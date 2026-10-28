import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import type { FetchedPage } from './lib/seoFetch.js';
import { setLeadsTestDeps } from './routes/leads.js';

test('Lead list: add, move through the pipeline, check a website, isolation', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const fetcher = async (url: string): Promise<FetchedPage> => {
    const u = new URL(url);
    const base = { url, contentType: 'text/html', ms: 5, bytes: 500 };
    if (u.hostname === 'lead.com') return { ...base, status: 200, text: '<html><head></head><body><p>Hello</p></body></html>' };
    if (u.hostname === 'broken.com') return { ...base, status: 500, text: '' };
    return { ...base, status: 0, text: '', error: 'down' };
  };
  setLeadsTestDeps({ fetcher });
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  const docs = createInMemoryProjectDocsStore(); setTestProjectDocsStore(docs);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Agency', domain: 'agency.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  const p2 = await fs.createProject(workspace.id, { name: 'Other', domain: 'other.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  setTestTokenVerifier(async (t: string) => {
    const who = t === 'token-alice' ? 'alice' : t === 'token-bob' ? 'bob' : null;
    if (!who) throw new Error('bad');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown, token = 'token-alice', proj = p) => fetch(`${baseUrl}/api/leads${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${proj.workspaceId}/${proj.id}` } });
  try {
    assert.equal((await fetch(`${baseUrl}/api/leads`)).status, 401);
    assert.equal((await call('POST', '', { name: '' })).status, 400);
    assert.equal((await call('POST', '', { name: 'X', value: -5 })).status, 400);
    assert.equal((await call('POST', '', { name: 'X', followUp: 'soon' })).status, 400);
    const made = await call('POST', '', { name: 'Lead Co', website: 'lead.com', value: 1200, email: 'a@lead.com' });
    assert.equal(made.status, 201);
    const lead = ((await made.json()) as { lead: { id: string; status: string; audit: unknown } }).lead;
    assert.equal(lead.status, 'new'); assert.equal(lead.audit, null);

    const audited = await call('POST', `/${lead.id}/audit`);
    assert.equal(audited.status, 200);
    const a = ((await audited.json()) as { lead: { audit: { score: number; issues: { title: string }[] } } }).lead.audit;
    assert.ok(a.score < 100 && a.issues.length > 0);

    const moved = await call('PUT', `/${lead.id}`, { status: 'proposal', notes: 'Sent quote' });
    assert.equal(((await moved.json()) as { lead: { status: string; audit: unknown } }).lead.status, 'proposal');
    const kept = ((await (await call('GET', '')).json()) as { leads: { audit: unknown }[] }).leads[0]!;
    assert.ok(kept.audit, 'audit stays while the website is unchanged');
    const changed = ((await (await call('PUT', `/${lead.id}`, { website: 'broken.com' })).json()) as { lead: { audit: unknown } }).lead;
    assert.equal(changed.audit, null, 'a new website clears the old check');
    assert.equal((await call('POST', `/${lead.id}/audit`)).status, 422);
    await call('PUT', `/${lead.id}`, { website: 'nowhere.invalid' });
    assert.equal((await call('POST', `/${lead.id}/audit`)).status, 502);
    await call('PUT', `/${lead.id}`, { website: '' });
    assert.equal((await call('POST', `/${lead.id}/audit`)).status, 409);

    // Isolation: another project and another person cannot see or touch it.
    assert.equal(((await (await call('GET', '', undefined, 'token-alice', p2)).json()) as { leads: unknown[] }).leads.length, 0);
    assert.equal((await call('PUT', `/${lead.id}`, { status: 'won' }, 'token-alice', p2)).status, 404);
    assert.equal((await call('GET', '', undefined, 'token-bob')).status, 404);
    assert.equal((await call('DELETE', `/${lead.id}`)).status, 200);
    assert.equal((await call('DELETE', `/${lead.id}`)).status, 404);
  } finally { server.close(); setLeadsTestDeps(null); }
});
