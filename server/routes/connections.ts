import { Router, type NextFunction, type Request, type Response } from 'express';
import { getServerConfig, requireGoogleConfigured } from '../config.ts';
import {
  fetchGA4Properties,
  fetchSearchConsoleSites,
  getValidAccessToken,
  GoogleApiError,
} from '../lib/google.ts';
import { readSession, writeSession } from '../lib/session.ts';

export const connectionsRouter = Router();
export const googleApiRouter = Router();

// Simple in-memory rate limiter: 60 requests per minute per IP on /api/google/*
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const ipRequestCounters = new Map<string, { count: number; resetAt: number }>();

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
  if (err instanceof GoogleApiError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
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

// GET /api/connections
connectionsRouter.get('/', (req: Request, res: Response) => {
  const cfg = getServerConfig();
  const session = readSession(req);
  const googleSession = session.google;
  const isConnected = Boolean(cfg.googleConfigured && googleSession?.refreshToken);

  res.json({
    google: {
      configured: cfg.googleConfigured,
      missing: cfg.missing,
      connected: isConnected,
      email: isConnected ? googleSession?.email ?? null : null,
      ga4Property: isConnected ? googleSession?.ga4Property ?? null : null,
      searchConsoleSite: isConnected ? googleSession?.searchConsoleSite ?? null : null,
    },
    meta: {
      connected: false,
      availableIn: 'Sprint 5',
    },
  });
});

// Apply rate limit and configuration check to all /api/google/* routes
googleApiRouter.use(googleRateLimitMiddleware);
googleApiRouter.use(requireGoogleConfigured);

// GET /api/google/ga4/properties
googleApiRouter.get('/ga4/properties', async (req: Request, res: Response) => {
  try {
    const session = readSession(req);
    const accessToken = await getValidAccessToken(session, res);
    const properties = await fetchGA4Properties(accessToken);
    res.json(properties);
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/google/search-console/sites
googleApiRouter.get('/search-console/sites', async (req: Request, res: Response) => {
  try {
    const session = readSession(req);
    const accessToken = await getValidAccessToken(session, res);
    const sites = await fetchSearchConsoleSites(accessToken);
    res.json(sites);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/google/selection
googleApiRouter.post('/selection', async (req: Request, res: Response) => {
  try {
    const session = readSession(req);
    const accessToken = await getValidAccessToken(session, res);

    if (!session.google) {
      throw new GoogleApiError('GOOGLE_NOT_CONNECTED', 'Google account is not connected.', 401);
    }

    const body = (req.body ?? {}) as {
      ga4PropertyId?: string | null;
      searchConsoleSiteUrl?: string | null;
    };

    // Validate GA4 property if provided
    if (body.ga4PropertyId !== undefined) {
      if (body.ga4PropertyId === null || body.ga4PropertyId === '') {
        delete session.google.ga4Property;
      } else {
        const properties = await fetchGA4Properties(accessToken);
        const normalizedTarget = String(body.ga4PropertyId).replace(/^properties\//, '');
        const matchedProp = properties.find(
          (p) => p.propertyId === normalizedTarget || `properties/${p.propertyId}` === body.ga4PropertyId
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

        session.google.ga4Property = {
          id: matchedProp.propertyId,
          name: matchedProp.propertyName,
        };
      }
    }

    // Validate Search Console site if provided
    if (body.searchConsoleSiteUrl !== undefined) {
      if (body.searchConsoleSiteUrl === null || body.searchConsoleSiteUrl === '') {
        delete session.google.searchConsoleSite;
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

        session.google.searchConsoleSite = {
          url: matchedSite.siteUrl,
        };
      }
    }

    writeSession(res, session);

    res.json({
      ok: true,
      ga4Property: session.google.ga4Property ?? null,
      searchConsoleSite: session.google.searchConsoleSite ?? null,
    });
  } catch (err) {
    sendError(res, err);
  }
});
