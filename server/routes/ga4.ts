import { cacheClear, cacheGet, cacheSet } from '../lib/responseCache.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireGoogleConfigured } from '../config.js';
import { GoogleApiError } from '../lib/google.js';
import { getVault, mapVaultError } from '../lib/vault.js';
import {
  ga4AcquisitionReport,
  ga4AiTrafficReport,
  ga4CampaignsReport,
  ga4ConversionsReport,
  ga4OverviewReport,
  ga4PropertyInfoReport,
  ga4SourceGroupsReport,
  ga4TopPagesReport,
  ga4TrafficBreakdownReport,
  ga4TrafficOverTimeReport,
} from '../reports/ga4Reports.js';
import {
  type DateRangeInput,
  dateRangeSchema,
  optionalDateRangeSchema,
  trafficBreakdownInputSchema,
} from '../reports/schemas.js';
import type { ReportContext } from '../reports/types.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import { googleRateLimitMiddleware } from './connections.js';

export const ga4Router = Router();

// In-memory cache with 10-minute TTL
const CACHE_TTL_MS = 10 * 60 * 1000;

export function clearGA4Cache(): void {
  cacheClear('ga4');
}

function extractRawDatesFromQuery(req: Request) {
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';
  const compareStartDate =
    typeof req.query.compareStartDate === 'string' ? req.query.compareStartDate.trim() : undefined;
  const compareEndDate =
    typeof req.query.compareEndDate === 'string' ? req.query.compareEndDate.trim() : undefined;

  return {
    startDate,
    endDate,
    ...(compareStartDate !== undefined ? { compareStartDate } : {}),
    ...(compareEndDate !== undefined ? { compareEndDate } : {}),
  };
}

function validateDateQuery(req: Request, res: Response): DateRangeInput | null {
  const parsed = dateRangeSchema.safeParse(extractRawDatesFromQuery(req));
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_DATE_RANGE',
        message:
          parsed.error.issues[0]?.message ||
          'Query parameters startDate and endDate must be valid YYYY-MM-DD dates with startDate <= endDate.',
      },
    });
    return null;
  }
  return parsed.data;
}

function buildCacheKey(
  propertyId: string,
  routeName: string,
  dates?: {
    startDate?: string;
    endDate?: string;
    compareStartDate?: string;
    compareEndDate?: string;
  },
  extra: string = ''
): string {
  if (!dates || (!dates.startDate && !dates.endDate)) {
    return extra ? `${propertyId}:${routeName}:${extra}` : `${propertyId}:${routeName}`;
  }
  const base = `${propertyId}:${routeName}:${dates.startDate ?? ''}:${dates.endDate ?? ''}:${dates.compareStartDate ?? ''}:${dates.compareEndDate ?? ''}`;
  return extra ? `${base}:${extra}` : base;
}

function sendWithCache<T>(res: Response, cacheKey: string, data: T, fromCache: boolean): void {
  if (!fromCache) {
    void cacheSet('ga4', cacheKey, data, CACHE_TTL_MS);
  }
  res.setHeader('X-AdLens-Cache', fromCache ? 'true' : 'false');
  res.json(data);
}

async function getCached<T>(cacheKey: string): Promise<T | null> {
  return cacheGet<T>('ga4', cacheKey);
}

function handleGA4Error(res: Response, err: unknown): void {
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

  res.status(502).json({
    error: {
      code: 'GA4_REQUEST_FAILED',
      message: 'Unable to retrieve data from Google Analytics 4.',
    },
  });
}

function buildReportContext(req: Request, res: Response): ReportContext {
  const propertyId = String(res.locals.ga4PropertyId);
  const propertyName = String(res.locals.ga4PropertyName || propertyId);
  const accessToken = res.locals.googleAccessToken as string | undefined;

  return {
    getAccessToken: async () =>
      accessToken ?? getVault().getAccessToken(req.user!.uid, 'google'),
    ga4PropertyId: propertyId,
    ga4PropertyName: propertyName,
    ...(req.project ? { project: req.project } : {}),
  };
}

// Middleware: rate limit + requireUser + verifyGoogleSessionOwnership + loadProject + Google configured + connected vault with selected project ga4Property
ga4Router.use(googleRateLimitMiddleware);
ga4Router.use(requireUser);
ga4Router.use(verifyGoogleSessionOwnership);
ga4Router.use(loadProject);
ga4Router.use(requireGoogleConfigured);

async function requireGA4Session(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const accessToken = await getVault().getAccessToken(req.user!.uid, 'google');
    const selectedId = req.project?.ga4PropertyId;
    const selectedName = req.project?.ga4PropertyName || selectedId;

    if (!selectedId) {
      res.status(409).json({
        error: {
          code: 'GA4_NOT_SELECTED',
          message: 'A connected Google account with a selected GA4 property is required.',
        },
      });
      return;
    }

    res.locals.ga4PropertyId = selectedId;
    res.locals.ga4PropertyName = selectedName;
    res.locals.googleAccessToken = accessToken;
    next();
  } catch (err) {
    handleGA4Error(res, err);
  }
}

ga4Router.use(requireGA4Session);

// GET /api/ga4/overview
ga4Router.get('/overview', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const cacheKey = buildCacheKey(propertyId, 'overview', dates);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4OverviewReport.run(buildReportContext(req, res), dates);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/traffic-over-time
ga4Router.get('/traffic-over-time', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const cacheKey = buildCacheKey(propertyId, 'traffic-over-time', dates);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4TrafficOverTimeReport.run(buildReportContext(req, res), dates);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/acquisition
ga4Router.get('/acquisition', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const cacheKey = buildCacheKey(propertyId, 'acquisition', dates);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4AcquisitionReport.run(buildReportContext(req, res), dates);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/campaigns
ga4Router.get('/campaigns', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const cacheKey = buildCacheKey(propertyId, 'campaigns', dates);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4CampaignsReport.run(buildReportContext(req, res), dates);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/top-pages
ga4Router.get('/top-pages', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const cacheKey = buildCacheKey(propertyId, 'top-pages', dates);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4TopPagesReport.run(buildReportContext(req, res), dates);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/conversions
ga4Router.get('/conversions', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const cacheKey = buildCacheKey(propertyId, 'conversions', dates);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4ConversionsReport.run(buildReportContext(req, res), dates);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/property-info
ga4Router.get('/property-info', async (req: Request, res: Response) => {
  const rawDates =
    req.query.startDate || req.query.endDate ? extractRawDatesFromQuery(req) : {};
  const parsed = optionalDateRangeSchema.safeParse(rawDates);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_DATE_RANGE',
        message: parsed.error.issues[0]?.message || 'Invalid date range parameters.',
      },
    });
    return;
  }

  const propertyId = String(res.locals.ga4PropertyId).replace(/^properties\//, '');
  const cacheKey = buildCacheKey(propertyId, 'property-info', parsed.data);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const info = await ga4PropertyInfoReport.run(buildReportContext(req, res), parsed.data);
    sendWithCache(res, cacheKey, info, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/traffic-breakdown
ga4Router.get('/traffic-breakdown', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const rawDimension =
    typeof req.query.dimension === 'string' ? req.query.dimension.trim() : 'channel';
  const rawCountry =
    typeof req.query.country === 'string' && req.query.country.trim() !== ''
      ? req.query.country.trim()
      : undefined;
  const rawDevice =
    typeof req.query.deviceCategory === 'string' && req.query.deviceCategory.trim() !== ''
      ? req.query.deviceCategory.trim()
      : undefined;
  const rawBrowser =
    typeof req.query.browser === 'string' && req.query.browser.trim() !== ''
      ? req.query.browser.trim()
      : undefined;
  const rawLimit =
    typeof req.query.limit === 'string' && req.query.limit.trim() !== ''
      ? Number(req.query.limit)
      : undefined;

  const parsed = trafficBreakdownInputSchema.safeParse({
    ...dates,
    dimension: rawDimension,
    filters:
      rawCountry || rawDevice || rawBrowser
        ? {
            ...(rawCountry ? { country: rawCountry } : {}),
            ...(rawDevice ? { deviceCategory: rawDevice } : {}),
            ...(rawBrowser ? { browser: rawBrowser } : {}),
          }
        : undefined,
    ...(rawLimit !== undefined ? { limit: rawLimit } : {}),
  });

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_BREAKDOWN_PARAMS',
        message:
          parsed.error.issues[0]?.message ||
          'Invalid traffic breakdown parameters (dimension, filters, or limit).',
      },
    });
    return;
  }

  const propertyId = String(res.locals.ga4PropertyId);
  const filterKey = `${parsed.data.dimension}:${rawCountry ?? ''}:${rawDevice ?? ''}:${rawBrowser ?? ''}:${parsed.data.limit ?? 50}`;
  const cacheKey = buildCacheKey(propertyId, 'traffic-breakdown', dates, filterKey);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4TrafficBreakdownReport.run(buildReportContext(req, res), parsed.data);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/source-groups
ga4Router.get('/source-groups', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const cacheKey = buildCacheKey(propertyId, 'source-groups', dates);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4SourceGroupsReport.run(buildReportContext(req, res), dates);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/ai-traffic
ga4Router.get('/ai-traffic', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const cacheKey = buildCacheKey(propertyId, 'ai-traffic', dates);

  const cached = await getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const data = await ga4AiTrafficReport.run(buildReportContext(req, res), dates);
    sendWithCache(res, cacheKey, data, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});
