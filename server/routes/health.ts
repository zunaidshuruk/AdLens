import { Router, Request, Response } from 'express';
import { APP_NAME, APP_VERSION } from '../../src/config/app';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  });
});
