import type { CookieOptions, Request, Response } from 'express';
import { getServerConfig } from '../config.ts';
import { decryptPayload, encryptPayload } from './crypto.ts';

export const SESSION_COOKIE_NAME = 'adlens_session';
export const OAUTH_STATE_COOKIE_NAME = 'adlens_oauth_state';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_COOKIE_BYTES = 4000; // Keep under 4 KB

export interface GoogleSessionData {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiry: number; // epoch ms
  email: string;
  ga4Property?: {
    id: string;
    name: string;
  };
  searchConsoleSite?: {
    url: string;
  };
}

export interface SessionData {
  google?: GoogleSessionData;
}

export function getSessionCookieOptions(maxAgeMs: number = SESSION_MAX_AGE_MS): CookieOptions {
  const { isProduction } = getServerConfig();
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function readSession(req: Request): SessionData {
  const { tokenEncryptionKey } = getServerConfig();
  if (!tokenEncryptionKey) {
    return {};
  }

  const rawCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (!rawCookie || typeof rawCookie !== 'string') {
    return {};
  }

  try {
    const json = decryptPayload(rawCookie, tokenEncryptionKey);
    const parsed = JSON.parse(json) as SessionData;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    // If decryption or JSON parsing fails, treat the session as empty
    return {};
  }
}

export function writeSession(res: Response, session: SessionData): void {
  const { tokenEncryptionKey } = getServerConfig();
  if (!tokenEncryptionKey) {
    return;
  }

  if (!session.google) {
    clearSession(res);
    return;
  }

  const plaintext = JSON.stringify(session);
  const encrypted = encryptPayload(plaintext, tokenEncryptionKey);

  if (Buffer.byteLength(encrypted, 'utf8') > MAX_COOKIE_BYTES) {
    throw new Error('Serialized session exceeds 4 KB cookie limit');
  }

  res.cookie(SESSION_COOKIE_NAME, encrypted, getSessionCookieOptions(SESSION_MAX_AGE_MS));
}

export function clearSession(res: Response): void {
  const { isProduction } = getServerConfig();
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
}
