import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import type { AgentProvider } from './lib/agentProviders.js';
import { createInMemoryVaultStore, setTestConnectionStore } from './lib/connectionStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { getVault, resetVaultSingleton } from './lib/vault.js';
import type { DatasetSummary } from './lib/datasets.js';
import { buildSuggestPrompt, extractJsonObject, suggestWidget, type SuggestSource } from './lib/widgetSuggest.js';
import { clearAiRateLimit, setTestAiRequest } from './routes/ai.js';

const fake = (text: string): AgentProvider => ({ complete: async () => ({ text, toolCalls: [] }) });

test('Sprint 15a-3 — describe a widget: JSON is extracted, checked and tidied', async () => {
  assert.deepEqual(extractJsonObject('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('{"a":2} trailing'), { a: 2 });
  assert.equal(extractJsonObject('no json here'), null);

  const sources: ('ga4' | 'search_console')[] = ['ga4', 'search_console'];
  const good = JSON.stringify({ title: 'Sessions by country', kind: 'bar', source: 'ga4', spec: { dimensions: ['country'], metrics: ['sessions'], filters: [], orderBy: { field: 'sessions', desc: true }, limit: 8 } });
  const ok = await suggestWidget('sessions by country', { provider: fake(good), sources });
  assert.equal(ok.ok, true);

  // a KPI is forced to one number with no breakdown, whatever the model sent
  const kpi = JSON.stringify({ title: 'Clicks', kind: 'kpi', source: 'search_console', spec: { dimensions: ['query'], metrics: ['clicks', 'impressions'], filters: [], limit: 50 } });
  const k = await suggestWidget('total clicks', { provider: fake(kpi), sources });
  assert.ok(k.ok);
  if (k.ok) {
    assert.deepEqual(k.widget.spec.dimensions, []);
    assert.deepEqual(k.widget.spec.metrics, ['clicks']);
  }

  // invented fields are rejected
  const invented = JSON.stringify({ title: 'x', kind: 'table', source: 'ga4', spec: { dimensions: ['madeUp'], metrics: ['sessions'], filters: [], limit: 5 } });
  const bad = await suggestWidget('x', { provider: fake(invented), sources });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'BAD_REPLY');

  // a chart with no breakdown cannot be drawn
  const flat = JSON.stringify({ title: 'x', kind: 'line', source: 'ga4', spec: { dimensions: [], metrics: ['sessions'], filters: [], limit: 5 } });
  assert.equal((await suggestWidget('x', { provider: fake(flat), sources })).ok, false);

  // a source the project has not connected is refused
  assert.equal((await suggestWidget('sessions by country', { provider: fake(good), sources: ['search_console'] })).ok, false);

  // the model may say it cannot
  const no = await suggestWidget('weather tomorrow', { provider: fake('{"error":"Not something your data can show."}'), sources });
  assert.equal(no.ok === false && no.code, 'NOT_POSSIBLE');

  // input checks and the prompt only lists allowed sources
  assert.equal((await suggestWidget('  ', { provider: fake(good), sources })).ok, false);
  assert.equal((await suggestWidget('x'.repeat(301), { provider: fake(good), sources })).ok, false);
  assert.ok(!buildSuggestPrompt(['ga4']).includes('Search Console metrics'));
  assert.ok(buildSuggestPrompt(['search_console']).includes('Search Console metrics'));
});

const table: DatasetSummary = { id: 'ds1', name: 'Sales "Q3"', rowCount: 3, createdBy: 'u', createdAt: 'x', updatedAt: 'x', columns: [{ key: 'c1', label: 'Region', type: 'text' }, { key: 'c2', label: 'Revenue', type: 'number' }] };

test('Sprint 37 — AI builder: Meta Ads, uploaded tables and the new chart kinds', async () => {
  const sources: SuggestSource[] = ['ga4', 'meta', 'data'];
  const run = (obj: unknown, srcs: SuggestSource[] = sources, datasets: DatasetSummary[] = [table]) => suggestWidget('x', { provider: fake(JSON.stringify(obj)), sources: srcs, datasets });

  const meta = await run({ title: 'Spend by campaign', kind: 'pie', source: 'meta', spec: { dimensions: ['campaign', 'age'], metrics: ['spend', 'clicks'], filters: [], limit: 6 } });
  assert.ok(meta.ok);
  if (meta.ok) { assert.deepEqual(meta.widget.spec.dimensions, ['campaign']); assert.deepEqual(meta.widget.spec.metrics, ['spend']); }

  const stacked = await run({ title: 'Clicks by platform and device', kind: 'stacked', source: 'meta', spec: { dimensions: ['platform', 'device', 'age'], metrics: ['clicks'], filters: [], limit: 40 } });
  assert.ok(stacked.ok);
  if (stacked.ok) assert.equal(stacked.widget.spec.dimensions.length, 2);
  // heat maps and stacked bars need two breakdowns
  assert.equal((await run({ title: 'x', kind: 'heatmap', source: 'meta', spec: { dimensions: ['age'], metrics: ['clicks'], filters: [], limit: 40 } })).ok, false);

  // a gauge is one number and keeps its goal; other kinds drop a stray target
  const gauge = await run({ title: 'Spend goal', kind: 'gauge', target: 5000, source: 'meta', spec: { dimensions: ['date'], metrics: ['spend'], filters: [], limit: 5 } });
  assert.ok(gauge.ok);
  if (gauge.ok) { assert.equal(gauge.widget.target, 5000); assert.deepEqual(gauge.widget.spec.dimensions, []); }
  const kpi = await run({ title: 'Spend', kind: 'kpi', target: 10, source: 'meta', spec: { dimensions: [], metrics: ['spend'], filters: [], limit: 1 } });
  assert.ok(kpi.ok && kpi.widget.target === undefined);

  // uploaded table: real table and real columns only
  const good = await run({ title: 'Revenue by region', kind: 'bar', source: 'data', spec: { datasetId: 'ds1', dimensions: ['c1'], metrics: ['c2'], aggregate: 'sum', filters: [], limit: 8 } });
  assert.ok(good.ok);
  const rows = await run({ title: 'Rows', kind: 'kpi', source: 'data', spec: { datasetId: 'ds1', dimensions: [], metrics: ['__rows'], aggregate: 'sum', filters: [], limit: 1 } });
  assert.ok(rows.ok);
  assert.equal((await run({ title: 'x', kind: 'bar', source: 'data', spec: { datasetId: 'other', dimensions: ['c1'], metrics: ['c2'], aggregate: 'sum', filters: [], limit: 8 } })).ok, false);
  assert.equal((await run({ title: 'x', kind: 'bar', source: 'data', spec: { datasetId: 'ds1', dimensions: ['c9'], metrics: ['c2'], aggregate: 'sum', filters: [], limit: 8 } })).ok, false);
  assert.equal((await run({ title: 'x', kind: 'bar', source: 'data', spec: { datasetId: 'ds1', dimensions: ['c1'], metrics: ['c1'], aggregate: 'sum', filters: [], limit: 8 } })).ok, false);
  // a source the project does not have is refused
  assert.equal((await run({ title: 'x', kind: 'bar', source: 'meta', spec: { dimensions: ['campaign'], metrics: ['spend'], filters: [], limit: 5 } }, ['ga4'])).ok, false);

  // the prompt lists only what exists, and cannot be broken out of by a table name
  const p = buildSuggestPrompt(['data'], [table]);
  assert.ok(p.includes('ds1') && p.includes('Region') && !p.includes('GA4 dimensions') && !p.includes('Meta Ads'));
  assert.ok(!p.includes('"Q3"'));
  assert.ok(buildSuggestPrompt(['meta']).includes('Amount spent'));
});

test('Sprint 15a-3 — suggest-widget route: uses one AI question, refunds failures, needs a connected source', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-15-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.GEMINI_API_KEY = 'AIzaTestKeyForWidgets';
  process.env.GEMINI_MODEL = 'gemini-test';
  delete process.env.GEMINI_API_KEY_2;
  clearAiRateLimit();

  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestConnectionStore(createInMemoryVaultStore());
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  resetVaultSingleton();
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const full = await fs.createProject(workspace.id, { name: 'Full', domain: 'a.com', ga4PropertyId: '1001', ga4PropertyName: 'GA', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  const bare = await fs.createProject(workspace.id, { name: 'Bare', domain: 'b.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async () => ({ uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  await getVault().saveConnection({ uid: 'uid_alice', provider: 'google', accountLabel: 'alice@acme.com', scopes: ['x'], refreshToken: 'rt', accessToken: 'tok', accessTokenExpiresAt: Date.now() + 3_600_000 });

  let reply = JSON.stringify({ title: 'Top pages', kind: 'table', source: 'ga4', spec: { dimensions: ['pagePath'], metrics: ['screenPageViews'], filters: [], limit: 10 } });
  const seen: string[] = [];
  setTestAiRequest(async (url, opts) => {
    seen.push(url.toString());
    assert.ok(!JSON.stringify(opts.body).includes('a.com'), 'no project data is sent');
    return { status: 200, headers: {}, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: 'STOP' }] }) };
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (body: unknown, project = full) =>
    fetch(`${baseUrl}/api/dashboards/suggest-widget`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-AdLens-Project': `${project.workspaceId}/${project.id}` } });
  const used = async () => (await fs.getUsage(workspace.id))?.aiQuestions ?? 0;

  try {
    assert.equal((await fetch(`${baseUrl}/api/dashboards/suggest-widget`, { method: 'POST' })).status, 401);
    const r = await call({ description: 'top pages' });
    assert.equal(r.status, 200);
    const j = (await r.json()) as any;
    assert.equal(j.widget.kind, 'table');
    assert.equal(j.quota.used, 1);
    assert.equal(await used(), 1);

    reply = 'sorry I cannot';
    const bad = await call({ description: 'asdf' });
    assert.equal(bad.status, 422);
    assert.equal(await used(), 1, 'a failed attempt is given back');

    assert.equal((await call({ description: '' })).status, 400);
    assert.equal((await call({ description: 'top pages' }, bare)).status, 409);
    assert.equal(await used(), 1);

    // a project with only an uploaded table can now use the builder too
    const up = await fetch(`${baseUrl}/api/datasets`, { method: 'POST', body: JSON.stringify({ name: 'Sales', csv: 'region,revenue\nNorth,10\nSouth,20\n' }), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-AdLens-Project': `${bare.workspaceId}/${bare.id}` } });
    assert.equal(up.status, 201);
    const ds = ((await up.json()) as any).dataset;
    reply = JSON.stringify({ title: 'Revenue by region', kind: 'pie', source: 'data', spec: { datasetId: ds.id, dimensions: [ds.columns[0].key], metrics: [ds.columns[1].key], aggregate: 'sum', filters: [], limit: 5 } });
    const dr = await call({ description: 'revenue by region' }, bare);
    assert.equal(dr.status, 200);
    assert.equal(((await dr.json()) as any).widget.source, 'data');
  } finally {
    server.close();
    setTestAiRequest(null);
  }
});
