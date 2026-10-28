import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { runRankTracking } from './lib/rankRunner.js';
import {
  clusterKeywords, createInMemoryRankTrackingStore, fetchRankDays, joinTraffic, mergeDays, parseKeywords, setTestRankTrackingStore, summariseRank, trackingId, type RankDay, type ScQuery,
} from './lib/rankTracking.js';
import { setRankTestDeps } from './routes/rank.js';

const NOW = Date.parse('2026-10-28T12:00:00Z'); // last complete day = 2026-10-25
const day = (n: number) => new Date(Date.parse('2026-10-25') - n * 86_400_000).toISOString().slice(0, 10);

test('parseKeywords: splits, lowercases, removes repeats and junk', () => {
  assert.deepEqual(parseKeywords('Web Hosting, web  hosting\nVPS;a\n\ncloud server'), ['web hosting', 'vps', 'cloud server']);
  assert.equal(parseKeywords('x'.repeat(200)).length, 0);
  assert.equal(parseKeywords(Array.from({ length: 700 }, (_, i) => `kw ${i}`).join('\n')).length, 500);
});

test('fetchRankDays keeps only tracked phrases and pages through results', async () => {
  const calls: number[] = [];
  const query: ScQuery = async (p) => {
    calls.push(p.startRow);
    if (p.startRow === 0) return { rows: Array.from({ length: 25_000 }, (_, i) => ({ keys: ['2026-10-20', `other ${i}`], clicks: 0, impressions: 1, position: 50 })) };
    return { rows: [{ keys: ['2026-10-20', 'Web  Hosting'], clicks: 3, impressions: 40, position: 4.236 }, { keys: ['2026-10-21', 'nope'], clicks: 1, impressions: 1, position: 1 }] };
  };
  const days = await fetchRankDays(query, ['web hosting'], '2026-10-01', '2026-10-25');
  assert.deepEqual(calls, [0, 25_000]);
  assert.deepEqual(days, [{ id: '2026-10-20', rows: [{ k: 'web hosting', p: 4.24, c: 3, i: 40 }] }]);
});

test('mergeDays replaces same days and drops very old ones', () => {
  const old: RankDay[] = [{ id: '2024-01-01', rows: [] }, { id: '2026-10-24', rows: [{ k: 'a', p: 9, c: 0, i: 1 }] }];
  const merged = mergeDays(old, [{ id: '2026-10-24', rows: [{ k: 'a', p: 3, c: 1, i: 5 }] }], '2026-10-25');
  assert.deepEqual(merged.map((d) => d.id), ['2026-10-24']);
  assert.equal(merged[0]!.rows[0]!.p, 3);
});

test('summariseRank: positions, movement, buckets, visibility, winners and losers', () => {
  const days: RankDay[] = [];
  for (let n = 13; n >= 0; n--) {
    const recent = n <= 6;
    days.push({ id: day(n), rows: [
      { k: 'rising', p: recent ? 4 : 12, c: 2, i: 100 },
      { k: 'falling', p: recent ? 15 : 3, c: 1, i: 100 },
      { k: 'steady', p: 1, c: 9, i: 100 },
    ] });
  }
  const s = summariseRank(days, ['rising', 'falling', 'steady', 'missing'], day(0));
  const get = (k: string) => s.keywords.find((x) => x.keyword === k)!;
  assert.equal(get('rising').position, 4); assert.equal(get('rising').previous, 12); assert.equal(get('rising').change, 8);
  assert.equal(get('falling').change, -12);
  assert.equal(get('missing').position, null);
  assert.deepEqual(s.buckets, { top3: 1, top10: 1, top20: 1, top50: 0, below50: 0, notRanking: 1 });
  assert.equal(s.rankingCount, 3);
  assert.equal(s.winners[0]!.keyword, 'rising');
  assert.equal(s.losers[0]!.keyword, 'falling');
  assert.ok(s.visibility > 0 && s.visibility <= 100);
  assert.ok(s.visibilityPrevious !== null);
  assert.equal(s.series.length, 14);
  assert.equal(s.volatility.label, 'calm');
});

test('summariseRank on no data is safe', () => {
  const s = summariseRank([], [], '2026-10-25');
  assert.equal(s.trackedCount, 0); assert.equal(s.visibility, 0); assert.equal(s.volatility.label, 'unknown');
});

test('clusterKeywords groups by the most shared word', () => {
  const c = clusterKeywords(['best web hosting', 'cheap web hosting', 'web hosting india', 'vps price', 'vps setup', 'lonely thing']);
  const names = c.map((x) => x.name);
  assert.ok(names.includes('vps')); assert.ok(names.includes('Other'));
  assert.deepEqual(c.find((x) => x.name === 'Other')!.keywords, ['lonely thing']);
  assert.equal(c.find((x) => x.name === 'vps')!.keywords.length, 2);
});

test('joinTraffic matches pages by path and counts clicks Google hides', () => {
  const rows = joinTraffic(
    [{ page: '/blog/a?utm=1', sessions: 50 }, { page: '/blog/a', sessions: 10 }, { page: '/only-ga', sessions: 5 }],
    [{ page: 'https://x.com/blog/a/', clicks: 100, impressions: 1000, position: 5 }],
    [{ page: 'https://x.com/blog/a/', query: 'big phrase', clicks: 40 }, { page: 'https://x.com/blog/a/', query: 'small', clicks: 10 }],
  );
  const a = rows.find((r) => r.page === '/blog/a')!;
  assert.equal(a.clicks, 100); assert.equal(a.topQuery, 'big phrase'); assert.equal(a.hiddenClicks, 50); assert.equal(a.position, 5);
  assert.equal(rows.find((r) => r.page === '/only-ga')!.sessions, 5);
});

test('Rank API: lists, limits, permissions, start tracking, history; daily run', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  const docs = createInMemoryProjectDocsStore(); setTestProjectDocsStore(docs);
  const store = createInMemoryRankTrackingStore(); setTestRankTrackingStore(store);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const withSc = await fs.createProject(workspace.id, { name: 'One', domain: 'a.com', searchConsoleSite: 'sc-domain:a.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  const noSc = await fs.createProject(workspace.id, { name: 'Two', domain: 'b.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  setTestTokenVerifier(async (token: string) => {
    const who = token === 'token-alice' ? 'alice' : token === 'token-bob' ? 'bob' : null;
    if (!who) throw new Error('bad');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  let scCalls = 0;
  setRankTestDeps({
    now: () => NOW,
    query: async () => async (p) => {
      scCalls++;
      return { rows: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ keys: [day(n), 'web hosting'], clicks: 2, impressions: 50, position: 6 })) };
    },
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown, project = withSc, token = 'token-alice') =>
    fetch(`${baseUrl}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${project.workspaceId}/${project.id}` } });
  try {
    assert.equal((await fetch(`${baseUrl}/api/rank/lists`)).status, 401);
    assert.equal((await call('GET', '/api/rank/lists', undefined, withSc, 'token-bob')).status, 404);

    const bad = await call('POST', '/api/rank/lists', { name: '' });
    assert.equal(bad.status, 400);
    const created = await call('POST', '/api/rank/lists', { name: 'Core', text: 'Web Hosting\nvps\nweb hosting' });
    assert.equal(created.status, 201);
    const list = ((await created.json()) as any).list;
    assert.deepEqual(list.keywords, ['web hosting', 'vps']);

    const got = (await (await call('GET', '/api/rank/lists')).json()) as any;
    assert.equal(got.lists.length, 1); assert.equal(got.trackedCount, 2); assert.equal(got.tracking, null); assert.ok(got.limits.tracked >= 10);

    const upd = await call('PUT', `/api/rank/lists/${list.id}`, { name: 'Core 2', keywords: ['web hosting', 'vps', 'cloud'] });
    assert.equal(upd.status, 200);
    assert.equal(((await upd.json()) as any).list.keywords.length, 3);
    assert.equal((await call('PUT', '/api/rank/lists/nope', { name: 'x' })).status, 404);

    // plan limit on tracked keywords
    const many = await call('POST', '/api/rank/lists', { name: 'Huge', keywords: Array.from({ length: 150 }, (_, i) => `phrase ${i}`) });
    assert.equal(many.status, 409);
    assert.equal(((await many.json()) as any).error.code, 'LIMIT_REACHED');
    const untracked = await call('POST', '/api/rank/lists', { name: 'Ideas', keywords: Array.from({ length: 150 }, (_, i) => `idea ${i}`), tracked: false });
    assert.equal(untracked.status, 201);

    const cl = (await (await call('POST', '/api/rank/cluster', { text: 'a hosting\nb hosting\nc vps\nd vps' })).json()) as any;
    assert.equal(cl.clusters.length, 2);

    // start tracking
    assert.equal((await call('POST', '/api/rank/tracking/start', {}, noSc)).status, 409);
    const started = await call('POST', '/api/rank/tracking/start', {});
    assert.equal(started.status, 200);
    assert.equal(((await started.json()) as any).days, 7);
    assert.equal((await store.get(trackingId(workspace.id, withSc.id)))?.ownerUid, 'uid_alice');
    const hist = (await (await call('GET', '/api/rank/history?days=28')).json()) as any;
    assert.equal(hist.daysStored, 7);
    const kw = hist.summary.keywords.find((k: any) => k.keyword === 'web hosting');
    assert.equal(kw.position, 6);
    assert.equal(hist.tracking.enabled, true);
    assert.equal((await call('POST', '/api/rank/refresh', {})).status, 200);

    // traffic needs GA4
    assert.equal((await call('POST', '/api/rank/traffic', {})).status, 409);

    // daily run: refreshes, then pauses when the owner has left, removes when the project is gone
    const deps = {
      store, docs, now: () => NOW,
      isMember: async (_w: string, uid: string) => uid === 'uid_alice',
      getProject: async () => ({ searchConsoleSite: 'sc-domain:a.com' }),
      queryFor: async () => async () => { scCalls++; return { rows: [{ keys: [day(0), 'web hosting'], clicks: 1, impressions: 10, position: 5 }] }; },
    };
    const before = scCalls;
    assert.deepEqual(await runRankTracking(deps), { refreshed: 1, paused: 0, removed: 0, failed: 0 });
    assert.ok(scCalls > before);
    assert.deepEqual(await runRankTracking({ ...deps, isMember: async () => false }), { refreshed: 0, paused: 1, removed: 0, failed: 0 });
    const paused = await store.get(trackingId(workspace.id, withSc.id));
    assert.equal(paused?.enabled, false); assert.ok(paused?.pausedReason);
    assert.deepEqual(await runRankTracking(deps), { refreshed: 0, paused: 0, removed: 0, failed: 0 });
    await store.put({ ...paused!, enabled: true });
    assert.deepEqual(await runRankTracking({ ...deps, getProject: async () => null }), { refreshed: 0, paused: 0, removed: 1, failed: 0 });
    assert.equal(await store.get(trackingId(workspace.id, withSc.id)), null);

    assert.equal((await call('DELETE', `/api/rank/lists/${list.id}`)).status, 200);
    assert.equal((await call('DELETE', `/api/rank/lists/${list.id}`)).status, 404);
  } finally {
    server.close();
    setRankTestDeps(null); setTestRankTrackingStore(null); setTestProjectDocsStore(null); setTestTokenVerifier(null); setTestFirestoreStore(null);
  }
});
