import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import type { FetchedPage } from './lib/seoFetch.js';
import { setSeoTestDeps } from './routes/seo.js';

const html = (t: string, links = '') => `<html lang="en"><head><title>${t}</title><meta name="viewport" content="width=device-width"></head><body><h1>${t}</h1>${links}<p>${'word '.repeat(320)}</p></body></html>`;

test('SEO API: page check, own-site audit only, keywords, opportunities need Search Console', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const asked: string[] = [];
  setSeoTestDeps({
    fetcher: async (url): Promise<FetchedPage> => {
      asked.push(url);
      const u = new URL(url);
      const base = { url, contentType: 'text/html', ms: 30, bytes: 3000 };
      if (u.hostname === 'redirect.example.com') return { ...base, status: 301, text: '', redirectTo: 'https://shop.example.com/' };
      if (u.pathname === '/robots.txt' || u.pathname === '/sitemap.xml') return { ...base, status: 404, text: '' };
      if (u.pathname === '/') return { ...base, status: 200, text: html('The shop home page with products', '<a href="/a">A</a>') };
      if (u.pathname === '/a') return { ...base, status: 200, text: html('Product page number one in the shop') };
      return { ...base, status: 404, text: '' };
    },
    suggest: async (q) => (q === 'leather' ? ['leather wallet', 'leather jacket'] : []),
  });
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p1 = await fs.createProject(workspace.id, { name: 'One', domain: 'shop.example.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  setTestTokenVerifier(async (token: string) => {
    const who = token === 'token-alice' ? 'alice' : token === 'token-bob' ? 'bob' : null;
    if (!who) throw new Error('bad');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, body?: unknown, token = 'token-alice') =>
    fetch(`${baseUrl}${path}`, { method: 'POST', body: JSON.stringify(body ?? {}), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${p1.workspaceId}/${p1.id}` } });
  try {
    assert.equal((await fetch(`${baseUrl}/api/seo/page`, { method: 'POST' })).status, 401);
    assert.equal((await call('/api/seo/page', { url: 'x' })).status, 400);
    assert.equal((await call('/api/seo/page', { url: 'http://localhost/admin' })).status, 400);
    assert.equal((await call('/api/seo/page', { url: 'shop.example.com' }, 'token-bob')).status, 404);

    const ok = await call('/api/seo/page', { url: 'redirect.example.com' });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as any;
    assert.equal(body.url, 'https://shop.example.com/');
    assert.equal(body.redirected, true);
    assert.equal(body.facts.title, 'The shop home page with products');
    assert.ok(body.score > 0 && Array.isArray(body.issues));
    assert.equal(asked.every((u) => u.startsWith('https://')), true);

    // audits run only on the project's own site
    const other = await call('/api/seo/crawl', { url: 'competitor.com' });
    assert.equal(other.status, 403);
    const crawl = await call('/api/seo/crawl', {});
    assert.equal(crawl.status, 200);
    const c = (await crawl.json()) as any;
    assert.equal(c.report.crawled, 2);
    assert.ok(c.maxPages >= 25);
    assert.equal((await call('/api/seo/crawl', { url: 'www.shop.example.com' })).status, 200);

    const kw = (await (await call('/api/seo/keywords', { seed: 'leather' })).json()) as any;
    assert.deepEqual(kw.ideas.map((i: any) => i.keyword).sort(), ['leather jacket', 'leather wallet']);
    assert.equal((await call('/api/seo/keywords', { seed: 'x' })).status, 400);

    const opp = await call('/api/seo/opportunities', {});
    assert.equal(opp.status, 409);
  } finally {
    server.close();
    setSeoTestDeps(null);
    setTestTokenVerifier(null as never);
    setTestFirestoreStore(null as never);
  }
});
