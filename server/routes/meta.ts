import { Router, type NextFunction, type Request, type Response } from 'express';
import type { MetaAccountInfo } from '../../src/types/index.js';
import {
  getServerConfig,
  isEmailAllowedForMetaSystemUser,
  normalizeMetaAdAccountId,
  requireMetaConfigured,
} from '../config.js';
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
import { loadProject } from '../middleware/loadProject.js';
import { requireUser } from '../middleware/requireUser.js';
import { googleRateLimitMiddleware } from './connections.js';

export const metaRouter = Router();

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
  accountId: string,
  routeName: string,
  dates: ValidatedDateQuery,
  extra: string = ''
): string {
  return `${accountId}:${routeName}:${dates.startDate}:${dates.endDate}:${dates.compareStartDate ?? ''}:${dates.compareEndDate ?? ''}:${extra}`;
}

function handleMetaRouteError(res: Response, err: unknown): void {
  if (err instanceof MetaApiError) {
    res.status(err.status).json({
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

function requireMetaSystemUserAllowlist(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isEmailAllowedForMetaSystemUser(req.user?.email)) {
    res.status(403).json({
      error: {
        code: 'META_NOT_AVAILABLE',
        message: 'Connecting your own Facebook account is coming soon',
      },
    });
    return;
  }
  next();
}

function resolveMetaAccountId(req: Request): string {
  const cfg = getServerConfig();
  if (req.project?.metaAdAccountId) {
    return normalizeMetaAdAccountId(req.project.metaAdAccountId) || cfg.metaAdAccountId;
  }
  return cfg.metaAdAccountId;
}

// Apply rate limiter, requireUser, loadProject, Meta allowlist safeguard, and Meta configuration check to all /api/meta/* routes
metaRouter.use(googleRateLimitMiddleware);
metaRouter.use(requireUser);
metaRouter.use(loadProject);
metaRouter.use(requireMetaSystemUserAllowlist);
metaRouter.use(requireMetaConfigured);

// GET /api/meta/account -> MetaAccountInfo
metaRouter.get('/account', async (req: Request, res: Response) => {
  const accountId = resolveMetaAccountId(req);
  const cacheKey = `${accountId}:account`;

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
    }>(`act_${accountId}`, {
      fields: 'name,currency,timezone_name,account_status',
    });

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

  const accountId = resolveMetaAccountId(req);
  const cacheKey = buildCacheKey(accountId, 'overview', dates);

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
        buildInsightsParams(dates.startDate, dates.endDate, 'account')
      ),
      dates.compareStartDate && dates.compareEndDate
        ? metaGet<{ data?: MetaInsightsRow[] }>(
            `act_${accountId}/insights`,
            buildInsightsParams(dates.compareStartDate, dates.compareEndDate, 'account')
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

  const accountId = resolveMetaAccountId(req);
  const cacheKey = buildCacheKey(accountId, 'spend-over-time', dates);

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
        })
      ),
      dates.compareStartDate && dates.compareEndDate
        ? metaGet<{ data?: MetaInsightsRow[] }>(
            `act_${accountId}/insights`,
            buildInsightsParams(dates.compareStartDate, dates.compareEndDate, 'account', [], {
              time_increment: 1,
            })
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

  const accountId = resolveMetaAccountId(req);
  const cacheKey = buildCacheKey(accountId, 'campaigns', dates);

  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    const [campaignsRes, insightsRes] = await Promise.all([
      metaGet<{ data?: MetaCampaignObject[] }>(`act_${accountId}/campaigns`, {
        fields: 'id,name,objective,effective_status',
        limit: 500,
      }),
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${accountId}/insights`,
        buildInsightsParams(dates.startDate, dates.endDate, 'campaign', [
          'campaign_id',
          'campaign_name',
        ])
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

  const accountId = resolveMetaAccountId(req);
  const cacheKey = buildCacheKey(accountId, 'adsets', dates, campaignId ?? 'all');

  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    const [campaignsRes, adSetsRes, insightsRes] = await Promise.all([
      metaGet<{ data?: MetaCampaignObject[] }>(`act_${accountId}/campaigns`, {
        fields: 'id,name',
        limit: 500,
      }),
      metaGet<{ data?: MetaAdSetObject[] }>(`act_${accountId}/adsets`, {
        fields: 'id,name,campaign_id,effective_status,targeting',
        limit: 500,
      }),
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${accountId}/insights`,
        buildInsightsParams(dates.startDate, dates.endDate, 'adset', [
          'campaign_id',
          'campaign_name',
          'adset_id',
          'adset_name',
        ])
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

  const accountId = resolveMetaAccountId(req);
  const cacheKey = buildCacheKey(accountId, 'ads', dates, adSetId ?? 'all');

  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(cached);
    return;
  }

  try {
    const [campaignsRes, adSetsRes, adsRes, insightsRes] = await Promise.all([
      metaGet<{ data?: MetaCampaignObject[] }>(`act_${accountId}/campaigns`, {
        fields: 'id,name',
        limit: 500,
      }),
      metaGet<{ data?: MetaAdSetObject[] }>(`act_${accountId}/adsets`, {
        fields: 'id,name,campaign_id',
        limit: 500,
      }),
      metaGet<{ data?: MetaAdObject[] }>(`act_${accountId}/ads`, {
        fields:
          'id,name,adset_id,campaign_id,effective_status,creative{object_type,video_id,object_story_spec,asset_feed_spec}',
        limit: 500,
      }),
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${accountId}/insights`,
        buildInsightsParams(dates.startDate, dates.endDate, 'ad', [
          'campaign_id',
          'campaign_name',
          'adset_id',
          'adset_name',
          'ad_id',
          'ad_name',
        ])
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
