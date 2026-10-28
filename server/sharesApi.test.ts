import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { refreshDueShares } from './lib/shareWiring.js';
import { createInMemoryShareStore, getShareStore, setTestShareStore, snapshotRange } from './lib/shares.js';

test('Share links: make, open publicly, password, expiry, refresh, turn off, isolation', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-34-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  setTestShareStore(createInMemoryShareStore());
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
    fetch(`${baseUrl}${path}`, {
      method: o.method,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      headers: { Authorization: `Bearer ${o.token ?? 'token-alice'}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${(o.project ?? p1).workspaceId}/${(o.project ?? p1).id}` },
    });
  const pub = (path: string, body?: unknown) => fetch(`${baseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${baseUrl}/api/shares`)).status, 401);
    const ds = ((await (await call('/api/datasets', { method: 'POST', body: { name: 'Ads', csv: 'Day,Channel,Spend\n2026-10-01,A,10\n2026-10-02,B,20' } })).json()) as any).dataset;
    const dash = ((await (await call('/api/dashboards', { method: 'POST', body: { name: 'Board', description: 'Weekly', widgets: [
      { id: 'w1', title: 'Spend', layout: { x: 0, y: 0, w: 4, h: 3 }, kind: 'kpi', source: 'data', spec: { datasetId: ds.id, dimensions: [], metrics: ['c3'], filters: [], limit: 10, aggregate: 'sum' } },
      { id: 'w2', title: 'Note', layout: { x: 4, y: 0, w: 4, h: 3 }, kind: 'text', text: 'Hello team' },
    ] } })).json()) as any).dashboard;

    assert.equal((await call('/api/shares', { method: 'POST', body: { kind: 'dashboard', targetId: 'nope' } })).status, 404);
    assert.equal((await call('/api/shares', { method: 'POST', body: { kind: 'dashboard', targetId: dash.id, password: 'ab' } })).status, 400);
    assert.equal((await call('/api/shares', { method: 'POST', body: { kind: 'dashboard', targetId: dash.id }, token: 'token-bob' })).status, 404);

    const made = await call('/api/shares', { method: 'POST', body: { kind: 'dashboard', targetId: dash.id, rangeDays: 28 } });
    assert.equal(made.status, 201);
    const share = ((await made.json()) as any).share;
    assert.match(share.url, /\/s\/[A-Za-z0-9_-]{30,}$/);
    assert.equal(share.hasPassword, false);
    for (const k of ['tokenHash', 'sealedToken', 'passwordHash', 'snapshot']) assert.equal(k in share, false);
    const token = share.url.split('/s/')[1];

    // public: no sign-in needed, snapshot only
    const meta = (await (await pub(`/api/shared/${token}`)).json()) as any;
    assert.deepEqual([meta.title, meta.needsPassword], ['Board', false]);
    const opened = await pub(`/api/shared/${token}`, {});
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get('x-robots-tag'), 'noindex, nofollow');
    const snap = ((await opened.json()) as any).snapshot;
    assert.equal(snap.widgets.length, 2);
    assert.equal(snap.widgets[0].result.totals?.c3 ?? snap.widgets[0].result.rows[0].c3, 30);
    assert.equal(snap.widgets[1].text, 'Hello team');
    assert.equal(JSON.stringify(snap).includes('uid_alice'), false);
    assert.equal((await pub('/api/shared/not-a-real-token-value-12345')).status, 404);
    assert.equal((await pub('/api/shared/short')).status, 404);

    // list is per project and shows the view
    const listed = (await (await call('/api/shares')).json()) as any;
    assert.equal(listed.shares.length, 1);
    assert.equal(listed.shares[0].views, 1);
    assert.equal(((await (await call('/api/shares', { project: p2 })).json()) as any).shares.length, 0);

    // password + expiry
    const locked = ((await (await call('/api/shares', { method: 'POST', body: { kind: 'dashboard', targetId: dash.id, password: 'secret1', expiresInDays: 1 } })).json()) as any).share;
    assert.equal(locked.hasPassword, true);
    const t2 = locked.url.split('/s/')[1];
    assert.equal(((await (await pub(`/api/shared/${t2}`)).json()) as any).needsPassword, true);
    const none = await pub(`/api/shared/${t2}`, {});
    assert.equal(none.status, 401);
    assert.equal(((await none.json()) as any).error.code, 'PASSWORD_REQUIRED');
    assert.equal(((await (await pub(`/api/shared/${t2}`, { password: 'nope' })).json()) as any).error.code, 'WRONG_PASSWORD');
    assert.equal((await pub(`/api/shared/${t2}`, { password: 'secret1' })).status, 200);
    const stored = await getShareStore().get(locked.id);
    await getShareStore().put({ ...stored!, expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await pub(`/api/shared/${t2}`, { password: 'secret1' })).status, 404);

    // saved report share
    const rep = ((await (await call('/api/explore/saved', { method: 'POST', body: { name: 'By channel', source: 'data', spec: { datasetId: ds.id, dimensions: ['c2'], metrics: ['c3'], filters: [], limit: 50, aggregate: 'sum' } } })).json()) as any);
    assert.ok(rep.report, JSON.stringify(rep));
    const reportId = rep.report.id;
    const rshare = await call('/api/shares', { method: 'POST', body: { kind: 'report', targetId: reportId, rangeDays: 7 } });
    assert.equal(rshare.status, 201, JSON.stringify(await rshare.clone().json()) + ' ' + reportId);

    // change the data, refresh the dashboard share, daily job refreshes only stale shares
    await call(`/api/shares/${share.id}/refresh`, { method: 'POST' });
    const before = await getShareStore().get(share.id);
    await getShareStore().put({ ...before!, refreshedAt: '2020-01-01T00:00:00.000Z' });
    const job = await refreshDueShares(getShareStore());
    assert.ok(job.refreshed >= 1);
    assert.equal((await getShareStore().get(share.id))!.refreshedAt.slice(0, 10), new Date().toISOString().slice(0, 10));

    // turn off
    assert.equal((await call(`/api/shares/${share.id}`, { method: 'DELETE', project: p2 })).status, 404);
    assert.equal((await call(`/api/shares/${share.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await pub(`/api/shared/${token}`, {})).status, 404);
  } finally {
    server.close();
    setTestTokenVerifier(null as never);
    setTestFirestoreStore(null as never);
    setTestProjectDocsStore(null);
    setTestShareStore(null);
  }
});

test('Snapshot range: the last N complete days ending yesterday', () => {
  assert.deepEqual(snapshotRange(7, new Date('2026-10-28T10:00:00Z')), { startDate: '2026-10-21', endDate: '2026-10-27' });
  assert.deepEqual(snapshotRange(1, new Date('2026-03-01T00:00:00Z')), { startDate: '2026-02-28', endDate: '2026-02-28' });
});
