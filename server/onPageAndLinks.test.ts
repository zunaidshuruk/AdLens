import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import type { FetchedPage } from './lib/seoFetch.js';
import { countPhrase, onPageReport, readability } from './lib/seoOnPage.js';
import { setLinksTestDeps } from './routes/links.js';
import { setSeoTestDeps } from './routes/seo.js';

const GOOD = `<!doctype html><html lang="en"><head><title>Leather wallet guide: how to choose</title><meta name="description" content="Choosing a leather wallet? Read our guide to grain, stitching and care in plain words."><meta name="viewport" content="width=device-width"></head>
<body><h1>The leather wallet guide</h1><p>A leather wallet lasts for years when you pick the right hide. This guide explains grain, stitching and care in simple steps so you can choose with confidence and avoid common mistakes that waste money on poor quality.</p>
<h2>Why a leather wallet beats nylon</h2><p>${'Good hides age well and gain character. '.repeat(40)}</p><img src="a.jpg" alt="brown leather wallet open" width="10" height="10"></body></html>`;

test('countPhrase matches whole words only', () => {
  assert.equal(countPhrase('Leather wallet, leather wallets and a leather wallet.', 'leather wallet'), 2);
  assert.equal(countPhrase('', 'x'), 0);
});

test('readability: short plain text is easy, no data is unknown', () => {
  assert.equal(readability('Short.').level, 'unknown');
  const easy = readability(Array.from({ length: 10 }, () => 'The cat sat on the mat today. It was a good day for all of us here.').join(' '));
  assert.equal(easy.level, 'easy'); assert.ok(easy.flesch! > 60);
});

test('onPageReport: good page scores high, bare page scores low, related words need rivals', () => {
  const good = onPageReport(GOOD, 'https://shop.com/leather-wallet-guide', 'leather wallet');
  assert.equal(good.placement.title && good.placement.h1 && good.placement.description && good.placement.url && good.placement.firstParagraph, true);
  assert.ok(good.placement.h2 === 1 && good.placement.imageAlt === 1);
  assert.ok(good.score >= 80, `score ${good.score}`);
  assert.equal(good.related, null);
  const bare = onPageReport('<html><head><title>Home</title></head><body><h1>Welcome</h1><p>Hi there.</p></body></html>', 'https://shop.com/', 'leather wallet');
  assert.ok(bare.score < 30, `score ${bare.score}`);
  assert.ok(bare.checks.find((c) => c.id === 'title')!.status === 'bad');
  const rich = onPageReport(GOOD, 'https://shop.com/x', 'leather wallet', ['full grain leather full grain leather vegetable tanned vegetable tanned', 'vegetable tanned full grain leather']);
  assert.ok(rich.related!.missing.some((m) => m.term === 'full grain'));
});

test('On-page and link-building APIs', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const html = (b: string) => `<html><head><title>t</title></head><body>${b}</body></html>`;
  const fetcher = async (url: string): Promise<FetchedPage> => {
    const u = new URL(url);
    const base = { url, contentType: 'text/html', ms: 10, bytes: 1000 };
    if (u.hostname === 'shop.com') return { ...base, status: 200, text: GOOD };
    if (u.hostname === 'blog.example.org') return { ...base, status: 200, text: html('<p>Great tips, see <a href="https://www.shop.com/guide">this wallet shop</a>.</p>') };
    if (u.hostname === 'nolink.example.org') return { ...base, status: 200, text: html('<p>Nothing here</p><a href="https://other.com">x</a>') };
    return { ...base, status: 404, text: '' };
  };
  setSeoTestDeps({ fetcher }); setLinksTestDeps({ fetcher });
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Shop', domain: 'shop.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  setTestTokenVerifier(async (token: string) => {
    const who = token === 'token-alice' ? 'alice' : token === 'token-bob' ? 'bob' : null;
    if (!who) throw new Error('bad');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown, token = 'token-alice') =>
    fetch(`${baseUrl}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  try {
    assert.equal((await call('POST', '/api/seo/onpage', { url: 'shop.com', keyword: 'x' })).status, 400);
    assert.equal((await call('POST', '/api/seo/onpage', { url: 'http://localhost/x', keyword: 'leather wallet' })).status, 400);
    assert.equal((await call('POST', '/api/seo/onpage', { url: 'gone.com', keyword: 'leather wallet' })).status, 422);
    const ok = (await (await call('POST', '/api/seo/onpage', { url: 'shop.com', keyword: 'leather wallet', competitors: ['blog.example.org', 'gone.com'] })).json()) as any;
    assert.ok(ok.report.score > 50); assert.deepEqual(ok.competitorErrors, ['gone.com']); assert.ok(ok.report.related);

    assert.equal((await call('GET', '/api/links/prospects', undefined, 'token-bob')).status, 404);
    assert.equal((await call('POST', '/api/links/prospects', { domains: [] })).status, 400);
    const add = await call('POST', '/api/links/prospects', { domains: ['https://www.blog.example.org/post', 'nolink.example.org', 'blog.example.org', 'shop.com', 'junk'] });
    assert.equal(add.status, 201);
    const added = (await add.json()) as any;
    assert.equal(added.added, 2); assert.equal(added.skipped, 3);
    const list = (await (await call('GET', '/api/links/prospects')).json()) as any;
    assert.equal(list.prospects.length, 2); assert.ok(list.limit >= 20);
    const blog = list.prospects.find((x: any) => x.domain === 'blog.example.org');
    const nolink = list.prospects.find((x: any) => x.domain === 'nolink.example.org');

    assert.equal((await call('POST', `/api/links/prospects/${blog.id}/check`)).status, 409); // no page address yet
    assert.equal((await call('PUT', `/api/links/prospects/${blog.id}`, { pageUrl: 'https://blog.example.org/post', status: 'contacted', notes: 'Emailed Sam' })).status, 200);
    const chk = (await (await call('POST', `/api/links/prospects/${blog.id}/check`)).json()) as any;
    assert.equal(chk.prospect.linkLive, true); assert.equal(chk.links[0].href, 'https://www.shop.com/guide');
    await call('PUT', `/api/links/prospects/${nolink.id}`, { pageUrl: 'https://nolink.example.org/' });
    assert.equal(((await (await call('POST', `/api/links/prospects/${nolink.id}/check`)).json()) as any).prospect.linkLive, false);
    // Changing one field must leave the others alone.
    const only = (await (await call('PUT', `/api/links/prospects/${blog.id}`, { status: 'replied' })).json()) as any;
    assert.equal(only.prospect.status, 'replied'); assert.equal(only.prospect.notes, 'Emailed Sam'); assert.equal(only.prospect.pageUrl, 'https://blog.example.org/post');
    assert.equal((await call('PUT', `/api/links/prospects/${blog.id}`, { status: 'bogus' })).status, 400);
    assert.equal((await call('DELETE', `/api/links/prospects/${blog.id}`)).status, 200);
    assert.equal((await call('DELETE', `/api/links/prospects/${blog.id}`)).status, 404);
  } finally {
    server.close(); setSeoTestDeps(null); setLinksTestDeps(null); setTestProjectDocsStore(null); setTestTokenVerifier(null); setTestFirestoreStore(null);
  }
});
