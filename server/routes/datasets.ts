import { Router, type Request, type Response } from 'express';
import { getContentLimits } from '../config/plans.js';
import {
  DatasetError, createDataset, datasetCatalog, datasetInputSchema, deleteDataset, getDataset, listDatasets, summary,
} from '../lib/datasets.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore } from '../lib/projectDocs.js';
import { CONNECTORS } from '../lib/connectors.js';
import { createConnectedDataset, refreshConnectedDataset } from '../lib/connectedData.js';
import { getAgentKeyring } from '../lib/vault.js';
import { z } from 'zod';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** Uploaded CSV tables, per project. The query itself runs through /api/explore/data/run. */
export const datasetsRouter = Router();

const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
function handleError(res: Response, err: unknown): void {
  if (err instanceof DatasetError) return fail(res, err.status, err.code, err.message);
  fail(res, 500, 'DATASET_FAILED', 'Something went wrong with this table.');
}

datasetsRouter.use(requireUser);
datasetsRouter.use(verifyGoogleSessionOwnership);
datasetsRouter.use(loadProject);

export async function datasetScope(req: Request, res: Response, write: boolean): Promise<{ ws: string; project: string; plan: string | undefined } | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  if (!ws || !can(ws, req.user!.uid, write ? 'content.edit' : 'reports.view')) {
    fail(res, 403, 'NOT_ALLOWED', 'You do not have permission to change uploaded tables in this project.');
    return null;
  }
  return { ws: project.workspaceId, project: project.id, plan: ws.plan };
}

datasetsRouter.get('/', async (req, res) => {
  try {
    const s = await datasetScope(req, res, false);
    if (!s) return;
    const datasets = await listDatasets(getProjectDocsStore(), s.ws, s.project);
    res.json({ datasets: datasets.map((d) => ({ ...d, catalog: datasetCatalog(d) })), limit: getContentLimits(s.plan).maxDatasets });
  } catch (err) { handleError(res, err); }
});

datasetsRouter.get('/connectors', (_req, res) => {
  res.json({ connectors: CONNECTORS });
});

const connectSchema = z.object({
  name: z.string().trim().min(1, 'Give the table a name').max(80),
  connector: z.string().min(1).max(40),
  values: z.record(z.string(), z.string().max(400)),
});

datasetsRouter.post('/connect', async (req, res) => {
  try {
    const s = await datasetScope(req, res, true);
    if (!s) return;
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_CONNECTOR', parsed.error.issues[0]?.message || 'Fill in the details.');
    const ds = await createConnectedDataset(getProjectDocsStore(), s.ws, s.project, req.user!.uid, parsed.data, getContentLimits(s.plan).maxDatasets, { keyring: getAgentKeyring });
    res.status(201).json({ dataset: { ...summary(ds), catalog: datasetCatalog(ds), preview: ds.rows.slice(0, 10) } });
  } catch (err) { handleError(res, err); }
});

datasetsRouter.post('/:id/refresh', async (req, res) => {
  try {
    const s = await datasetScope(req, res, true);
    if (!s) return;
    const ds = await refreshConnectedDataset(getProjectDocsStore(), s.ws, s.project, String(req.params.id), { keyring: getAgentKeyring });
    res.json({ dataset: { ...summary(ds), catalog: datasetCatalog(ds), preview: ds.rows.slice(0, 10) } });
  } catch (err) { handleError(res, err); }
});

datasetsRouter.get('/:id', async (req, res) => {
  try {
    const s = await datasetScope(req, res, false);
    if (!s) return;
    const ds = await getDataset(getProjectDocsStore(), s.ws, s.project, String(req.params.id));
    res.json({ dataset: { ...summary(ds), catalog: datasetCatalog(ds), preview: ds.rows.slice(0, 10) } });
  } catch (err) { handleError(res, err); }
});

datasetsRouter.post('/', async (req, res) => {
  try {
    const s = await datasetScope(req, res, true);
    if (!s) return;
    const parsed = datasetInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_CSV', parsed.error.issues[0]?.message || 'The file is not valid.');
    const ds = await createDataset(getProjectDocsStore(), s.ws, s.project, req.user!.uid, parsed.data, getContentLimits(s.plan).maxDatasets);
    res.status(201).json({ dataset: { ...summary(ds), catalog: datasetCatalog(ds), preview: ds.rows.slice(0, 10) } });
  } catch (err) { handleError(res, err); }
});

datasetsRouter.delete('/:id', async (req, res) => {
  try {
    const s = await datasetScope(req, res, true);
    if (!s) return;
    await deleteDataset(getProjectDocsStore(), s.ws, s.project, String(req.params.id));
    res.status(204).end();
  } catch (err) { handleError(res, err); }
});
