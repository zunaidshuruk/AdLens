import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { buildScheduleEmail, createInMemoryScheduleStore, isDue, runEmailSchedules, setTestScheduleStore, type StoredSchedule } from './lib/emailSchedules.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import type { Snapshot } from './lib/shares.js';

const MON = new Date('2026-10-26T06:00:00Z'); // a Monday
const FIRST = new Date('2026-11-01T06:00:00Z');

const snap: Snapshot = {
  title: 'Board <b>', description: '', kind: 'dashboard', range: { startDate: '2026-10-19', endDate: '2026-10-25' }, generatedAt: MON.toISOString(),
  widgets: [
    { id: 'a', title: 'Visits', layout: { x: 0, y: 0, w: 4, h: 2 }, kind: 'kpi', result: { source: 'ga4', columns: [{ key: 'sessions', label: 'Sessions', type: 'integer', role: 'metric' }], rows: [], totals: { sessions: 12345 }, rowCount: 1, truncated: false } },
    { id: 'b', title: 'By <script>', layout: { x: 0, y: 2, w: 8, h: 4 }, kind: 'table', result: { source: 'ga4', columns: [{ key: 'c', label: 'Country', type: 'text', role: 'dimension' }, { key: 's', label: 'Sessions', type: 'integer', role: 'metric' }], rows: [{ c: '<img src=x>', s: 5 }], totals: null, rowCount: 1, truncated: false } },
    { id: 'c', title: 'Broken', layout: { x: 0, y: 6, w: 4, h: 2 }, kind: 'kpi', error: 'Could not load this panel.' },
  ],
};

const sched = (o: Partial<StoredSchedule> = {}): StoredSchedule => ({ id: 's1', workspaceId: 'w', projectId: 'p', createdBy: 'u', createdAt: '2026-10-01T00:00:00Z', title: 'Board', kind: 'dashboard', targetId: 'd1', frequency: 'weekly', rangeDays: 7, emails: ['a@b.com', 'c@d.com'], enabled: true, ...o });

test('Scheduled emails: weekly on Mondays, monthly on the 1st, once per period', () => {
  assert.equal(isDue(sched(), MON), true);
  assert.equal(isDue(sched(), new Date('2026-10-27T06:00:00Z')), false);
  assert.equal(isDue(sched({ lastSentAt: MON.toISOString() }), new Date('2026-10-26T18:00:00Z')), false);
  assert.equal(isDue(sched({ enabled: false }), MON), false);
  assert.equal(isDue(sched({ frequency: 'monthly' }), FIRST), true);
  assert.equal(isDue(sched({ frequency: 'monthly' }), MON), false);
  assert.equal(isDue(sched({ frequency: 'monthly', lastSentAt: '2026-11-01T01:00:00Z' }), FIRST), false);
});

test('Scheduled emails: content is escaped and shows numbers, tables and failed panels', () => {
  const m = buildScheduleEmail({ title: 'Board <b>', frequency: 'weekly', kind: 'dashboard', targetId: 'd1' }, snap, 'Proj & Co', 'https://app.example.com/', 'me@x.com');
  assert.equal(m.html.includes('<script>'), false);
  assert.equal(m.html.includes('<img src=x>'), false);
  assert.match(m.html, /12,345/);
  assert.match(m.html, /&lt;img src=x&gt;/);
  assert.match(m.html, /Could not load this panel/);
  assert.match(m.html, /https:\/\/app\.example\.com\/dashboards\/d1/);
  assert.match(m.text, /Sessions/);
  assert.match(m.subject, /weekly snapshot/);
});

test('Scheduled emails: runner sends once, drops orphans, respects plan, records failures', async () => {
  const store = createInMemoryScheduleStore();
  await store.put(sched());
  await store.put(sched({ id: 'orphan', projectId: 'gone' }));
  await store.put(sched({ id: 'noplan', projectId: 'free' }));
  await store.put(sched({ id: 'bad', projectId: 'bad' }));
  const sent: string[] = [];
  const deps = {
    store, appUrl: 'https://app.example.com', now: MON,
    sendMail: async (m: { to: string }) => { sent.push(m.to); return { ok: true as const }; },
    context: async (s: StoredSchedule) => s.projectId === 'gone' ? null : { projectName: 'P', ownerEmail: 'me@x.com', emailAllowed: s.projectId !== 'free' },
    snapshot: async (s: StoredSchedule) => { if (s.projectId === 'bad') throw new Error('boom secret'); return { title: 'Board', snapshot: snap }; },
  };
  const r = await runEmailSchedules(deps);
  assert.deepEqual(r, { checked: 4, sent: 1, failed: 1, removed: 1 });
  assert.deepEqual(sent.sort(), ['a@b.com', 'c@d.com']);
  assert.equal((await store.get('orphan')), null);
  assert.equal((await store.get('bad'))!.lastError, 'Could not read the data for this email.');
  assert.ok((await store.get('s1'))!.lastSentAt);
  const again = await runEmailSchedules({ ...deps, now: new Date('2026-10-26T20:00:00Z') });
  assert.equal(again.sent, 0);
});

test('Scheduled emails API: create, list, update, test, delete, isolation', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-35-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  setTestScheduleStore(createInMemoryScheduleStore());
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p1 = await fs.createProject(workspace.id, { name: 'One', domain: 'a.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  const p2 = await fs.createProject(workspace.id, { name: 'Two', domain: 'b.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  setTestTokenVerifier(async (token: string) => {
    const who = token === 'token-alice' ? 'alice' : token === 'token-bob' ? 'bob' : null;
    if (!who) throw new Error('bad');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, o: { method?: string; body?: unknown; token?: string; project?: { workspaceId: string; id: string } } = {}) =>
    fetch(`${baseUrl}${path}`, { method: o.method, body: o.body === undefined ? undefined : JSON.stringify(o.body), headers: { Authorization: `Bearer ${o.token ?? 'token-alice'}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${(o.project ?? p1).workspaceId}/${(o.project ?? p1).id}` } });
  try {
    assert.equal((await fetch(`${baseUrl}/api/email-schedules`)).status, 401);
    const dash = ((await (await call('/api/dashboards', { method: 'POST', body: { name: 'Board', description: '', widgets: [{ id: 'w2', title: 'Note', layout: { x: 0, y: 0, w: 4, h: 2 }, kind: 'text', text: 'Hi' }] } })).json()) as any).dashboard;
    const body = { kind: 'dashboard', targetId: dash.id, frequency: 'weekly', rangeDays: 7, emails: ['Alice@Acme.com'] };
    assert.equal((await call('/api/email-schedules', { method: 'POST', body: { ...body, emails: [] } })).status, 400);
    assert.equal((await call('/api/email-schedules', { method: 'POST', body: { ...body, targetId: 'nope' } })).status, 404);
    assert.equal((await call('/api/email-schedules', { method: 'POST', body, token: 'token-bob' })).status, 404);
    const ok = await call('/api/email-schedules', { method: 'POST', body });
    assert.equal(ok.status, 201);
    const rec = ((await ok.json()) as any).schedule;
    assert.deepEqual(rec.emails, ['alice@acme.com']);
    assert.equal(rec.title, 'Board');
    const listed = (await (await call('/api/email-schedules')).json()) as any;
    assert.equal(listed.schedules.length, 1);
    assert.equal(((await (await call('/api/email-schedules', { project: p2 })).json()) as any).schedules.length, 0);
    const upd = await call(`/api/email-schedules/${rec.id}`, { method: 'PUT', body: { frequency: 'monthly', enabled: false } });
    assert.equal(upd.status, 200);
    const u = ((await upd.json()) as any).schedule;
    assert.deepEqual([u.frequency, u.enabled, u.emails.length], ['monthly', false, 1]);
    assert.equal((await call(`/api/email-schedules/${rec.id}`, { method: 'PUT', body: { enabled: true }, project: p2 })).status, 404);
    const t = (await (await call(`/api/email-schedules/${rec.id}/test`, { method: 'POST' })).json()) as any;
    assert.equal(t.to, 'alice@acme.com');
    assert.equal(t.sent, false); // no mail provider in tests
    assert.equal((await call(`/api/email-schedules/${rec.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/api/email-schedules/${rec.id}`, { method: 'DELETE' })).status, 404);
  } finally {
    server.close();
    setTestTokenVerifier(null as never);
    setTestFirestoreStore(null as never);
    setTestProjectDocsStore(null);
    setTestScheduleStore(null);
  }
});
