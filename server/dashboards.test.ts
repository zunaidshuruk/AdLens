import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { DASHBOARD_TEMPLATES, templateToInput } from '../src/config/dashboardTemplates.js';
import { dashboardInputSchema } from './lib/dashboardSpec.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';

test('Sprint 14 — every starter template passes the server validation', () => {
  for (const tpl of DASHBOARD_TEMPLATES) {
    const r = dashboardInputSchema.safeParse(templateToInput(tpl));
    assert.ok(r.success, `${tpl.id}: ${r.success ? '' : r.error.issues[0]?.message} ${r.success ? '' : JSON.stringify(r.error.issues[0]?.path)}`);
  }
});

test('Sprint 14 — dashboard validation rejects bad layouts, duplicate ids and unknown fields', () => {
  const base = templateToInput(DASHBOARD_TEMPLATES[0]);
  assert.equal(dashboardInputSchema.safeParse({ ...base, widgets: [{ ...base.widgets[0], layout: { x: 10, y: 0, w: 6, h: 2 } }] }).success, false);
  assert.equal(dashboardInputSchema.safeParse({ ...base, widgets: [base.widgets[0], base.widgets[0]] }).success, false);
  const bad = JSON.parse(JSON.stringify(base.widgets[0]));
  bad.spec.metrics = ['notAMetric'];
  assert.equal(dashboardInputSchema.safeParse({ ...base, widgets: [bad] }).success, false);
  assert.equal(dashboardInputSchema.safeParse({ ...base, name: '  ' }).success, false);
});

test('Sprint 14 — dashboards API: create, list, update, delete, limits and isolation', async () => {
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
    fetch(`${baseUrl}/api/dashboards${path}`, {
      method: o.method,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      headers: { Authorization: `Bearer ${o.token ?? 'token-alice'}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${(o.project ?? p1).workspaceId}/${(o.project ?? p1).id}` },
    });

  try {
    assert.equal((await fetch(`${baseUrl}/api/dashboards`)).status, 401);
    const input = templateToInput(DASHBOARD_TEMPLATES[0]);

    const created = await call('', { method: 'POST', body: input });
    assert.equal(created.status, 201);
    const dash = ((await created.json()) as any).dashboard;
    assert.equal(dash.widgets.length, input.widgets.length);

    const listed = ((await (await call('')).json()) as any).dashboards;
    assert.equal(listed.length, 1);
    // another project in the same workspace has its own list
    assert.equal(((await (await call('', { project: p2 })).json()) as any).dashboards.length, 0);
    // a stranger cannot read or write
    assert.equal((await call('', { token: 'token-bob' })).status, 404);
    assert.equal((await call('', { method: 'POST', body: input, token: 'token-bob' })).status, 404);

    const got = await call(`/${dash.id}`);
    assert.equal(got.status, 200);

    const updated = await call(`/${dash.id}`, { method: 'PUT', body: { ...input, name: 'Renamed', widgets: input.widgets.slice(0, 2) } });
    assert.equal(updated.status, 200);
    assert.equal(((await updated.json()) as any).dashboard.name, 'Renamed');

    assert.equal((await call('', { method: 'POST', body: { ...input, name: '' } })).status, 400);
    assert.equal((await call('/nope')).status, 404);

    // widget limit
    const many = { ...input, widgets: Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, title: 'n', kind: 'text', text: 'x', layout: { x: 0, y: i, w: 12, h: 1 } })) };
    const tooMany = await call('', { method: 'POST', body: many });
    assert.equal(tooMany.status, 409);
    assert.equal(((await tooMany.json()) as any).error.code, 'TOO_MANY_WIDGETS');

    // dashboard limit
    for (let i = 0; i < 9; i += 1) assert.equal((await call('', { method: 'POST', body: input })).status, 201);
    const over = await call('', { method: 'POST', body: input });
    assert.equal(over.status, 409);
    assert.equal(((await over.json()) as any).error.code, 'LIMIT_REACHED');

    assert.equal((await call(`/${dash.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/${dash.id}`, { method: 'DELETE' })).status, 404);
  } finally {
    server.close();
  }
});
