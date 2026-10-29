import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryGbpStore, fetchPerformance, fetchReviews, performanceCsv, reviewDocId, sealRefresh, setTestGbpStore, GbpError, type GbpDeps } from './lib/gbp.js';
import { runGbp } from './lib/gbpRunner.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { setGbpTestDeps } from './routes/gbp.js';

const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });

interface Fake { deps: GbpDeps; calls: { url: string; method: string; body?: string }[]; reviews: object[]; replied: string[]; posts: string[]; mode: 'ok' | 'forbidden' }
function fakeGoogle(): Fake {
  const f: Fake = { calls: [], reviews: [], replied: [], posts: [], mode: 'ok', deps: { now: () => Date.parse('2026-11-02T10:00:00Z'), fetchFn: async () => json(500, {}) } };
  f.deps.fetchFn = async (url, init) => {
    f.calls.push({ url, method: init?.method ?? 'GET', ...(init?.body ? { body: init.body } : {}) });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: 'at', refresh_token: 'rt', id_token: `x.${Buffer.from(JSON.stringify({ email: 'owner@biz.com' })).toString('base64url')}.y` });
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return json(200, {});
    if (f.mode === 'forbidden') return json(403, { error: { status: 'PERMISSION_DENIED', message: 'quota 0 not approved' } });
    if (url.includes('/v1/accounts?')) return json(200, { accounts: [{ name: 'accounts/111' }] });
    if (url.includes('/locations?readMask')) return json(200, { locations: [{ name: 'locations/222', title: "Ann's Cafe", websiteUri: 'https://ann.com', storefrontAddress: { addressLines: ['1 Road'], locality: 'Dhaka' } }] });
    if (url.includes('fetchMultiDailyMetricsTimeSeries')) return json(200, { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 30 }, value: '4' }] } }, { dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 30 }, value: '100' }, { date: { year: 2026, month: 10, day: 31 } }] } }] }] });
    if (url.includes('/reviews/') && url.endsWith('/reply')) { f.replied.push(JSON.parse(init!.body!).comment); return json(200, {}); }
    if (url.includes('/reviews?')) return json(200, { reviews: f.reviews, averageRating: 4.2, totalReviewCount: f.reviews.length });
    if (url.endsWith('/localPosts')) { f.posts.push(JSON.parse(init!.body!).summary); return json(200, {}); }
    return json(404, {});
  };
  return f;
}
const rv = (id: string, stars: string, comment = 'x', reply?: string) => ({ reviewId: id, reviewer: { displayName: 'Rahim' }, starRating: stars, comment, createTime: '2026-11-01T00:00:00Z', ...(reply ? { reviewReply: { comment: reply } } : {}) });

test('Google calls: reviews, performance, forbidden mapped to a clear message', async () => {
  const g = fakeGoogle();
  g.reviews = [rv('r1', 'FIVE'), rv('r2', 'TWO', 'bad', 'sorry'), { reviewId: 'r3', starRating: 'BOGUS' }];
  const r = await fetchReviews(g.deps, 't', 'accounts/111', 'locations/222');
  assert.equal(r.reviews.length, 2); assert.equal(r.reviews[1]!.stars, 2); assert.equal(r.reviews[1]!.reply, 'sorry'); assert.equal(r.averageRating, 4.2);
  const p = await fetchPerformance(g.deps, 't', 'locations/222', 7);
  assert.equal(p.totals.calls, 4); assert.equal(p.totals.views, 100); assert.equal(p.days.length, 7);
  assert.match(performanceCsv(p), /^date,views,calls,website_clicks,direction_requests\n/);
  await assert.rejects(fetchReviews(g.deps, 't', 'accounts/../x', 'locations/222'), GbpError);
  g.mode = 'forbidden';
  await assert.rejects(fetchReviews(g.deps, 't', 'accounts/111', 'locations/222'), (e: GbpError) => e.code === 'GBP_NOT_APPROVED' && /not approved/.test(e.message));
});

test('Business Profile API, replies need approval, and the daily job', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-46-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const g = fakeGoogle();
  const gstore = createInMemoryGbpStore(); setTestGbpStore(gstore);
  const docs = createInMemoryProjectDocsStore(); setTestProjectDocsStore(docs);
  const drafts: string[] = [];
  setGbpTestDeps({ gbp: g.deps, draft: async (_s, prompt) => { drafts.push(prompt); return '  Thank you Rahim, we are sorry and would like to make it right.  '; } });
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Shop', domain: 'shop.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async () => ({ uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown) => fetch(`${baseUrl}/api/gbp${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  try {
    const st0 = await (await call('GET', '')).json() as { connected: boolean; googleConfigured: boolean };
    assert.equal(st0.connected, false); assert.equal(st0.googleConfigured, true);
    // Before connecting: clear errors, nothing called on Google.
    assert.equal((await call('GET', '/reviews')).status, 404);
    // Start returns a Google address asking only for the business scope (plus identity), and sets the state cookie.
    const start = await call('POST', '/start');
    const { url } = await start.json() as { url: string };
    assert.match(url, /business\.manage/); assert.match(url, /redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fgbp%2Fcallback/);
    assert.ok(start.headers.get('set-cookie')?.includes('adlens_gbp_state'));
    // A callback without the right cookie is refused.
    const bad = await fetch(`${baseUrl}/api/gbp/callback?code=c&state=nope`, { redirect: 'manual' });
    assert.match(bad.headers.get('location') ?? '', /gbp=invalid_state/);
    // Simulate a finished connection.
    await gstore.put({ id: p.workspaceId, sealedRefresh: sealRefresh('rt', 'uid_alice', p.workspaceId), googleEmail: 'owner@biz.com', connectedBy: 'uid_alice', connectedByEmail: 'alice@acme.com', connectedAt: 'x', locations: [], links: {}, lastError: null, lastRunAt: null });
    assert.equal((await call('GET', '/reviews')).status, 404); // not linked yet
    const loc = await (await call('POST', '/locations/refresh')).json() as { locations: { name: string; account: string }[] };
    assert.equal(loc.locations[0]!.name, 'locations/222');
    assert.equal((await call('PUT', '/link', { location: 'locations/999' })).status, 404);
    assert.equal((await call('PUT', '/link', { location: 'locations/222' })).status, 200);
    const perf = await (await call('GET', '/performance?days=28')).json() as { totals: { calls: number } };
    assert.equal(perf.totals.calls, 4);
    const saved = await (await call('POST', '/performance/save-table')).json() as { rows: number };
    assert.equal(saved.rows, 90);

    // First sync is a baseline: old reviews are not alerted.
    g.reviews = [rv('r1', 'FIVE', 'great'), rv('r2', 'ONE', 'terrible food')];
    const first = await (await call('GET', '/reviews')).json() as { items: { id: string; stars: number; alerted: boolean; status: string }[] };
    assert.equal(first.items.length, 2); assert.ok(first.items.every((i) => i.alerted));
    const low = first.items.find((i) => i.stars === 1)!;
    // Draft: written to the review, nothing sent to Google.
    const dr = await (await call('POST', `/reviews/${low.id}/draft`)).json() as { draft: string };
    assert.match(dr.draft, /^Thank you Rahim/); assert.match(drafts[0]!, /terrible food/); assert.equal(g.replied.length, 0);
    assert.equal((await call('POST', `/reviews/${low.id}/approve`, {})).status, 400);
    // Only an explicit approve with the exact text posts a reply.
    assert.equal((await call('POST', `/reviews/${low.id}/approve`, { text: 'We are sorry. Please call us.' })).status, 200);
    assert.deepEqual(g.replied, ['We are sorry. Please call us.']);
    assert.equal((await call('POST', `/reviews/${low.id}/approve`, { text: 'again' })).status, 409);
    assert.equal(reviewDocId('r2'), low.id);

    // Posts: future ones wait for the daily job.
    assert.equal((await call('POST', '/posts', { text: 'Hi', publishOn: '2026-11-05' })).status, 400);
    assert.equal((await call('POST', '/posts', { text: 'Now open late on Fridays', url: 'http://x.com' })).status, 400);
    const sch = await (await call('POST', '/posts', { text: 'Diwali sweets are in', publishOn: '2026-11-03' })).json() as { id: string; status: string };
    assert.equal(sch.status, 'scheduled'); assert.equal(g.posts.length, 0);
    const now = await (await call('POST', '/posts', { text: 'Open late tonight' })).json() as { status: string };
    assert.equal(now.status, 'published'); assert.deepEqual(g.posts, ['Open late tonight']);
    assert.equal((await call('DELETE', `/posts/${sch.id}`)).status, 200);
    const again = await (await call('POST', '/posts', { text: 'Diwali sweets are in', publishOn: '2026-11-03' })).json() as { id: string };

    // Daily job: a new 2-star review raises one alert email, a new 5-star does not, and due posts go out (the next day).
    g.reviews = [rv('r1', 'FIVE', 'great'), rv('r2', 'ONE', 'terrible food', 'We are sorry'), rv('r4', 'TWO', 'cold coffee'), rv('r5', 'FIVE', 'lovely')];
    const sent: { to: string; subject: string; text: string }[] = [];
    g.deps.now = () => Date.parse('2026-11-03T08:00:00Z');
    const out = await runGbp({ store: gstore, docs, gbp: g.deps, cred: { clientId: 'a', clientSecret: 'b' }, projectInfo: async () => ({ name: 'Shop' }), send: async (m) => { sent.push(m); return { ok: true }; }, appUrl: 'http://localhost:3000' });
    assert.equal(out.checked, 1); assert.equal(out.newLowStar, 1); assert.equal(out.emailed, 1); assert.equal(out.posted, 1); assert.equal(out.failed, 0);
    assert.equal(sent[0]!.to, 'alice@acme.com'); assert.match(sent[0]!.text, /cold coffee/); assert.doesNotMatch(sent[0]!.text, /lovely/);
    assert.ok(g.posts.includes('Diwali sweets are in'));
    assert.equal((await docs.get(p.workspaceId, p.id, 'gbpPosts', again.id))?.status, 'published');
    // Running again does not alert twice.
    const out2 = await runGbp({ store: gstore, docs, gbp: g.deps, cred: { clientId: 'a', clientSecret: 'b' }, projectInfo: async () => ({ name: 'Shop' }), send: async (m) => { sent.push(m); return { ok: true }; }, appUrl: 'x' });
    assert.equal(out2.newLowStar, 0); assert.equal(sent.length, 1);

    // Google refusing (not approved) is reported plainly.
    g.mode = 'forbidden';
    const refused = await call('GET', '/reviews');
    assert.equal(refused.status, 403);
    assert.match(((await refused.json()) as { error: { message: string } }).error.message, /not approved/);

    assert.equal((await call('POST', '/disconnect')).status, 200);
    assert.ok(g.calls.some((c) => c.url.includes('/revoke')));
    assert.equal(((await (await call('GET', '')).json()) as { connected: boolean }).connected, false);
  } finally { server.close(); setGbpTestDeps(null); setTestGbpStore(null); }
});
