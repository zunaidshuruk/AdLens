import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import type { FetchedPage } from './lib/seoFetch.js';
import { countRawElements, parsePageSpeed, rate, runPageSpeed, SpeedError } from './lib/seoSpeed.js';
import { setSeoTestDeps } from './routes/seo.js';

const psiJson = (over: Record<string, any> = {}) => ({
  id: 'https://shop.example.com/',
  loadingExperience: { overall_category: 'AVERAGE', metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: 'AVERAGE' }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 4, category: 'FAST' }, INTERACTION_TO_NEXT_PAINT: { percentile: 640, category: 'SLOW' } } },
  lighthouseResult: {
    finalDisplayedUrl: 'https://shop.example.com/',
    categories: { performance: { score: 0.54 }, seo: { score: 0.82, auditRefs: [{ id: 'document-title' }, { id: 'meta-description' }, { id: 'image-alt' }, { id: 'robots-txt' }, { id: 'structured-data' }] }, accessibility: { score: 0.9 }, 'best-practices': { score: 1 } },
    audits: {
      'largest-contentful-paint': { numericValue: 4400 }, 'cumulative-layout-shift': { numericValue: 0.04 }, 'total-blocking-time': { numericValue: 350 }, 'first-contentful-paint': { numericValue: 1500 }, 'speed-index': { numericValue: 3000 }, interactive: { numericValue: 6000 },
      'total-byte-weight': { numericValue: 2_097_152 }, 'dom-size': { numericValue: 2400 }, 'bootup-time': { numericValue: 1234.6 }, 'network-requests': { details: { items: new Array(64).fill({}) } },
      'render-blocking-resources': { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', details: { type: 'opportunity', overallSavingsMs: 900 } },
      'unused-javascript': { id: 'unused-javascript', title: 'Reduce unused [JavaScript](https://x.dev/y)', details: { type: 'opportunity', overallSavingsMs: 300, overallSavingsBytes: 204_800 } },
      'tiny-thing': { id: 'tiny-thing', title: 'Tiny', details: { type: 'opportunity', overallSavingsMs: 20 } },
      'document-title': { id: 'document-title', title: 'Document has a <title> element', description: 'The title gives screen reader users an overview.', score: 1, scoreDisplayMode: 'binary' },
      'meta-description': { id: 'meta-description', title: 'Document does not have a meta description', description: 'Meta descriptions may be included in search results.', score: 0, scoreDisplayMode: 'binary' },
      'image-alt': { id: 'image-alt', title: 'Image elements do not have [alt] attributes', description: 'Informative elements should aim for short, descriptive alternate text.', score: 0, scoreDisplayMode: 'binary' },
      'robots-txt': { id: 'robots-txt', title: 'robots.txt is valid', score: null, scoreDisplayMode: 'notApplicable' },
      'structured-data': { id: 'structured-data', title: 'Structured data is valid', score: null, scoreDisplayMode: 'manual' },
    },
    ...over,
  },
});

test('Sprint 38 — speed test: ratings, plain labels and what real visitors saw', () => {
  assert.equal(rate('lcp', 2000), 'good'); assert.equal(rate('lcp', 3000), 'needs'); assert.equal(rate('lcp', 5000), 'poor');
  assert.equal(rate('cls', 0.3), 'poor'); assert.equal(rate('inp', 150), 'good');
  const r = parsePageSpeed(psiJson(), 'mobile', undefined, new Date('2026-10-28T00:00:00Z'));
  assert.deepEqual(r.scores, { performance: 54, seo: 82, accessibility: 90, bestPractices: 100 });
  const lcp = r.lab.find((m) => m.key === 'lcp')!;
  assert.equal(lcp.display, '4.4 s'); assert.equal(lcp.rating, 'poor');
  assert.equal(r.lab.find((m) => m.key === 'cls')!.display, '0.04');
  assert.equal(r.lab.find((m) => m.key === 'tbt')!.rating, 'needs');
  assert.equal(r.field.available, true); assert.equal(r.field.scope, 'page'); assert.equal(r.field.overall, 'needs');
  assert.equal(r.field.metrics.find((m) => m.key === 'cls')!.display, '0.04', 'Google reports layout shift times 100');
  assert.equal(r.field.metrics.find((m) => m.key === 'inp')!.rating, 'poor');
  assert.deepEqual(r.opportunities.map((o) => o.id), ['render-blocking-resources', 'unused-javascript']);
  assert.equal(r.opportunities[1].title, 'Reduce unused JavaScript', 'links are stripped');
  assert.equal(r.opportunities[1].savingsKb, 200);
  assert.deepEqual(r.seoFailed.map((x) => x.id), ['meta-description', 'image-alt'], 'only real failures, not n/a or manual checks');
  assert.deepEqual(r.facts, { pageWeightKb: 2048, requests: 64, domElements: 2400, scriptTimeMs: 1235 });

  // no visitor data: falls back to site-wide data, then to none
  const originOnly = parsePageSpeed(psiJson({}), 'mobile');
  assert.equal(originOnly.field.scope, 'page');
  const j = psiJson() as any; j.originLoadingExperience = j.loadingExperience; j.loadingExperience = { metrics: {} };
  assert.equal(parsePageSpeed(j, 'desktop').field.scope, 'site');
  const none = psiJson() as any; none.loadingExperience = { metrics: {} };
  const n = parsePageSpeed(none, 'mobile');
  assert.equal(n.field.available, false); assert.equal(n.field.scope, 'none');
});

test('Sprint 38 — speed test: how much of the page only exists after JavaScript runs', () => {
  const html = '<html><head><title>x</title></head><body><div id="root"></div><script src="a.js"></script></body></html>';
  assert.ok(countRawElements(html) >= 6);
  const heavy = parsePageSpeed(psiJson(), 'mobile', { elements: countRawElements(html), title: 'x', description: null });
  assert.equal(heavy.javascript.level, 'heavy');
  assert.match(heavy.javascript.notes[0], /built by JavaScript/);
  const injected = parsePageSpeed(psiJson(), 'mobile', { elements: 2000, title: null, description: null });
  assert.equal(injected.javascript.level, 'some');
  assert.ok(injected.javascript.notes.some((x) => /title is added by JavaScript/.test(x)));
  assert.ok(!injected.javascript.notes.some((x) => /meta description is added/.test(x)), 'description check failed in the browser too, so it is not "added by JavaScript"');
  const fine = parsePageSpeed(psiJson(), 'mobile', { elements: 2300, title: 'x', description: 'y' });
  assert.equal(fine.javascript.level, 'none');
  assert.match(fine.javascript.notes[0], /first HTML/);
});

test('Sprint 38 — speed test: Google errors become plain messages, and the key never shows', async () => {
  const ok = JSON.stringify(psiJson());
  const run = (status: number, text: string, key?: string) => runPageSpeed('https://a.com/', 'mobile', { request: async () => ({ status, text }), apiKey: key });
  assert.ok((await run(200, ok)).lighthouseResult);
  await assert.rejects(run(429, '{}'), (e: SpeedError) => e.status === 429 && /PAGESPEED_API_KEY/.test(e.message));
  await assert.rejects(run(429, '{}', 'SECRETKEY'), (e: SpeedError) => e.status === 429 && !/SECRETKEY|PAGESPEED_API_KEY/.test(e.message));
  await assert.rejects(run(400, JSON.stringify({ error: { message: 'FAILED_DOCUMENT_REQUEST' } })), (e: SpeedError) => e.code === 'SPEED_PAGE_UNREACHABLE');
  await assert.rejects(run(403, '{}', 'SECRETKEY'), (e: SpeedError) => e.code === 'SPEED_KEY_REJECTED' && !e.message.includes('SECRETKEY'));
  await assert.rejects(run(200, '{"no":"result"}'), (e: SpeedError) => e.code === 'SPEED_FAILED');
  await assert.rejects(runPageSpeed('https://a.com/', 'mobile', { request: async () => { throw new Error('boom SECRETKEY'); }, apiKey: 'SECRETKEY' }), (e: SpeedError) => e.code === 'SPEED_TIMEOUT' && !e.message.includes('SECRETKEY'));
  let asked = '';
  await runPageSpeed('https://a.com/x y', 'desktop', { request: async (u) => { asked = u; return { status: 200, text: ok }; }, apiKey: 'K1' });
  assert.match(asked, /strategy=desktop/); assert.match(asked, /category=seo/); assert.match(asked, /key=K1/);
});

test('Sprint 38 — speed test route: checks the address, limits use, combines Google and the first HTML', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-38-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  delete process.env.PAGESPEED_API_KEY;
  let psiUrl = '';
  let psiStatus = 200;
  setSeoTestDeps({
    fetcher: async (url): Promise<FetchedPage> => ({ url, status: 200, contentType: 'text/html', ms: 30, bytes: 500, text: '<html><head><title>Shop</title></head><body><div id="app"></div></body></html>' }),
    psi: async (u) => { psiUrl = u; return { status: psiStatus, text: JSON.stringify(psiJson()) }; },
  });
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'One', domain: 'shop.example.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async () => ({ uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (body: unknown) => fetch(`${base}/api/seo/speed`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  try {
    assert.equal((await fetch(`${base}/api/seo/speed`, { method: 'POST' })).status, 401);
    assert.equal((await call({ url: 'x' })).status, 400);
    assert.equal((await call({ url: 'http://localhost/admin' })).status, 400, 'private addresses are refused');
    assert.equal((await call({ url: 'https://shop.example.com', strategy: 'tablet' })).status, 400);
    const r = await call({ url: 'shop.example.com', strategy: 'desktop' });
    assert.equal(r.status, 200);
    const { report } = (await r.json()) as any;
    assert.equal(report.strategy, 'desktop');
    assert.equal(report.scores.performance, 54);
    assert.equal(report.javascript.level, 'heavy', 'tiny first HTML versus a big finished page');
    assert.match(psiUrl, /strategy=desktop/);
    assert.ok(!psiUrl.includes('key='), 'no key set, none sent');
    process.env.PAGESPEED_API_KEY = 'KEY123';
    await call({ url: 'shop.example.com' });
    assert.match(psiUrl, /key=KEY123/);
    psiStatus = 429;
    const busy = await call({ url: 'shop.example.com' });
    assert.equal(busy.status, 429);
    assert.ok(!JSON.stringify(await busy.json()).includes('KEY123'));
  } finally {
    server.close();
    delete process.env.PAGESPEED_API_KEY;
    setSeoTestDeps(null);
    setTestTokenVerifier(null as never);
    setTestFirestoreStore(null as never);
  }
});
