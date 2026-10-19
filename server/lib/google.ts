import { OAuth2Client } from 'google-auth-library';
import { getServerConfig } from '../config.js';

export class GoogleApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number = 400) {
    super(message);
    this.name = 'GoogleApiError';
    this.code = code;
    this.status = status;
  }
}

export interface GA4PropertySummaryItem {
  accountName: string;
  propertyId: string;
  propertyName: string;
}

export interface SearchConsoleSiteItem {
  siteUrl: string;
  permissionLevel: string;
}

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

export function createOAuthClient(): OAuth2Client {
  const cfg = getServerConfig();
  const redirectUri = `${cfg.appBaseUrl}/api/auth/google/callback`;
  return new OAuth2Client(cfg.googleClientId, cfg.googleClientSecret, redirectUri);
}

interface AnalyticsAdminAccountSummariesResponse {
  accountSummaries?: {
    name?: string;
    displayName?: string;
    propertySummaries?: {
      property?: string;
      displayName?: string;
    }[];
  }[];
  nextPageToken?: string;
}

export async function fetchGA4Properties(accessToken: string): Promise<GA4PropertySummaryItem[]> {
  const results: GA4PropertySummaryItem[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
    url.searchParams.set('pageSize', '200');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (resp.status === 401) {
      throw new GoogleApiError(
        'GOOGLE_REAUTH_REQUIRED',
        'Google Analytics authorization failed. Please reconnect your Google account.',
        401
      );
    }

    if (!resp.ok) {
      throw new GoogleApiError(
        'GA4_API_ERROR',
        `Failed to list GA4 properties (HTTP ${resp.status}).`,
        resp.status
      );
    }

    const body = (await resp.json()) as AnalyticsAdminAccountSummariesResponse;
    for (const acct of body.accountSummaries ?? []) {
      const accountName = acct.displayName || acct.name || 'Google Analytics Account';
      for (const prop of acct.propertySummaries ?? []) {
        const rawProp = prop.property || '';
        const propertyId = rawProp.replace(/^properties\//, '');
        if (propertyId) {
          results.push({
            accountName,
            propertyId,
            propertyName: prop.displayName || propertyId,
          });
        }
      }
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return results;
}

interface SearchConsoleSitesResponse {
  siteEntry?: {
    siteUrl?: string;
    permissionLevel?: string;
  }[];
}

export async function fetchSearchConsoleSites(accessToken: string): Promise<SearchConsoleSiteItem[]> {
  const resp = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (resp.status === 401) {
    throw new GoogleApiError(
      'GOOGLE_REAUTH_REQUIRED',
      'Search Console authorization failed. Please reconnect your Google account.',
      401
    );
  }

  if (!resp.ok) {
    throw new GoogleApiError(
      'GSC_API_ERROR',
      `Failed to list Search Console sites (HTTP ${resp.status}).`,
      resp.status
    );
  }

  const body = (await resp.json()) as SearchConsoleSitesResponse;
  const entries = body.siteEntry ?? [];

  return entries
    .filter(
      (entry): entry is { siteUrl: string; permissionLevel: string } =>
        Boolean(entry.siteUrl) &&
        Boolean(entry.permissionLevel) &&
        entry.permissionLevel !== 'siteUnverifiedUser'
    )
    .map((entry) => ({
      siteUrl: entry.siteUrl,
      permissionLevel: entry.permissionLevel,
    }));
}
