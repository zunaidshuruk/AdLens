import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { activeBrand } from './lib/branding.js';
import { buildScheduleEmail } from './lib/emailSchedules.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { snapshotToPdf } from './lib/pdf.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { createInMemoryShareStore, setTestShareStore } from './lib/shares.js';

const snap = { title: 'Board', description: '', generatedAt: '2026-10-26T00:00:00Z', range: { startDate: '2026-10-01', endDate: '2026-10-07' }, widgets: [{ id: 'w', title: 'Note', kind: 'text', text: 'Hi', layout: { x: 0, y: 0, w: 4, h: 2 } }] } as never;

test('activeBrand needs it switched on, a name and a plan that includes it', () => {
  const b = { enabled: true, name: 'Acme', footer: 'f', accent: '#112233' };
  assert.equal(activeBrand({ plan: 'business', branding: b })?.name, 'Acme');
  assert.equal(activeBrand({ plan: 'free', branding: b }), null);
  assert.equal(activeBrand({ plan: 'business', branding: { ...b, enabled: false } }), null);
  assert.equal(activeBrand({ plan: 'business', branding: { ...b, name: 'A' } }), null);
  assert.equal(activeBrand({ plan: 'business', branding: null }), null);
});

test('White-label emails and PDFs carry the customer brand, not ours', () => {
  const brand = { name: 'Acme <Marketing>', footer: 'Call us', accent: '#112233' };
  const m = buildScheduleEmail({ title: 'Board', frequency: 'weekly', kind: 'dashboard', targetId: 'd1' }, snap, 'Proj', 'https://app.example.com', 'me@x.com', false, brand);
  assert.match(m.html, /Acme &lt;Marketing&gt;/);
  assert.equal(m.html.includes('<Marketing>'), false);
  assert.equal(/AdLens/.test(m.html + m.text), false);
  assert.match(m.html, /#112233/); assert.match(m.text, /Call us/);
  const plain = buildScheduleEmail({ title: 'Board', frequency: 'weekly', kind: 'dashboard', targetId: 'd1' }, snap, 'Proj', 'https://app.example.com', 'me@x.com');
  assert.match(plain.html, /Sent by AdLens/);
  const a = snapshotToPdf(snap, 'Proj', brand); const b = snapshotToPdf(snap, 'Proj');
  assert.equal(a.subarray(0, 5).toString(), '%PDF-'); assert.notDeepEqual(a, b);
});

test('White label settings: plan gate, validation, and the public share page', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-34-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore()); setTestShareStore(createInMemoryShareStore());
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'One', domain: 'a.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async () => ({ uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown) => fetch(`${baseUrl}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  const path = `/api/workspaces/${workspace.id}/branding`;
  const good = { enabled: true, name: '  Acme\u0007 Agency ', footer: 'Prepared by Acme', accent: '#1a73e8' };
  try {
    await fs.setWorkspacePlan(workspace.id, 'free', null);
    const g = await (await call('GET', path)).json() as { allowed: boolean };
    assert.equal(g.allowed, false);
    assert.equal((await call('PUT', path, good)).status, 403);
    await fs.setWorkspacePlan(workspace.id, 'business', null);
    assert.equal((await call('PUT', path, { ...good, accent: 'red' })).status, 400);
    assert.equal((await call('PUT', path, { ...good, name: 'A' })).status, 400);
    assert.equal((await call('PUT', path, { ...good, extra: 1 })).status, 400);
    const saved = await call('PUT', path, good);
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as { branding: { name: string } }).branding.name, 'Acme Agency');

    const dash = ((await (await call('POST', '/api/dashboards', { name: 'Board', widgets: [{ id: 'w1', title: 'Note', layout: { x: 0, y: 0, w: 4, h: 3 }, kind: 'text', text: 'Hello' }] })).json()) as { dashboard: { id: string } }).dashboard;
    const share = ((await (await call('POST', '/api/shares', { kind: 'dashboard', targetId: dash.id, rangeDays: 28 })).json()) as { share: { url: string } }).share;
    const token = share.url.split('/s/')[1]!;
    const meta = await (await fetch(`${baseUrl}/api/shared/${token}`)).json() as { brand: { name: string; footer: string; accent: string } | null };
    assert.equal(meta.brand?.name, 'Acme Agency'); assert.equal(meta.brand?.accent, '#1a73e8');
    const opened = await (await fetch(`${baseUrl}/api/shared/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json() as { brand: { name: string } | null };
    assert.equal(opened.brand?.name, 'Acme Agency');
    const pdf = await fetch(`${baseUrl}/api/shared/${token}/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(pdf.status, 200);

    // Downgrade: the brand disappears from public pages even though the settings are still saved.
    await fs.setWorkspacePlan(workspace.id, 'free', null);
    assert.equal(((await (await fetch(`${baseUrl}/api/shared/${token}`)).json()) as { brand: unknown }).brand, null);
  } finally { server.close(); }
});
