/**
 * "Connect Facebook" helpers (Sprint 8). Pure functions: URL builders, response parsers,
 * expiry maths, ad-account mapping and plain-English diagnosis. The route layer does the
 * fetches and stores tokens (encrypted) in the server-only vault.
 *
 * Never log URLs produced by buildCodeExchangeUrl / buildLongLivedExchangeUrl: they contain
 * the app secret and tokens.
 */

export const META_GRAPH_VERSION = 'v26.0';

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export interface MetaLoginUrlOptions {
  appId: string;
  redirectUri: string;
  state: string;
  /** Facebook Login for Business configuration ID (preferred). */
  configId?: string;
  /** Classic Facebook Login scopes, used only when no configId is given. */
  scopes?: string[];
  graphVersion?: string;
}

export function buildMetaLoginUrl(o: MetaLoginUrlOptions): string {
  const url = new URL(`https://www.facebook.com/${o.graphVersion ?? META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', o.appId);
  url.searchParams.set('redirect_uri', o.redirectUri);
  url.searchParams.set('state', o.state);
  url.searchParams.set('response_type', 'code');
  if (o.configId) {
    url.searchParams.set('config_id', o.configId);
    url.searchParams.set('override_default_response_type', 'true');
  } else {
    url.searchParams.set('scope', (o.scopes ?? ['ads_read']).join(','));
  }
  return url.toString();
}

export function buildCodeExchangeUrl(o: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  graphVersion?: string;
}): string {
  const url = new URL(`https://graph.facebook.com/${o.graphVersion ?? META_GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', o.appId);
  url.searchParams.set('client_secret', o.appSecret);
  url.searchParams.set('redirect_uri', o.redirectUri);
  url.searchParams.set('code', o.code);
  return url.toString();
}

export function buildLongLivedExchangeUrl(o: {
  appId: string;
  appSecret: string;
  shortLivedToken: string;
  graphVersion?: string;
}): string {
  const url = new URL(`https://graph.facebook.com/${o.graphVersion ?? META_GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', o.appId);
  url.searchParams.set('client_secret', o.appSecret);
  url.searchParams.set('fb_exchange_token', o.shortLivedToken);
  return url.toString();
}

/** Fields to request from GET me/adaccounts. */
export const AD_ACCOUNT_FIELDS = 'id,account_id,name,currency,timezone_name,account_status,business{id,name}';

// ---------------------------------------------------------------------------
// Token parsing + expiry
// ---------------------------------------------------------------------------

export interface ParsedMetaToken {
  accessToken: string;
  /** ISO time, or null when Meta reports no expiry. */
  expiresAt: string | null;
}

/** Parse { access_token, expires_in } from the token endpoints. Throws on a malformed response. */
export function parseTokenResponse(json: unknown, now: Date = new Date()): ParsedMetaToken {
  const j = json as { access_token?: unknown; expires_in?: unknown };
  if (!j || typeof j.access_token !== 'string' || j.access_token.length < 10) {
    throw new Error('META_TOKEN_EXCHANGE_FAILED');
  }
  const seconds = typeof j.expires_in === 'number' && j.expires_in > 0 ? j.expires_in : null;
  return {
    accessToken: j.access_token,
    expiresAt: seconds ? new Date(now.getTime() + seconds * 1000).toISOString() : null,
  };
}

/**
 * Meta access ends at the EARLIER of token expiry and data-access expiry (from debug_token:
 * expires_at and data_access_expires_at, Unix seconds; 0 means "never").
 */
export function effectiveExpiry(tokenExpiresAt: string | null, dataAccessExpiresUnix?: number | null): string | null {
  const candidates: number[] = [];
  if (tokenExpiresAt) candidates.push(new Date(tokenExpiresAt).getTime());
  if (dataAccessExpiresUnix && dataAccessExpiresUnix > 0) candidates.push(dataAccessExpiresUnix * 1000);
  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null;
}

export type ReconnectState = 'ok' | 'due_soon' | 'expired' | 'no_expiry';

export function reconnectStatus(
  expiresAt: string | null,
  now: Date = new Date(),
  warnDays = 7
): { state: ReconnectState; daysLeft: number | null } {
  if (!expiresAt) return { state: 'no_expiry', daysLeft: null };
  const msLeft = new Date(expiresAt).getTime() - now.getTime();
  if (msLeft <= 0) return { state: 'expired', daysLeft: 0 };
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  return { state: daysLeft <= warnDays ? 'due_soon' : 'ok', daysLeft };
}

// ---------------------------------------------------------------------------
// Ad accounts
// ---------------------------------------------------------------------------

export interface RawAdAccount {
  id?: string; // "act_123"
  account_id?: string; // "123"
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: { id?: string; name?: string };
}

export interface AdAccountOption {
  accountId: string; // digits only
  name: string;
  currency: string;
  timezoneName: string;
  status: string;
  usable: boolean;
  businessName: string | null;
}

const ACCOUNT_STATUS: Record<number, { label: string; usable: boolean }> = {
  1: { label: 'Active', usable: true },
  2: { label: 'Disabled', usable: false },
  3: { label: 'Unsettled payment', usable: true },
  7: { label: 'Pending risk review', usable: true },
  8: { label: 'Pending settlement', usable: true },
  9: { label: 'In grace period', usable: true },
  100: { label: 'Pending closure', usable: true },
  101: { label: 'Closed', usable: false },
  201: { label: 'Active', usable: true },
  202: { label: 'Closed', usable: false },
};

/** Map me/adaccounts rows to picker options; usable accounts first, then by name. */
export function mapAdAccounts(rows: RawAdAccount[]): AdAccountOption[] {
  return rows
    .map((r) => {
      const accountId = (r.account_id ?? (r.id ?? '').replace(/^act_/, '')).trim();
      const st = ACCOUNT_STATUS[r.account_status ?? -1] ?? { label: 'Unknown', usable: true };
      return {
        accountId,
        name: r.name?.trim() || `Ad account ${accountId}`,
        currency: r.currency ?? 'USD',
        timezoneName: r.timezone_name ?? 'UTC',
        status: st.label,
        usable: st.usable,
        businessName: r.business?.name ?? null,
      };
    })
    .filter((a) => /^\d+$/.test(a.accountId))
    .sort((a, b) => Number(b.usable) - Number(a.usable) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Plain-English diagnosis
// ---------------------------------------------------------------------------

export interface MetaDiagnosis {
  code: string;
  title: string;
  message: string;
  action: 'reconnect' | 'ask_admin' | 'wait' | 'check_access' | 'none';
}

export interface MetaDiagnosisInput {
  /** Callback query params from the login dialog. */
  callbackError?: string; // e.g. "access_denied"
  callbackErrorReason?: string; // e.g. "user_denied"
  /** Graph API error object. */
  graphError?: { code?: number; error_subcode?: number };
  /** Scopes granted to the token (from debug_token). */
  grantedScopes?: string[];
  /** Number of ad accounts returned by me/adaccounts. */
  adAccountCount?: number;
  /** Token expiry check. */
  expiresAt?: string | null;
  now?: Date;
}

export function diagnoseMeta(i: MetaDiagnosisInput): MetaDiagnosis {
  if (i.callbackError) {
    if (i.callbackErrorReason === 'user_denied') {
      return {
        code: 'META_USER_CANCELLED',
        title: 'Connection cancelled',
        message: 'Facebook access was not approved. Click Connect Facebook to try again.',
        action: 'reconnect',
      };
    }
    return {
      code: 'META_LOGIN_FAILED',
      title: 'Facebook could not complete sign-in',
      message:
        'If AdLens is still in testing, only people added to the AdLens app can connect. Ask the AdLens admin to add you, then try again.',
      action: 'ask_admin',
    };
  }

  const e = i.graphError;
  if (e?.code === 190) {
    const sub = e.error_subcode;
    const why =
      sub === 460 ? 'your Facebook password was changed'
      : sub === 458 ? 'AdLens was removed from your Facebook apps'
      : sub === 463 ? 'the connection expired'
      : 'the connection is no longer valid';
    return {
      code: 'META_TOKEN_INVALID',
      title: 'Facebook connection needs renewing',
      message: `Access stopped because ${why}. Click Reconnect to continue.`,
      action: 'reconnect',
    };
  }
  if (e && (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || e.code === 80004)) {
    return {
      code: 'META_RATE_LIMITED',
      title: 'Meta is limiting requests',
      message: 'Too many requests were made to Meta in a short time. Try again in a few minutes.',
      action: 'wait',
    };
  }
  if (e && (e.code === 10 || e.code === 200 || (e.code !== undefined && e.code >= 200 && e.code < 300))) {
    return {
      code: 'META_PERMISSION_DENIED',
      title: 'Missing permission',
      message: 'Your Facebook account does not have permission to read this ad account. Ask an admin of the ad account for access.',
      action: 'check_access',
    };
  }

  if (i.grantedScopes && !i.grantedScopes.includes('ads_read')) {
    return {
      code: 'META_SCOPE_MISSING',
      title: 'Ad performance access was not granted',
      message: 'AdLens needs read-only access to your ad performance. Reconnect and keep the ads permission switched on.',
      action: 'reconnect',
    };
  }

  if (i.expiresAt !== undefined) {
    const r = reconnectStatus(i.expiresAt, i.now);
    if (r.state === 'expired') {
      return {
        code: 'META_TOKEN_EXPIRED',
        title: 'Facebook connection expired',
        message: 'Facebook connections last about 60 days. Click Reconnect to continue.',
        action: 'reconnect',
      };
    }
  }

  if (i.adAccountCount === 0) {
    return {
      code: 'META_NO_AD_ACCOUNTS',
      title: 'No ad accounts found',
      message:
        'This Facebook account cannot see any ad accounts. Make sure you have access in Meta Business Settings, and that you selected the ad account when connecting.',
      action: 'check_access',
    };
  }

  return { code: 'META_OK', title: 'Connected', message: 'Facebook is connected and working.', action: 'none' };
}
