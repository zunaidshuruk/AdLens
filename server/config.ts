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

export type RequiredGoogleEnvVar = (typeof REQUIRED_GOOGLE_ENV_VARS)[number];
export type RequiredMetaEnvVar = (typeof REQUIRED_META_ENV_VARS)[number];

export interface ServerConfig {
  googleClientId: string;
  googleClientSecret: string;
  tokenEncryptionKey: string;
  appBaseUrl: string;
  googleConfigured: boolean;
  missing: RequiredGoogleEnvVar[];
  metaAccessToken: string;
  metaAppSecret: string;
  metaAdAccountId: string;
  metaConfigured: boolean;
  metaMissing: RequiredMetaEnvVar[];
  isProduction: boolean;
}

export function normalizeMetaAdAccountId(raw: string | undefined): string {
  if (!raw) return '';
  const stripped = raw.trim().replace(/^act_/i, '').trim();
  return /^\d+$/.test(stripped) ? stripped : '';
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

  const rawBaseUrl = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');

  return {
    googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    tokenEncryptionKey: (process.env.TOKEN_ENCRYPTION_KEY || '').trim(),
    appBaseUrl: rawBaseUrl,
    googleConfigured: missing.length === 0,
    missing,
    metaAccessToken,
    metaAppSecret,
    metaAdAccountId,
    metaConfigured: metaMissing.length === 0,
    metaMissing,
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

