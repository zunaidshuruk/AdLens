import crypto from 'node:crypto';
import { getServerConfig } from '../config.js';
import { mapMetaErrorCode } from './metaAdsMapper.js';

export const GRAPH_API_VERSION = 'v26.0';
const MAX_PAGINATED_ROWS = 5000;

export class MetaApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number = 400) {
    super(message);
    this.name = 'MetaApiError';
    this.code = code;
    this.status = status;
  }
}

const FRIENDLY_ERROR_MESSAGES: Record<string, { status: number; message: string }> = {
  META_TOKEN_INVALID: {
    status: 401,
    message: 'The Meta access token is invalid or was revoked — generate a new system user token',
  },
  META_PERMISSION_DENIED: {
    status: 403,
    message: 'The Meta system user does not have permission to access this ad account',
  },
  META_RATE_LIMITED: {
    status: 429,
    message: 'Meta is limiting requests — try again in a few minutes',
  },
  META_INVALID_REQUEST: {
    status: 400,
    message: 'Invalid request parameters sent to Meta Marketing API',
  },
  META_REQUEST_FAILED: {
    status: 502,
    message: 'Failed to fetch data from Meta Marketing API',
  },
};

export function createMetaApiError(
  graphErr?: { code?: number; error_subcode?: number; type?: string }
): MetaApiError {
  const code = mapMetaErrorCode(graphErr);
  const info = FRIENDLY_ERROR_MESSAGES[code] ?? FRIENDLY_ERROR_MESSAGES.META_REQUEST_FAILED;
  return new MetaApiError(code, info.message, info.status);
}

/**
 * Computes HMAC-SHA256(access_token, key = META_APP_SECRET) as hex.
 */
export function computeAppSecretProof(accessToken: string, appSecret: string): string {
  return crypto.createHmac('sha256', appSecret).update(accessToken, 'utf8').digest('hex');
}

interface GraphErrorPayload {
  error?: {
    code?: number;
    error_subcode?: number;
    type?: string;
    message?: string;
  };
}

interface GraphPaginatedPayload<Row = unknown> extends GraphErrorPayload {
  data?: Row[];
  paging?: {
    next?: string;
  };
}

/**
 * Performs a GET request to https://graph.facebook.com/{GRAPH_API_VERSION}/{path},
 * attaches access_token and appsecret_proof, follows paging.next up to 5,000 rows,
 * and maps any Graph errors via mapMetaErrorCode() without exposing raw error messages or tokens.
 */
export async function metaGet<T = unknown>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const cfg = getServerConfig();
  if (!cfg.metaConfigured) {
    throw new MetaApiError(
      'META_NOT_CONFIGURED',
      `Meta Ads integration is not configured. Missing environment variables: ${cfg.metaMissing.join(', ')}`,
      503
    );
  }

  const cleanPath = path.replace(/^\/+/, '');
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${cleanPath}`);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const appSecretProof = computeAppSecretProof(cfg.metaAccessToken, cfg.metaAppSecret);
  url.searchParams.set('access_token', cfg.metaAccessToken);
  url.searchParams.set('appsecret_proof', appSecretProof);

  const fetchPage = async (targetUrl: string): Promise<GraphPaginatedPayload> => {
    let response: Response;
    try {
      response = await fetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw createMetaApiError(undefined);
    }

    let body: GraphPaginatedPayload | null = null;
    try {
      body = (await response.json()) as GraphPaginatedPayload;
    } catch {
      body = null;
    }

    if (!response.ok || body?.error) {
      throw createMetaApiError(body?.error);
    }

    if (!body) {
      throw createMetaApiError(undefined);
    }

    return body;
  };

  const firstPage = await fetchPage(url.toString());

  // If the endpoint returns a paginated list (`data` array), follow paging.next up to 5,000 rows
  if (Array.isArray(firstPage.data)) {
    const accumulated: unknown[] = [...firstPage.data];
    let nextUrl = firstPage.paging?.next;

    while (nextUrl && accumulated.length < MAX_PAGINATED_ROWS) {
      let parsedNext: URL;
      try {
        parsedNext = new URL(nextUrl);
      } catch {
        break;
      }
      if (parsedNext.hostname !== 'graph.facebook.com') {
        break;
      }
      if (!parsedNext.searchParams.has('access_token')) {
        parsedNext.searchParams.set('access_token', cfg.metaAccessToken);
      }
      if (!parsedNext.searchParams.has('appsecret_proof')) {
        parsedNext.searchParams.set('appsecret_proof', appSecretProof);
      }

      const nextPage = await fetchPage(parsedNext.toString());
      if (!Array.isArray(nextPage.data) || nextPage.data.length === 0) {
        break;
      }

      accumulated.push(...nextPage.data);
      nextUrl = nextPage.paging?.next;
    }

    return {
      ...firstPage,
      data: accumulated.slice(0, MAX_PAGINATED_ROWS),
    } as T;
  }

  return firstPage as T;
}
