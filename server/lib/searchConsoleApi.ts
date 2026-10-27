import { countUpstream } from './usageMeter.js';
import { GoogleApiError } from './google.js';
import type { SearchConsoleQueryResponse } from './searchConsoleMapper.js';

/** The one place that talks to the Search Console search analytics API. Raw Google error bodies are never forwarded. */

export function mapUpstreamSearchConsoleError(respStatus: number, googleStatus: string): GoogleApiError {
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

export async function callSearchConsoleQuery(
  siteUrl: string,
  accessToken: string,
  payload: {
    startDate: string;
    endDate: string;
    dimensions?: string[];
    rowLimit?: number;
    startRow?: number;
    dataState?: string;
    dimensionFilterGroups?: unknown[];
  }
): Promise<SearchConsoleQueryResponse> {
  const encodedSite = encodeURIComponent(siteUrl);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`;

  void countUpstream('searchConsole');
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


export interface SitemapListItem {
  path: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  warnings?: number;
  errors?: number;
  submittedUrls?: number;
}

/** Read-only list of the sitemaps submitted for a Search Console site. */
export async function listSitemaps(siteUrl: string, accessToken: string): Promise<SitemapListItem[]> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`;
  void countUpstream('searchConsole');
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!resp.ok) {
    let googleStatus = '';
    try {
      const errJson = (await resp.json()) as { error?: { status?: string; errors?: { reason?: string }[] } };
      googleStatus = errJson?.error?.status || errJson?.error?.errors?.[0]?.reason || '';
    } catch {
      // never forward raw Google error bodies
    }
    throw mapUpstreamSearchConsoleError(resp.status, googleStatus);
  }
  const body = (await resp.json()) as {
    sitemap?: {
      path?: string;
      lastSubmitted?: string;
      lastDownloaded?: string;
      isPending?: boolean;
      isSitemapsIndex?: boolean;
      warnings?: string | number;
      errors?: string | number;
      contents?: { submitted?: string | number }[];
    }[];
  };
  const num = (v: string | number | undefined) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return (body.sitemap ?? [])
    .filter((s) => typeof s.path === 'string' && s.path)
    .map((s) => ({
      path: s.path as string,
      ...(s.lastSubmitted ? { lastSubmitted: s.lastSubmitted } : {}),
      ...(s.lastDownloaded ? { lastDownloaded: s.lastDownloaded } : {}),
      isPending: Boolean(s.isPending),
      isSitemapsIndex: Boolean(s.isSitemapsIndex),
      warnings: num(s.warnings),
      errors: num(s.errors),
      submittedUrls: (s.contents ?? []).reduce((t, c) => t + num(c.submitted), 0),
    }));
}
