import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { setTestDataProvider, type DataProvider, type MapsPlace } from './lib/dataProvider.js';
import { dataForSeoProvider, customProvider, customConfigSchema } from './lib/dataProviders.js';
import { competitorAccumulator, costFor, findOwn, gridPoints, summarize, zoomFor } from './lib/localSeo.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { setLocalTestDeps } from './routes/local.js';

const place = (name: string, rank: number, o: Partial<MapsPlace> = {}): MapsPlace => ({ name, placeId: `id-${name}`, rank, rating: 4.5, reviews: 100, category: 'Cafe', address: 'x', website: null, ...o });

test('gridPoints: centred, evenly spaced, north on top', () => {
  const g = gridPoints(23.78, 90.4, 3, 3);
  assert.equal(g.length, 9);
  const centre = g.find((p) => p.row === 1 && p.col === 1)!;
  assert.equal(centre.lat, 23.78); assert.equal(centre.lng, 90.4);
  assert.ok(g.find((p) => p.row === 0 && p.col === 1)!.lat > 23.78);
  assert.ok(g.find((p) => p.row === 1 && p.col === 2)!.lng > 90.4);
  const edge = g.find((p) => p.row === 0 && p.col === 1)!;
  assert.ok(Math.abs((edge.lat - 23.78) * 111.32 - 3) < 0.01);
  assert.equal(gridPoints(0, 0, 5, 7).length, 49);
});

test('zoom, cost, own-listing match and summary', () => {
  assert.ok(zoomFor(1, 5) > zoomFor(10, 3));
  assert.equal(costFor(250), 0.5);
  const places = [place('Joe Pizza', 1), place("Ann's Cafe Dhaka", 2)];
  assert.equal(findOwn(places, { name: 'Anns Cafe', matchName: '', placeId: '' })?.name, "Ann's Cafe Dhaka");
  assert.equal(findOwn(places, { name: 'Zed', matchName: '', placeId: '' }), null);
  assert.equal(findOwn(places, { name: 'x', matchName: 'nothing', placeId: 'id-Joe Pizza' })?.name, 'Joe Pizza');
  const s = summarize([
    { row: 0, col: 0, lat: 0, lng: 0, ranks: [1, null] }, { row: 0, col: 1, lat: 0, lng: 0, ranks: [5, 2] },
  ], ['a', 'b']);
  assert.equal(s.keywords[0]!.avgRank, 3); assert.equal(s.keywords[0]!.top3Share, 50); assert.equal(s.keywords[1]!.foundShare, 50);
  assert.equal(s.foundShare, 75); assert.equal(s.top3Share, 50);
  const acc = competitorAccumulator({ name: 'Mine', matchName: '', placeId: '' });
  acc.add([place('Mine', 1), place('Rival', 2)], null); acc.add([place('Rival', 4, { reviews: 120 })], null);
  assert.equal(acc.top(5).length, 1); assert.equal(acc.top(5)[0]!.appearances, 2); assert.equal(acc.top(5)[0]!.avgRank, 3); assert.equal(acc.top(5)[0]!.reviews, 120);
  assert.equal(acc.own()?.name, 'Mine');
});

test('provider adapters read Maps results', async () => {
  const dfs = dataForSeoProvider({ login: 'a@b.c', password: 'pw' }, {
    now: Date.now,
    request: async (_u, o) => { assert.match(String(o.body), /location_coordinate/); return { status: 200, headers: {}, text: JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [{ title: 'Cafe A', rank_group: 1, place_id: 'p1', rating: { value: 4.7, votes_count: 88 }, category: 'Cafe', address: '1 Road', domain: 'a.com' }, { type: 'x' }] }] }] }) } as never; },
  });
  const r = await dfs.mapsSearch!({ keyword: 'coffee', lat: 1, lng: 2, zoom: 14 });
  assert.equal(r.length, 1); assert.equal(r[0]!.rating, 4.7); assert.equal(r[0]!.reviews, 88); assert.equal(r[0]!.placeId, 'p1');
  const cfg = customConfigSchema.parse({ name: 'Mine', auth: { type: 'none' }, mapsSearch: { method: 'GET', url: 'https://api.example.com/m?q={{keyword}}&lat={{lat}}&lng={{lng}}', itemsPath: 'data', fields: { name: 'n', position: 'p', rating: 'r', reviews: 'c', category: '', address: '', website: '', placeId: 'id' } } });
  let seen = '';
  const cp = customProvider(cfg, {}, { now: Date.now, request: async (u) => { seen = u.toString(); return { status: 200, headers: {}, text: JSON.stringify({ data: [{ n: 'Z', p: 3, r: 4, c: 9, id: 'zz' }] }) } as never; } });
  const cr = await cp.mapsSearch!({ keyword: 'tea shop', lat: 10.5, lng: 20.25, zoom: 14 });
  assert.match(seen, /q=tea%20shop/); assert.match(seen, /lat=10.5/);
  assert.equal(cr[0]!.rank, 3); assert.equal(cr[0]!.placeId, 'zz');
});

test('Local rank tracker API', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-46-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  let calls = 0; let broken = false;
  const stand: DataProvider = {
    id: 'x', name: 'Stand-in', connected: true,
    async keywordMetrics() { return []; }, async competitorKeywords() { return []; }, async backlinks() { return null; },
    async mapsSearch(q) { calls++; if (broken) throw new Error('boom'); return q.lat > 23.78 ? [place('Rival', 1), place('Anns Cafe', 4)] : [place('Anns Cafe', 2), place('Rival', 3)]; },
  };
  setTestDataProvider(stand);
  setLocalTestDeps({ request: async () => ({ status: 200, headers: {}, text: JSON.stringify([{ lat: '23.78', lon: '90.4', display_name: 'Dhaka' }]) }) as never });
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Shop', domain: 'shop.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async () => ({ uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown) => fetch(`${baseUrl}/api/local${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  try {
    assert.equal((await call('POST', '/business', { name: 'x' })).status, 400);
    const geo = await (await call('POST', '/geocode', { query: 'Dhaka' })).json() as { lat: number };
    assert.equal(geo.lat, 23.78);
    const created = await (await call('POST', '/business', { name: 'Anns Cafe', lat: 23.78, lng: 90.4, radiusKm: 2, gridSize: 3, keywords: ['Coffee', 'coffee', 'tea shop'] })).json() as { business: { id: string; keywords: string[] } };
    assert.deepEqual(created.business.keywords, ['coffee', 'tea shop']);
    const id = created.business.id;
    const est = await (await call('GET', `/business/${id}/estimate`)).json() as { lookups: number };
    assert.equal(est.lookups, 18);
    assert.equal((await call('POST', `/business/${id}/scan`, {})).status, 400);
    assert.equal((await call('POST', `/business/${id}/scan`, { confirmedLookups: 5 })).status, 400);
    assert.equal((await call('GET', `/business/${id}/review-link`)).status, 404);
    const r = await call('POST', `/business/${id}/scan`, { confirmedLookups: 18 });
    assert.equal(r.status, 200);
    const { scan } = await r.json() as { scan: { points: { ranks: (number | null)[] }[]; summary: { foundShare: number }; competitors: { name: string }[]; own: { reviews: number } } };
    assert.equal(calls, 18); assert.equal(scan.points.length, 9); assert.equal(scan.summary.foundShare, 100);
    assert.equal(scan.competitors[0]!.name, 'Rival'); assert.equal(scan.own.reviews, 100);
    const rl = await (await call('GET', `/business/${id}/review-link`)).json() as { url: string; qr: string };
    assert.match(rl.url, /writereview\?placeid=id-Anns%20Cafe/); assert.match(rl.qr, /^data:image\/png/);
    const list = await (await call('GET', '')).json() as { businesses: { lastScan: { summary: { avgRank: number } } | null; scanCount: number }[]; providerConnected: boolean };
    assert.equal(list.providerConnected, true); assert.equal(list.businesses[0]!.scanCount, 1); assert.ok(list.businesses[0]!.lastScan);
    const hist = await (await call('GET', `/business/${id}/scans`)).json() as { history: unknown[]; latest: { id: string } };
    assert.equal(hist.history.length, 1);
    assert.equal((await call('GET', `/business/${id}/scans/${hist.latest.id}`)).status, 200);
    // A provider that refuses everything stops early and saves nothing.
    broken = true; calls = 0;
    const bad = await call('POST', `/business/${id}/scan`, { confirmedLookups: 18 });
    assert.equal(bad.status, 502); assert.ok(calls <= 8);
    assert.equal(((await (await call('GET', `/business/${id}/scans`)).json()) as { history: unknown[] }).history.length, 1);
    assert.equal((await call('DELETE', `/business/${id}`)).status, 200);
    assert.equal((await call('GET', `/business/${id}/scans`)).status, 404);
  } finally { server.close(); setTestDataProvider(null); setLocalTestDeps(null); }
});
