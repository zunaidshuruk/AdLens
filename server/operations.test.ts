import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryAuditStore, listAuditForUid, recordAccountDeletion, recordAudit, setTestAuditStore } from './lib/auditLog.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { reportError, scrubMessage } from './lib/errorReporter.js';
import { cacheClear, cacheGet, cacheSet } from './lib/responseCache.js';
import { createMemoryStore, setTestSharedStore } from './lib/sharedStore.js';
import { countUpstream, readUsage } from './lib/usageMeter.js';
import { isOperator } from './routes/ops.js';

test('audit log: records, lists newest first, trims long details, and anonymises on account deletion', async () => {
  const store = createInMemoryAuditStore();
  await recordAudit({ uid: 'u1', action: 'connection.meta.connected' }, store, new Date('2026-10-01T10:00:00Z'));
  await recordAudit({ uid: 'u1', action: 'mcp.key_created', detail: `line1\nline2 ${'x'.repeat(500)}` }, store, new Date('2026-10-02T10:00:00Z'));
  await recordAudit({ uid: 'u2', action: 'project.deleted', workspaceId: 'w' }, store);
  const mine = await listAuditForUid('u1', 100, store);
  assert.deepEqual(mine.map((e) => e.action), ['mcp.key_created', 'connection.meta.connected']);
  assert.ok((mine[0].detail ?? '').length <= 200 && !mine[0].detail!.includes('\n'));
  await recordAccountDeletion('u1', store);
  assert.equal((await listAuditForUid('u1', 100, store)).length, 0);
  const left = store.all().filter((e) => e.action === 'account.deleted');
  assert.equal(left.length, 1);
  assert.ok(left[0].uid.startsWith('deleted:') && !left[0].uid.includes('u1'));
});

test('audit log never throws when the store fails', async () => {
  const broken = { put: async () => { throw new Error('down'); }, listForUid: async () => [], listForWorkspace: async () => [], deleteForUid: async () => { throw new Error('down'); } };
  await recordAudit({ uid: 'u', action: 'project.deleted' }, broken);
  await recordAccountDeletion('u', broken);
});

test('usage meter counts per provider per day', async () => {
  const store = createMemoryStore();
  const day = new Date('2026-10-26T12:00:00Z');
  await countUpstream('ga4', { store, now: day });
  await countUpstream('ga4', { store, now: day });
  await countUpstream('meta', { store, now: day });
  const days = await readUsage(2, { store, now: day });
  assert.equal(days[0].date, '2026-10-26');
  assert.equal(days[0].counts.ga4, 2);
  assert.equal(days[0].counts.meta, 1);
  assert.equal(days[1].counts.ga4, 0);
});

test('error reporter masks secrets, sends once per five minutes, and is silent without a webhook', async () => {
  assert.equal(scrubMessage('failed Bearer abc.def-123 for bob@x.com access_token=SECRET123 key adl_abcdefghijkl'), 'failed Bearer [hidden] for [email] access_token=[hidden] key adl_[hidden]');
  const sent: { url: string; body: string }[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => { sent.push({ url, body: init.body }); return { ok: true }; }) as unknown as typeof fetch;
  const store = createMemoryStore();
  const env = { ERROR_WEBHOOK_URL: 'https://hooks.example.com/abc' };
  assert.equal(await reportError(new Error('boom token=abc'), { method: 'get', path: '/api/x?code=1' }, { env, fetchFn, store }), true);
  assert.equal(await reportError(new Error('boom token=abc'), { method: 'get', path: '/api/x?code=2' }, { env, fetchFn, store }), false);
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].body.includes('abc.') && !sent[0].body.includes('code=1') && sent[0].body.includes('GET /api/x'));
  assert.equal(await reportError(new Error('x'), {}, { env: {}, fetchFn, store }), false);
  assert.equal(await reportError(new Error('x'), {}, { env: { ERROR_WEBHOOK_URL: 'http://insecure' }, fetchFn, store }), false);
});

test('response cache round-trips through the shared store and clears by namespace', async () => {
  setTestSharedStore(createMemoryStore());
  await cacheSet('t', 'k', { a: 1 }, 10_000);
  assert.deepEqual(await cacheGet('t', 'k'), { a: 1 });
  assert.equal(await cacheGet('other', 'k'), null);
  cacheClear('t');
  assert.equal(await cacheGet('t', 'k'), null);
  setTestSharedStore(null);
});

test('ops routes: ready is public; audit is private; usage is owner only', async () => {
  setTestSharedStore(createMemoryStore());
  setTestFirestoreStore(createInMemoryFirestoreStore());
  const audit = createInMemoryAuditStore();
  setTestAuditStore(audit);
  await recordAudit({ uid: 'uid_o', action: 'connection.google.connected' }, audit);
  await recordAudit({ uid: 'uid_other', action: 'connection.google.connected' }, audit);
  let email = 'owner@acme.com';
  setTestTokenVerifier(async () => ({ uid: 'uid_o', email, name: 'o', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  process.env.OPERATOR_EMAILS = 'Owner@acme.com';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (p: string, auth = true) => fetch(`${base}${p}`, { headers: auth ? { Authorization: 'Bearer t' } : {} });
  try {
    assert.equal((await get('/api/ops/ready', false)).status, 200);
    assert.equal((await get('/api/ops/audit', false)).status, 401);
    const a = await (await get('/api/ops/audit')).json() as { events: { action: string }[] };
    assert.equal(a.events.length, 1, 'only my own events');
    assert.equal((await get('/api/ops/usage')).status, 200);
    email = 'someone@else.com';
    assert.equal((await get('/api/ops/usage')).status, 403);
    const bad = await fetch(`${base}/api/ops/audit`, { method: 'POST', body: '{bad', headers: { 'Content-Type': 'application/json' } });
    assert.ok(bad.status === 400 || bad.status === 404, 'a malformed body is a client error, not a crash');
  } finally {
    server.close();
    delete process.env.OPERATOR_EMAILS;
    setTestAuditStore(null);
    setTestSharedStore(null);
  }
  assert.equal(isOperator('a@b.com', { OPERATOR_EMAILS: ' A@B.com ,c@d.com' }), true);
  assert.equal(isOperator(null, { OPERATOR_EMAILS: 'a@b.com' }), false);
});
