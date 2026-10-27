import { Router, type Request, type Response } from 'express';
import {
  DashboardError, createDashboard, deleteDashboard, getDashboard, listDashboards, updateDashboard,
} from '../lib/dashboards.js';
import { dashboardInputSchema } from '../lib/dashboardSpec.js';
import { createAgentProvider } from '../lib/agentProviders.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { suggestWidget, type SuggestOutcome } from '../lib/widgetSuggest.js';
import { getServerConfig } from '../config.js';
import { aiRateLimitMiddleware, getAiRequest, resolveConnectedSourcesForProject } from './ai.js';
import { getProjectDocsStore } from '../lib/projectDocs.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

export const dashboardsRouter = Router();

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof DashboardError) return fail(res, err.status, err.code, err.message);
  fail(res, 500, 'DASHBOARD_FAILED', 'Something went wrong with this dashboard.');
}

dashboardsRouter.use(requireUser);
dashboardsRouter.use(verifyGoogleSessionOwnership);
dashboardsRouter.use(loadProject);

async function scope(req: Request, res: Response, write: boolean): Promise<{ ws: string; project: string; plan: string | undefined } | null> {
  const project = req.project;
  if (!project) {
    fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.');
    return null;
  }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const role = ws?.members?.[req.user!.uid];
  if (!role || (write && role !== 'owner' && role !== 'admin' && role !== 'member')) {
    fail(res, 403, 'NOT_ALLOWED', 'You do not have permission to change dashboards in this project.');
    return null;
  }
  return { ws: project.workspaceId, project: project.id, plan: ws?.plan };
}

const invalid = (res: Response, issue?: { message?: string }) =>
  fail(res, 400, 'INVALID_DASHBOARD', issue?.message || 'The dashboard is not valid.');

dashboardsRouter.get('/', async (req, res) => {
  try {
    const s = await scope(req, res, false);
    if (!s) return;
    res.json({ dashboards: await listDashboards(getProjectDocsStore(), s.ws, s.project) });
  } catch (err) { handleError(res, err); }
});

dashboardsRouter.get('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, false);
    if (!s) return;
    res.json({ dashboard: await getDashboard(getProjectDocsStore(), s.ws, s.project, String(req.params.id)) });
  } catch (err) { handleError(res, err); }
});

dashboardsRouter.post('/', async (req, res) => {
  try {
    const s = await scope(req, res, true);
    if (!s) return;
    const parsed = dashboardInputSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues[0]);
    res.status(201).json({ dashboard: await createDashboard(getProjectDocsStore(), s.ws, s.project, req.user!.uid, s.plan, parsed.data) });
  } catch (err) { handleError(res, err); }
});

dashboardsRouter.put('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true);
    if (!s) return;
    const parsed = dashboardInputSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues[0]);
    res.json({ dashboard: await updateDashboard(getProjectDocsStore(), s.ws, s.project, String(req.params.id), s.plan, parsed.data) });
  } catch (err) { handleError(res, err); }
});

dashboardsRouter.delete('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true);
    if (!s) return;
    await deleteDashboard(getProjectDocsStore(), s.ws, s.project, String(req.params.id));
    res.status(204).end();
  } catch (err) { handleError(res, err); }
});

// POST /api/dashboards/suggest-widget -> the AI turns a sentence into one widget (uses one AI question)
dashboardsRouter.post('/suggest-widget', aiRateLimitMiddleware, async (req, res) => {
  try {
    const s = await scope(req, res, true);
    if (!s) return;
    const cfg = getServerConfig();
    const keys = [cfg.geminiApiKey, cfg.geminiApiKey2].filter((k): k is string => Boolean(k));
    if (keys.length === 0 || !cfg.geminiModel) return fail(res, 503, 'CLOUD_NOT_CONFIGURED', 'The built-in AI is not set up on this server yet.');
    const connected = await resolveConnectedSourcesForProject(req.user!.uid, req.user?.email, req.project);
    const sources = connected.filter((c): c is 'ga4' | 'search_console' => c === 'ga4' || c === 'search_console');
    if (sources.length === 0) return fail(res, 409, 'NO_DATA_SOURCES', 'Connect Google Analytics or Search Console to this project first.');

    const description = (req.body as { description?: unknown } | undefined)?.description;
    if (typeof description !== 'string' || !description.trim()) return fail(res, 400, 'INVALID_DESCRIPTION', 'Describe the widget you want first.');

    const store = getFirestoreStore();
    const quota = await store.consumeAiQuota(s.ws);
    if (!quota.ok) return fail(res, 429, 'QUOTA_EXCEEDED', "You've used all AI questions for this month.");

    let outcome: SuggestOutcome | null = null;
    for (const apiKey of keys) {
      const provider = createAgentProvider(
        { kind: 'gemini', model: cfg.geminiModel, apiKey, agent: { id: 'widget-builder', name: 'Widget builder' }, temperature: 0.1 },
        { request: getAiRequest() }
      );
      outcome = await suggestWidget(description, { provider, sources });
      const retryable = !outcome.ok && outcome.code === 'PROVIDER_ERROR' && ['PROVIDER_AUTH', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(outcome.providerCode ?? '');
      if (!retryable) break;
    }
    if (!outcome || !outcome.ok) {
      await store.refundAiQuota(s.ws);
      const o = outcome as Extract<SuggestOutcome, { ok: false }> | null;
      return fail(res, o?.code === 'PROVIDER_ERROR' ? 502 : 422, o?.code ?? 'BAD_REPLY', o?.message ?? 'Could not build that widget.');
    }
    res.json({ widget: outcome.widget, quota: { used: quota.used, limit: quota.limit } });
  } catch {
    fail(res, 500, 'DASHBOARD_FAILED', 'Something went wrong with this dashboard.');
  }
});
