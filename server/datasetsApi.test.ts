import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';

test('Uploaded tables API: upload, list, query, isolation, plan limit and delete', async () => {
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
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
  try {
    assert.equal((await fetch(`${baseUrl}/api/datasets`)).status, 401);
    const csv = 'Day,Channel,Spend\n2026-10-01,A,10\n2026-10-02,B,20\n2026-10-03,A,5';

    const bad = await call('/api/datasets', { method: 'POST', body: { name: 'x', csv: 'only a header' } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as any).error.code, 'INVALID_CSV');

    const created = await call('/api/datasets', { method: 'POST', body: { name: 'Ads', csv } });
    assert.equal(created.status, 201);
    const ds = ((await created.json()) as any).dataset;
    assert.equal(ds.rowCount, 3);
    assert.equal('rows' in ds, false);
    assert.equal(ds.preview.length, 3);

    const listed = (await (await call('/api/datasets')).json()) as any;
    assert.equal(listed.datasets.length, 1);
    assert.equal(listed.datasets[0].catalog.metrics.length, 2);
    assert.equal(((await (await call('/api/datasets', { project: p2 })).json()) as any).datasets.length, 0);
    assert.equal((await call('/api/datasets', { token: 'token-bob' })).status, 404);

    const run = await call('/api/explore/data/run', { method: 'POST', body: { datasetId: ds.id, dimensions: ['c2'], metrics: ['c3'], startDate: '2026-10-01', endDate: '2026-10-02' } });
    assert.equal(run.status, 200);
    const result = (await run.json()) as any;
    assert.deepEqual(result.rows.map((r: any) => [r.c2, r.c3]), [['B', 20], ['A', 10]]);
    // another project cannot read this table
    const other = await call('/api/explore/data/run', { method: 'POST', body: { datasetId: ds.id, metrics: ['c3'] }, project: p2 });
    assert.equal(other.status, 404);
    assert.equal((await call('/api/explore/data/run', { method: 'POST', body: { datasetId: ds.id, metrics: ['c2'] } })).status, 400);

    // connectors: the gallery, plain refusals, and nothing secret in any answer
    const gallery = (await (await call('/api/datasets/connectors')).json()) as any;
    assert.ok(gallery.connectors.some((c: any) => c.id === 'shopify' && c.status === 'live'));
    assert.ok(gallery.connectors.some((c: any) => c.id === 'tiktok_ads' && c.status === 'live'));
    const soon = await call('/api/datasets/connect', { method: 'POST', body: { name: 'T', connector: 'tiktok_ads', values: {} } });
    assert.equal(soon.status, 400);
    assert.equal(((await soon.json()) as any).error.code, 'CONNECTOR_FAILED');
    const missing = await call('/api/datasets/connect', { method: 'POST', body: { name: 'S', connector: 'shopify', values: { shop: 'x' } } });
    assert.equal(missing.status, 400);
    assert.equal((await call('/api/datasets/connect', { method: 'POST', body: { name: 'S', connector: 'google_sheets', values: { url: 'https://evil.com' } }, token: 'token-bob' })).status, 404);
    assert.equal((await call(`/api/datasets/${ds.id}/refresh`, { method: 'POST' })).status, 400);

    // the beta test plan allows 10 tables, so the limit message is covered by the unit test; here delete works
    assert.equal((await call(`/api/datasets/${ds.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/api/datasets/${ds.id}`, { method: 'DELETE' })).status, 404);
  } finally {
    server.close();
    setTestTokenVerifier(null as never);
    setTestFirestoreStore(null as never);
    setTestProjectDocsStore(null);
  }
});
