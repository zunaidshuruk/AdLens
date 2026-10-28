import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryAlertStore, type StoredAlertRule } from './lib/alertRules.js';
import { createInMemoryScheduleStore, type StoredSchedule } from './lib/emailSchedules.js';
import { cleanOrphans, removeContentOfMember, removeContentOfProject, removeContentOfWorkspace, type CleanupDeps } from './lib/memberCleanup.js';
import { createInMemoryShareStore, type StoredShare } from './lib/shares.js';

const share = (id: string, ws: string, project: string, by: string) => ({ id, workspaceId: ws, projectId: project, createdBy: by, tokenHash: id, title: id }) as unknown as StoredShare;
const sched = (id: string, ws: string, project: string, by: string) => ({ id, workspaceId: ws, projectId: project, createdBy: by, title: id }) as unknown as StoredSchedule;
const alert = (id: string, ws: string, project: string, by: string) => ({ id, workspaceId: ws, projectId: project, createdBy: by }) as unknown as StoredAlertRule;

async function setup() {
  const shares = createInMemoryShareStore(); const schedules = createInMemoryScheduleStore(); const alerts = createInMemoryAlertStore();
  const members = new Set(['w1|alice', 'w1|bob', 'w2|carol']);
  const projects = new Set(['w1|p1', 'w1|p2', 'w2|p9']);
  const deps: CleanupDeps = { shares, schedules, alerts, isMember: async (w, u) => members.has(`${w}|${u}`), projectExists: async (w, p) => projects.has(`${w}|${p}`) };
  for (const s of [share('s1', 'w1', 'p1', 'alice'), share('s2', 'w1', 'p1', 'bob'), share('s3', 'w2', 'p9', 'carol')]) await shares.put(s);
  for (const s of [sched('e1', 'w1', 'p1', 'alice'), sched('e2', 'w1', 'p2', 'bob')]) await schedules.put(s);
  for (const a of [alert('a1', 'w1', 'p1', 'alice'), alert('a2', 'w1', 'p2', 'bob')]) await alerts.put(a);
  return { deps, shares, schedules, alerts, members, projects };
}
const ids = async (s: { listAll(): Promise<{ id: string }[]> }) => (await s.listAll()).map((x) => x.id).sort();

test('Sprint 38 — when someone leaves, their public links and scheduled emails go with them (alerts stay with the team)', async () => {
  const t = await setup();
  assert.deepEqual(await removeContentOfMember('w1', 'alice', t.deps), { shares: 1, schedules: 1 });
  assert.deepEqual(await ids(t.shares), ['s2', 's3']);
  assert.deepEqual(await ids(t.schedules), ['e2']);
  assert.deepEqual(await ids(t.alerts), ['a1', 'a2']);
  // same user id in another workspace is untouched
  assert.deepEqual(await removeContentOfMember('w2', 'bob', t.deps), { shares: 0, schedules: 0 });
});

test('Sprint 38 — deleting a project or workspace removes its links, scheduled emails and alerts', async () => {
  const t = await setup();
  assert.deepEqual(await removeContentOfProject('w1', 'p1', t.deps), { shares: 2, schedules: 1, alerts: 1 });
  assert.deepEqual(await ids(t.shares), ['s3']);
  assert.deepEqual(await removeContentOfWorkspace('w2', t.deps), { shares: 1, schedules: 0, alerts: 0 });
  assert.deepEqual(await ids(t.shares), []);
});

test('Sprint 38 — the daily safety net removes anything left behind by a removed owner or deleted project', async () => {
  const t = await setup();
  t.members.delete('w1|bob'); // removed without the immediate clean-up running
  t.projects.delete('w2|p9'); // project deleted
  const r = await cleanOrphans(t.deps);
  assert.deepEqual(r, { shares: 2, schedules: 1, alerts: 0 });
  assert.deepEqual(await ids(t.shares), ['s1']);
  assert.deepEqual(await ids(t.schedules), ['e1']);
  assert.deepEqual(await ids(t.alerts), ['a1', 'a2']);
  t.projects.delete('w1|p2');
  assert.equal((await cleanOrphans(t.deps)).alerts, 1);
  assert.deepEqual(await ids(t.alerts), ['a1']);
  // nothing more to do on a second run
  assert.deepEqual(await cleanOrphans(t.deps), { shares: 0, schedules: 0, alerts: 0 });
});
