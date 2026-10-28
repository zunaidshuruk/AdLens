import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import type { FetchedPage } from './lib/seoFetch.js';
import { detectTech } from './lib/seoDomain.js';
import { collectSitemap, parseRobots, parseSitemapXml } from './lib/seoSitemap.js';
import { setSeoTestDeps } from './routes/seo.js';

const URLSET = `<?xml version="1.0"?><urlset><url><loc>https://shop.com/</loc></url><url><loc>https://shop.com/blog/a</loc><lastmod>2026-01-02</lastmod></url><url><loc>https://shop.com/blog/b</loc><lastmod>2026-03-04</lastmod></url></urlset>`;
const INDEX = `<sitemapindex><sitemap><loc>https://shop.com/s1.xml</loc></sitemap></sitemapindex>`;
const HOME = `<html lang="en"><head><title>Shop</title><meta name="description" content="Leather goods"><script src="https://cdn.shopify.com/x.js"></script><script src="https://www.googletagmanager.com/gtag/js"></script></head><body><h1>Leather wallets</h1><p>leather wallets leather wallets for everyone</p><a href="https://twitter.com/shop">t</a></body></html>`;

const fetcher = async (url: string): Promise<FetchedPage> => {
  const u = new URL(url);
  const base = { url, contentType: 'text/html', ms: 5, bytes: 2048 };
  if (u.hostname !== 'shop.com') return { ...base, status: 0, text: '', error: 'down' };
  if (u.pathname === '/robots.txt') return { ...base, contentType: 'text/plain', status: 200, text: 'User-agent: GPTBot\nDisallow: /\n\nSitemap: https://shop.com/index.xml' };
  if (u.pathname === '/index.xml') return { ...base, contentType: 'application/xml', status: 200, text: INDEX };
  if (u.pathname === '/s1.xml') return { ...base, contentType: 'application/xml', status: 200, text: URLSET };
  if (u.pathname === '/') return { ...base, status: 200, text: HOME };
  return { ...base, status: 404, text: '' };
};

test('parseSitemapXml reads urlsets and indexes', () => {
  assert.equal(parseSitemapXml(URLSET).kind, 'urlset');
  assert.equal(parseSitemapXml(URLSET).entries.length, 3);
  assert.equal(parseSitemapXml(INDEX).kind, 'index');
  assert.equal(parseSitemapXml('<html>nope</html>').kind, 'unknown');
});

test('parseRobots finds sitemaps and blocked AI bots', () => {
  const r = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: GPTBot\nDisallow: /\nSitemap: https://a.com/s.xml');
  assert.deepEqual(r.sitemaps, ['https://a.com/s.xml']);
  assert.equal(r.blocksAll, false);
  assert.ok(r.blockedBots.includes('GPTBot'));
  assert.equal(parseRobots('User-agent: *\nDisallow: /').blocksAll, true);
});

test('collectSitemap follows an index and detectTech spots platforms', async () => {
  const r = await collectSitemap(['https://shop.com/index.xml'], fetcher);
  assert.equal(r.found, true); assert.equal(r.entries.length, 3); assert.equal(r.files, 2);
  assert.ok(detectTech(HOME).length >= 1);
});

test('Domain overview API', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  setSeoTestDeps({ fetcher });
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Shop', domain: 'shop.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async () => ({ uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (body: unknown) => fetch(`${baseUrl}/api/seo/domain-overview`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  try {
    assert.equal((await call({ domain: 'x' })).status, 400);
    const ok = await call({ domain: 'https://shop.com/some/page' });
    assert.equal(ok.status, 200);
    const { overview } = await ok.json() as { overview: { domain: string; title: string; sitemap: { urls: number; latestChange: string }; robots: { blockedBots: string[] }; social: { name: string }[]; trackers: string[] } };
    assert.equal(overview.domain, 'shop.com'); assert.equal(overview.title, 'Shop');
    assert.equal(overview.sitemap.urls, 3); assert.equal(overview.sitemap.latestChange, '2026-03-04');
    assert.ok(overview.robots.blockedBots.includes('GPTBot'));
    assert.ok(overview.social.some((s) => s.name.toLowerCase().includes('twitter') || s.name.toLowerCase() === 'x'));
    assert.equal((await call({ domain: 'down.example.org' })).status, 502);
  } finally { server.close(); setSeoTestDeps(null); }
});
