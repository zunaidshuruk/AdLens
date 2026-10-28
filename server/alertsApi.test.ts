import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestAlertStore, createInMemoryAlertStore } from './lib/alertRules.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';

test('Alerts API: create, list, update, test, isolation, limits and delete', async () => {
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  setTestAlertStore(createInMemoryAlertStore());
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
    assert.equal((await fetch(`${baseUrl}/api/alerts`)).status, 401);
    const created = await call('/api/datasets', { method: 'POST', body: { name: 'Ads', csv: 'Day,Channel,Spend\n2026-10-01,A,10\n2026-10-02,B,20' } });
    const ds = ((await created.json()) as any).dataset;

    const rule = { name: 'Spend high', source: 'data', datasetId: ds.id, metric: 'c3', aggregate: 'sum', condition: 'above', threshold: 5, windowDays: 7, emails: ['alice@acme.com'] };
    const bad = await call('/api/alerts', { method: 'POST', body: { ...rule, emails: [] } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as any).error.code, 'INVALID_ALERT');
    assert.equal((await call('/api/alerts', { method: 'POST', body: { ...rule, datasetId: 'nope' } })).status, 400);
    assert.equal((await call('/api/alerts', { method: 'POST', body: rule, token: 'token-bob' })).status, 404);

    const ok = await call('/api/alerts', { method: 'POST', body: rule });
    assert.equal(ok.status, 201);
    const made = ((await ok.json()) as any).rule;
    assert.equal(made.status, 'new');
    assert.equal('sealedWebhook' in made, false);

    const listed = (await (await call('/api/alerts')).json()) as any;
    assert.equal(listed.rules.length, 1);
    assert.equal(listed.emailAllowed, true);
    assert.equal(listed.userEmail, 'alice@acme.com');
    assert.equal(((await (await call('/api/alerts', { project: p2 })).json()) as any).rules.length, 0);
    assert.equal((await call(`/api/alerts/${made.id}`, { method: 'PUT', body: rule, project: p2 })).status, 404);

    const upd = await call(`/api/alerts/${made.id}`, { method: 'PUT', body: { ...rule, threshold: 1000 } });
    assert.equal(upd.status, 200);
    assert.equal(((await upd.json()) as any).rule.threshold, 1000);

    // test message: the mailer is not set up in tests, so nothing is delivered, and the rule stays untouched
    const t = await call(`/api/alerts/${made.id}/test`, { method: 'POST' });
    assert.equal(t.status, 200);
    const tr = (await t.json()) as any;
    assert.equal(typeof tr.message, 'string');
    assert.equal(typeof tr.wouldTrigger, 'boolean');
    assert.equal(((await (await call('/api/alerts')).json()) as any).rules[0].status, 'new');

    assert.equal((await call(`/api/alerts/${made.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/api/alerts/${made.id}`, { method: 'DELETE' })).status, 404);
  } finally {
    server.close();
    setTestTokenVerifier(null as never);
    setTestFirestoreStore(null as never);
    setTestProjectDocsStore(null);
    setTestAlertStore(null as never);
  }
});
