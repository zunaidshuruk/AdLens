import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { detectLatestAnomaly, type DailyPoint } from './lib/anomaly.js';
import { buildAnomalyAlert, buildWeeklyDigest, escapeHtml } from './lib/digest.js';
import { createInMemoryDigestStore, setTestDigestStore, subscriptionId, type DigestSubscription } from './lib/digestStore.js';
import { runDigests } from './lib/digestRunner.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { mailConfigured, sendMail } from './lib/mailer.js';
import type { GA4Overview, GA4TrafficPoint } from '../src/types/index.js';

const days = (n: number, f: (i: number) => number, start = '2026-09-01'): DailyPoint[] =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10), value: f(i) }));

test('anomaly: flags a real drop and a real spike, ignores normal noise, small numbers and short history', () => {
  const base = (i: number) => 200 + ((i * 7) % 13) - 6;
  const drop = days(20, (i) => (i === 19 ? 80 : base(i)));
  const a = detectLatestAnomaly(drop);
  assert.ok(a && a.direction === 'down' && a.changePercent < -50);
  const spike = days(20, (i) => (i === 19 ? 520 : base(i)));
  assert.equal(detectLatestAnomaly(spike)?.direction, 'up');
  assert.equal(detectLatestAnomaly(days(20, (i) => (i === 19 ? 215 : base(i)))), null, 'a normal day');
  assert.equal(detectLatestAnomaly(days(20, (i) => (i === 19 ? 3 : 10))), null, 'tiny volumes swing wildly');
  assert.equal(detectLatestAnomaly(days(6, () => 300)), null, 'not enough history');
});

test('anomaly: one old spike does not hide a later drop, and flat history ignores tiny moves', () => {
  const series = days(24, (i) => (i === 5 ? 2000 : i === 23 ? 90 : 200 + (i % 3)));
  assert.equal(detectLatestAnomaly(series)?.direction, 'down');
  assert.equal(detectLatestAnomaly(days(20, (i) => (i === 19 ? 205 : 200))), null);
});

test('digest email escapes everything that came from outside', () => {
  assert.equal(escapeHtml(`<b>"x"&'y'`), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;');
  const m = buildWeeklyDigest({ projectName: '<script>alert(1)</script>', domain: 'a.com', startDate: '2026-10-19', endDate: '2026-10-25', appUrl: 'https://app.example.com', metrics: [{ label: 'Sessions', value: 1234, previousValue: 1000, changePercent: 23.4 }, { label: 'Engagement rate', value: 61.25, previousValue: 60, changePercent: null, unit: 'percent' }] });
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.text.includes('Sessions: 1,234 (+23.4% vs previous period)') && m.text.includes('Engagement rate: 61.3% (no comparison)'));
  const al = buildAnomalyAlert({ projectName: 'P', domain: 'a.com', appUrl: 'https://x', anomaly: { date: '2026-10-25', value: 80, baseline: 200, changePercent: -60, direction: 'down' } });
  assert.match(al.subject, /drop on 2026-10-25/);
  assert.match(al.text, /60% lower/);
});

test('mailer: needs configuration, sends the right request, reports rejection', async () => {
  assert.equal(mailConfigured({}), false);
  assert.deepEqual(await sendMail({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }, { env: {} }), { ok: false, reason: 'not_configured' });
  const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
  const env = { RESEND_API_KEY: 're_123', MAIL_FROM: 'AdLens <a@x.com>' };
  const ok = (async (url: string, init: never) => { calls.push({ url, init }); return { ok: true }; }) as unknown as typeof fetch;
  assert.deepEqual(await sendMail({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }, { env, fetchFn: ok }), { ok: true });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_123');
  assert.deepEqual(JSON.parse(calls[0].init.body).to, ['a@b.com']);
  assert.deepEqual(await sendMail({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }, { env, fetchFn: (async () => ({ ok: false })) as unknown as typeof fetch }), { ok: false, reason: 'rejected' });
  assert.deepEqual(await sendMail({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }, { env, fetchFn: (async () => { throw new Error('x'); }) as unknown as typeof fetch }), { ok: false, reason: 'network' });
});

const metric = (v: number, p: number) => ({ value: v, previousValue: p, changePercent: ((v - p) / p) * 100 });
const overview: GA4Overview = { sessions: metric(700, 600), users: metric(500, 450), engagedSessions: metric(400, 380), engagementRate: metric(57, 60), avgEngagementTimeSec: metric(70, 65), conversions: metric(20, 18) };
const series = (drop: boolean): GA4TrafficPoint[] => days(29, (i) => (drop && i === 28 ? 60 : 200 + ((i * 5) % 11)), '2026-09-27').map((p) => ({ date: p.date, sessions: p.value, previousSessions: 0, users: 0, previousUsers: 0, engagedSessions: 0, conversions: 0 }));

const sub = (over: Partial<DigestSubscription> = {}): DigestSubscription => ({ id: 's1', uid: 'u1', email: 'a@acme.com', workspaceId: 'w', projectId: 'p', weekly: true, alerts: true, createdAt: '2026-10-01T00:00:00Z', ...over });

test('digest runner: sends weekly once, alerts once per unusual day, removes dead subscriptions, isolates failures', async () => {
  const store = createInMemoryDigestStore();
  await store.put(sub());
  await store.put(sub({ id: 's2', uid: 'u2', email: 'b@acme.com', projectId: 'gone' }));
  const sent: { to: string; subject: string }[] = [];
  const now = new Date('2026-10-26T09:00:00Z');
  const deps = (drop: boolean, ok = true) => ({
    store, appUrl: 'https://app.example.com', now,
    send: async (m: { to: string; subject: string }) => { sent.push({ to: m.to, subject: m.subject }); return ok ? ({ ok: true } as const) : ({ ok: false, reason: 'rejected' } as const); },
    projectInfo: async (s: DigestSubscription) => (s.projectId === 'gone' ? null : { name: 'Shop', domain: 'shop.com' }),
    loadData: async () => ({ overview, series: series(drop) }),
  });

  const first = await runDigests(deps(true));
  assert.equal(first.weeklySent, 1);
  assert.equal(first.alertsSent, 0, 'the weekly email already carried the alert for that day');
  assert.equal(first.removed, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent.map((s) => s.to), ['a@acme.com']);

  const second = await runDigests(deps(true));
  assert.equal(sent.length, 1, 'nothing is sent twice');
  assert.equal(second.weeklySent + second.alertsSent, 0);

  const later = new Date('2026-10-28T09:00:00Z');
  const third = await runDigests({ ...deps(true), now: later, loadData: async () => ({ overview, series: series(true).map((p, i, a) => (i === a.length - 1 ? { ...p, date: '2026-10-27' } : p)) }) });
  assert.equal(third.alertsSent, 1, 'a new unusual day gets its own alert');

  const failing = createInMemoryDigestStore();
  await failing.put(sub());
  const bad = await runDigests({ ...deps(false, false), store: failing });
  assert.equal(bad.failed, 1);
  assert.equal((await failing.listAll())[0].lastWeeklyAt, undefined, 'a failed send is retried next time');
});

test('digest routes: only for my own projects, mail goes to my own address, off removes it', async () => {
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  const ds = createInMemoryDigestStore();
  setTestDigestStore(ds);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_a', email: 'alice@acme.com', displayName: 'A' });
  const mine = await fs.createProject(workspace.id, { name: 'P', domain: 'a.com', ga4PropertyId: '1', timezone: 'UTC', currency: 'USD', createdBy: 'uid_a' });
  const other = await fs.bootstrapUserAndWorkspace({ uid: 'uid_b', email: 'bob@acme.com', displayName: 'B' });
  const theirs = await fs.createProject(other.workspace.id, { name: 'Q', domain: 'b.com', ga4PropertyId: '2', timezone: 'UTC', currency: 'USD', createdBy: 'uid_b' });
  setTestTokenVerifier(async () => ({ uid: 'uid_a', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, body?: unknown) => fetch(`${base}/api/digest`, { method, body: body ? JSON.stringify(body) : undefined, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' } });
  try {
    assert.equal((await call('PUT', { workspaceId: other.workspace.id, projectId: theirs.id, weekly: true, alerts: true })).status, 404, "someone else's project");
    assert.equal((await call('PUT', { workspaceId: workspace.id, projectId: mine.id, weekly: 'yes', alerts: true })).status, 400);
    assert.equal((await call('PUT', { workspaceId: workspace.id, projectId: mine.id, weekly: true, alerts: false, email: 'evil@x.com' })).status, 200);
    const stored = await ds.listForUid('uid_a');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].email, 'alice@acme.com', 'a different address in the request is ignored');
    assert.equal(stored[0].id, subscriptionId('uid_a', workspace.id, mine.id));
    const list = await (await call('GET')).json() as { subscriptions: { weekly: boolean }[] };
    assert.equal(list.subscriptions[0].weekly, true);
    assert.equal((await call('PUT', { workspaceId: workspace.id, projectId: mine.id, weekly: false, alerts: false })).status, 200);
    assert.equal((await ds.listForUid('uid_a')).length, 0);
  } finally {
    server.close();
    setTestDigestStore(null);
  }
});

test('run-digests endpoint refuses without the right secret', async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (auth?: string) => fetch(`${base}/api/ops/run-digests`, { method: 'POST', headers: auth ? { Authorization: auth } : {} });
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await post('Bearer anything')).status, 503);
    process.env.CRON_SECRET = 'a-long-enough-secret-123';
    assert.equal((await post()).status, 401);
    assert.equal((await post('Bearer wrong')).status, 401);
  } finally {
    server.close();
    delete process.env.CRON_SECRET;
  }
});
