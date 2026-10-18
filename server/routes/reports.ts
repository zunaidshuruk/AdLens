import { Router, type Request, type Response } from 'express';
import { requireGoogleConfigured } from '../config.js';
import { readSession } from '../lib/session.js';
import '../reports/ga4Reports.js';
import { reportRegistry } from '../reports/registry.js';
import { googleRateLimitMiddleware } from './connections.js';

export const reportsRouter = Router();

reportsRouter.use(googleRateLimitMiddleware);
reportsRouter.use(requireGoogleConfigured);

// GET /api/reports -> registry.list() (requires a Google session; no data, just definitions)
reportsRouter.get('/', (req: Request, res: Response) => {
  const session = readSession(req);
  if (!session.google?.refreshToken) {
    res.status(401).json({
      error: {
        code: 'GOOGLE_NOT_CONNECTED',
        message: 'A connected Google session is required to list report definitions.',
      },
    });
    return;
  }

  res.json(reportRegistry.list());
});
