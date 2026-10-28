import { can } from '../lib/permissions.js';
import { getContentLimits } from '../config/plans.js';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireGoogleConfigured } from '../config.js';
import {
  GA4_DIMENSIONS, GA4_METRICS, SC_DIMENSIONS, SC_METRICS, META_DIMENSIONS, META_METRICS, MAX_ROWS,
  ga4ExploreInputSchema, scExploreInputSchema, metaExploreInputSchema, type ExploreResult,
} from '../lib/exploreSpec.js';
import { GoogleApiError } from '../lib/google.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { getProjectDocsStore } from '../lib/projectDocs.js';
import {
  SavedReportError, createSavedReport, deleteSavedReport, listSavedReports, savedReportInputSchema, updateSavedReport,
} from '../lib/savedReports.js';
import { getVault, mapVaultError } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import { buildReportContext } from '../lib/reportContext.js';
import { MetaApiError } from '../lib/meta.js';
import { DatasetError, dataExploreInputSchema, getDataset, runDataQuery } from '../lib/datasets.js';
import { datasetScope } from './datasets.js';
import { ga4ExploreReport, metaExploreReport, searchConsoleExploreReport } from '../reports/exploreReports.js';
import type { ReportContext } from '../reports/types.js';
import { googleRateLimitMiddleware } from './connections.js';

export const exploreRouter = Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; data: ExploreResult }>();
export function clearExploreCache(): void { cache.clear(); }

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof SavedReportError) return fail(res, err.status, err.code, err.message);
  if (err instanceof DatasetError) return fail(res, err.status, err.code, err.message);
  if (err instanceof MetaApiError) return fail(res, err.status, err.code, err.message);
  const mapped = mapVaultError(err) ?? (err instanceof GoogleApiError ? err : null);
  if (mapped) return fail(res, mapped.status, mapped.code, mapped.message);
  fail(res, 502, 'EXPLORE_FAILED', 'Unable to run this report right now.');
}

exploreRouter.use(googleRateLimitMiddleware);
exploreRouter.use(requireUser);
exploreRouter.use(verifyGoogleSessionOwnership);
exploreRouter.use(loadProject);

// GET /api/explore/catalog: which dimensions and metrics can be chosen (no Google call needed)
exploreRouter.get('/catalog', (_req: Request, res: Response) => {
  res.json({
    maxRows: MAX_ROWS,
    ga4: { dimensions: GA4_DIMENSIONS, metrics: GA4_METRICS, maxDimensions: 4, maxMetrics: 6 },
    search_console: { dimensions: SC_DIMENSIONS, metrics: SC_METRICS, maxDimensions: 3, maxMetrics: 4 },
    meta: { dimensions: META_DIMENSIONS, metrics: META_METRICS, maxDimensions: 3, maxMetrics: 6 },
  });
});

function ctxFor(req: Request): ReportContext {
  const uid = req.user!.uid;
  return {
    getAccessToken: () => getVault().getAccessToken(uid, 'google'),
    ga4PropertyId: req.project?.ga4PropertyId ?? undefined,
    searchConsoleSite: req.project?.searchConsoleSite ?? undefined,
    ...(req.project ? { project: req.project } : {}),
  };
}

async function run(req: Request, res: Response, kind: 'ga4' | 'search_console' | 'meta'): Promise<void> {
  const parsed = (kind === 'ga4' ? ga4ExploreInputSchema : kind === 'meta' ? metaExploreInputSchema : scExploreInputSchema).safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, 'INVALID_REPORT', parsed.error.issues[0]?.message || 'The report settings are not valid.');
  }
  const uid = req.user!.uid;
  const selected = kind === 'ga4' ? req.project?.ga4PropertyId : kind === 'meta' ? req.project?.metaAdAccountId : req.project?.searchConsoleSite;
  if (!selected && kind === 'meta') {
    return fail(res, 409, 'META_NOT_SELECTED', 'Connect Facebook and choose an ad account on the Connections page first.');
  }
  if (!selected) {
    return fail(res, 409, kind === 'ga4' ? 'GA4_NOT_SELECTED' : 'SC_NOT_SELECTED',
      kind === 'ga4' ? 'Choose a Google Analytics property on the Connections page first.' : 'Choose a Search Console site on the Connections page first.');
  }
  const key = `${uid}:${req.project?.id ?? ''}:${kind}:${JSON.stringify(parsed.data)}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    res.setHeader('X-AdLens-Cache', 'true');
    res.json(hit.data);
    return;
  }
  try {
    const ctx = kind === 'meta' ? buildReportContext(uid, req.project) : ctxFor(req);
    const data = kind === 'ga4'
      ? await ga4ExploreReport.run(ctx, parsed.data as z.infer<typeof ga4ExploreInputSchema>)
      : kind === 'meta'
        ? await metaExploreReport.run(ctx, parsed.data as z.infer<typeof metaExploreInputSchema>)
        : await searchConsoleExploreReport.run(ctx, parsed.data as z.infer<typeof scExploreInputSchema>);
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
    res.setHeader('X-AdLens-Cache', 'false');
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
}

exploreRouter.post('/data/run', async (req, res) => {
  try {
    const parsed = dataExploreInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REPORT', parsed.error.issues[0]?.message || 'The report settings are not valid.');
    const s = await datasetScope(req, res, false);
    if (!s) return;
    const ds = await getDataset(getProjectDocsStore(), s.ws, s.project, parsed.data.datasetId);
    res.json(runDataQuery(ds, parsed.data));
  } catch (err) { handleError(res, err); }
});
exploreRouter.post('/meta/run', (req, res) => void run(req, res, 'meta'));
exploreRouter.use(requireGoogleConfigured);
exploreRouter.post('/ga4/run', (req, res) => void run(req, res, 'ga4'));
exploreRouter.post('/search-console/run', (req, res) => void run(req, res, 'search_console'));

// ---------------------------------------------------------------------------
// Saved reports (per project, stored by the server)
// ---------------------------------------------------------------------------

async function requireProjectMember(req: Request, res: Response, write: boolean): Promise<{ ws: string; project: string; plan: string } | null> {
  const project = req.project;
  if (!project) {
    fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.');
    return null;
  }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  if (!ws || !can(ws, req.user!.uid, write ? 'content.edit' : 'reports.view')) {
    fail(res, 403, 'NOT_ALLOWED', 'You do not have permission to change reports in this project.');
    return null;
  }
  return { ws: project.workspaceId, project: project.id, plan: ws?.plan ?? 'beta' };
}

exploreRouter.get('/saved', async (req, res) => {
  try {
    const scope = await requireProjectMember(req, res, false);
    if (!scope) return;
    res.json({ reports: await listSavedReports(getProjectDocsStore(), scope.ws, scope.project) });
  } catch (err) { handleError(res, err); }
});

exploreRouter.post('/saved', async (req, res) => {
  try {
    const scope = await requireProjectMember(req, res, true);
    if (!scope) return;
    const parsed = savedReportInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REPORT', parsed.error.issues[0]?.message || 'The report is not valid.');
    const report = await createSavedReport(getProjectDocsStore(), scope.ws, scope.project, req.user!.uid, parsed.data, new Date(), getContentLimits(scope.plan).maxSavedReports);
    res.status(201).json({ report });
  } catch (err) { handleError(res, err); }
});

exploreRouter.put('/saved/:id', async (req, res) => {
  try {
    const scope = await requireProjectMember(req, res, true);
    if (!scope) return;
    const parsed = savedReportInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REPORT', parsed.error.issues[0]?.message || 'The report is not valid.');
    res.json({ report: await updateSavedReport(getProjectDocsStore(), scope.ws, scope.project, String(req.params.id), parsed.data) });
  } catch (err) { handleError(res, err); }
});

exploreRouter.delete('/saved/:id', async (req, res) => {
  try {
    const scope = await requireProjectMember(req, res, true);
    if (!scope) return;
    await deleteSavedReport(getProjectDocsStore(), scope.ws, scope.project, String(req.params.id));
    res.status(204).end();
  } catch (err) { handleError(res, err); }
});
