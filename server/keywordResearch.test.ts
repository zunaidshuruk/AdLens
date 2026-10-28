import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { notConnectedProvider, setTestDataProvider } from './lib/dataProvider.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import type { FetchedPage } from './lib/seoFetch.js';
import { keywordIdeas } from './lib/seoKeywords.js';
import { termCounts, topicGap, visibleText } from './lib/seoTopics.js';
import { setSeoTestDeps } from './routes/seo.js';

test('visibleText drops scripts, styles and tags', () => {
  assert.equal(visibleText('<head><title>T</title></head><body><script>var a=1</script><style>p{}</style><p>Hello &amp; <b>world</b></p></body>'), 'Hello & world');
});

test('termCounts counts words and two-word phrases, skipping stop words', () => {
  const c = termCounts('Cloud hosting is the best cloud hosting for the web');
  assert.equal(c.get('cloud'), 2); assert.equal(c.get('cloud hosting'), 2); assert.equal(c.has('the'), false); assert.equal(c.has('hosting best'), false);
});

test('topicGap finds terms competitors share that you lack', () => {
  const yours = 'We sell leather wallets. Our wallets are handmade.';
  const a = 'Leather wallets guide. Wallet care tips: leather conditioner and leather conditioner use. Full grain leather is durable. Full grain leather lasts.';
  const b = 'Choosing a wallet: full grain leather beats bonded leather. Use leather conditioner twice a year. Leather conditioner matters.';
  const g = topicGap(yours, [a, b]);
  const missing = g.missing.map((m) => m.term);
  assert.ok(missing.includes('leather conditioner'));
  assert.ok(missing.includes('full grain'));
  assert.equal(missing.includes('conditioner'), false, 'single word hidden when its phrase is listed');
  assert.equal(g.competitorCount, 2);
  assert.ok(g.missing.every((m) => m.yourCount === 0 && m.competitors >= 2));
});

test('keywordIdeas now also probes prepositions and comparisons', async () => {
  const asked: string[] = [];
  const ideas = await keywordIdeas('vpn', async (q) => { asked.push(q); return q === 'vpn without' ? ['vpn without logs'] : q === 'vpn or' ? ['vpn or proxy'] : []; });
  assert.ok(ideas.find((i) => i.keyword === 'vpn without logs')?.group === 'prepositions');
  assert.ok(ideas.find((i) => i.keyword === 'vpn or proxy')?.group === 'comparisons');
  assert.equal(asked.filter((q) => q === 'vpn for').length, 1);
});

test('SEO API: keyword overview, topic gap, provider status and metrics hook', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const page = (t: string): string => `<html><head><title>x</title></head><body><p>${t}</p></body></html>`;
  setSeoTestDeps({
    fetcher: async (url): Promise<FetchedPage> => {
      const u = new URL(url);
      const base = { url, contentType: 'text/html', ms: 10, bytes: 1000 };
      if (u.hostname === 'mine.com') return { ...base, status: 200, text: page('We sell wallets and bags.') };
      if (u.hostname === 'rival1.com') return { ...base, status: 200, text: page('Leather conditioner guide. Leather conditioner tips. Full grain leather. Full grain leather care.') };
      if (u.hostname === 'rival2.com') return { ...base, status: 200, text: page('Use leather conditioner often. Leather conditioner is cheap. Full grain leather is best.') };
      return { ...base, status: 404, text: '' };
    },
    suggest: async (q) => (q === 'leather wallet' ? ['leather wallet for men', 'leather wallet brands'] : q === 'how leather wallet' ? ['how leather wallet is made'] : []),
  });
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'One', domain: 'mine.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async (token: string) => {
    if (token !== 'token-alice') throw new Error('bad');
    return { uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer token-alice', 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  try {
    const prov = (await (await call('GET', '/api/seo/provider')).json()) as any;
    assert.equal(prov.connected, false); assert.match(prov.note, /not connected/i);

    assert.equal((await call('POST', '/api/seo/keyword-overview', { keyword: 'x' })).status, 400);
    const ov = (await (await call('POST', '/api/seo/keyword-overview', { keyword: 'Leather  Wallet' })).json()) as any;
    assert.equal(ov.keyword, 'leather wallet'); assert.equal(ov.own, null); assert.equal(ov.metrics, null); assert.equal(ov.providerConnected, false);
    assert.ok(ov.related.includes('leather wallet for men')); assert.ok(ov.questions.includes('how leather wallet is made'));

    const kw = (await (await call('POST', '/api/seo/keywords', { seed: 'leather wallet' })).json()) as any;
    assert.ok(Array.isArray(kw.clusters) && kw.clusters.length > 0); assert.equal(kw.providerConnected, false); assert.equal(kw.ideas[0].metrics, null);

    setTestDataProvider({ ...notConnectedProvider, id: 't', name: 'Test', connected: true, keywordMetrics: async (ks) => ks.map((keyword) => ({ keyword, volume: 1200, cpc: 0.8, difficulty: 35, competition: 0.2 })) });
    const kw2 = (await (await call('POST', '/api/seo/keywords', { seed: 'leather wallet' })).json()) as any;
    assert.equal(kw2.providerConnected, true); assert.equal(kw2.ideas[0].metrics.volume, 1200);
    const ov2 = (await (await call('POST', '/api/seo/keyword-overview', { keyword: 'leather wallet' })).json()) as any;
    assert.equal(ov2.metrics.difficulty, 35);
    setTestDataProvider(null);

    assert.equal((await call('POST', '/api/seo/topic-gap', { yourUrl: 'mine.com', competitors: [] })).status, 400);
    assert.equal((await call('POST', '/api/seo/topic-gap', { yourUrl: 'http://localhost/x', competitors: ['rival1.com'] })).status, 422);
    assert.equal((await call('POST', '/api/seo/topic-gap', { yourUrl: 'mine.com', competitors: ['gone.com'] })).status, 422);
    const gap = (await (await call('POST', '/api/seo/topic-gap', { yourUrl: 'mine.com', competitors: ['rival1.com', 'rival2.com', 'gone.com'] })).json()) as any;
    assert.ok(gap.gap.missing.some((m: any) => m.term === 'leather conditioner'));
    assert.equal(gap.competitors.filter((c: any) => c.error).length, 1);
  } finally {
    server.close(); setSeoTestDeps(null); setTestDataProvider(null); setTestTokenVerifier(null); setTestFirestoreStore(null);
  }
});
