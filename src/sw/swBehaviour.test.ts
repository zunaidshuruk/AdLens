/**
 * Runs the REAL built service worker (scripts/build-sw.mjs → sw.js) inside a fake browser and checks what it
 * actually does with requests, caches and updates.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const ORIGIN = 'https://app.test';
const BUILD_ID = '202610251530-abc1234';
const CURRENT = `adlens-${BUILD_ID}`;
let swSource = '';
let outDir = '';

before(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adlens-sw-'));
  execFileSync(process.execPath, ['scripts/build-sw.mjs'], { env: { ...process.env, OUT_DIR: outDir, BUILD_ID }, stdio: 'pipe' });
  swSource = fs.readFileSync(path.join(outDir, 'sw.js'), 'utf8');
});

// ---- fake browser pieces ----------------------------------------------------------------------------------------

const abs = (k: unknown): string => new URL(typeof k === 'string' ? k : (k as { url: string }).url, ORIGIN).href;

class FakeCache {
  entries = new Map<string, Response>();
  puts: string[] = [];
  constructor(private fetchFn: (r: unknown) => Promise<Response>) {}
  async put(key: unknown, res: Response) { const k = abs(key); this.puts.push(k); this.entries.set(k, res.clone()); }
  async add(req: unknown) { const res = await this.fetchFn(req); if (!res.ok) throw new Error(`add failed ${res.status}`); await this.put(req, res); }
  async match(key: unknown) { return this.entries.get(abs(key))?.clone(); }
}
class FakeCaches {
  stores = new Map<string, FakeCache>();
  constructor(private fetchFn: (r: unknown) => Promise<Response>) {}
  async open(name: string) { if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.fetchFn)); return this.stores.get(name)!; }
  async keys() { return [...this.stores.keys()]; }
  async delete(name: string) { return this.stores.delete(name); }
  async match(key: unknown) { for (const c of this.stores.values()) { const r = await c.match(key); if (r) return r; } return undefined; }
  seed(name: string, entries: Record<string, Response>) { const c = new FakeCache(this.fetchFn); for (const [k, v] of Object.entries(entries)) c.entries.set(abs(k), v); this.stores.set(name, c); }
}

/** Same-origin responses are "basic" in a real browser, and their clones stay "basic". */
const makeBasic = (res: Response): Response => {
  Object.defineProperty(res, 'type', { value: 'basic' });
  const clone = res.clone.bind(res);
  res.clone = () => makeBasic(clone());
  return res;
};
const reply = (body: string, contentType: string, extra: Record<string, string> = {}) => makeBasic(new Response(body, { status: 200, headers: { 'content-type': contentType, ...extra } }));
const html = (b = 'APP SHELL') => reply(b, 'text/html; charset=utf-8');
const js = (b = 'console.log(1)') => reply(b, 'text/javascript');

interface Env {
  caches: FakeCaches;
  network: Record<string, () => Response | Promise<Response>>;
  offline: boolean;
  fetchLog: string[];
  skipWaiting: number;
  claim: number;
  handlers: Record<string, ((e: any) => void)[]>;
}

function boot(init: { offline?: boolean; network?: Env['network'] } = {}): Env {
  const env: Env = { caches: null as unknown as FakeCaches, network: init.network ?? {}, offline: init.offline ?? false, fetchLog: [], skipWaiting: 0, claim: 0, handlers: {} };
  const fetchFn = async (input: unknown): Promise<Response> => {
    const url = new URL(abs(input));
    env.fetchLog.push(url.pathname);
    if (env.offline) throw new TypeError('Failed to fetch');
    const handler = env.network[url.pathname];
    if (!handler) return new Response('not found', { status: 404 });
    return handler();
  };
  env.caches = new FakeCaches(fetchFn);
  class FakeRequest { url: string; method: string; mode = 'cors'; headers: Headers; constructor(input: string, init: { method?: string; headers?: Record<string, string> } = {}) { this.url = new URL(input, ORIGIN).href; this.method = init.method ?? 'GET'; this.headers = new Headers(init.headers); } }
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => { env.claim++; } },
    skipWaiting: async () => { env.skipWaiting++; },
    addEventListener: (t: string, l: (e: any) => void) => { (env.handlers[t] ??= []).push(l); },
  };
  vm.runInNewContext(swSource, { self, caches: env.caches, fetch: fetchFn, Request: FakeRequest, Response, URL, Headers, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms > 1000 ? 25 : ms), Promise, console });
  return env;
}

const flush = () => new Promise((r) => setTimeout(r, 40));
const page = (p: string, mode = 'navigate') => ({ url: `${ORIGIN}${p}`, method: 'GET', mode, headers: new Headers() });

async function run(env: Env, type: 'install' | 'activate') {
  const waits: Promise<unknown>[] = [];
  for (const h of env.handlers[type]) h({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}
async function dispatch(env: Env, request: unknown): Promise<{ handled: boolean; res?: Response }> {
  let out: Promise<Response> | Response | undefined;
  for (const h of env.handlers.fetch) h({ request, respondWith: (r: Promise<Response> | Response) => { out = r; }, waitUntil: () => undefined });
  if (out === undefined) return { handled: false };
  const res = await out;
  await flush(); // background cache writes
  return { handled: true, res };
}
const stored = (env: Env, name = CURRENT) => [...(env.caches.stores.get(name)?.entries.keys() ?? [])].map((k) => new URL(k).pathname + new URL(k).search);

// ---- tests ---------------------------------------------------------------------------------------------------------

test('the built worker is small, stamped with its build id, and free of eval', () => {
  assert.ok(swSource.length < 12_000, `size ${swSource.length}`);
  assert.ok(swSource.includes(BUILD_ID));
  assert.ok(!swSource.includes('__BUILD_ID__'));
  assert.ok(!/\beval\(|new Function\(/.test(swSource));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'version.json'), 'utf8')), { buildId: BUILD_ID });
});

test('the build refuses a malformed build id', () => {
  assert.throws(() => execFileSync(process.execPath, ['scripts/build-sw.mjs'], { env: { ...process.env, OUT_DIR: outDir, BUILD_ID: 'latest' }, stdio: 'pipe' }), /BUILD_ID must look like/);
  assert.throws(() => execFileSync(process.execPath, ['scripts/build-sw.mjs'], { env: { ...process.env, OUT_DIR: path.join(outDir, 'missing'), BUILD_ID }, stdio: 'pipe' }), /not found/);
});

test('install keeps the offline page and app shell; it does not take over without the user (no skipWaiting)', async () => {
  const env = boot({ network: { '/offline.html': () => html('OFFLINE'), '/': () => html('SHELL') } });
  await run(env, 'install');
  assert.deepEqual(stored(env).sort(), ['/', '/offline.html']);
  assert.equal(env.skipWaiting, 0);
});

test('install fails (so the old version stays) if the offline page cannot be fetched', async () => {
  const env = boot({ network: { '/': () => html('SHELL') } }); // /offline.html is a 404
  await assert.rejects(run(env, 'install'));
});

test('activate retires old caches, keeps the previous build and other sites, and claims open pages', async () => {
  const env = boot();
  env.caches.seed('adlens-202610010900-aaa1111', { '/x': js() });
  env.caches.seed('adlens-202610150900-bbb2222', { '/y': js() });
  env.caches.seed(CURRENT, {});
  env.caches.seed('some-other-app', { '/z': js() });
  await run(env, 'activate');
  assert.deepEqual([...env.caches.stores.keys()].sort(), ['adlens-202610150900-bbb2222', CURRENT, 'some-other-app'].sort());
  assert.equal(env.claim, 1);
});

test('USER DATA: API calls, sign-in traffic, writes, other sites and authorised requests are never intercepted or stored', async () => {
  const env = boot({ network: { '/api/ga4/overview': () => reply('{"secret":1}', 'application/json') } });
  await run(env, 'install').catch(() => undefined);
  const before = stored(env).length;
  const requests = [
    page('/api/ga4/overview?startDate=2026-10-01', 'cors'),
    page('/api/ai/ask', 'cors'),
    page('/__/auth/handler?state=s&code=c', 'navigate'),
    page('/__/firebase/init.json', 'cors'),
    { url: `${ORIGIN}/ga4`, method: 'POST', mode: 'cors', headers: new Headers() },
    { url: 'https://firestore.googleapis.com/v1/x', method: 'GET', mode: 'cors', headers: new Headers() },
    { url: `${ORIGIN}/assets/index-abcdef12.js`, method: 'GET', mode: 'cors', headers: new Headers({ authorization: 'Bearer abc' }) },
    page('/sw.js', 'cors'),
    page('/manifest.webmanifest', 'cors'),
    page('/robots.txt', 'cors'),
  ];
  for (const r of requests) assert.equal((await dispatch(env, r)).handled, false, r.url);
  assert.equal(stored(env).length, before);
  assert.ok(![...env.caches.stores.values()].some((c) => [...c.entries.keys()].some((k) => k.includes('/api/') || k.includes('/__/'))));
});

test('pages: network first, always stored under one key so addresses are never kept', async () => {
  const env = boot({ network: { '/ga4': () => html('PAGE') } });
  const { res } = await dispatch(env, page('/ga4?project=secret-123&range=7'));
  assert.equal(await res!.text(), 'PAGE');
  assert.deepEqual(stored(env), ['/']);
  assert.ok(!JSON.stringify(stored(env)).includes('secret-123'));
});

test('OFFLINE: a cached app opens; with no cache the branded offline page shows; with neither there is a plain message', async () => {
  const env = boot({ network: { '/': () => html('SHELL'), '/offline.html': () => html('OFFLINE PAGE') } });
  await run(env, 'install');
  env.offline = true;
  assert.equal(await (await dispatch(env, page('/ga4'))).res!.text(), 'SHELL');

  const noShell = boot({ network: { '/offline.html': () => html('OFFLINE PAGE') } });
  noShell.caches.seed(CURRENT, { '/offline.html': html('OFFLINE PAGE') });
  noShell.offline = true;
  assert.equal(await (await dispatch(noShell, page('/ga4'))).res!.text(), 'OFFLINE PAGE');

  const bare = boot();
  bare.offline = true;
  const res = (await dispatch(bare, page('/ga4'))).res!;
  assert.equal(res.status, 503);
});

test('ONE-TIME LINKS: password-reset and verification pages are never stored, and offline they show the offline page', async () => {
  const env = boot({ network: { '/auth/action': () => html('ACTION PAGE') } });
  env.caches.seed(CURRENT, { '/': html('SHELL'), '/offline.html': html('OFFLINE PAGE') });
  const putsBefore = env.caches.stores.get(CURRENT)!.puts.length;
  const online = await dispatch(env, page('/auth/action?mode=resetPassword&oobCode=SUPERSECRET'));
  assert.equal(await online.res!.text(), 'ACTION PAGE');
  assert.equal(env.caches.stores.get(CURRENT)!.puts.length, putsBefore);
  env.offline = true;
  assert.equal(await (await dispatch(env, page('/auth/action?mode=resetPassword&oobCode=SUPERSECRET'))).res!.text(), 'OFFLINE PAGE'); // not the shell
  assert.equal(await (await dispatch(env, page('/anything?code=abc&state=def'))).res!.text(), 'OFFLINE PAGE');
});

test('build files: fetched once, then served from the cache even offline', async () => {
  const env = boot({ network: { '/assets/index-abcdef12.js': () => js('APP CODE') } });
  assert.equal(await (await dispatch(env, page('/assets/index-abcdef12.js', 'cors'))).res!.text(), 'APP CODE');
  assert.deepEqual(stored(env), ['/assets/index-abcdef12.js']);
  const calls = env.fetchLog.length;
  env.offline = true;
  assert.equal(await (await dispatch(env, page('/assets/index-abcdef12.js', 'cors'))).res!.text(), 'APP CODE');
  assert.equal(env.fetchLog.length, calls); // no network used
});

test('files from the previous build still resolve after an update (open tabs keep working)', async () => {
  const env = boot();
  env.caches.seed('adlens-202610150900-bbb2222', { '/assets/chunk-abcdef12.js': js('OLD CHUNK') });
  env.caches.seed(CURRENT, {});
  env.offline = true;
  assert.equal(await (await dispatch(env, page('/assets/chunk-abcdef12.js', 'cors'))).res!.text(), 'OLD CHUNK');
});

test('the app page the server returns for a missing file is never stored as a script', async () => {
  const env = boot({ network: { '/assets/missing-abcdef12.js': () => html('APP SHELL, NOT A SCRIPT') } });
  const { res } = await dispatch(env, page('/assets/missing-abcdef12.js', 'cors'));
  assert.equal(res!.status, 200);
  assert.deepEqual(stored(env), []);
});

test('no-store and private responses, errors and non-basic responses are not stored', async () => {
  const noStore = reply('x', 'text/javascript', { 'cache-control': 'no-store' });
  const env = boot({ network: {
    '/assets/a-abcdef12.js': () => noStore,
    '/assets/b-abcdef12.js': () => reply('x', 'text/javascript', { 'cache-control': 'private' }),
    '/assets/c-abcdef12.js': () => new Response('boom', { status: 500, headers: { 'content-type': 'text/javascript' } }),
  } });
  for (const p of ['a', 'b', 'c']) await dispatch(env, page(`/assets/${p}-abcdef12.js`, 'cors'));
  assert.deepEqual(stored(env), []);
});

test('icons are served from the cache and refreshed in the background', async () => {
  const env = boot({ network: { '/icons/icon-192.png': () => reply('NEW PNG', 'image/png') } });
  env.caches.seed(CURRENT, { '/icons/icon-192.png': reply('OLD PNG', 'image/png') });
  const { res } = await dispatch(env, page('/icons/icon-192.png', 'cors'));
  assert.equal(await res!.text(), 'OLD PNG');
  assert.ok(env.fetchLog.includes('/icons/icon-192.png')); // refresh happened
  assert.equal(await (await env.caches.match('/icons/icon-192.png'))!.text(), 'NEW PNG');
});

test('SLOW NETWORK: a hanging page request falls back to the cached app after the timeout', async () => {
  const env = boot({ network: { '/ga4': () => new Promise<Response>(() => undefined) } });
  env.caches.seed(CURRENT, { '/': html('CACHED SHELL') });
  const t0 = Date.now();
  assert.equal(await (await dispatch(env, page('/ga4'))).res!.text(), 'CACHED SHELL');
  assert.ok(Date.now() - t0 < 1500);
});

test('a new version waits for the user: only the SKIP_WAITING message activates it', async () => {
  const env = boot();
  const fire = async (data: unknown) => { const w: Promise<unknown>[] = []; env.handlers.message.forEach((h) => h({ data, waitUntil: (p: Promise<unknown>) => w.push(p) })); await Promise.all(w); };
  await fire({ type: 'SOMETHING_ELSE' });
  await fire('SKIP_WAITING');
  await fire(null);
  assert.equal(env.skipWaiting, 0);
  await fire({ type: 'SKIP_WAITING' });
  assert.equal(env.skipWaiting, 1);
});
