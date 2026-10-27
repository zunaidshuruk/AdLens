import { Router, type Request, type Response } from 'express';
import {
  DashboardError, createDashboard, deleteDashboard, getDashboard, listDashboards, updateDashboard,
} from '../lib/dashboards.js';
import { dashboardInputSchema } from '../lib/dashboardSpec.js';
import { getFirestoreStore } from '../lib/firestore.js';
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
