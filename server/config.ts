import dotenv from 'dotenv';
import type { NextFunction, Request, Response } from 'express';

dotenv.config();

export const REQUIRED_GOOGLE_ENV_VARS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'APP_BASE_URL',
] as const;

export const REQUIRED_META_ENV_VARS = [
  'META_ACCESS_TOKEN',
  'META_APP_SECRET',
  'META_AD_ACCOUNT_ID',
] as const;

export const REQUIRED_FIREBASE_ENV_VARS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
] as const;

export type RequiredGoogleEnvVar = (typeof REQUIRED_GOOGLE_ENV_VARS)[number];
export type RequiredMetaEnvVar = (typeof REQUIRED_META_ENV_VARS)[number];
export type RequiredFirebaseEnvVar = (typeof REQUIRED_FIREBASE_ENV_VARS)[number];

export interface ServerConfig {
  googleClientId: string;
  googleClientSecret: string;
  tokenEncryptionKey: string;
  tokenEncryptionKeyPrevious: string[];
  vaultReady: boolean;
  appBaseUrl: string;
  googleConfigured: boolean;
  missing: RequiredGoogleEnvVar[];
  metaAccessToken: string;
  metaAppSecret: string;
  metaAdAccountId: string;
  metaConfigured: boolean;
  metaMissing: RequiredMetaEnvVar[];
  metaSystemUserAllowedEmails: string[];
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  firebaseAppId: string;
  firebaseServiceAccountJson: string;
  firebaseConfigured: boolean;
  firebaseMissing: RequiredFirebaseEnvVar[];
  geminiApiKey: string;
  geminiApiKey2: string;
  geminiModel: string;
  aiConfigured: boolean;
  aiFallbackKeyConfigured: boolean;
  authProviders: string[];
  isProduction: boolean;
}

export const DEFAULT_AUTH_PROVIDERS = ['password', 'google'] as const;

export function parseAuthProviders(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) {
    return [...DEFAULT_AUTH_PROVIDERS];
  }
  const parsed = raw
    .split(',')
    .map((p) => {
      const token = p.trim().toLowerCase();
      if (token === 'google.com') return 'google';
      if (token === 'microsoft.com') return 'microsoft';
      return token;
    })
    .filter(Boolean);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [...DEFAULT_AUTH_PROVIDERS];
}

export function normalizeMetaAdAccountId(raw: string | undefined): string {
  if (!raw) return '';
  const stripped = raw.trim().replace(/^act_/i, '').trim();
  return /^\d+$/.test(stripped) ? stripped : '';
}

export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowedForMetaSystemUser(
  email: string | null | undefined,
  allowedEmails?: string[]
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const list = allowedEmails ?? getServerConfig().metaSystemUserAllowedEmails;
  return list.includes(normalized);
}

export function getServerConfig(): ServerConfig {
  const missing: RequiredGoogleEnvVar[] = [];

  for (const key of REQUIRED_GOOGLE_ENV_VARS) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      missing.push(key);
    }
  }

  const metaAccessToken = (process.env.META_ACCESS_TOKEN || '').trim();
  const metaAppSecret = (process.env.META_APP_SECRET || '').trim();
  const metaAdAccountId = normalizeMetaAdAccountId(process.env.META_AD_ACCOUNT_ID);

  const metaMissing: RequiredMetaEnvVar[] = [];
  if (!metaAccessToken) metaMissing.push('META_ACCESS_TOKEN');
  if (!metaAppSecret) metaMissing.push('META_APP_SECRET');
  if (!metaAdAccountId) metaMissing.push('META_AD_ACCOUNT_ID');

  const firebaseApiKey = (process.env.FIREBASE_API_KEY || '').trim();
  const firebaseAuthDomain = (process.env.FIREBASE_AUTH_DOMAIN || '').trim();
  const firebaseProjectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const firebaseAppId = (process.env.FIREBASE_APP_ID || '').trim();
  const firebaseServiceAccountJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();

  const firebaseMissing: RequiredFirebaseEnvVar[] = [];
  for (const key of REQUIRED_FIREBASE_ENV_VARS) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      firebaseMissing.push(key);
    }
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
  const geminiApiKey2 = (process.env.GEMINI_API_KEY_2 || '').trim();
  const geminiModel = (process.env.GEMINI_MODEL || '').trim();
  const aiConfigured = Boolean(geminiModel && (geminiApiKey || geminiApiKey2));
  const aiFallbackKeyConfigured = Boolean(geminiApiKey2);

  const rawBaseUrl = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  const metaSystemUserAllowedEmails = parseAllowedEmails(
    process.env.META_SYSTEM_USER_ALLOWED_EMAILS
  );
  const authProviders = parseAuthProviders(process.env.AUTH_PROVIDERS);
  const tokenEncryptionKey = (process.env.TOKEN_ENCRYPTION_KEY || '').trim();
  const tokenEncryptionKeyPrevious = (process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    tokenEncryptionKey,
    tokenEncryptionKeyPrevious,
    vaultReady: tokenEncryptionKey.length >= 32,
    appBaseUrl: rawBaseUrl,
    googleConfigured: missing.length === 0,
    missing,
    metaAccessToken,
    metaAppSecret,
    metaAdAccountId,
    metaConfigured: metaMissing.length === 0,
    metaMissing,
    metaSystemUserAllowedEmails,
    firebaseApiKey,
    firebaseAuthDomain,
    firebaseProjectId,
    firebaseAppId,
    firebaseServiceAccountJson,
    firebaseConfigured: firebaseMissing.length === 0,
    firebaseMissing,
    geminiApiKey,
    geminiApiKey2,
    geminiModel,
    aiConfigured,
    aiFallbackKeyConfigured,
    authProviders,
    isProduction: process.env.NODE_ENV === 'production',
  };
}

export function requireGoogleConfigured(_req: Request, res: Response, next: NextFunction): void {
  const cfg = getServerConfig();
  if (!cfg.googleConfigured) {
    res.status(503).json({
      error: {
        code: 'GOOGLE_NOT_CONFIGURED',
        message: `Google integration is not configured. Missing environment variables: ${cfg.missing.join(', ')}`,
      },
    });
    return;
  }
  next();
}

export function requireMetaConfigured(_req: Request, res: Response, next: NextFunction): void {
  const cfg = getServerConfig();
  if (!cfg.metaConfigured) {
    res.status(503).json({
      error: {
        code: 'META_NOT_CONFIGURED',
        message: `Meta Ads integration is not configured. Missing environment variables: ${cfg.metaMissing.join(', ')}`,
      },
    });
    return;
  }
  next();
}
