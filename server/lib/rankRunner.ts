/** The daily rank-tracking refresh (Sprint 39). Runs inside the same daily job as digests and alerts. */
import { getFirestoreStore } from './firestore.js';
import { getProjectDocsStore, type ProjectDocsStore } from './projectDocs.js';
import { getRankTrackingStore, refreshProject, type RankTrackingStore, type ScQuery } from './rankTracking.js';
import { buildReportContext } from './reportContext.js';
import { callSearchConsoleQuery } from './searchConsoleApi.js';

export interface RankRunDeps {
  store: RankTrackingStore;
  docs: ProjectDocsStore;
  now: () => number;
  isMember(ws: string, uid: string): Promise<boolean>;
  getProject(ws: string, project: string): Promise<{ searchConsoleSite?: string | null } | null>;
  queryFor(ownerUid: string, ws: string, project: string): Promise<ScQuery | null>;
}
export interface RankRunResult { refreshed: number; paused: number; removed: number; failed: number }

export const productionRankDeps = (): RankRunDeps => ({
  store: getRankTrackingStore(),
  docs: getProjectDocsStore(),
  now: Date.now,
  async isMember(ws, uid) { const w = await getFirestoreStore().getWorkspace(ws); return Boolean(w?.members && Object.prototype.hasOwnProperty.call(w.members, uid)); },
  async getProject(ws, project) { return getFirestoreStore().getProject(ws, project); },
  async queryFor(uid, ws, project) {
    const p = await getFirestoreStore().getProject(ws, project);
    if (!p?.searchConsoleSite) return null;
    const token = await buildReportContext(uid, p).getAccessToken();
    const site = p.searchConsoleSite;
    return (payload) => callSearchConsoleQuery(site, token, payload);
  },
});

export async function runRankTracking(deps: RankRunDeps = productionRankDeps()): Promise<RankRunResult> {
  const out: RankRunResult = { refreshed: 0, paused: 0, removed: 0, failed: 0 };
  for (const s of await deps.store.listAll()) {
    if (!s.enabled) continue;
    const project = await deps.getProject(s.workspaceId, s.projectId);
    if (!project) { if (await deps.store.delete(s.id)) out.removed++; continue; }
    if (!(await deps.isMember(s.workspaceId, s.ownerUid))) {
      await deps.store.put({ ...s, enabled: false, pausedReason: 'The person who started tracking left the team. Open Rank tracking and press Start tracking to continue.' });
      out.paused++; continue;
    }
    try {
      const query = await deps.queryFor(s.ownerUid, s.workspaceId, s.projectId);
      if (!query) { await deps.store.put({ ...s, enabled: false, pausedReason: 'No Search Console site is chosen for this project.' }); out.paused++; continue; }
      await refreshProject({ docs: deps.docs, query, now: deps.now }, s.workspaceId, s.projectId, 7);
      await deps.store.put({ ...s, refreshedAt: new Date(deps.now()).toISOString(), pausedReason: null });
      out.refreshed++;
    } catch { out.failed++; }
  }
  return out;
}
