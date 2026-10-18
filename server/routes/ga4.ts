import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GA4PropertyInfo } from '../../src/types/index.js';
import { requireGoogleConfigured } from '../config.js';
import {
  type GA4RunReportResponse,
  mapGA4AcquisitionResponse,
  mapGA4CampaignsResponse,
  mapGA4ConversionsResponse,
  mapGA4OverviewResponse,
  mapGA4TopPagesResponse,
  mapGA4TrafficOverTimeResponse,
} from '../lib/ga4Mapper.js';
import { getValidAccessToken, GoogleApiError } from '../lib/google.js';
import { readSession } from '../lib/session.js';
import { googleRateLimitMiddleware } from './connections.js';

export const ga4Router = Router();

// In-memory cache with 10-minute TTL
const CACHE_TTL_MS = 10 * 60 * 1000;
const ga4Cache = new Map<string, { expiresAt: number; data: unknown }>();

export function clearGA4Cache(): void {
  ga4Cache.clear();
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

function buildCacheKey(propertyId: string, routeName: string, dates?: ValidatedDateQuery): string {
  if (!dates) {
    return `${propertyId}:${routeName}`;
  }
  return `${propertyId}:${routeName}:${dates.startDate}:${dates.endDate}:${dates.compareStartDate ?? ''}:${dates.compareEndDate ?? ''}`;
}

function sendWithCache<T>(res: Response, cacheKey: string, data: T, fromCache: boolean): void {
  if (!fromCache) {
    ga4Cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    });
  }
  res.setHeader('X-AdLens-Cache', fromCache ? 'true' : 'false');
  res.json(data);
}

function getCached<T>(cacheKey: string): T | null {
  const entry = ga4Cache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    ga4Cache.delete(cacheKey);
    return null;
  }
  return entry.data as T;
}

async function callGA4RunReport(
  propertyId: string,
  accessToken: string,
  payload: Record<string, unknown>
): Promise<GA4RunReportResponse> {
  const cleanId = propertyId.replace(/^properties\//, '');
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${cleanId}:runReport`;

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
      const errJson = (await resp.json()) as { error?: { status?: string } };
      googleStatus = errJson?.error?.status || '';
    } catch {
      // ignore body parse errors; never forward raw Google error bodies
    }

    if (resp.status === 401) {
      throw new GoogleApiError(
        'GOOGLE_REAUTH_REQUIRED',
        'Your Google session has expired or been revoked. Please reconnect your Google account.',
        401
      );
    }

    if (resp.status === 403 || googleStatus === 'PERMISSION_DENIED') {
      throw new GoogleApiError(
        'GA4_PERMISSION_DENIED',
        'This Google account no longer has access to the selected property',
        403
      );
    }

    if (resp.status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') {
      throw new GoogleApiError(
        'GA4_QUOTA_EXCEEDED',
        'Google Analytics 4 API quota exceeded. Please wait a moment and retry.',
        429
      );
    }

    throw new GoogleApiError(
      'GA4_REQUEST_FAILED',
      'Unable to retrieve report data from Google Analytics 4.',
      502
    );
  }

  return (await resp.json()) as GA4RunReportResponse;
}

function buildDateRangesPayload(dates: ValidatedDateQuery) {
  const ranges: { name: string; startDate: string; endDate: string }[] = [
    { name: 'current', startDate: dates.startDate, endDate: dates.endDate },
  ];
  if (dates.compareStartDate && dates.compareEndDate) {
    ranges.push({
      name: 'previous',
      startDate: dates.compareStartDate,
      endDate: dates.compareEndDate,
    });
  }
  return ranges;
}

function handleGA4Error(res: Response, err: unknown): void {
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
      code: 'GA4_REQUEST_FAILED',
      message: 'Unable to retrieve data from Google Analytics 4.',
    },
  });
}

// Middleware: rate limit + Google configured + connected session with selected ga4Property
ga4Router.use(googleRateLimitMiddleware);
ga4Router.use(requireGoogleConfigured);

async function requireGA4Session(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = readSession(req);
    if (!session.google?.refreshToken || !session.google?.ga4Property?.id) {
      res.status(409).json({
        error: {
          code: 'GA4_NOT_SELECTED',
          message: 'A connected Google account with a selected GA4 property is required.',
        },
      });
      return;
    }

    const accessToken = await getValidAccessToken(session, res);
    res.locals.ga4PropertyId = session.google.ga4Property.id;
    res.locals.ga4PropertyName = session.google.ga4Property.name;
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
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(propertyId, 'overview', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const report = await callGA4RunReport(propertyId, accessToken, {
      dateRanges: buildDateRangesPayload(dates),
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'userEngagementDuration' },
        { name: 'keyEvents' },
      ],
    });

    const mapped = mapGA4OverviewResponse(report);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/traffic-over-time
ga4Router.get('/traffic-over-time', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(propertyId, 'traffic-over-time', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const report = await callGA4RunReport(propertyId, accessToken, {
      dateRanges: buildDateRangesPayload(dates),
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagedSessions' },
        { name: 'keyEvents' },
      ],
      limit: 1000,
    });

    const mapped = mapGA4TrafficOverTimeResponse(
      report,
      dates.startDate,
      dates.endDate,
      dates.compareStartDate,
      dates.compareEndDate
    );
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/acquisition
ga4Router.get('/acquisition', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(propertyId, 'acquisition', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const primaryRange = [{ name: 'current', startDate: dates.startDate, endDate: dates.endDate }];
    const [channelsReport, countriesReport] = await Promise.all([
      callGA4RunReport(propertyId, accessToken, {
        dateRanges: primaryRange,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'keyEvents' },
        ],
        limit: 25,
      }),
      callGA4RunReport(propertyId, accessToken, {
        dateRanges: primaryRange,
        dimensions: [{ name: 'country' }, { name: 'countryId' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        limit: 25,
      }),
    ]);

    const mapped = mapGA4AcquisitionResponse(channelsReport, countriesReport);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/campaigns
ga4Router.get('/campaigns', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(propertyId, 'campaigns', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const report = await callGA4RunReport(propertyId, accessToken, {
      dateRanges: [{ name: 'current', startDate: dates.startDate, endDate: dates.endDate }],
      dimensions: [
        { name: 'sessionCampaignName' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagementRate' },
        { name: 'keyEvents' },
      ],
      limit: 50,
    });

    const mapped = mapGA4CampaignsResponse(report);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/top-pages
ga4Router.get('/top-pages', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(propertyId, 'top-pages', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const report = await callGA4RunReport(propertyId, accessToken, {
      dateRanges: [{ name: 'current', startDate: dates.startDate, endDate: dates.endDate }],
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'userEngagementDuration' },
        { name: 'bounceRate' },
        { name: 'keyEvents' },
      ],
      limit: 50,
    });

    const mapped = mapGA4TopPagesResponse(report);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/conversions
ga4Router.get('/conversions', async (req: Request, res: Response) => {
  const dates = validateDateQuery(req, res);
  if (!dates) return;

  const propertyId = String(res.locals.ga4PropertyId);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(propertyId, 'conversions', dates);

  const cached = getCached(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const report = await callGA4RunReport(propertyId, accessToken, {
      dateRanges: buildDateRangesPayload(dates),
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'keyEvents' }, { name: 'totalUsers' }, { name: 'sessions' }],
      limit: 50,
    });

    const mapped = mapGA4ConversionsResponse(report);
    sendWithCache(res, cacheKey, mapped, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});

// GET /api/ga4/property-info
ga4Router.get('/property-info', async (req: Request, res: Response) => {
  const dates = req.query.startDate && req.query.endDate ? validateDateQuery(req, res) : null;
  if (req.query.startDate && !dates) return;

  const propertyId = String(res.locals.ga4PropertyId).replace(/^properties\//, '');
  const fallbackName = String(res.locals.ga4PropertyName || propertyId);
  const accessToken = String(res.locals.googleAccessToken);
  const cacheKey = buildCacheKey(propertyId, 'property-info', dates ?? undefined);

  const cached = getCached<GA4PropertyInfo>(cacheKey);
  if (cached) {
    sendWithCache(res, cacheKey, cached, true);
    return;
  }

  try {
    const url = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      let googleStatus = '';
      try {
        const errJson = (await resp.json()) as { error?: { status?: string } };
        googleStatus = errJson?.error?.status || '';
      } catch {
        // ignore
      }

      if (resp.status === 401) {
        throw new GoogleApiError(
          'GOOGLE_REAUTH_REQUIRED',
          'Your Google session has expired or been revoked. Please reconnect your Google account.',
          401
        );
      }

      if (resp.status === 403 || googleStatus === 'PERMISSION_DENIED') {
        throw new GoogleApiError(
          'GA4_PERMISSION_DENIED',
          'This Google account no longer has access to the selected property',
          403
        );
      }

      if (resp.status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') {
        throw new GoogleApiError(
          'GA4_QUOTA_EXCEEDED',
          'Google Analytics 4 API quota exceeded. Please wait a moment and retry.',
          429
        );
      }

      throw new GoogleApiError(
        'GA4_REQUEST_FAILED',
        'Unable to fetch GA4 property details.',
        502
      );
    }

    const body = (await resp.json()) as {
      displayName?: string;
      timeZone?: string;
      currencyCode?: string;
    };

    const info: GA4PropertyInfo = {
      propertyId,
      displayName: body.displayName || fallbackName,
      timeZone: body.timeZone ?? null,
      currencyCode: body.currencyCode ?? null,
    };

    sendWithCache(res, cacheKey, info, false);
  } catch (err) {
    handleGA4Error(res, err);
  }
});
