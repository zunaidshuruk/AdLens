/**
 * Keeps public links and scheduled emails from outliving the person (or project) they belong to (Sprint 38).
 * Used straight away when someone is removed or leaves, and again in the daily job as a safety net.
 */
import { getFirestoreStore } from './firestore.js';
import { getScheduleStore, type ScheduleStore } from './emailSchedules.js';
import { getShareStore, type ShareStore } from './shares.js';
import { getAlertStore, type AlertStore } from './alertRules.js';

export interface Counts { shares: number; schedules: number; alerts: number }

export interface CleanupDeps {
  shares: ShareStore;
  schedules: ScheduleStore;
  alerts: AlertStore;
  isMember(workspaceId: string, uid: string): Promise<boolean>;
  projectExists(workspaceId: string, projectId: string): Promise<boolean>;
}

export const productionCleanupDeps = (): CleanupDeps => ({
  shares: getShareStore(),
  schedules: getScheduleStore(),
  alerts: getAlertStore(),
  async isMember(ws, uid) {
    const w = await getFirestoreStore().getWorkspace(ws);
    return Boolean(w?.members && Object.prototype.hasOwnProperty.call(w.members, uid));
  },
  async projectExists(ws, project) { return Boolean(await getFirestoreStore().getProject(ws, project)); },
});

/** Right after someone leaves a workspace: delete the links and scheduled emails they made there. */
export async function removeContentOfMember(workspaceId: string, uid: string, deps: Pick<CleanupDeps, 'shares' | 'schedules'> = productionCleanupDeps()): Promise<Omit<Counts, 'alerts'>> {
  const out = { shares: 0, schedules: 0 };
  for (const s of await deps.shares.listAll()) if (s.workspaceId === workspaceId && s.createdBy === uid && (await deps.shares.delete(s.id))) out.shares++;
  for (const s of await deps.schedules.listAll()) if (s.workspaceId === workspaceId && s.createdBy === uid && (await deps.schedules.delete(s.id))) out.schedules++;
  return out;
}

/** Right after a project is deleted: delete its links and scheduled emails. */
export async function removeContentOfProject(workspaceId: string, projectId: string, deps: Pick<CleanupDeps, 'shares' | 'schedules' | 'alerts'> = productionCleanupDeps()): Promise<Counts> {
  const out: Counts = { shares: 0, schedules: 0, alerts: 0 };
  for (const a of await deps.alerts.listAll()) if (a.workspaceId === workspaceId && a.projectId === projectId && (await deps.alerts.delete(a.id))) out.alerts++;
  for (const s of await deps.shares.listAll()) if (s.workspaceId === workspaceId && s.projectId === projectId && (await deps.shares.delete(s.id))) out.shares++;
  for (const s of await deps.schedules.listAll()) if (s.workspaceId === workspaceId && s.projectId === projectId && (await deps.schedules.delete(s.id))) out.schedules++;
  return out;
}

/** Right after a whole workspace is deleted. */
export async function removeContentOfWorkspace(workspaceId: string, deps: Pick<CleanupDeps, 'shares' | 'schedules' | 'alerts'> = productionCleanupDeps()): Promise<Counts> {
  const out: Counts = { shares: 0, schedules: 0, alerts: 0 };
  for (const a of await deps.alerts.listAll()) if (a.workspaceId === workspaceId && (await deps.alerts.delete(a.id))) out.alerts++;
  for (const s of await deps.shares.listAll()) if (s.workspaceId === workspaceId && (await deps.shares.delete(s.id))) out.shares++;
  for (const s of await deps.schedules.listAll()) if (s.workspaceId === workspaceId && (await deps.schedules.delete(s.id))) out.schedules++;
  return out;
}

/** Daily safety net: delete anything whose owner is no longer in the workspace, or whose project or workspace is gone. */
export async function cleanOrphans(deps: CleanupDeps = productionCleanupDeps()): Promise<Counts> {
  const memberCache = new Map<string, boolean>();
  const projectCache = new Map<string, boolean>();
  const orphaned = async (workspaceId: string, projectId: string, uid: string) => {
    const mk = `${workspaceId}|${uid}`;
    if (!memberCache.has(mk)) memberCache.set(mk, await deps.isMember(workspaceId, uid));
    if (!memberCache.get(mk)) return true;
    const pk = `${workspaceId}|${projectId}`;
    if (!projectCache.has(pk)) projectCache.set(pk, await deps.projectExists(workspaceId, projectId));
    return !projectCache.get(pk);
  };
  const out: Counts = { shares: 0, schedules: 0, alerts: 0 };
  // Alert rules are team property: only removed when their project or workspace is gone, not when their author leaves.
  for (const a of await deps.alerts.listAll()) {
    const pk = `${a.workspaceId}|${a.projectId}`;
    if (!projectCache.has(pk)) projectCache.set(pk, await deps.projectExists(a.workspaceId, a.projectId));
    if (!projectCache.get(pk) && (await deps.alerts.delete(a.id))) out.alerts++;
  }
  for (const s of await deps.shares.listAll()) if (await orphaned(s.workspaceId, s.projectId, s.createdBy) && (await deps.shares.delete(s.id))) out.shares++;
  for (const s of await deps.schedules.listAll()) if (await orphaned(s.workspaceId, s.projectId, s.createdBy) && (await deps.schedules.delete(s.id))) out.schedules++;
  return out;
}
