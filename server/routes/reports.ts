import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { withDateDefaults } from '../../src/utils/aiTools.js';
import { requireGoogleConfigured } from '../config.js';
import { GoogleApiError } from '../lib/google.js';
import { getVault, mapVaultError } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import '../reports/ga4Reports.js';
import '../reports/exploreReports.js';
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

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const runBodySchema = z.object({
  id: z.string().min(1).max(80),
  args: z.record(z.string(), z.unknown()).optional(),
  startDate: z.string().regex(ISO),
  endDate: z.string().regex(ISO),
  compareStartDate: z.string().regex(ISO).optional(),
  compareEndDate: z.string().regex(ISO).optional(),
});

// POST /api/reports/run -> runs one registered report and returns its raw result.
// Used by the on-device (Private mode) analyst, which reads the numbers itself so the question never leaves the browser.
reportsRouter.post('/run', async (req: Request, res: Response) => {
  const body = runBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: body.error.issues[0]?.message || 'Invalid request.' } });
    return;
  }
  const def = reportRegistry.get(body.data.id);
  if (!def) {
    res.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'That report does not exist.' } });
    return;
  }
  const { id, args, ...dates } = body.data;
  const parsed = def.input.safeParse(withDateDefaults(args, dates));
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_REPORT_INPUT', message: parsed.error.issues[0]?.message || 'Invalid report arguments.' } });
    return;
  }
  try {
    res.json({ id, result: await def.run(createReportContext(req), parsed.data) });
  } catch (err) {
    const mapped = mapVaultError(err) ?? (err instanceof GoogleApiError ? err : null);
    if (mapped) {
      res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
      return;
    }
    res.status(502).json({ error: { code: 'REPORT_FAILED', message: 'Unable to run this report right now.' } });
  }
});
