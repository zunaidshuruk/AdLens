import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  getServerConfig,
  isEmailAllowedForMetaSystemUser,
  normalizeMetaAdAccountId,
  requireGoogleConfigured,
} from '../config.js';
import { getFirestoreStore } from '../lib/firestore.js';
import {
  fetchGA4Properties,
  fetchGA4StreamUris,
  fetchSearchConsoleSites,
  GoogleApiError,
  type GA4PropertySummaryItem,
} from '../lib/google.js';
import {
  matchSourcesForDomain,
  normalizeDomain,
  scoreGA4Property,
} from '../lib/sourceMatcher.js';
import { getVault, mapVaultError } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

export const connectionsRouter = Router();
export const googleApiRouter = Router();

// Simple in-memory rate limiter: 60 requests per minute per IP on /api/google/*
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const ipRequestCounters = new Map<string, { count: number; resetAt: number }>();

export function clearGoogleRateLimit(): void {
  ipRequestCounters.clear();
}

export function googleRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = ipRequestCounters.get(ip);

  if (!entry || now >= entry.resetAt) {
    ipRequestCounters.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded (max 60 requests per minute). Please wait and try again.',
      },
    });
    return;
  }

  entry.count += 1;
  next();
}

function sendError(res: Response, err: unknown): void {
  const mapped = mapVaultError(err) ?? (err instanceof GoogleApiError ? err : null);
  if (mapped) {
    res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
    return;
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: err instanceof Error ? err.message : 'An unexpected server error occurred.',
    },
  });
}

// Require authenticated & verified Firebase user and matching Google session uid / lazy migration
connectionsRouter.use(requireUser);
connectionsRouter.use(verifyGoogleSessionOwnership);
connectionsRouter.use(loadProject);

// GET /api/connections
connectionsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const cfg = getServerConfig();
    const uid = req.user!.uid;
    const summary = cfg.vaultReady ? await getVault().getSummary(uid, 'google') : null;
    const isConnected = Boolean(cfg.googleConfigured && summary?.connected);
    const needsReconnect = Boolean(summary?.needsReconnect);
    const metaAllowed = isEmailAllowedForMetaSystemUser(req.user?.email);

    const projectGa4 =
      req.project?.ga4PropertyId
        ? {
            id: req.project.ga4PropertyId,
            name: req.project.ga4PropertyName || req.project.ga4PropertyId,
          }
        : null;
    const projectSc =
      req.project?.searchConsoleSite
        ? {
            url: req.project.searchConsoleSite,
          }
        : null;

    const effectiveGa4 = isConnected ? projectGa4 : null;
    const effectiveSc = isConnected ? projectSc : null;
    const effectiveMetaAccountId =
      cfg.metaConfigured && metaAllowed
        ? normalizeMetaAdAccountId(req.project?.metaAdAccountId || cfg.metaAdAccountId)
        : null;

    res.json({
      google: {
        configured: cfg.googleConfigured,
        missing: cfg.missing,
        connected: isConnected,
        email: summary?.accountLabel ?? null,
        needsReconnect,
        vault: summary,
        ga4Property: effectiveGa4,
        searchConsoleSite: effectiveSc,
      },
      meta: {
        configured: cfg.metaConfigured,
        missing: cfg.metaMissing,
        connected: Boolean(cfg.metaConfigured && metaAllowed),
        adAccountId: effectiveMetaAccountId,
        notAvailable: !metaAllowed,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Apply rate limit, auth, session ownership/migration, project loader, and configuration check to all /api/google/* routes
googleApiRouter.use(googleRateLimitMiddleware);
googleApiRouter.use(requireUser);
googleApiRouter.use(verifyGoogleSessionOwnership);
googleApiRouter.use(loadProject);
googleApiRouter.use(requireGoogleConfigured);

// GET /api/google/ga4/properties
googleApiRouter.get('/ga4/properties', async (req: Request, res: Response) => {
  try {
    const accessToken = await getVault().getAccessToken(req.user!.uid, 'google');
    const properties = await fetchGA4Properties(accessToken);
    res.json(properties);
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/google/search-console/sites
googleApiRouter.get('/search-console/sites', async (req: Request, res: Response) => {
  try {
    const accessToken = await getVault().getAccessToken(req.user!.uid, 'google');
    const sites = await fetchSearchConsoleSites(accessToken);
    res.json(sites);
  } catch (err) {
    sendError(res, err);
  }
});

const MAX_DISCOVER_STREAM_PROPERTIES = 20;
const DISCOVER_STREAM_CONCURRENCY = 5;
const DISCOVER_STREAM_TIMEOUT_MS = 8_000;

async function fetchStreamUrisWithTimeout(
  accessToken: string,
  propertyId: string
): Promise<string[] | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchGA4StreamUris(accessToken, propertyId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Stream lookup timed out')),
          DISCOVER_STREAM_TIMEOUT_MS
        );
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

// GET /api/google/discover?domain=<text>
googleApiRouter.get('/discover', async (req: Request, res: Response) => {
  const rawDomain = typeof req.query.domain === 'string' ? req.query.domain.trim() : '';
  if (rawDomain.length < 1 || rawDomain.length > 253) {
    res.status(400).json({
      error: {
        code: 'INVALID_DOMAIN',
        message: 'Domain must be between 1 and 253 characters.',
      },
    });
    return;
  }

  try {
    const accessToken = await getVault().getAccessToken(req.user!.uid, 'google');
    const [properties, sites] = await Promise.all([
      fetchGA4Properties(accessToken),
      fetchSearchConsoleSites(accessToken),
    ]);

    const normalizedDomain = normalizeDomain(rawDomain) || rawDomain.toLowerCase();
    const scoredForOrdering = properties.map((prop, index) => ({
      prop,
      index,
      nameScore: scoreGA4Property(normalizedDomain, {
        propertyId: prop.propertyId,
        displayName: prop.propertyName,
        accountName: prop.accountName,
      }).score,
    }));
    scoredForOrdering.sort((a, b) => b.nameScore - a.nameScore || a.index - b.index);

    const propertiesToCheck: GA4PropertySummaryItem[] = scoredForOrdering
      .slice(0, MAX_DISCOVER_STREAM_PROPERTIES)
      .map((item) => item.prop);

    const streamUrisByProperty = new Map<string, string[]>();
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < propertiesToCheck.length) {
        const currentIndex = cursor;
        cursor += 1;
        const prop = propertiesToCheck[currentIndex];
        const uris = await fetchStreamUrisWithTimeout(accessToken, prop.propertyId);
        if (uris !== undefined) {
          streamUrisByProperty.set(prop.propertyId, uris);
        }
      }
    }

    const workerCount = Math.min(DISCOVER_STREAM_CONCURRENCY, propertiesToCheck.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const ga4Candidates = properties.map((prop) => ({
      propertyId: prop.propertyId,
      displayName: prop.propertyName,
      accountName: prop.accountName,
      streamUris: streamUrisByProperty.get(prop.propertyId),
    }));

    const searchConsoleCandidates = sites.map((site) => ({
      siteUrl: site.siteUrl,
      permissionLevel: site.permissionLevel,
    }));

    const matched = matchSourcesForDomain(rawDomain, ga4Candidates, searchConsoleCandidates);

    res.json({
      ...matched,
      checkedProperties: propertiesToCheck.length,
      totalProperties: properties.length,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/google/selection
googleApiRouter.post('/selection', async (req: Request, res: Response) => {
  try {
    const accessToken = await getVault().getAccessToken(req.user!.uid, 'google');

    const body = (req.body ?? {}) as {
      ga4PropertyId?: string | null;
      searchConsoleSiteUrl?: string | null;
    };

    let selectedGa4: { id: string; name: string } | null = req.project?.ga4PropertyId
      ? {
          id: req.project.ga4PropertyId,
          name: req.project.ga4PropertyName || req.project.ga4PropertyId,
        }
      : null;

    let selectedSc: { url: string } | null = req.project?.searchConsoleSite
      ? { url: req.project.searchConsoleSite }
      : null;

    // Validate GA4 property if provided
    if (body.ga4PropertyId !== undefined) {
      if (body.ga4PropertyId === null || body.ga4PropertyId === '') {
        selectedGa4 = null;
      } else {
        const properties = await fetchGA4Properties(accessToken);
        const normalizedTarget = String(body.ga4PropertyId).replace(/^properties\//, '');
        const matchedProp = properties.find(
          (p) =>
            p.propertyId === normalizedTarget ||
            `properties/${p.propertyId}` === body.ga4PropertyId
        );

        if (!matchedProp) {
          res.status(400).json({
            error: {
              code: 'INVALID_GA4_PROPERTY',
              message: `GA4 property "${body.ga4PropertyId}" was not found on this Google account.`,
            },
          });
          return;
        }

        selectedGa4 = {
          id: matchedProp.propertyId,
          name: matchedProp.propertyName,
        };
      }
    }

    // Validate Search Console site if provided
    if (body.searchConsoleSiteUrl !== undefined) {
      if (body.searchConsoleSiteUrl === null || body.searchConsoleSiteUrl === '') {
        selectedSc = null;
      } else {
        const sites = await fetchSearchConsoleSites(accessToken);
        const matchedSite = sites.find((s) => s.siteUrl === body.searchConsoleSiteUrl);

        if (!matchedSite) {
          res.status(400).json({
            error: {
              code: 'INVALID_SEARCH_CONSOLE_SITE',
              message: `Verified Search Console site "${body.searchConsoleSiteUrl}" was not found on this Google account.`,
            },
          });
          return;
        }

        selectedSc = {
          url: matchedSite.siteUrl,
        };
      }
    }

    // Only PATCH the active project's ga4PropertyId/Name and searchConsoleSite; never write the cookie
    if (req.project) {
      const store = getFirestoreStore();
      await store.updateProject(req.project.workspaceId, req.project.id, {
        ...(body.ga4PropertyId !== undefined
          ? {
              ga4PropertyId: selectedGa4?.id ?? null,
              ga4PropertyName: selectedGa4?.name ?? null,
            }
          : {}),
        ...(body.searchConsoleSiteUrl !== undefined
          ? {
              searchConsoleSite: selectedSc?.url ?? null,
            }
          : {}),
      });
    }

    res.json({
      ok: true,
      ga4Property: selectedGa4,
      searchConsoleSite: selectedSc,
    });
  } catch (err) {
    sendError(res, err);
  }
});

