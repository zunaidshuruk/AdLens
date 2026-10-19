import type { Request, Response } from 'express';
import { getServerConfig } from '../config.js';
import { connectionStore } from './connectionStore.js';
import { createOAuthClient, GOOGLE_OAUTH_SCOPES, GoogleApiError } from './google.js';
import { clearSession, readSession, writeSession } from './session.js';
import {
  buildKeyring,
  createTokenVault,
  parsePreviousSecrets,
  VaultError,
  type RefreshResult,
  type TokenVault,
} from './tokenVault.js';

export async function refreshGoogle(refreshToken: string): Promise<RefreshResult> {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error('No access_token returned from Google token refresh.');
  }
  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date ?? Date.now() + 3_600_000,
    refreshToken: credentials.refresh_token ?? undefined,
  };
}

let vaultInstance: TokenVault | null = null;
let vaultKeySignature = '';
let testVaultOverride: TokenVault | null = null;

export function setTestVault(vault: TokenVault | null): void {
  testVaultOverride = vault;
}

export function resetVaultSingleton(): void {
  vaultInstance = null;
  vaultKeySignature = '';
}

export function getVault(): TokenVault {
  if (testVaultOverride) {
    return testVaultOverride;
  }
  const cfg = getServerConfig();
  const prevRaw = process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS ?? '';
  const signature = `${cfg.tokenEncryptionKey}|${prevRaw}`;

  if (!vaultInstance || vaultKeySignature !== signature) {
    vaultInstance = createTokenVault({
      store: connectionStore,
      keyring: buildKeyring(cfg.tokenEncryptionKey, parsePreviousSecrets(prevRaw)),
      refreshers: { google: refreshGoogle },
    });
    vaultKeySignature = signature;
  }

  return vaultInstance;
}

export function mapVaultError(err: unknown): GoogleApiError | null {
  if (!(err instanceof VaultError)) {
    return null;
  }
  switch (err.code) {
    case 'VAULT_NOT_CONNECTED':
      return new GoogleApiError(
        'GOOGLE_NOT_CONNECTED',
        'Google account is not connected.',
        401
      );
    case 'VAULT_REAUTH_REQUIRED':
    case 'VAULT_DECRYPT_FAILED':
      return new GoogleApiError(
        'GOOGLE_REAUTH_REQUIRED',
        'Your Google session has expired or been revoked. Please reconnect your Google account.',
        401
      );
    case 'VAULT_REFRESH_FAILED':
      return new GoogleApiError(
        'GOOGLE_REQUEST_FAILED',
        'Could not refresh Google access right now. Please try again.',
        502
      );
    default:
      return new GoogleApiError(err.code, err.message, err.status);
  }
}

const checkedRequests = new WeakSet<Request>();

interface LegacyCookieGoogleData {
  uid?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiry?: number;
  email?: string | null;
}

/**
 * Lazy migration: if the user has no vault connection yet, but the old encrypted cookie
 * has google.refreshToken AND its owner uid matches req.user.uid, save it into the vault
 * and clear the google part of the cookie.
 */
export async function ensureVaultFromCookie(req: Request, res: Response): Promise<boolean> {
  if (checkedRequests.has(req)) {
    return false;
  }
  checkedRequests.add(req);

  const uid = req.user?.uid;
  if (!uid) {
    return false;
  }

  const session = readSession(req) as {
    uid?: string;
    google?: LegacyCookieGoogleData;
  };
  const legacyGoogle = session.google;
  if (
    !legacyGoogle ||
    typeof legacyGoogle.refreshToken !== 'string' ||
    legacyGoogle.refreshToken.length === 0
  ) {
    return false;
  }

  const cookieUid = legacyGoogle.uid ?? session.uid;
  if (!cookieUid || cookieUid !== uid) {
    return false;
  }

  const cfg = getServerConfig();
  if (!cfg.vaultReady) {
    return false;
  }

  const vault = getVault();
  const existing = await vault.getSummary(uid, 'google');
  if (!existing) {
    await vault.saveConnection({
      uid,
      provider: 'google',
      accountLabel: legacyGoogle.email ?? null,
      scopes: [...GOOGLE_OAUTH_SCOPES],
      refreshToken: legacyGoogle.refreshToken,
      accessToken:
        typeof legacyGoogle.accessToken === 'string' && legacyGoogle.accessToken.length > 0
          ? legacyGoogle.accessToken
          : undefined,
      accessTokenExpiresAt:
        typeof legacyGoogle.accessTokenExpiry === 'number'
          ? legacyGoogle.accessTokenExpiry
          : undefined,
    });
  }

  delete session.google;
  if (session.uid) {
    writeSession(res, session);
  } else {
    clearSession(res);
  }
  return !existing;
}
