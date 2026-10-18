import dotenv from 'dotenv';
import type { NextFunction, Request, Response } from 'express';

dotenv.config();

export const REQUIRED_GOOGLE_ENV_VARS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'APP_BASE_URL',
] as const;

export type RequiredGoogleEnvVar = (typeof REQUIRED_GOOGLE_ENV_VARS)[number];

export interface ServerConfig {
  googleClientId: string;
  googleClientSecret: string;
  tokenEncryptionKey: string;
  appBaseUrl: string;
  googleConfigured: boolean;
  missing: RequiredGoogleEnvVar[];
  isProduction: boolean;
}

export function getServerConfig(): ServerConfig {
  const missing: RequiredGoogleEnvVar[] = [];

  for (const key of REQUIRED_GOOGLE_ENV_VARS) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      missing.push(key);
    }
  }

  const rawBaseUrl = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');

  return {
    googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    tokenEncryptionKey: (process.env.TOKEN_ENCRYPTION_KEY || '').trim(),
    appBaseUrl: rawBaseUrl,
    googleConfigured: missing.length === 0,
    missing,
    isProduction: process.env.NODE_ENV === 'production',
  };
}

export function requireGoogleConfigured(req: Request, res: Response, next: NextFunction): void {
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
