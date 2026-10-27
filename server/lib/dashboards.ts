import { getContentLimits } from '../config/plans.js';
import type { DashboardInput } from './dashboardSpec.js';
import { newDocId, type ProjectDocsStore, type StoredDoc } from './projectDocs.js';

export interface DashboardDoc extends DashboardInput {
  id: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class DashboardError extends Error {
  constructor(readonly code: 'LIMIT_REACHED' | 'NOT_FOUND' | 'TOO_MANY_WIDGETS', message: string, readonly status: number) {
    super(message);
  }
}

const toDash = (d: StoredDoc): DashboardDoc => d as unknown as DashboardDoc;

function checkWidgets(plan: string | undefined, input: DashboardInput): void {
  const { maxWidgetsPerDashboard } = getContentLimits(plan);
  if (input.widgets.length > maxWidgetsPerDashboard) {
    throw new DashboardError('TOO_MANY_WIDGETS', `A dashboard can hold up to ${maxWidgetsPerDashboard} widgets.`, 409);
  }
}

export async function listDashboards(store: ProjectDocsStore, ws: string, project: string): Promise<DashboardDoc[]> {
  return (await store.list(ws, project, 'dashboards')).map(toDash).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDashboard(store: ProjectDocsStore, ws: string, project: string, id: string): Promise<DashboardDoc> {
  const doc = await store.get(ws, project, 'dashboards', id);
  if (!doc) throw new DashboardError('NOT_FOUND', 'Dashboard not found.', 404);
  return toDash(doc);
}

export async function createDashboard(store: ProjectDocsStore, ws: string, project: string, uid: string, plan: string | undefined, input: DashboardInput, now = new Date()): Promise<DashboardDoc> {
  const { maxDashboards } = getContentLimits(plan);
  checkWidgets(plan, input);
  if ((await store.list(ws, project, 'dashboards')).length >= maxDashboards) {
    throw new DashboardError('LIMIT_REACHED', `A project can keep up to ${maxDashboards} dashboards. Delete one first.`, 409);
  }
  const iso = now.toISOString();
  const doc: DashboardDoc = { ...input, id: newDocId(), createdBy: uid, createdAt: iso, updatedAt: iso };
  await store.put(ws, project, 'dashboards', doc as unknown as StoredDoc);
  return doc;
}

export async function updateDashboard(store: ProjectDocsStore, ws: string, project: string, id: string, plan: string | undefined, input: DashboardInput, now = new Date()): Promise<DashboardDoc> {
  const current = await getDashboard(store, ws, project, id);
  checkWidgets(plan, input);
  const next: DashboardDoc = { ...current, ...input, updatedAt: now.toISOString() };
  await store.put(ws, project, 'dashboards', next as unknown as StoredDoc);
  return next;
}

export async function deleteDashboard(store: ProjectDocsStore, ws: string, project: string, id: string): Promise<void> {
  if (!(await store.delete(ws, project, 'dashboards', id))) throw new DashboardError('NOT_FOUND', 'Dashboard not found.', 404);
}
