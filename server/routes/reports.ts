import { Router, type Request, type Response } from 'express';
import { requireGoogleConfigured } from '../config.js';
import { GoogleApiError } from '../lib/google.js';
import { getVault, mapVaultError } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import '../reports/ga4Reports.js';
import { reportRegistry } from '../reports/registry.js';
import type { ReportContext } from '../reports/types.js';
import { googleRateLimitMiddleware } from './connections.js';

export const reportsRouter = Router();

export function createReportContext(req: Request): ReportContext {
  const uid = req.user!.uid;
  return {
    getAccessToken: () => getVault().getAccessToken(uid, 'google'),
    ga4PropertyId: req.project?.ga4PropertyId ?? undefined,
    ga4PropertyName: req.project?.ga4PropertyName ?? req.project?.ga4PropertyId ?? undefined,
    searchConsoleSite: req.project?.searchConsoleSite ?? undefined,
    ...(req.project ? { project: req.project } : {}),
  };
}

reportsRouter.use(googleRateLimitMiddleware);
reportsRouter.use(requireUser);
reportsRouter.use(verifyGoogleSessionOwnership);
reportsRouter.use(loadProject);
reportsRouter.use(requireGoogleConfigured);

// GET /api/reports -> registry.list() (requires a connected Google account in the vault)
reportsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = createReportContext(req);
    await ctx.getAccessToken();
    res.json(reportRegistry.list());
  } catch (err) {
    const mapped = mapVaultError(err) ?? (err instanceof GoogleApiError ? err : null);
    if (mapped) {
      res.status(mapped.status).json({
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      });
      return;
    }
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: err instanceof Error ? err.message : 'An unexpected server error occurred.',
      },
    });
  }
});
