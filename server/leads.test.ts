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

test('Leads: assign to a team member (with email), lead link for Google/Zapier, CSV import', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const sent: { to: string; subject: string }[] = [];
  setLeadsTestDeps({ mail: async (m) => { sent.push({ to: m.to, subject: m.subject }); return { ok: true }; } });
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_eve', email: 'eve@acme.com', displayName: 'Eve' });
  await fs.updateWorkspace(workspace.id, { members: { ...(await fs.getWorkspace(workspace.id))!.members, uid_bob: 'member' } });
  const p = await fs.createProject(workspace.id, { name: 'Agency', domain: 'agency.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async (t: string) => {
    const who = t.replace('token-', '');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown, token = 'token-alice') => fetch(`${baseUrl}/api/leads${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  try {
    // Members for the picker
    const m = (await (await call('GET', '/members')).json()) as { members: { uid: string; name: string }[]; me: string };
    assert.deepEqual(m.members.map((x) => x.uid).sort(), ['uid_alice', 'uid_bob']);
    assert.equal(m.me, 'uid_alice');

    // Assign: only to workspace members; the person gets an email; assigning yourself sends nothing
    const made = ((await (await call('POST', '', { name: 'Lead One', email: 'one@x.com' })).json()) as { lead: { id: string; assigneeId: string; source: string } }).lead;
    assert.equal(made.assigneeId, ''); assert.equal(made.source, 'manual');
    assert.equal((await call('PUT', `/${made.id}`, { assigneeId: 'uid_eve' })).status, 400);
    assert.equal((await call('PUT', `/${made.id}`, { assigneeId: 'uid_bob' })).status, 200);
    await settle();
    assert.equal(sent.length, 1); assert.equal(sent[0]!.to, 'bob@acme.com');
    await call('PUT', `/${made.id}`, { assigneeId: 'uid_bob' }); await call('PUT', `/${made.id}`, { notes: 'hi' }); await settle();
    assert.equal(sent.length, 1, 'no repeat email when nothing changed');
    await call('PUT', `/${made.id}`, { assigneeId: 'uid_alice' }); await settle();
    assert.equal(sent.length, 1, 'assigning yourself sends nothing');
    assert.equal(((await (await call('PUT', `/${made.id}`, { assigneeId: '' })).json()) as { lead: { assigneeId: string } }).lead.assigneeId, '');
    assert.equal((await call('POST', '', { name: 'Bad', assigneeId: 'uid_eve' })).status, 400);

    // Lead link: off until a key is made; wrong key refused; Google body and flat bodies accepted; repeats skipped
    const cap = `${baseUrl}/api/leads/capture/${p.workspaceId}/${p.id}`;
    const post = (key: string, body: unknown, q = '') => fetch(`${cap}${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(typeof body === 'object' && body ? { ...(key ? { google_key: key } : {}), ...(body as object) } : body) });
    assert.equal((await post('nope', { name: 'X' })).status, 404);
    assert.equal(((await (await call('GET', '/capture')).json()) as { enabled: boolean }).enabled, false);
    const k = (await (await call('POST', '/capture/key', {})).json()) as { key: string; url: string };
    assert.ok(k.key.startsWith('ll_')); assert.equal(k.url, `http://localhost:3000/api/leads/capture/${p.workspaceId}/${p.id}`);
    assert.equal((await post('wrong', { name: 'X' })).status, 404);
    assert.equal((await post(k.key, { is_test: true, name: 'T' })).status, 200);
    assert.equal(((await (await call('GET', '')).json()) as { leads: unknown[] }).leads.length, 1, 'test data is not saved');
    const google = await post(k.key, { lead_id: 'abc', user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Gina Google' }, { column_id: 'EMAIL', string_value: 'gina@g.com' }, { column_id: 'PHONE_NUMBER', string_value: '+880 1711 000000' }, { column_id: 'COMPANY_NAME', string_value: 'Gina Ltd' }] });
    assert.equal(google.status, 201);
    assert.equal((await fetch(`${cap}?key=${k.key}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Zed+Zapier&email=zed%40z.com&budget=%24500' })).status, 201);
    assert.equal(((await (await post(k.key, { email: 'GINA@g.com', name: 'Gina again' })).json()) as { duplicate?: boolean }).duplicate, true);
    assert.equal((await post(k.key, { hello: 'world' })).status, 400);
    const list = ((await (await call('GET', '')).json()) as { leads: { name: string; source: string; value: number; notes: string; email: string }[] }).leads;
    const gina = list.find((l) => l.email === 'gina@g.com')!;
    assert.equal(gina.name, 'Gina Google'); assert.equal(gina.source, 'capture'); assert.ok(gina.notes.includes('Gina Ltd'));
    assert.equal(list.find((l) => l.email === 'z@z.com' || l.email === 'zed@z.com')!.value, 500);

    // Default assignee gets new link leads + an email
    sent.length = 0;
    assert.equal((await call('PUT', '/capture', { defaultAssigneeId: 'uid_eve' })).status, 400);
    assert.equal((await call('PUT', '/capture', { defaultAssigneeId: 'uid_bob' })).status, 200);
    assert.equal((await post(k.key, { name: 'Auto Assigned', email: 'auto@a.com' })).status, 201); await settle();
    assert.equal(sent.length, 1); assert.equal(sent[0]!.to, 'bob@acme.com');
    // Turn off -> refused; new key replaces the old one
    assert.equal((await call('PUT', '/capture', { enabled: false })).status, 200);
    assert.equal((await post(k.key, { name: 'Off', email: 'off@o.com' })).status, 404);
    const k2 = (await (await call('POST', '/capture/key', {})).json()) as { key: string };
    assert.equal((await post(k.key, { name: 'Old key', email: 'old@o.com' })).status, 404);
    assert.equal((await post(k2.key, { name: 'New key', email: 'new@o.com' })).status, 201);
    // The key itself is never stored or returned again
    assert.ok(!JSON.stringify(await (await call('GET', '/capture')).json()).includes(k2.key));

    // CSV import: maps column names, skips repeats, reports unreadable rows
    const imp = (await (await call('POST', '/import', { rows: [{ 'Full name': 'Imp One', Email: 'imp1@i.com', Phone: '123456789' }, { Name: 'Imp Two', Mobile: '987654321', Company: 'Two Ltd' }, { Email: 'IMP1@i.com' }, { Notes: 'nothing useful' }, { First_Name: 'Ivy', Last_Name: 'Last', Email: 'ivy@i.com' }] })).json()) as { added: number; duplicates: number; unreadable: number };
    assert.deepEqual({ a: imp.added, d: imp.duplicates, u: imp.unreadable }, { a: 3, d: 1, u: 1 });
    assert.equal((await call('POST', '/import', { rows: [] })).status, 400);
    assert.equal((await call('POST', '/import', { rows: new Array(501).fill({ Name: 'x' }) })).status, 400);
    const after = ((await (await call('GET', '')).json()) as { leads: { name: string; source: string }[] }).leads;
    assert.ok(after.some((l) => l.name === 'Ivy Last' && l.source === 'import'));
    // Import counts toward the plan limit (free plan: 20)
    await fs.setWorkspacePlan(workspace.id, 'free', null);
    const many = (await (await call('POST', '/import', { rows: Array.from({ length: 40 }, (_, i) => ({ Name: `Bulk ${i}`, Email: `bulk${i}@b.com` })) })).json()) as { added: number; overLimit: number };
    assert.ok(many.overLimit > 0 && many.added > 0);
    assert.equal(((await (await call('GET', '')).json()) as { leads: unknown[]; limit: number }).leads.length, ((await (await call('GET', '')).json()) as { limit: number }).limit);
  } finally { server.close(); setLeadsTestDeps(null); }
});
