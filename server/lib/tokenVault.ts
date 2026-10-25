/**
 * Server-side token vault (Sprint 7C). Pure logic, no network and no Firestore imports:
 * the storage backend and the token refreshers are injected, so everything here is unit-tested.
 *
 * Security properties
 * - AES-256-GCM, random 96-bit IV per encryption.
 * - The key is derived with HKDF-SHA256 from TOKEN_ENCRYPTION_KEY (never used directly).
 * - Every ciphertext is BOUND to its owner: the user id, provider and connection id are
 *   authenticated as additional data. A ciphertext copied into another user's document,
 *   or another provider's, fails to decrypt.
 * - Key rotation: ciphertexts carry a key id. Keep the old secret in TOKEN_ENCRYPTION_KEY_PREVIOUS
 *   (comma-separated) and tokens are re-sealed with the new key the next time they refresh.
 * - Summaries returned to routes never contain tokens.
 * - Concurrent refreshes for the same connection are coalesced (single flight), so a burst of
 *   requests triggers one refresh, not many.
 *
 * Imports in this folder end in .js (guard test).
 */

import crypto from 'node:crypto';

export type VaultProvider = 'google' | 'meta';
/** Everything that can be sealed: provider connections, plus a user's own AI agent secrets. */
export type SecretProvider = VaultProvider | 'agent';
export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';

const FORMAT_VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDERS: readonly SecretProvider[] = ['google', 'meta', 'agent'];
const SCOPE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ACCESS_TOKEN_SKEW_MS = 60_000;
const MIN_SECRET_LENGTH = 32;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type VaultErrorCode =
  | 'VAULT_NOT_CONNECTED'
  | 'VAULT_REAUTH_REQUIRED'
  | 'VAULT_REFRESH_FAILED'
  | 'VAULT_DECRYPT_FAILED'
  | 'VAULT_INVALID_INPUT'
  | 'VAULT_KEY_INVALID';

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  readonly status: number;

  constructor(code: VaultErrorCode, message: string, status: number) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
    this.status = status;
  }
}

/** Thrown by a refresher when the provider permanently rejected the refresh token (revoked/expired). */
export class RefreshRejectedError extends Error {
  constructor(message = 'The provider rejected the refresh token.') {
    super(message);
    this.name = 'RefreshRejectedError';
  }
}

/**
 * True when a refresh failure means "the user must reconnect" (token revoked or expired), as
 * opposed to a temporary problem (network, Google outage) where the connection must be kept.
 * Works with google-auth-library / gaxios errors and plain errors.
 */
export function isPermanentRefreshError(err: unknown): boolean {
  if (err instanceof RefreshRejectedError) return true;
  const e = err as {
    message?: unknown;
    response?: { data?: { error?: unknown; error_description?: unknown } };
  };
  const parts = [e?.message, e?.response?.data?.error, e?.response?.data?.error_description]
    .filter((p): p is string => typeof p === 'string')
    .join(' ');
  return /invalid_grant|token has been expired or revoked/i.test(parts);
}

// ---------------------------------------------------------------------------
// Keys and sealing
// ---------------------------------------------------------------------------

export interface Keyring {
  primaryId: string;
  keys: Map<string, Buffer>;
}

export function keyIdFor(secret: string): string {
  return crypto.createHash('sha256').update(`adlens-key-id:${secret}`, 'utf8').digest('hex').slice(0, 8);
}

function deriveKey(secret: string, keyId: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('adlens-token-vault-v1', 'utf8'),
      Buffer.from(`key:${keyId}`, 'utf8'),
      32
    )
  );
}

export function buildKeyring(primarySecret: string, previousSecrets: string[] = []): Keyring {
  const primary = (primarySecret ?? '').trim();
  if (primary.length < MIN_SECRET_LENGTH) {
    throw new VaultError(
      'VAULT_KEY_INVALID',
      `TOKEN_ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters long.`,
      500
    );
  }
  const keys = new Map<string, Buffer>();
  const primaryId = keyIdFor(primary);
  keys.set(primaryId, deriveKey(primary, primaryId));
  for (const raw of previousSecrets) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length < MIN_SECRET_LENGTH) {
      throw new VaultError(
        'VAULT_KEY_INVALID',
        `Each previous encryption key must be at least ${MIN_SECRET_LENGTH} characters long.`,
        500
      );
    }
    const id = keyIdFor(s);
    if (!keys.has(id)) keys.set(id, deriveKey(s, id));
  }
  return { primaryId, keys };
}

/** Parse the optional comma-separated TOKEN_ENCRYPTION_KEY_PREVIOUS value. */
export function parsePreviousSecrets(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface VaultContext {
  uid: string;
  provider: SecretProvider;
  connectionId: string;
  /** Required for provider "agent" (the agent id); not allowed for the others. */
  scope?: string;
}

/** "{uid}_{provider}", or "{uid}_agent_{agentId}" for a user's own AI agent key. */
export function connectionIdFor(uid: string, provider: SecretProvider, scope?: string): string {
  return scope ? `${uid}_${provider}_${scope}` : `${uid}_${provider}`;
}

function assertContext(ctx: VaultContext): void {
  const scopeOk = ctx.provider === 'agent' ? !!ctx.scope && SCOPE_RE.test(ctx.scope) : ctx.scope === undefined;
  if (
    !UID_RE.test(ctx.uid) ||
    !PROVIDERS.includes(ctx.provider) ||
    !scopeOk ||
    ctx.connectionId !== connectionIdFor(ctx.uid, ctx.provider, ctx.scope)
  ) {
    throw new VaultError('VAULT_INVALID_INPUT', 'Invalid connection context.', 400);
  }
}

const agentContext = (uid: string, agentId: string): VaultContext => ({
  uid,
  provider: 'agent',
  scope: agentId,
  connectionId: connectionIdFor(uid, 'agent', agentId),
});

/** Encrypt a user's own AI API key (or webhook signing secret), bound to this user and agent. */
export function sealAgentSecret(plaintext: string, uid: string, agentId: string, keyring: Keyring): string {
  return sealSecret(plaintext, agentContext(uid, agentId), keyring);
}

export function openAgentSecret(sealed: string, uid: string, agentId: string, keyring: Keyring): string {
  return openSecret(sealed, agentContext(uid, agentId), keyring);
}

function aadFor(ctx: VaultContext): Buffer {
  return Buffer.from(`adlens:${FORMAT_VERSION}:${ctx.uid}:${ctx.provider}:${ctx.connectionId}`, 'utf8');
}

/** Returns "v1.<keyId>.<base64url(iv | tag | ciphertext)>". */
export function sealSecret(plaintext: string, ctx: VaultContext, keyring: Keyring): string {
  assertContext(ctx);
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new VaultError('VAULT_INVALID_INPUT', 'Cannot encrypt an empty value.', 400);
  }
  const key = keyring.keys.get(keyring.primaryId);
  if (!key) throw new VaultError('VAULT_KEY_INVALID', 'No primary encryption key is available.', 500);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(aadFor(ctx));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FORMAT_VERSION}.${keyring.primaryId}.${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

export function sealedKeyId(sealed: string): string | null {
  const parts = typeof sealed === 'string' ? sealed.split('.') : [];
  return parts.length === 3 && parts[0] === FORMAT_VERSION ? parts[1] : null;
}

/** Throws VaultError('VAULT_DECRYPT_FAILED') for wrong key, wrong owner, wrong provider or tampering. */
export function openSecret(sealed: string, ctx: VaultContext, keyring: Keyring): string {
  assertContext(ctx);
  const fail = () => new VaultError('VAULT_DECRYPT_FAILED', 'Stored credentials could not be read.', 401);
  const parts = typeof sealed === 'string' ? sealed.split('.') : [];
  if (parts.length !== 3 || parts[0] !== FORMAT_VERSION || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw fail();

  const key = keyring.keys.get(parts[1]);
  if (!key) throw fail();

  const raw = Buffer.from(parts[2], 'base64url');
  if (raw.length <= IV_LENGTH + TAG_LENGTH) throw fail();
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_LENGTH), { authTagLength: TAG_LENGTH });
    decipher.setAAD(aadFor(ctx));
    decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
  } catch {
    throw fail();
  }
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export interface ConnectionRecord {
  userId: string;
  provider: VaultProvider;
  accountLabel: string | null;
  scopes: string[];
  encryptedRefreshToken: string;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: number | null; // epoch ms
  status: ConnectionStatus;
  keyId: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

/** Storage backend (Firestore collection "connections" in production, a Map in tests). */
export interface VaultStore {
  get(id: string): Promise<ConnectionRecord | null>;
  set(id: string, record: ConnectionRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface RefreshResult {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  /** Only when the provider rotated the refresh token. */
  refreshToken?: string;
}

/** Exchanges a refresh token for a new access token. Throw RefreshRejectedError (or an error that
 *  isPermanentRefreshError() recognises) when the provider says the token is revoked. */
export type TokenRefresher = (refreshToken: string) => Promise<RefreshResult>;

export interface TokenVaultDeps {
  store: VaultStore;
  keyring: Keyring;
  refreshers: Partial<Record<VaultProvider, TokenRefresher>>;
  now?: () => number;
}

export interface SaveConnectionInput {
  uid: string;
  provider: VaultProvider;
  accountLabel: string | null;
  scopes: string[];
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

export interface ConnectionSummary {
  provider: VaultProvider;
  connected: boolean;
  status: ConnectionStatus;
  accountLabel: string | null;
  scopes: string[];
  updatedAt: number;
  needsReconnect: boolean;
}

export function createTokenVault(deps: TokenVaultDeps) {
  const { store, keyring, refreshers } = deps;
  const now = deps.now ?? (() => Date.now());
  const inflight = new Map<string, Promise<string>>();

  const ctxFor = (uid: string, provider: VaultProvider): VaultContext => ({
    uid,
    provider,
    connectionId: connectionIdFor(uid, provider),
  });

  async function loadOwned(uid: string, provider: VaultProvider): Promise<ConnectionRecord | null> {
    assertContext(ctxFor(uid, provider));
    const rec = await store.get(connectionIdFor(uid, provider));
    if (!rec || rec.userId !== uid || rec.provider !== provider) return null;
    return rec;
  }

  async function saveConnection(input: SaveConnectionInput): Promise<void> {
    const ctx = ctxFor(input.uid, input.provider);
    assertContext(ctx);
    if (!input.refreshToken) {
      throw new VaultError('VAULT_INVALID_INPUT', 'A refresh token is required to save a connection.', 400);
    }
    const existing = await loadOwned(input.uid, input.provider);
    const t = now();
    const record: ConnectionRecord = {
      userId: input.uid,
      provider: input.provider,
      accountLabel: input.accountLabel,
      scopes: [...input.scopes],
      encryptedRefreshToken: sealSecret(input.refreshToken, ctx, keyring),
      encryptedAccessToken: input.accessToken ? sealSecret(input.accessToken, ctx, keyring) : null,
      accessTokenExpiresAt: input.accessToken ? input.accessTokenExpiresAt ?? null : null,
      status: 'active',
      keyId: keyring.primaryId,
      createdAt: existing?.createdAt ?? t,
      updatedAt: t,
    };
    await store.set(ctx.connectionId, record);
  }

  /** Token-free view for the Connections page. Null when the user has no connection. */
  async function getSummary(uid: string, provider: VaultProvider): Promise<ConnectionSummary | null> {
    const rec = await loadOwned(uid, provider);
    if (!rec) return null;
    return {
      provider,
      connected: rec.status === 'active',
      status: rec.status,
      accountLabel: rec.accountLabel,
      scopes: [...rec.scopes],
      updatedAt: rec.updatedAt,
      needsReconnect: rec.status !== 'active',
    };
  }

  async function refreshOnce(uid: string, provider: VaultProvider): Promise<string> {
    const ctx = ctxFor(uid, provider);
    const rec = await loadOwned(uid, provider);
    if (!rec) throw new VaultError('VAULT_NOT_CONNECTED', 'This account is not connected.', 401);
    if (rec.status !== 'active') {
      throw new VaultError('VAULT_REAUTH_REQUIRED', 'The connection needs to be renewed. Please reconnect.', 401);
    }

    // Another request may have refreshed while we waited: use its result.
    if (rec.encryptedAccessToken && rec.accessTokenExpiresAt && rec.accessTokenExpiresAt - now() > ACCESS_TOKEN_SKEW_MS) {
      try {
        return openSecret(rec.encryptedAccessToken, ctx, keyring);
      } catch {
        // fall through and refresh with the refresh token
      }
    }

    const refresher = refreshers[provider];
    if (!refresher) {
      throw new VaultError('VAULT_REFRESH_FAILED', `No token refresher is configured for ${provider}.`, 500);
    }

    const refreshToken = openSecret(rec.encryptedRefreshToken, ctx, keyring);

    let result: RefreshResult;
    try {
      result = await refresher(refreshToken);
    } catch (err) {
      if (isPermanentRefreshError(err)) {
        await store.set(ctx.connectionId, {
          ...rec,
          status: 'revoked',
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
          updatedAt: now(),
        });
        throw new VaultError('VAULT_REAUTH_REQUIRED', 'Access was revoked or expired. Please reconnect.', 401);
      }
      throw new VaultError('VAULT_REFRESH_FAILED', 'Could not refresh access right now. Please try again.', 502);
    }

    // Always re-seal both tokens with the current primary key (this is how old keys retire).
    await store.set(ctx.connectionId, {
      ...rec,
      encryptedRefreshToken: sealSecret(result.refreshToken ?? refreshToken, ctx, keyring),
      encryptedAccessToken: sealSecret(result.accessToken, ctx, keyring),
      accessTokenExpiresAt: result.expiresAt,
      status: 'active',
      keyId: keyring.primaryId,
      updatedAt: now(),
    });
    return result.accessToken;
  }

  /** A valid access token for this user's own connection, refreshing it when needed. */
  async function getAccessToken(uid: string, provider: VaultProvider): Promise<string> {
    const ctx = ctxFor(uid, provider);
    const rec = await loadOwned(uid, provider);
    if (!rec) throw new VaultError('VAULT_NOT_CONNECTED', 'This account is not connected.', 401);
    if (rec.status !== 'active') {
      throw new VaultError('VAULT_REAUTH_REQUIRED', 'The connection needs to be renewed. Please reconnect.', 401);
    }
    if (rec.encryptedAccessToken && rec.accessTokenExpiresAt && rec.accessTokenExpiresAt - now() > ACCESS_TOKEN_SKEW_MS) {
      try {
        return openSecret(rec.encryptedAccessToken, ctx, keyring);
      } catch {
        // fall through to refresh
      }
    }

    const key = ctx.connectionId;
    const running = inflight.get(key);
    if (running) return running;
    const promise = refreshOnce(uid, provider).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  /** For revoking at the provider when the user disconnects. */
  async function getRefreshToken(uid: string, provider: VaultProvider): Promise<string> {
    const rec = await loadOwned(uid, provider);
    if (!rec) throw new VaultError('VAULT_NOT_CONNECTED', 'This account is not connected.', 401);
    return openSecret(rec.encryptedRefreshToken, ctxFor(uid, provider), keyring);
  }

  async function deleteConnection(uid: string, provider: VaultProvider): Promise<void> {
    assertContext(ctxFor(uid, provider));
    await store.delete(connectionIdFor(uid, provider));
  }

  return { saveConnection, getSummary, getAccessToken, getRefreshToken, deleteConnection };
}

export type TokenVault = ReturnType<typeof createTokenVault>;
