import { Router, type NextFunction, type Request, type Response } from 'express';
import type { SearchConsoleSiteInfo } from '../../src/types/index.js';
import { requireGoogleConfigured } from '../config.js';
import { getValidAccessToken, GoogleApiError } from '../lib/google.js';
import {
  type SearchConsoleQueryResponse,
  mapSearchConsoleCountriesResponse,
  mapSearchConsoleDevicesResponse,
  mapSearchConsoleOverviewResponse,
  mapSearchConsolePerformanceOverTimeResponse,
  mapSearchConsoleTopPagesResponse,
  mapSearchConsoleTopQueriesResponse,
} from '../lib/searchConsoleMapper.js';
import { readSession } from '../lib/session.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import { googleRateLimitMiddleware } from './connections.js';

export const searchConsoleRouter = Router();

// In-memory cache with 10-minute TTL
const CACHE_TTL_MS = 10 * 60 * 1000;
const scCache = new Map<string, { expiresAt: number; data: unknown }>();

export function clearSearchConsoleCache(): void {
  scCache.clear();
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
        code: 'INVALID_DATE_RANGE',
        message: 'Query parameters startDate and endDate must be in YYYY-MM-DD format.',
      },
    });
    return null;
  }

  if (startDate > endDate) {
    res.status(400).json({
      error: {
        code: 'INVALID_DATE_RANGE',
        message: 'startDate must be on or before endDate.',
      },
    });
    return null;
  }

  if (compareStartDate !== undefined || compareEndDate !== undefined) {
    if (
      !compareStartDate ||
      !compareEndDate ||
      !ISO_DATE_RE.test(compareStartDate) ||
      !ISO_DATE_RE.test(compareEndDate) ||
      compareStartDate > compareEndDate
    ) {
      res.status(400).json({
        error: {
          code: 'INVALID_DATE_RANGE',
          message:
            'compareStartDate and compareEndDate must both be valid YYYY-MM-DD dates with compareStartDate <= compareEndDate.',
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

function buildCacheKey(siteUrl: string, routeName: string, dates?: ValidatedDateQuery): string {
  if (!dates) {
    return `${siteUrl}:${routeName}`;
  }
  return `${siteUrl}:${routeName}:${dates.startDate}:${dates.endDate}:${dates.compareStartDate ?? ''}:${dates.compareEndDate ?? ''}`;
}

function sendWithCache<T>(res: Response, cacheKey: string, data: T, fromCache: boolean): void {
  if (!fromCache) {
    scCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    });
  }
  res.setHeader('X-AdLens-Cache', fromCache ? 'true' : 'false');
  res.json(data);
}

function getCached<T>(cacheKey: string): T | null {
  const entry = scCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    scCache.delete(cacheKey);
    return null;
  }
  return entry.data as T;
}

function mapUpstreamSearchConsoleError(respStatus: number, googleStatus: string): GoogleApiError {
  if (respStatus === 401) {
    return new GoogleApiError(
      'GOOGLE_REAUTH_REQUIRED',
      'Your Google session has expired or been revoked. Please reconnect your Google account.',
      401
    );
  }

  if (respStatus === 403 || googleStatus === 'PERMISSION_DENIED' || googleStatus === 'forbidden') {
    return new GoogleApiError(
      'SC_PERMISSION_DENIED',
      'This Google account no longer has access to the selected Search Console site.',
      403
    );
  }

  if (
    respStatus === 429 ||
    googleStatus === 'RESOURCE_EXHAUSTED' ||
    googleStatus === 'rateLimitExceeded' ||
    googleStatus === 'quotaExceeded'
  ) {
    return new GoogleApiError(
      'SC_QUOTA_EXCEEDED',
      'Google Search Console API quota exceeded. Please wait a moment and retry.',
      429
    );
  }

  return new GoogleApiError(
    'SC_REQUEST_FAILED',
    'Unable to retrieve report data from Google Search Console.',
    502
  );
}

async function callSearchConsoleQuery(
  siteUrl: string,
  accessToken: string,
  payload: {
    startDate: string;
    endDate: string;
    dimensions?: string[];
    rowLimit?: number;
  }
): Promise<SearchConsoleQueryResponse> {
  const encodedSite = encodeURIComponent(siteUrl);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    let googleStatus = '';
    try {
      const errJson = (await resp.json()) as {
        error?: { status?: string; errors?: { reason?: string }[] };
      };
      googleStatus =
        errJson?.error?.status || errJson?.error?.errors?.[0]?.reason || '';
    } catch {
      // Never forward raw Google error bodies
    }

    throw mapUpstreamSearchConsoleError(resp.status, googleStatus);
  }

  return (await resp.json()) as SearchConsoleQueryResponse;
}

function handleSearchConsoleError(res: Response, err: unknown): void {
  if (err instanceof GoogleApiError) {
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
      code: 'SC_REQUEST_FAILED',
      message: 'Unable to retrieve data from Google Search Console.',
    },
  });
}

// Middleware: rate limiter + requireUser + verifyGoogleSessionOwnership + Google configured + connected session with selected searchConsoleSite
searchConsoleRouter.use(googleRateLimitMiddleware);
searchConsoleRouter.use(requireUser);
searchConsoleRouter.use(verifyGoogleSessionOwnership);
searchConsoleRouter.use(requireGoogleConfigured);

async function requireSearchConsoleSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = readSession(req);
    if (!session.google?.refreshToken || !session.google?.searchConsoleSite?.url) {
      res.status(409).json({
        error: {
          code: 'SC_NOT_SELECTED',
          message: 'A connected Google account with a selected Search Console site is required.',
        },
      });
      return;
    }

    const accessToken = await getValidAccessToken(session, res);
    res.locals.scSiteUrl = session.google.searchConsoleSite.url;
    res.locals.googleAccessToken = accessToken;
    next();
  } catch (err) {
    handleSearchConsoleError(res, err);
  }
}

searchConsoleRouter.use(requireSearchConsoleSession);

// GET /api/search-console/overview
searchConsoleRouter.get('/overview', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const siteUrl = String(res.locals.scSiteUrl);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(siteUrl, 'overview', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const hasCompare = Boolean(dates.compareStartDate && dates.compareEndDate);
    const [currentReport, previousReport] = await Promise.all([
      callSearchConsoleQuery(siteUrl, accessToken, {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }),
      hasCompare
        ? callSearchConsoleQuery(siteUrl, accessToken, {
            startDate: dates.compareStartDate!,
            endDate: dates.compareEndDate!,
          })
        : Promise.resolve(undefined),
    ]);

    const mapped = mapSearchConsoleOverviewResponse(currentReport, previousReport);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleSearchConsoleError(res, err);
  }
});

// GET /api/search-console/performance-over-time
searchConsoleRouter.get('/performance-over-time', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const siteUrl = String(res.locals.scSiteUrl);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(siteUrl, 'performance-over-time', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const hasCompare = Boolean(dates.compareStartDate && dates.compareEndDate);
    const [currentReport, previousReport] = await Promise.all([
      callSearchConsoleQuery(siteUrl, accessToken, {
        startDate: dates.startDate,
        endDate: dates.endDate,
        dimensions: ['date'],
        rowLimit: 1000,
      }),
      hasCompare
        ? callSearchConsoleQuery(siteUrl, accessToken, {
            startDate: dates.compareStartDate!,
            endDate: dates.compareEndDate!,
            dimensions: ['date'],
            rowLimit: 1000,
          })
        : Promise.resolve(undefined),
    ]);

    const mapped = mapSearchConsolePerformanceOverTimeResponse(
      currentReport,
      previousReport,
      dates.startDate,
      dates.endDate,
      dates.compareStartDate,
      dates.compareEndDate
    );
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleSearchConsoleError(res, err);
  }
});

// GET /api/search-console/top-queries
searchConsoleRouter.get('/top-queries', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const siteUrl = String(res.locals.scSiteUrl);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(siteUrl, 'top-queries', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const hasCompare = Boolean(dates.compareStartDate && dates.compareEndDate);
    const [currentReport, previousReport] = await Promise.all([
      callSearchConsoleQuery(siteUrl, accessToken, {
        startDate: dates.startDate,
        endDate: dates.endDate,
        dimensions: ['query'],
        rowLimit: 250,
      }),
      hasCompare
        ? callSearchConsoleQuery(siteUrl, accessToken, {
            startDate: dates.compareStartDate!,
            endDate: dates.compareEndDate!,
            dimensions: ['query'],
            rowLimit: 250,
          })
        : Promise.resolve(undefined),
    ]);

    const mapped = mapSearchConsoleTopQueriesResponse(currentReport, previousReport);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleSearchConsoleError(res, err);
  }
});

// GET /api/search-console/top-pages
searchConsoleRouter.get('/top-pages', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const siteUrl = String(res.locals.scSiteUrl);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(siteUrl, 'top-pages', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const currentReport = await callSearchConsoleQuery(siteUrl, accessToken, {
      startDate: dates.startDate,
      endDate: dates.endDate,
      dimensions: ['page'],
      rowLimit: 250,
    });

    const mapped = mapSearchConsoleTopPagesResponse(currentReport);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleSearchConsoleError(res, err);
  }
});

// GET /api/search-console/countries
searchConsoleRouter.get('/countries', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const siteUrl = String(res.locals.scSiteUrl);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(siteUrl, 'countries', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const currentReport = await callSearchConsoleQuery(siteUrl, accessToken, {
      startDate: dates.startDate,
      endDate: dates.endDate,
      dimensions: ['country'],
      rowLimit: 250,
    });

    const mapped = mapSearchConsoleCountriesResponse(currentReport);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleSearchConsoleError(res, err);
  }
});

// GET /api/search-console/devices
searchConsoleRouter.get('/devices', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const siteUrl = String(res.locals.scSiteUrl);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(siteUrl, 'devices', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const currentReport = await callSearchConsoleQuery(siteUrl, accessToken, {
      startDate: dates.startDate,
      endDate: dates.endDate,
      dimensions: ['device'],
      rowLimit: 10,
    });

    const mapped = mapSearchConsoleDevicesResponse(currentReport);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleSearchConsoleError(res, err);
  }
});

// GET /api/search-console/site-info
searchConsoleRouter.get('/site-info', async (req: Request, res: Response) => {
  const dates = req.query.startDate && req.query.endDate ? validateDateQuery(req, res) : null;
  if (req.query.startDate && !dates) return;

  const siteUrl = String(res.locals.scSiteUrl);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(siteUrl, 'site-info', dates ?? undefined);

  const cached = getCached<SearchConsoleSiteInfo>(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const encodedSite = encodeURIComponent(siteUrl);
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      let googleStatus = '';
      try {
        const errJson = (await resp.json()) as {
          error?: { status?: string; errors?: { reason?: string }[] };
        };
        googleStatus =
          errJson?.error?.status || errJson?.error?.errors?.[0]?.reason || '';
      } catch {
        // ignore
      }
      throw mapUpstreamSearchConsoleError(resp.status, googleStatus);
    }

    const body = (await resp.json()) as {
      siteUrl?: string;
      permissionLevel?: string;
    };

    const info: SearchConsoleSiteInfo = {
      siteUrl: body.siteUrl || siteUrl,
      permissionLevel: body.permissionLevel || 'siteFullUser',
    };

    sendWithCache(res, cacheKey, info, false);
  } catch (err) {
    handleSearchConsoleError(res, err);
  }
});
