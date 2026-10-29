import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { getProviderFor, clearProviderCache, createInMemoryProviderStore, customProvider, dataForSeoProvider, fillBody, fillUrl, getPath, ProviderError, setTestProviderStore, validateCustomConfig, withCache, customConfigSchema, type ProviderDeps } from './lib/dataProviders.js';
import { setTestDataProvider } from './lib/dataProvider.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { setDataProviderTestDeps } from './routes/dataprovider.js';
import { setSeoTestDeps } from './routes/seo.js';
import type { FetchedPage } from './lib/seoFetch.js';

interface Seen { url: string; method?: string; headers?: Record<string, string>; body?: unknown }
const fakeDeps = (reply: (url: URL, body: unknown) => { status: number; json?: unknown }, seen: Seen[] = []): ProviderDeps => ({
  now: Date.now,
  request: async (url, o) => { const body = o.body ? JSON.parse(o.body) : undefined; seen.push({ url: url.toString(), ...(o.method ? { method: o.method } : {}), ...(o.headers ? { headers: o.headers } : {}), body }); const r = reply(url, body); return { status: r.status, headers: {}, text: JSON.stringify(r.json ?? {}) }; },
});
const dfsReply = (url: URL): { status: number; json?: unknown } => {
  const ok = (result: unknown) => ({ status: 200, json: { status_code: 20000, tasks: [{ status_code: 20000, result }] } });
  if (url.pathname.endsWith('search_volume/live')) return ok([{ keyword: 'coffee beans', search_volume: 5400, cpc: 1.25, competition: 'HIGH', competition_index: 80 }, { keyword: 'tea', search_volume: null, cpc: null, competition_index: null }]);
  if (url.pathname.endsWith('bulk_keyword_difficulty/live')) return ok([{ items: [{ keyword: 'coffee beans', keyword_difficulty: 42 }] }]);
  if (url.pathname.endsWith('ranked_keywords/live')) return ok([{ items: [{ keyword_data: { keyword: 'espresso', keyword_info: { search_volume: 900 } }, ranked_serp_element: { serp_item: { rank_group: 3, url: 'https://x.com/e' } } }, { keyword_data: { keyword: 'broken' } }] }]);
  if (url.pathname.endsWith('backlinks/summary/live')) return ok([{ referring_domains: 12, backlinks: 40, rank: 55 }]);
  return { status: 404 };
};

test('getPath follows dots and list positions and refuses prototype tricks', () => {
  const o = { a: { b: [{ c: 5 }] } };
  assert.equal(getPath(o, 'a.b.0.c'), 5); assert.equal(getPath(o, 'a.x.0'), undefined); assert.deepEqual(getPath(o, ''), o);
  assert.equal(getPath(o, 'a.__proto__'), undefined); assert.equal(getPath({}, 'constructor'), undefined);
});

test('Templates: values go in as values, never as JSON structure or extra address parts', () => {
  const evil = 'x","admin":true,"y":"';
  const body = fillBody('{"target":"{{domain}}","list":"{{keywords}}","note":"for {{domain}} in {{country}}","loc":"{{location_code}}"}', { domain: evil, keywords: ['a', 'b'], country: 'GB' }) as Record<string, unknown>;
  assert.equal(body.target, evil); assert.deepEqual(body.list, ['a', 'b']); assert.equal(body.note, `for ${evil} in gb`); assert.equal(body.loc, 2826); assert.equal('admin' in body, false);
  assert.equal(fillUrl('https://api.x.com/k?q={{keywords}}&c={{country}}', { keywords: ['a b', 'c&d'], country: 'us' }), 'https://api.x.com/k?q=a%20b%2Cc%26d&c=us');
});

test('DataForSEO: sends the right requests with the customer login and reads volume, cost, difficulty, keywords and links', async () => {
  const seen: Seen[] = [];
  const p = dataForSeoProvider({ login: 'me@x.com', password: 'pw' }, fakeDeps(dfsReply, seen));
  const m = await p.keywordMetrics(['Coffee Beans', 'tea'], 'gb');
  assert.deepEqual(m[0], { keyword: 'coffee beans', volume: 5400, cpc: 1.25, difficulty: 42, competition: 80 });
  assert.deepEqual(m[1], { keyword: 'tea', volume: null, cpc: null, difficulty: null, competition: null });
  assert.equal((seen[0]!.body as { location_code: number }[])[0]!.location_code, 0 + 2826);
  assert.equal(seen[0]!.headers!.Authorization, `Basic ${Buffer.from('me@x.com:pw').toString('base64')}`);
  assert.deepEqual((seen[0]!.body as { keywords: string[] }[])[0]!.keywords, ['coffee beans', 'tea']);
  const ck = await p.competitorKeywords('x.com', 'us');
  assert.deepEqual(ck, [{ keyword: 'espresso', position: 3, volume: 900, url: 'https://x.com/e' }]);
  assert.deepEqual(await p.backlinks('x.com'), { domain: 'x.com', referringDomains: 12, backlinks: 40, authority: 55 });
});

test('DataForSEO: refused sign-in, no credit and provider-side errors become plain messages; difficulty failing is not fatal', async () => {
  const bad = dataForSeoProvider({ login: 'a@b.c', password: 'x' }, fakeDeps(() => ({ status: 401 })));
  await assert.rejects(bad.keywordMetrics(['a'], 'us'), (e: Error) => e instanceof ProviderError && /sign-in/.test(e.message));
  const credit = dataForSeoProvider({ login: 'a@b.c', password: 'x' }, fakeDeps(() => ({ status: 402 })));
  await assert.rejects(credit.keywordMetrics(['a'], 'us'), /out of credit/);
  const nosub = dataForSeoProvider({ login: 'a@b.c', password: 'x' }, fakeDeps(() => ({ status: 200, json: { status_code: 20000, tasks: [{ status_code: 40204, status_message: 'Access denied. Subscription needed.', result: null }] } })));
  await assert.rejects(nosub.backlinks('x.com'), /Subscription needed/);
  const partial = dataForSeoProvider({ login: 'a@b.c', password: 'x' }, fakeDeps((u) => (u.pathname.includes('difficulty') ? { status: 500 } : dfsReply(u))));
  assert.equal((await partial.keywordMetrics(['coffee beans'], 'us'))[0]!.volume, 5400);
  assert.equal(dataForSeoProvider({}).connected, false);
});

const CUSTOM = customConfigSchema.parse({
  name: 'My SEO API', auth: { type: 'header', headerName: 'X-Api-Key' },
  keywordMetrics: { method: 'POST', url: 'https://api.seo.example.com/v1/keywords', body: '{"terms":"{{keywords}}","geo":"{{country}}"}', itemsPath: 'data.rows', fields: { keyword: 'term', volume: 'stats.searches', cpc: 'stats.cpc', difficulty: 'kd', competition: '' } },
  backlinks: { method: 'GET', url: 'https://api.seo.example.com/v1/links?site={{domain}}', itemsPath: 'data', fields: { referringDomains: 'domains', backlinks: 'links', authority: 'score' } },
});
test('Custom provider: customer-described address, key header and field names are honoured', async () => {
  assert.equal(validateCustomConfig(CUSTOM), null);
  const seen: Seen[] = [];
  const p = customProvider(CUSTOM, { secret: 'K3Y' }, fakeDeps((u) => (u.pathname === '/v1/keywords' ? { status: 200, json: { data: { rows: [{ term: 'Shoes', stats: { searches: '300', cpc: 0.8 }, kd: 12 }, { stats: {} }] } } } : { status: 200, json: { data: { domains: 9, links: 70, score: '33' } } }), seen));
  assert.deepEqual(await p.keywordMetrics(['shoes'], 'us'), [{ keyword: 'shoes', volume: 300, cpc: 0.8, difficulty: 12, competition: null }]);
  assert.equal(seen[0]!.headers!['X-Api-Key'], 'K3Y'); assert.deepEqual(seen[0]!.body, { terms: ['shoes'], geo: 'us' });
  assert.deepEqual(await p.backlinks('x.com'), { domain: 'x.com', referringDomains: 9, backlinks: 70, authority: 33 });
  assert.equal(seen[1]!.url, 'https://api.seo.example.com/v1/links?site=x.com');
  assert.deepEqual(await p.competitorKeywords('x.com', 'us'), [], 'a lookup the customer did not describe returns nothing');
});

test('Custom setup is checked: https only, no internal addresses, valid body, a lookup at all', () => {
  const base = { name: 'Xy', auth: { type: 'none' as const } };
  const ep = (url: string, extra = {}) => ({ method: 'GET' as const, url, itemsPath: '', fields: { keyword: 'k', volume: 'v', cpc: '', difficulty: '', competition: '' }, ...extra });
  assert.match(validateCustomConfig(customConfigSchema.parse({ ...base }))!, /at least one lookup/);
  assert.match(validateCustomConfig(customConfigSchema.parse({ ...base, keywordMetrics: ep('http://api.x.com/a') }))!, /https/);
  assert.match(validateCustomConfig(customConfigSchema.parse({ ...base, keywordMetrics: ep('https://localhost/a') }))!, /private|internal/);
  assert.match(validateCustomConfig(customConfigSchema.parse({ ...base, keywordMetrics: ep('https://169.254.169.254/a') }))!, /IP address/);
  assert.match(validateCustomConfig(customConfigSchema.parse({ ...base, keywordMetrics: ep('https://api.x.com/a', { method: 'POST', body: '{not json' }) }))!, /not valid JSON/);
  assert.match(validateCustomConfig(customConfigSchema.parse({ name: 'Xy', auth: { type: 'header' }, keywordMetrics: ep('https://api.x.com/a') }))!, /header/);
});

test('Cache: the same phrase is never paid for twice, and a daily cap protects the bill', async () => {
  clearProviderCache();
  let calls = 0; const asked: string[][] = [];
  const inner = { id: 'x', name: 'X', connected: true, async keywordMetrics(k: string[]) { calls++; asked.push(k); return k.map((keyword) => ({ keyword, volume: 1, cpc: 1, difficulty: 1, competition: 1 })); }, async competitorKeywords() { calls++; return []; }, async backlinks() { calls++; return null; } };
  const p = withCache(inner, 'ws_cache');
  await p.keywordMetrics(['a', 'b'], 'us'); const again = await p.keywordMetrics(['a', 'b', 'c'], 'us');
  assert.deepEqual(asked, [['a', 'b'], ['c']]); assert.equal(again.length, 3);
  await p.backlinks('x.com'); await p.backlinks('x.com'); assert.equal(calls, 3, 'a "no data" answer is cached too');
  clearProviderCache();
  const capped = withCache(inner, 'ws_cap'); let refused = 0;
  for (let i = 0; i < 305; i++) { try { await capped.competitorKeywords(`d${i}.com`, 'us'); } catch (e) { if (e instanceof ProviderError && /limit/.test(e.message)) refused++; } }
  assert.equal(refused, 5);
});

test('Data provider settings API: connect, hide the secret, test, use in keyword tools, remove', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-45-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  clearProviderCache();
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore()); setTestProviderStore(createInMemoryProviderStore());
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Shop', domain: 'shop.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  setTestTokenVerifier(async (t: string) => { const who = t === 'token-alice' ? 'alice' : t === 'token-bob' ? 'bob' : null; if (!who) throw new Error('bad'); return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never; });
  setDataProviderTestDeps({ provider: fakeDeps(dfsReply) });
  const suggest = async (q: string) => [q + ' a', q + ' b'];
  setSeoTestDeps({ suggest, fetcher: async (url: string): Promise<FetchedPage> => ({ url, status: 0, text: '', error: 'down', contentType: '', ms: 1, bytes: 0 }) });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown, token = 'token-alice') => fetch(`${baseUrl}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  try {
    assert.equal(((await (await call('GET', '/api/data-provider')).json()) as { provider: unknown }).provider, null);
    assert.equal((await call('PUT', '/api/data-provider', { kind: 'dataforseo' })).status, 400, 'credentials needed');
    assert.equal((await call('PUT', '/api/data-provider', { kind: 'dataforseo', credentials: { login: 'me@x.com', password: 'super-secret-pw' } }, 'token-bob')).status, 404);
    const saved = await call('PUT', '/api/data-provider', { kind: 'dataforseo', credentials: { login: 'me@x.com', password: 'super-secret-pw' } });
    assert.equal(saved.status, 200);
    const text = JSON.stringify(await (await call('GET', '/api/data-provider')).json());
    assert.equal(text.includes('super-secret-pw'), false); assert.match(text, /"hasSecret":true/);
    const tested = (await (await call('POST', '/api/data-provider/test')).json()) as { ok: boolean; checks: { name: string; ok: boolean; message: string }[] };
    assert.equal(tested.ok, true); assert.equal(tested.checks.every((c) => c.ok), true); assert.match(tested.checks[0]!.message, /5400/);

    // The saved connection is what the keyword tools use (no stand-in provider).
    const real = await getProviderFor(workspace.id);
    assert.deepEqual([real.connected, real.name], [true, 'DataForSEO']);
    const off = await call('PUT', '/api/data-provider', { kind: 'dataforseo', enabled: false });
    assert.equal(off.status, 200, 'turning it off keeps the saved login');
    assert.equal((await getProviderFor(workspace.id)).connected, false);
    setTestDataProvider(dataForSeoProvider({ login: 'a', password: 'b' }, fakeDeps(dfsReply)));
    clearProviderCache();
    const ideas = (await (await call('POST', '/api/seo/keywords', { seed: 'coffee beans' })).json()) as { providerConnected: boolean; ideas: { keyword: string; metrics: { volume: number } | null }[]; providerError: string | null };
    assert.equal(ideas.providerConnected, true); assert.equal(ideas.providerError, null);
    const prov = (await (await call('GET', '/api/seo/provider')).json()) as { connected: boolean; name: string };
    assert.deepEqual([prov.connected, prov.name], [true, 'DataForSEO']);
    setTestDataProvider(null);

    assert.equal((await call('PUT', '/api/data-provider', { kind: 'custom', config: { name: 'Bad', auth: { type: 'none' }, keywordMetrics: { method: 'GET', url: 'http://insecure.example.com', itemsPath: '', fields: { keyword: 'k', volume: '', cpc: '', difficulty: '', competition: '' } } } })).status, 400);
    assert.equal((await call('DELETE', '/api/data-provider')).status, 200);
    assert.equal(((await (await call('GET', '/api/data-provider')).json()) as { provider: unknown }).provider, null);
    assert.equal((await call('POST', '/api/data-provider/test')).status, 404);
  } finally { server.close(); setDataProviderTestDeps(null); setSeoTestDeps(null); setTestProviderStore(null); setTestDataProvider(null); }
});
