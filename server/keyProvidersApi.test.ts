import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { clearProviderCache, createInMemoryProviderStore, setTestProviderStore, type ProviderDeps } from './lib/dataProviders.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { setDataProviderTestDeps } from './routes/dataprovider.js';

test('Connect Semrush and SerpApi with one key: saved sealed, never shown, test only tries what that service offers', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id'; process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-60-32chars!!'; process.env.APP_BASE_URL = 'http://localhost:3000';
  clearProviderCache();
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore()); setTestProviderStore(createInMemoryProviderStore());
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Shop', domain: 'shop.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async (t: string) => { if (t !== 'token-alice') throw new Error('bad'); return { uid: 'uid_alice', email: 'alice@acme.com', name: 'alice', email_verified: true } as never; });
  const deps: ProviderDeps = { now: Date.now, request: async (url) => {
    const type = url.searchParams.get('type');
    const text = url.hostname === 'serpapi.com' ? JSON.stringify({ local_results: [{ position: 1, title: 'Cafe A', place_id: 'p1' }] })
      : type === 'phrase_these' ? 'Keyword;Search Volume;CPC;Competition;Keyword Difficulty Index\ncoffee;5400;1.2;0.5;40'
      : type === 'domain_organic' ? 'Keyword;Position;Search Volume;Url\nespresso;3;900;https://x.com/e'
      : 'ascore;total;domains_num\n55;40;12';
    return { status: 200, headers: {}, text } as never;
  } };
  setDataProviderTestDeps({ provider: deps });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer token-alice', 'Content-Type': 'application/json', 'X-AdLens-Project': `${workspace.id}/${p.id}` } });
  try {
    assert.equal((await call('PUT', '/api/data-provider', { kind: 'semrush' })).status, 400, 'a key is needed');
    assert.equal((await call('PUT', '/api/data-provider', { kind: 'semrush', credentials: { secret: 'short' } })).status, 400, 'too short to be a key');
    assert.equal((await call('PUT', '/api/data-provider', { kind: 'semrush', credentials: { secret: 'SEMRUSH-KEY-1234' } })).status, 200);
    const shown = JSON.stringify(await (await call('GET', '/api/data-provider')).json());
    assert.equal(shown.includes('SEMRUSH-KEY-1234'), false); assert.match(shown, /"kind":"semrush"/); assert.match(shown, /"hasSecret":true/);
    const t1 = (await (await call('POST', '/api/data-provider/test')).json()) as { ok: boolean; checks: { name: string; ok: boolean; message: string }[] };
    assert.equal(t1.ok, true);
    assert.equal(t1.checks.find((c) => c.name === 'Map results')!.message, 'Not set up.');
    assert.equal(t1.checks.filter((c) => c.ok).length, 3);
    assert.equal((await call('PUT', '/api/data-provider', { kind: 'serpapi', credentials: { secret: 'SERPAPI-KEY-1234' } })).status, 200);
    const t2 = (await (await call('POST', '/api/data-provider/test')).json()) as { ok: boolean; checks: { name: string; ok: boolean }[] };
    assert.equal(t2.ok, true); assert.deepEqual(t2.checks.filter((c) => c.ok).map((c) => c.name), ['Map results']);
    assert.equal((await call('PUT', '/api/data-provider', { kind: 'ahrefs', enabled: false })).status, 400, 'switching service needs its own key');
  } finally { server.close(); setDataProviderTestDeps(null); setTestProviderStore(null); }
});
