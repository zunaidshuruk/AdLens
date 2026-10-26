import { Router, type Request, type Response } from 'express';
import { APP_NAME, APP_VERSION } from '../../src/config/app.js';
import { getServerConfig } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  const cfg = getServerConfig();
  res.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    googleConfigured: cfg.googleConfigured,
    missing: cfg.missing,
    metaConfigured: cfg.metaConfigured,
    metaMissing: cfg.metaMissing,
    firebaseConfigured: cfg.firebaseConfigured,
    firebaseMissing: cfg.firebaseMissing,
    vaultReady: cfg.vaultReady,
    aiConfigured: cfg.aiConfigured,
    timestamp: new Date().toISOString(),
  });
});
