import '../reports/exploreReports.js';
import type { DashboardWidget, QueryWidget } from '../../src/types/dashboard.js';
import { ga4ExploreReport, metaExploreReport, searchConsoleExploreReport } from '../reports/exploreReports.js';
import { getDashboard } from './dashboards.js';
import { dataExploreInputSchema, getDataset, runDataQuery } from './datasets.js';
import { ga4ExploreInputSchema, metaExploreInputSchema, scExploreInputSchema, type ExploreResult } from './exploreSpec.js';
import { getFirestoreStore } from './firestore.js';
import { getProjectDocsStore, type StoredDoc } from './projectDocs.js';
import { buildReportContext } from './reportContext.js';
import { buildSnapshot, type RunQuery, type Snapshot, type StoredShare } from './shares.js';
import type { SavedReport } from './savedReports.js';

/** The same request the browser builds for a panel. */
export function requestFor(widget: Pick<QueryWidget, 'spec'>, range: { startDate: string; endDate: string }): Record<string, unknown> {
  const spec = widget.spec;
  const body: Record<string, unknown> = {
    ...range,
    dimensions: spec.dimensions,
    metrics: spec.metrics,
    filters: spec.filters.map((f) => ({ ...f, value: f.value.trim() })),
    limit: spec.limit,
  };
  if (spec.orderBy && [...spec.metrics, ...spec.dimensions].includes(spec.orderBy.field)) body.orderBy = spec.orderBy;
  if (spec.datasetId) { body.datasetId = spec.datasetId; body.aggregate = spec.aggregate ?? 'sum'; }
  return body;
}

/** Runs a panel's query with the owner's own connections (read-only reports only). */
export function ownerQueryRunner(ownerUid: string, workspaceId: string, projectId: string): RunQuery {
  return async (widget, range): Promise<ExploreResult> => {
    const project = await getFirestoreStore().getProject(workspaceId, projectId);
    if (!project) throw new Error('project gone');
    const query = requestFor(widget, range);
    if (widget.source === 'data') {
      const ds = await getDataset(getProjectDocsStore(), workspaceId, projectId, String(query.datasetId ?? ''));
      return runDataQuery(ds, dataExploreInputSchema.parse(query));
    }
    const ctx = buildReportContext(ownerUid, project);
    if (widget.source === 'ga4') return ga4ExploreReport.run(ctx, ga4ExploreInputSchema.parse(query));
    if (widget.source === 'meta') return metaExploreReport.run(ctx, metaExploreInputSchema.parse(query));
    return searchConsoleExploreReport.run(ctx, scExploreInputSchema.parse(query));
  };
}

export class ShareSourceError extends Error {}

/** Reads the dashboard or saved report a share points at and builds a fresh snapshot of it. */
export async function snapshotForTarget(
  t: { kind: 'dashboard' | 'report'; targetId: string; workspaceId: string; projectId: string; ownerUid: string; rangeDays: number },
  runner: RunQuery = ownerQueryRunner(t.ownerUid, t.workspaceId, t.projectId),
  now = new Date(),
): Promise<{ title: string; snapshot: Snapshot }> {
  const docs = getProjectDocsStore();
  if (t.kind === 'dashboard') {
    let d;
    try { d = await getDashboard(docs, t.workspaceId, t.projectId, t.targetId); } catch { throw new ShareSourceError('That dashboard was not found.'); }
    return { title: d.name, snapshot: await buildSnapshot({ kind: 'dashboard', title: d.name, description: d.description ?? '', widgets: d.widgets as unknown as DashboardWidget[] }, t.rangeDays, runner, now) };
  }
  const doc: StoredDoc | null = await docs.get(t.workspaceId, t.projectId, 'savedReports', t.targetId);
  if (!doc) throw new ShareSourceError('That saved report was not found.');
  const r = doc as unknown as SavedReport;
  const widget: QueryWidget = {
    id: 'report', title: r.name, layout: { x: 0, y: 0, w: 12, h: 8 }, kind: 'table', source: r.source,
    spec: r.spec as unknown as QueryWidget['spec'],
  };
  return { title: r.name, snapshot: await buildSnapshot({ kind: 'report', title: r.name, description: '', widgets: [widget] }, t.rangeDays, runner, now) };
}

export interface RefreshDeps { now?: Date; runner?: (s: StoredShare) => ReturnType<typeof ownerQueryRunner> }

/** Refreshes one share's snapshot. Keeps the old snapshot (and says why) when the source is gone or the owner left. */
export async function refreshShare(share: StoredShare, deps: RefreshDeps = {}): Promise<StoredShare> {
  const now = deps.now ?? new Date();
  try {
    const ws = await getFirestoreStore().getWorkspace(share.workspaceId);
    if (!ws?.members || !Object.prototype.hasOwnProperty.call(ws.members, share.createdBy)) throw new ShareSourceError('The person who made this link is no longer in the workspace.');
    const { title, snapshot } = await snapshotForTarget({ ...share, ownerUid: share.createdBy }, deps.runner?.(share), now);
    const failed = snapshot.widgets.filter((w) => w.error).length;
    const next: StoredShare = { ...share, title, snapshot, refreshedAt: now.toISOString() };
    if (failed > 0) next.refreshError = `${failed} ${failed === 1 ? 'panel' : 'panels'} could not be loaded. Check your connections.`; else delete next.refreshError;
    return next;
  } catch (e) {
    return { ...share, refreshError: e instanceof ShareSourceError ? e.message : 'Could not refresh this link.' };
  }
}

/** Daily job: refresh live, auto-refreshing shares at most once a day. Returns how many were refreshed. */
export async function refreshDueShares(store: import('./shares.js').ShareStore, now = new Date(), run: typeof refreshShare = refreshShare): Promise<{ checked: number; refreshed: number }> {
  const all = await store.listAll();
  let refreshed = 0;
  for (const s of all) {
    if (s.revokedAt || !s.autoRefresh) continue;
    if (s.expiresAt && new Date(s.expiresAt) <= now) continue;
    if (s.refreshedAt.slice(0, 10) === now.toISOString().slice(0, 10)) continue;
    await store.put(await run(s, { now }));
    refreshed++;
  }
  return { checked: all.length, refreshed };
}
