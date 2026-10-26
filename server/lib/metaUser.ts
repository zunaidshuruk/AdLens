import { computeAppSecretProof } from './meta.js';
import {
  AD_ACCOUNT_FIELDS,
  diagnoseMeta,
  mapAdAccounts,
  META_GRAPH_VERSION,
  type AdAccountOption,
  type RawAdAccount,
} from './metaOAuth.js';

const META_USER_FETCH_TIMEOUT_MS = 8_000;
const MAX_AD_ACCOUNT_PAGES = 3;

export class MetaUserApiError extends Error {
  readonly code: string;
  readonly title: string;
  readonly action: string;
  readonly status: number;

  constructor(opts: {
    code: string;
    title: string;
    message: string;
    action: string;
    status: number;
  }) {
    super(opts.message);
    this.name = 'MetaUserApiError';
    this.code = opts.code;
    this.title = opts.title;
    this.action = opts.action;
    this.status = opts.status;
  }
}

interface GraphAdAccountsPage {
  data?: RawAdAccount[];
  paging?: {
    next?: string;
  };
  error?: {
    code?: number;
    error_subcode?: number;
  };
}

function statusForDiagnosisCode(code: string): number {
  switch (code) {
    case 'META_TOKEN_INVALID':
    case 'META_TOKEN_EXPIRED':
      return 401;
    case 'META_PERMISSION_DENIED':
    case 'META_SCOPE_MISSING':
      return 403;
    case 'META_RATE_LIMITED':
      return 429;
    default:
      return 502;
  }
}

function createDiagnosedError(graphError?: { code?: number; error_subcode?: number }): MetaUserApiError {
  const diag = diagnoseMeta({ graphError: graphError ?? { code: 190 } });
  if (diag.code === 'META_OK') {
    const fallback = diagnoseMeta({ callbackError: 'graph_error' });
    return new MetaUserApiError({
      code: 'META_REQUEST_FAILED',
      title: fallback.title,
      message: fallback.message,
      action: fallback.action,
      status: 502,
    });
  }
  return new MetaUserApiError({
    code: diag.code,
    title: diag.title,
    message: diag.message,
    action: diag.action,
    status: statusForDiagnosisCode(diag.code),
  });
}

async function fetchGraphPageWithTimeout(url: string): Promise<GraphAdAccountsPage> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race([
      fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('META_TIMEOUT'));
        }, META_USER_FETCH_TIMEOUT_MS);
      }),
    ]);

    let body: GraphAdAccountsPage | null = null;
    try {
      body = (await response.json()) as GraphAdAccountsPage;
    } catch {
      body = null;
    }

    if (!response.ok || body?.error) {
      throw createDiagnosedError(body?.error);
    }

    if (!body) {
      throw createDiagnosedError(undefined);
    }

    return body;
  } catch (err) {
    if (err instanceof MetaUserApiError) {
      throw err;
    }
    throw createDiagnosedError(undefined);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Fetches the signed-in user's Meta ad accounts from GET /v26.0/me/adaccounts,
 * follows paging.next up to 3 pages (8s timeout per page), and maps rows with mapAdAccounts.
 * Never exposes tokens, appSecret, appsecret_proof, or raw Graph error messages.
 */
export async function fetchMetaAdAccounts(
  accessToken: string,
  appSecret: string
): Promise<AdAccountOption[]> {
  const proof = appSecret ? computeAppSecretProof(accessToken, appSecret) : '';
  const initialUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts`);
  initialUrl.searchParams.set('fields', AD_ACCOUNT_FIELDS);
  initialUrl.searchParams.set('limit', '100');
  initialUrl.searchParams.set('access_token', accessToken);
  if (proof) {
    initialUrl.searchParams.set('appsecret_proof', proof);
  }

  const rows: RawAdAccount[] = [];
  let nextUrl: string | undefined = initialUrl.toString();
  let pagesFetched = 0;

  while (nextUrl && pagesFetched < MAX_AD_ACCOUNT_PAGES) {
    const pageUrl = new URL(nextUrl);
    if (pageUrl.origin !== 'https://graph.facebook.com') {
      break;
    }
    if (!pageUrl.searchParams.has('access_token')) {
      pageUrl.searchParams.set('access_token', accessToken);
    }
    if (proof && !pageUrl.searchParams.has('appsecret_proof')) {
      pageUrl.searchParams.set('appsecret_proof', proof);
    }

    const page = await fetchGraphPageWithTimeout(pageUrl.toString());
    pagesFetched += 1;

    if (Array.isArray(page.data)) {
      rows.push(...page.data);
    }

    nextUrl =
      typeof page.paging?.next === 'string' && page.paging.next.length > 0
        ? page.paging.next
        : undefined;
  }

  return mapAdAccounts(rows);
}

/**
 * Best-effort DELETE https://graph.facebook.com/v26.0/me/permissions with access_token
 * and appsecret_proof (8s timeout). Failures are ignored by caller.
 */
export async function revokeMetaPermissions(
  accessToken: string,
  appSecret: string
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions`);
    url.searchParams.set('access_token', accessToken);
    if (appSecret) {
      url.searchParams.set('appsecret_proof', computeAppSecretProof(accessToken, appSecret));
    }

    await Promise.race([
      fetch(url.toString(), {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('META_REVOKE_TIMEOUT'));
        }, META_USER_FETCH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Best-effort revoke: ignore errors and never log URLs or tokens
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
