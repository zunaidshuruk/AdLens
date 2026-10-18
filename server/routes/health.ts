import { Router, type Request, type Response } from 'express';
import { APP_NAME, APP_VERSION } from '../../src/config/app.ts';
import { getServerConfig } from '../config.ts';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  const cfg = getServerConfig();
  res.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    googleConfigured: cfg.googleConfigured,
    missing: cfg.missing,
    timestamp: new Date().toISOString(),
  });
});
