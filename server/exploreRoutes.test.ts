import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryVaultStore, setTestConnectionStore } from './lib/connectionStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { clearExploreCache } from './routes/explore.js';
import { getVault, resetVaultSingleton } from './lib/vault.js';

test('Sprint 13 — Explore: catalogue, GA4 + Search Console runs, validation, caching, saved reports and isolation', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-13-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  clearExploreCache();

  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestConnectionStore(createInMemoryVaultStore());
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  resetVaultSingleton();

  const { workspace: wsA } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const full = await fs.createProject(wsA.id, { name: 'Full', domain: 'a.com', ga4PropertyId: '1001', ga4PropertyName: 'GA', searchConsoleSite: 'sc-domain:a.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  const bare = await fs.createProject(wsA.id, { name: 'Bare', domain: 'b.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });

  setTestTokenVerifier(async (token: string) => {
    const who = token === 'token-alice' ? 'alice' : token === 'token-bob' ? 'bob' : null;
    if (!who) throw new Error('bad');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  await getVault().saveConnection({ uid: 'uid_alice', provider: 'google', accountLabel: 'alice@acme.com', scopes: ['x'], refreshToken: 'rt', accessToken: 'GOOGLE-ACCESS-TOKEN', accessTokenExpiresAt: Date.now() + 3_600_000 });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  const upstream: { url: string; body: any; auth: string | null }[] = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(baseUrl)) return realFetch(input, init);
    const headers = new Headers(init?.headers);
    upstream.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get('authorization') });
    if (url.includes('analyticsdata.googleapis.com')) {
      return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: 'Bangladesh' }], metricValues: [{ value: '42' }] }], totals: [{ metricValues: [{ value: '42' }] }], rowCount: 1 }), { status: 200 });
    }
    if (url.includes('searchAnalytics/query')) {
      return new Response(JSON.stringify({ rows: [{ keys: ['adlens'], clicks: 5, impressions: 50, ctr: 0.1, position: 3.2 }] }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const H = (token: string, project?: { workspaceId: string; id: string }) => ({
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    ...(project ? { 'X-AdLens-Project': `${project.workspaceId}/${project.id}` } : {}),
  });
  const D = { startDate: '2026-10-01', endDate: '2026-10-07' };
  const call = (path: string, init: RequestInit & { token?: string; project?: { workspaceId: string; id: string } } = {}) =>
    realFetch(`${baseUrl}/api/explore${path}`, { method: init.method, body: init.body, headers: H(init.token ?? 'token-alice', init.project ?? full) });

  try {
    assert.equal((await realFetch(`${baseUrl}/api/explore/catalog`)).status, 401);

    const cat = await (await call('/catalog')).json() as any;
    assert.ok(cat.ga4.dimensions.length > 10 && cat.search_console.metrics.length === 4);

    // GA4 run
    const ga4Body = JSON.stringify({ ...D, dimensions: ['country'], metrics: ['sessions'], limit: 10 });
    const r1 = await call('/ga4/run', { method: 'POST', body: ga4Body });
    assert.equal(r1.status, 200);
    const j1 = await r1.json() as any;
    assert.deepEqual(j1.rows, [{ country: 'Bangladesh', sessions: 42 }]);
    assert.equal(upstream[0].auth, 'Bearer GOOGLE-ACCESS-TOKEN');
    assert.ok(upstream[0].url.includes('/properties/1001:runReport'));
    assert.deepEqual(upstream[0].body.metrics, [{ name: 'sessions' }]);
    assert.equal(r1.headers.get('x-adlens-cache'), 'false');

    // cached the second time (no new upstream call)
    const before = upstream.length;
    const r2 = await call('/ga4/run', { method: 'POST', body: ga4Body });
    assert.equal(r2.headers.get('x-adlens-cache'), 'true');
    assert.equal(upstream.length, before);

    // Search Console run
    const r3 = await call('/search-console/run', { method: 'POST', body: JSON.stringify({ ...D, dimensions: ['query'], metrics: ['clicks', 'ctr'], filters: [{ field: 'query', op: 'contains', value: 'lens' }] }) });
    assert.equal(r3.status, 200);
    const j3 = await r3.json() as any;
    assert.deepEqual(j3.rows, [{ query: 'adlens', clicks: 5, ctr: 10 }]);
    const scCall = upstream[upstream.length - 1];
    assert.ok(scCall.url.includes(encodeURIComponent('sc-domain:a.com')));
    assert.equal(scCall.body.dimensionFilterGroups[0].filters[0].operator, 'contains');

    // validation: unknown field never reaches Google
    const n = upstream.length;
    const bad = await call('/ga4/run', { method: 'POST', body: JSON.stringify({ ...D, metrics: ['sessions; DROP TABLE'] }) });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as any).error.code, 'INVALID_REPORT');
    assert.equal(upstream.length, n);

    // project without a property / site
    const noProp = await call('/ga4/run', { method: 'POST', body: ga4Body, project: bare });
    assert.equal(noProp.status, 409);
    assert.equal(((await noProp.json()) as any).error.code, 'GA4_NOT_SELECTED');
    const noSite = await call('/search-console/run', { method: 'POST', body: JSON.stringify({ ...D, metrics: ['clicks'] }), project: bare });
    assert.equal(noSite.status, 409);

    // Bob cannot use Alice's project
    const bobRun = await call('/ga4/run', { method: 'POST', body: ga4Body, token: 'token-bob' });
    assert.equal(bobRun.status, 404);

    // Saved reports
    const spec = { dimensions: ['country'], metrics: ['sessions'], filters: [], limit: 50 };
    const created = await call('/saved', { method: 'POST', body: JSON.stringify({ name: 'Sessions by country', source: 'ga4', spec }) });
    assert.equal(created.status, 201);
    const rep = ((await created.json()) as any).report;
    assert.equal(rep.name, 'Sessions by country'); assert.equal(rep.createdBy, 'uid_alice');
    assert.equal('startDate' in rep.spec, false);

    const listed = ((await (await call('/saved')).json()) as any).reports;
    assert.equal(listed.length, 1);

    const upd = await call(`/saved/${rep.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Renamed', source: 'ga4', spec }) });
    assert.equal(((await upd.json()) as any).report.name, 'Renamed');

    const badSave = await call('/saved', { method: 'POST', body: JSON.stringify({ name: '', source: 'ga4', spec }) });
    assert.equal(badSave.status, 400);
    const badSpec = await call('/saved', { method: 'POST', body: JSON.stringify({ name: 'x', source: 'ga4', spec: { metrics: ['nope'] } }) });
    assert.equal(badSpec.status, 400);

    // isolation: saved reports are per project, and Bob sees nothing
    assert.equal(((await (await call('/saved', { project: bare })).json()) as any).reports.length, 0);
    assert.equal((await call('/saved', { token: 'token-bob' })).status, 404);
    assert.equal((await call(`/saved/${rep.id}`, { method: 'DELETE', token: 'token-bob' })).status, 404);

    assert.equal((await call(`/saved/${rep.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/saved/${rep.id}`, { method: 'DELETE' })).status, 404);

    // no secrets in any response
    assert.ok(!JSON.stringify(j1).includes('GOOGLE-ACCESS-TOKEN'));
  } finally {
    globalThis.fetch = realFetch;
    server.close();
    setTestProjectDocsStore(null);
  }
});

test('saved reports: limit per project', async () => {
  const { createSavedReport, MAX_SAVED_REPORTS_PER_PROJECT, SavedReportError } = await import('./lib/savedReports.js');
  const store = createInMemoryProjectDocsStore();
  const input = { name: 'r', source: 'ga4' as const, spec: { dimensions: [], metrics: ['sessions'], filters: [], limit: 10 } };
  for (let i = 0; i < MAX_SAVED_REPORTS_PER_PROJECT; i++) await createSavedReport(store, 'w', 'p', 'u', input);
  await assert.rejects(() => createSavedReport(store, 'w', 'p', 'u', input), (e: unknown) => e instanceof SavedReportError && e.code === 'LIMIT_REACHED');
  await createSavedReport(store, 'w', 'other', 'u', input); // another project is unaffected
});
