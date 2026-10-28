import { Router, type Request, type Response } from 'express';
import { APP_NAME, APP_VERSION } from '../../src/config/app.js';
import { getServerConfig } from '../config.js';

export const healthRouter = Router();

// Public: only what the sign-in screen and uptime checks need. Which secrets are missing is shown to operators in the admin panel.
healthRouter.get('/', (_req: Request, res: Response) => {
  const cfg = getServerConfig();
  res.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    googleConfigured: cfg.googleConfigured,
    metaConfigured: cfg.metaConfigured,
    metaLoginConfigured: cfg.metaLoginConfigured,
    firebaseConfigured: cfg.firebaseConfigured,
    aiConfigured: cfg.aiConfigured,
    timestamp: new Date().toISOString(),
  });
});
