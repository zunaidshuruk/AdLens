import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import type { FetchedPage } from './lib/seoFetch.js';
import { createInMemoryWatchStore, diffSnapshots, runWatches, setTestWatchStore, type Snapshot } from './lib/watches.js';
import { setWatchTestDeps } from './routes/watch.js';

const snap = (urls: [string, string?][], pages: Snapshot['pages'] = {}, o: Partial<Snapshot> = {}): Snapshot => ({ at: 'x', urls: urls.map(([u, m]) => ({ u, ...(m ? { m } : {}) })), truncated: false, found: true, pages, ...o });
const pg = (o: Partial<Snapshot['pages'][string]> = {}) => ({ title: 'T', description: 'D', h1: 'H', words: 500, hash: 'a', ...o });

test('diffSnapshots: new, removed, updated pages and key page edits', () => {
  const ev = diffSnapshots(
    snap([['https://c.com/a', '2026-01-01'], ['https://c.com/b']], { 'https://c.com/': pg() }),
    snap([['https://c.com/a', '2026-02-01'], ['https://c.com/c']], { 'https://c.com/': pg({ title: 'New title', hash: 'b', words: 700 }) }),
  );
  const types = ev.map((e) => e.type).sort();
  assert.deepEqual(types, ['content_changed', 'new_page', 'removed_page', 'title_changed', 'updated_page']);
});

test('diffSnapshots: truncated reads never invent removals, and floods are summarised', () => {
  const ev = diffSnapshots(snap([['https://c.com/a']], {}, { truncated: true }), snap([['https://c.com/b']]));
  assert.equal(ev.some((e) => e.type === 'removed_page'), false);
  const many = Array.from({ length: 30 }, (_, i) => [`https://c.com/n${i}`] as [string]);
  const flood = diffSnapshots(snap([]), snap(many));
  assert.equal(flood.filter((e) => e.type === 'new_page').length, 20);
  assert.ok(flood.some((e) => e.type === 'more' && e.detail.includes('10')));
  // Small wording noise in page text is ignored.
  assert.equal(diffSnapshots(snap([], { u: pg() }), snap([], { u: pg({ hash: 'z', words: 505 }) })).length, 0);
});

test('Competitor watch API and daily run', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  let urls = ['https://rival.com/', 'https://rival.com/a'];
  let title = 'Rival';
  const fetcher = async (url: string): Promise<FetchedPage> => {
    const u = new URL(url);
    const base = { url, contentType: 'text/html', ms: 5, bytes: 1000 };
    if (u.hostname !== 'rival.com') return { ...base, status: 0, text: '', error: 'down' };
    if (u.pathname === '/sitemap.xml') return { ...base, contentType: 'application/xml', status: 200, text: `<urlset>${urls.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>` };
    if (u.pathname === '/') return { ...base, status: 200, text: `<html><head><title>${title}</title></head><body><h1>Hi</h1><p>text</p></body></html>` };
    return { ...base, status: 404, text: '' };
  };
  setWatchTestDeps({ fetcher });
  setTestWatchStore(createInMemoryWatchStore());
  const docs = createInMemoryProjectDocsStore(); setTestProjectDocsStore(docs);
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Shop', domain: 'shop.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async () => ({ uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown) => fetch(`${baseUrl}/api/watch${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  try {
    assert.equal((await call('POST', '', { domain: 'x' })).status, 400);
    const created = await call('POST', '', { domain: 'https://www.rival.com/blog' });
    assert.equal(created.status, 201);
    const { watch } = await created.json() as { watch: { id: string; domain: string } };
    assert.equal(watch.domain, 'www.rival.com');
    assert.equal((await call('POST', '', { domain: 'www.rival.com' })).status, 409);
    // Use a watch on the exact host the fake serves.
    await call('DELETE', `/${watch.id}`);
    const c2 = await (await call('POST', '', { domain: 'rival.com' })).json() as { watch: { id: string } };
    const first = await (await call('POST', `/${c2.watch.id}/check`)).json() as { result: { baseline: boolean; urls: number } };
    assert.equal(first.result.baseline, true); assert.equal(first.result.urls, 2);
    urls = ['https://rival.com/', 'https://rival.com/b']; title = 'Rival 2';
    const second = await (await call('POST', `/${c2.watch.id}/check`)).json() as { result: { events: number } };
    assert.equal(second.result.events, 3);
    const list = await (await call('GET', '')).json() as { events: { type: string }[]; watches: unknown[]; limit: number };
    assert.deepEqual(list.events.map((e) => e.type).sort(), ['new_page', 'removed_page', 'title_changed']);
    assert.equal(list.watches.length, 1);
    // Daily run
    urls = ['https://rival.com/']; 
    const run = await runWatches({ store: (await import('./lib/watches.js')).getWatchStore(), docs, fetcher, now: Date.now, projectExists: async () => true });
    assert.equal(run.checked, 1); assert.equal(run.changes, 2 - 1);
    const gone = await runWatches({ store: (await import('./lib/watches.js')).getWatchStore(), docs, fetcher, now: Date.now, projectExists: async () => false });
    assert.equal(gone.removed, 1);
    assert.equal((await call('DELETE', `/${c2.watch.id}`)).status, 404);
  } finally { server.close(); setWatchTestDeps(null); setTestWatchStore(null); }
});
