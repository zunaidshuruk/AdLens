import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRateLimit } from './lib/rateLimiter.js';
import { createMemoryStore, createUpstashStore, withFallback, type KeyValueStore } from './lib/sharedStore.js';

test('memory store: set, get, expiry and delete', async () => {
  let t = 1000;
  const s = createMemoryStore(() => t);
  await s.set('a', '1', 100);
  assert.equal(await s.get('a'), '1');
  t += 101;
  assert.equal(await s.get('a'), null);
  await s.set('b', '2', 1000);
  await s.del('b');
  assert.equal(await s.get('b'), null);
});

test('memory store: counters keep their original expiry and restart after it', async () => {
  let t = 0;
  const s = createMemoryStore(() => t);
  assert.equal(await s.incr('c', 100), 1);
  t = 90;
  assert.equal(await s.incr('c', 100), 2);
  t = 101;
  assert.equal(await s.incr('c', 100), 1, 'the window did not extend itself');
});

test('memory store: stays under its size cap', async () => {
  const s = createMemoryStore(() => 0, 10);
  for (let i = 0; i < 50; i++) await s.set(`k${i}`, 'v', 1000);
  assert.ok(s.size() <= 10);
  assert.equal(await s.get('k49'), 'v');
});

test('Upstash store sends the right commands and reads results', async () => {
  const seen: unknown[] = [];
  const fake = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    seen.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const cmds = JSON.parse(init.body) as string[][];
    return new Response(JSON.stringify(cmds.map((c) => ({ result: c[0] === 'GET' ? 'hello' : c[0] === 'INCR' ? 3 : 'OK' }))), { status: 200 });
  }) as unknown as typeof fetch;
  const s = createUpstashStore({ url: 'https://x.upstash.io/', token: 'tok', fetchImpl: fake });
  assert.equal(await s.get('k'), 'hello');
  await s.set('k', 'v', 5000);
  assert.equal(await s.incr('n', 60000), 3);
  assert.deepEqual(seen[1], { url: 'https://x.upstash.io/pipeline', body: [['SET', 'k', 'v', 'PX', 5000]], auth: 'Bearer tok' });
  assert.deepEqual((seen[2] as { body: unknown }).body, [['INCR', 'n'], ['PEXPIRE', 'n', 60000, 'NX']]);
});

test('Upstash errors become memory fallbacks, not failures', async () => {
  const broken = createUpstashStore({ url: 'https://x', token: 't', fetchImpl: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch });
  let errors = 0;
  const s = withFallback(broken, createMemoryStore(), () => (errors += 1));
  await s.set('a', '1', 1000);
  assert.equal(await s.get('a'), '1');
  assert.equal(await s.incr('n', 1000), 1);
  assert.ok(errors >= 3);
});

test('rate limiter counts per key and window, and says when to retry', async () => {
  const store: KeyValueStore = createMemoryStore(() => 0);
  const now = () => 30_000;
  const r = [];
  for (let i = 0; i < 4; i++) r.push(await checkRateLimit('mcp', 'cred1', 3, 60_000, { store, now }));
  assert.deepEqual(r.map((x) => x.allowed), [true, true, true, false]);
  assert.equal(r[3].remaining, 0);
  assert.equal(r[3].retryAfterSeconds, 30);
  assert.equal((await checkRateLimit('mcp', 'cred2', 3, 60_000, { store, now })).allowed, true, 'other keys are separate');
});
