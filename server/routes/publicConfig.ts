import { Router, type Request, type Response } from 'express';
import { getServerConfig } from '../config.js';

export const publicConfigRouter = Router();

// GET /api/public-config (no auth) -> { firebase: { apiKey, authDomain, projectId, appId }, providers: string[] }
publicConfigRouter.get('/', (_req: Request, res: Response) => {
  const cfg = getServerConfig();
  res.json({
    firebase: {
      apiKey: cfg.firebaseApiKey,
      authDomain: cfg.firebaseAuthDomain,
      projectId: cfg.firebaseProjectId,
      appId: cfg.firebaseAppId,
    },
    providers: cfg.authProviders,
  });
});

