import { Router, type NextFunction, type Request, type Response } from 'express';
import type { MetaAccountInfo } from '../../src/types/index.js';
import {
  getServerConfig,
  isEmailAllowedForMetaSystemUser,
  normalizeMetaAdAccountId,
} from '../config.js';
import { getFirestoreStore, type ProjectDoc } from '../lib/firestore.js';
import { MetaApiError, metaGet } from '../lib/meta.js';
import {
  type MetaAdObject,
  type MetaAdSetObject,
  type MetaCampaignObject,
  type MetaInsightsRow,
  mapMetaAds,
  mapMetaAdSets,
  mapMetaCampaigns,
  mapMetaOverview,
  mapMetaSpendOverTime,
} from '../lib/metaAdsMapper.js';
import { VaultError } from '../lib/tokenVault.js';
import { getVault } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser } from '../middleware/requireUser.js';
import { googleRateLimitMiddleware } from './connections.js';

export const metaRouter = Router();

export interface MetaAccessContext {
  accessToken: string;
  appSecret: string;
  accountId: string;
  source: 'user' | 'system';
}

// In-memory cache with 10-minute TTL
const CACHE_TTL_MS = 10 * 60 * 1000;
const metaCache = new Map<string, { expiresAt: number; data: unknown }>();

export function clearMetaCache(): void {
  metaCache.clear();
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ValidatedDateQuery {
  startDate: string;
  endDate: string;
  compareStartDate?: string;
  compareEndDate?: string;
}

function validateDateQuery(req: Request, res: Response): ValidatedDateQuery | null {
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';
  const compareStartDate =
    typeof req.query.compareStartDate === 'string' ? req.query.compareStartDate.trim() : undefined;
  const compareEndDate =
    typeof req.query.compareEndDate === 'string' ? req.query.compareEndDate.trim() : undefined;

  if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
    res.status(400).json({
      error: {
        code: 'INVALID_DATE_PARAMS',
        message: 'startDate and endDate are required in YYYY-MM-DD format.',
      },
    });
    return null;
  }

  if (startDate > endDate) {
    res.status(400).json({
      error: {
        code: 'INVALID_DATE_RANGE',
        message: 'startDate must be less than or equal to endDate.',
      },
    });
    return null;
  }

  if (compareStartDate !== undefined || compareEndDate !== undefined) {
    if (
      !compareStartDate ||
      !compareEndDate ||
      !ISO_DATE_RE.test(compareStartDate) ||
      !ISO_DATE_RE.test(compareEndDate)
    ) {
      res.status(400).json({
        error: {
          code: 'INVALID_COMPARE_DATE_PARAMS',
          message: 'compareStartDate and compareEndDate must both be valid YYYY-MM-DD dates.',
        },
      });
      return null;
    }

    if (compareStartDate > compareEndDate) {
      res.status(400).json({
        error: {
          code: 'INVALID_COMPARE_DATE_RANGE',
          message: 'compareStartDate must be less than or equal to compareEndDate.',
        },
      });
      return null;
    }
  }

  return {
    startDate,
    endDate,
    compareStartDate,
    compareEndDate,
  };
}

function getCache<T>(key: string): T | null {
  const hit = metaCache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    metaCache.delete(key);
    return null;
  }
  return hit.data as T;
}

function setCache(key: string, data: unknown): void {
  metaCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data,
  });
}

function buildCacheKey(
  uid: string,
  source: string,
  accountId: string,
  routeName: string,
  dates: ValidatedDateQuery,
  extra: string = ''
): string {
  return `${uid}:${source}:${accountId}:${routeName}:${dates.startDate}:${dates.endDate}:${dates.compareStartDate ?? ''}:${dates.compareEndDate ?? ''}:${extra}`;
}

function handleMetaRouteError(res: Response, err: unknown): void {
  if (err instanceof MetaApiError) {
    const status =
      err.code === 'META_TOKEN_INVALID' || err.code === 'META_TOKEN_EXPIRED' ? 401 : err.status;
    res.status(status).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  res.status(502).json({
    error: {
      code: 'META_REQUEST_FAILED',
      message: 'Failed to fetch data from Meta Marketing API',
    },
  });
}

const ACCOUNT_STATUS_LABELS: Record<number, string> = {
  1: 'Active',
  2: 'Disabled',
  3: 'Unsettled',
  7: 'Pending Risk Review',
  8: 'Pending Settlement',
  9: 'In Grace Period',
  100: 'Pending Closure',
  101: 'Closed',
};

function formatAccountStatus(status: number | string | undefined): string {
  if (typeof status === 'number') {
    return ACCOUNT_STATUS_LABELS[status] ?? `Status ${status}`;
  }
  if (typeof status === 'string' && status.trim() !== '') {
    const asNum = Number(status);
    if (Number.isInteger(asNum) && ACCOUNT_STATUS_LABELS[asNum]) {
      return ACCOUNT_STATUS_LABELS[asNum];
    }
    return status;
  }
  return 'Active';
}

const BASE_INSIGHTS_FIELDS =
  'spend,impressions,reach,inline_link_clicks,clicks,actions,account_currency,date_start,date_stop';

function buildInsightsParams(
  startDate: string,
  endDate: string,
  level: 'account' | 'campaign' | 'adset' | 'ad',
  extraFields: string[] = [],
  extraParams: Record<string, string | number | boolean | undefined> = {}
): Record<string, string | number | boolean | undefined> {
  const fields =
    extraFields.length > 0
      ? `${extraFields.join(',')},${BASE_INSIGHTS_FIELDS}`
      : BASE_INSIGHTS_FIELDS;

  return {
    level,
    fields,
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    use_unified_attribution_setting: 'true',
    limit: 500,
    ...extraParams,
  };
}

async function resolveDefaultProjectForUser(uid: string): Promise<ProjectDoc | undefined> {
  try {
    const store = getFirestoreStore();
    const workspaces = await store.listWorkspacesForUser(uid);
    for (const ws of workspaces) {
      if (!ws.members?.[uid]) continue;
      const projects = await store.listProjects(ws.id);
      const nonDemo = projects.find((p) => !p.isDemo);
      if (nonDemo) return nonDemo;
      if (projects[0]) return projects[0];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function resolveMetaAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const cfg = getServerConfig();
  const uid = req.user!.uid;
  const vaultAvailable = cfg.vaultReady;

  if (vaultAvailable) {
    try {
      const userAccessToken = await getVault().getAccessToken(uid, 'meta');
      const activeProject = req.project ?? (await resolveDefaultProjectForUser(uid));
      const projectAccountId = normalizeMetaAdAccountId(
        activeProject?.metaAdAccountId ?? undefined
      );

      if (!projectAccountId) {
        res.status(409).json({
          error: {
            code: 'META_NO_AD_ACCOUNT',
            message: 'Choose a Facebook ad account first.',
          },
        });
        return;
      }

      const metaAccess: MetaAccessContext = {
        accessToken: userAccessToken,
        appSecret: cfg.metaAppSecret,
        accountId: projectAccountId,
        source: 'user',
      };
      res.locals.metaAccess = metaAccess;
      next();
      return;
    } catch (err) {
      if (err instanceof VaultError) {
        if (err.code === 'VAULT_REAUTH_REQUIRED' || err.code === 'VAULT_DECRYPT_FAILED') {
          res.status(401).json({
            error: {
              code: 'META_REAUTH_REQUIRED',
              message: 'Facebook access has expired. Reconnect Facebook.',
            },
          });
          return;
        }
        if (err.code !== 'VAULT_NOT_CONNECTED') {
          res.status(err.status).json({
            error: {
              code: err.code,
              message: err.message,
            },
          });
          return;
        }
      } else {
        res.status(502).json({
          error: {
            code: 'META_REQUEST_FAILED',
            message: 'Failed to fetch data from Meta Marketing API',
          },
        });
        return;
      }
    }
  }

  // Fallback to shared system token ONLY when cfg.metaConfigured and user's email is allowlisted
  const metaAllowed = isEmailAllowedForMetaSystemUser(req.user?.email);
  if (cfg.metaConfigured && metaAllowed) {
    const accountId =
      normalizeMetaAdAccountId(req.project?.metaAdAccountId ?? undefined) || cfg.metaAdAccountId;
    const metaAccess: MetaAccessContext = {
      accessToken: cfg.metaAccessToken,
      appSecret: cfg.metaAppSecret,
      accountId,
      source: 'system',
    };
    res.locals.metaAccess = metaAccess;
    next();
    return;
  }

  if (!vaultAvailable) {
    if (!metaAllowed) {
      res.status(403).json({
        error: {
          code: 'META_NOT_AVAILABLE',
          message: 'Connecting your own Facebook account is coming soon',
        },
      });
      return;
    }
    res.status(503).json({
      error: {
        code: 'META_NOT_CONFIGURED',
        message: `Meta Ads integration is not configured. Missing environment variables: ${cfg.metaMissing.join(', ')}`,
      },
    });
    return;
  }

  res.status(404).json({
    error: {
      code: 'NOT_CONNECTED',
      message: 'Facebook account is not connected.',
    },
  });
}

function getMetaAccess(res: Response): MetaAccessContext {
  return res.locals.metaAccess as MetaAccessContext;
}

// Apply rate limiter, requireUser, loadProject, and resolveMetaAccess to all /api/meta/* routes
metaRouter.use(googleRateLimitMiddleware);
metaRouter.use(requireUser);
metaRouter.use(loadProject);
metaRouter.use(resolveMetaAccess);

// GET /api/meta/account -> MetaAccountInfo
metaRouter.get('/account', async (req: Request, res: Response) => {
  const { accountId, accessToken, appSecret, source } = getMetaAccess(res);
  const uid = req.user?.uid ?? 'anon';
  const cacheKey = `${uid}:${source}:${accountId}:account`;

  const cached = getCache<MetaAccountInfo>(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    const raw = await metaGet<{
      id?: string;
      name?: string;
      currency?: string;
      timezone_name?: string;
      account_status?: number | string;
    }>(
      `act_${accountId}`,
      {
        fields: 'name,currency,timezone_name,account_status',
      },
      { accessToken, appSecret }
    );

    const data: MetaAccountInfo = {
      accountId,
      name: raw.name || `Ad Account ${accountId}`,
      currency: raw.currency || 'USD',
      timezoneName: raw.timezone_name || 'UTC',
      status: formatAccountStatus(raw.account_status),
    };

    setCache(cacheKey, data);
    res.setHeader('X-AdLens-Cache', 'false');
    res.json(data);
  } catch (err) {
    handleMetaRouteError(res, err);
  }
});

// GET /api/meta/overview -> MetaAdsOverview
metaRouter.get('/overview', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const { accountId, accessToken, appSecret, source } = getMetaAccess(res);
  const uid = req.user?.uid ?? 'anon';
  const cacheKey = buildCacheKey(uid, source, accountId, 'overview', dates);
  const credentials = { accessToken, appSecret };

  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    // ONE level=account insights row per period, no time_increment (so reach is de-duplicated)
    const [currentRes, previousRes] = await Promise.all([
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${accountId}/insights`,
        buildInsightsParams(dates.startDate, dates.endDate, 'account'),
        credentials
      ),
      dates.compareStartDate && dates.compareEndDate
        ? metaGet<{ data?: MetaInsightsRow[] }>(
            `act_${accountId}/insights`,
            buildInsightsParams(dates.compareStartDate, dates.compareEndDate, 'account'),
            credentials
          )
        : Promise.resolve({ data: [] as MetaInsightsRow[] }),
    ]);

    const currentRow = currentRes.data?.[0];
    const previousRow = previousRes.data?.[0];
    const mapped = mapMetaOverview(currentRow, previousRow);
    const accountCurrency = currentRow?.account_currency || previousRow?.account_currency;
    const data = accountCurrency ? { ...mapped, accountCurrency } : mapped;
    setCache(cacheKey, data);
    res.setHeader('X-AdLens-Cache', 'false');
    res.json(data);
  } catch (err) {
    handleMetaRouteError(res, err);
  }
});

// GET /api/meta/spend-over-time -> MetaSpendPoint[]
metaRouter.get('/spend-over-time', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const { accountId, accessToken, appSecret, source } = getMetaAccess(res);
  const uid = req.user?.uid ?? 'anon';
  const cacheKey = buildCacheKey(uid, source, accountId, 'spend-over-time', dates);
  const credentials = { accessToken, appSecret };

  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    const [currentRes, previousRes] = await Promise.all([
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${accountId}/insights`,
        buildInsightsParams(dates.startDate, dates.endDate, 'account', [], {
          time_increment: 1,
        }),
        credentials
      ),
      dates.compareStartDate && dates.compareEndDate
        ? metaGet<{ data?: MetaInsightsRow[] }>(
            `act_${accountId}/insights`,
            buildInsightsParams(dates.compareStartDate, dates.compareEndDate, 'account', [], {
              time_increment: 1,
            }),
            credentials
          )
        : Promise.resolve({ data: [] as MetaInsightsRow[] }),
    ]);

    const data = mapMetaSpendOverTime(
      currentRes.data ?? [],
      dates.startDate,
      dates.endDate,
      previousRes.data ?? [],
      dates.compareStartDate,
      dates.compareEndDate
    );

    setCache(cacheKey, data);
    res.setHeader('X-AdLens-Cache', 'false');
    res.json(data);
  } catch (err) {
    handleMetaRouteError(res, err);
  }
});

// GET /api/meta/campaigns -> MetaCampaignRow[]
metaRouter.get('/campaigns', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const { accountId, accessToken, appSecret, source } = getMetaAccess(res);
  const uid = req.user?.uid ?? 'anon';
  const cacheKey = buildCacheKey(uid, source, accountId, 'campaigns', dates);
  const credentials = { accessToken, appSecret };

  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    const [campaignsRes, insightsRes] = await Promise.all([
      metaGet<{ data?: MetaCampaignObject[] }>(
        `act_${accountId}/campaigns`,
        {
          fields: 'id,name,objective,effective_status',
          limit: 500,
        },
        credentials
      ),
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${accountId}/insights`,
        buildInsightsParams(dates.startDate, dates.endDate, 'campaign', [
          'campaign_id',
          'campaign_name',
        ]),
        credentials
      ),
    ]);

    const data = mapMetaCampaigns(campaignsRes.data ?? [], insightsRes.data ?? []);
    setCache(cacheKey, data);
    res.setHeader('X-AdLens-Cache', 'false');
    res.json(data);
  } catch (err) {
    handleMetaRouteError(res, err);
  }
});

// GET /api/meta/adsets?campaignId= -> MetaAdSetRow[]
metaRouter.get('/adsets', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const campaignId =
    typeof req.query.campaignId === 'string' && req.query.campaignId.trim() !== ''
      ? req.query.campaignId.trim()
      : undefined;

  const { accountId, accessToken, appSecret, source } = getMetaAccess(res);
  const uid = req.user?.uid ?? 'anon';
  const cacheKey = buildCacheKey(uid, source, accountId, 'adsets', dates, campaignId ?? 'all');
  const credentials = { accessToken, appSecret };

  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    const [campaignsRes, adSetsRes, insightsRes] = await Promise.all([
      metaGet<{ data?: MetaCampaignObject[] }>(
        `act_${accountId}/campaigns`,
        {
          fields: 'id,name',
          limit: 500,
        },
        credentials
      ),
      metaGet<{ data?: MetaAdSetObject[] }>(
        `act_${accountId}/adsets`,
        {
          fields: 'id,name,campaign_id,effective_status,targeting',
          limit: 500,
        },
        credentials
      ),
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${accountId}/insights`,
        buildInsightsParams(dates.startDate, dates.endDate, 'adset', [
          'campaign_id',
          'campaign_name',
          'adset_id',
          'adset_name',
        ]),
        credentials
      ),
    ]);

    const campaignNames = new Map<string, string>();
    for (const c of campaignsRes.data ?? []) {
      if (c.id && c.name) {
        campaignNames.set(c.id, c.name);
      }
    }

    const data = mapMetaAdSets(
      adSetsRes.data ?? [],
      insightsRes.data ?? [],
      campaignNames,
      campaignId
    );
    setCache(cacheKey, data);
    res.setHeader('X-AdLens-Cache', 'false');
    res.json(data);
  } catch (err) {
    handleMetaRouteError(res, err);
  }
});

// GET /api/meta/ads?adSetId= -> MetaAdRow[]
metaRouter.get('/ads', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const adSetId =
    typeof req.query.adSetId === 'string' && req.query.adSetId.trim() !== ''
      ? req.query.adSetId.trim()
      : undefined;

  const { accountId, accessToken, appSecret, source } = getMetaAccess(res);
  const uid = req.user?.uid ?? 'anon';
  const cacheKey = buildCacheKey(uid, source, accountId, 'ads', dates, adSetId ?? 'all');
  const credentials = { accessToken, appSecret };

  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    const [campaignsRes, adSetsRes, adsRes, insightsRes] = await Promise.all([
      metaGet<{ data?: MetaCampaignObject[] }>(
        `act_${accountId}/campaigns`,
        {
          fields: 'id,name',
          limit: 500,
        },
        credentials
      ),
      metaGet<{ data?: MetaAdSetObject[] }>(
        `act_${accountId}/adsets`,
        {
          fields: 'id,name,campaign_id',
          limit: 500,
        },
        credentials
      ),
      metaGet<{ data?: MetaAdObject[] }>(
        `act_${accountId}/ads`,
        {
          fields:
            'id,name,adset_id,campaign_id,effective_status,creative{object_type,video_id,object_story_spec,asset_feed_spec}',
          limit: 500,
        },
        credentials
      ),
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${accountId}/insights`,
        buildInsightsParams(dates.startDate, dates.endDate, 'ad', [
          'campaign_id',
          'campaign_name',
          'adset_id',
          'adset_name',
          'ad_id',
          'ad_name',
        ]),
        credentials
      ),
    ]);

    const campaignNames = new Map<string, string>();
    for (const c of campaignsRes.data ?? []) {
      if (c.id && c.name) {
        campaignNames.set(c.id, c.name);
      }
    }

    const adSetNames = new Map<string, string>();
    for (const s of adSetsRes.data ?? []) {
      if (s.id && s.name) {
        adSetNames.set(s.id, s.name);
      }
    }

    const data = mapMetaAds(
      adsRes.data ?? [],
      insightsRes.data ?? [],
      adSetNames,
      campaignNames,
      adSetId
    );
    setCache(cacheKey, data);
    res.setHeader('X-AdLens-Cache', 'false');
    res.json(data);
  } catch (err) {
    handleMetaRouteError(res, err);
  }
});
