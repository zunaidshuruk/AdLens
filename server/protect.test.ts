import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createLimiter, ipKey, resetProtectionState } from './middleware/protect.js';

test('Flood protection — limiter counts per key inside the window and starts again after it', () => {
  const l = createLimiter();
  for (let i = 0; i < 3; i++) assert.equal(l.hit('a', 3, 1000, 0).allowed, true);
  const over = l.hit('a', 3, 1000, 10);
  assert.equal(over.allowed, false);
  assert.ok(over.retryAfterSeconds >= 1);
  assert.equal(l.hit('b', 3, 1000, 10).allowed, true, 'other keys are not affected');
  assert.equal(l.hit('a', 3, 1000, 1001).allowed, true, 'new window');
});

test('Flood protection — the limiter cannot grow without bound', () => {
  const l = createLimiter(50);
  for (let i = 0; i < 500; i++) l.hit(`k${i}`, 5, 60_000, 0);
  assert.ok(l.size() <= 50);
});

test('Flood protection — IPv6 addresses are grouped by network, IPv4-mapped ones read as IPv4', () => {
  assert.equal(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), ipKey('2001:db8:1:2:1:2:3:4'));
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
  assert.equal(ipKey('::ffff:10.0.0.1'), '10.0.0.1');
});

test('Flood protection — one address hammering the API gets 429 with Retry-After, health checks stay open', async () => {
  resetProtectionState();
  process.env.RATE_LIMIT_IP_PER_MIN = '20';
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const codes: number[] = [];
    for (let i = 0; i < 30; i++) codes.push((await fetch(`${base}/api/me`)).status);
    assert.ok(codes.slice(0, 20).every((c) => c === 401), 'under the limit it reaches the sign-in check');
    const blocked = await fetch(`${base}/api/me`);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    assert.equal(((await blocked.json()) as { error: { code: string } }).error.code, 'RATE_LIMIT_EXCEEDED');
    assert.equal((await fetch(`${base}/api/health`)).status, 200, 'health is never refused');
  } finally { delete process.env.RATE_LIMIT_IP_PER_MIN; resetProtectionState(); server.close(); }
});

test('Flood protection — repeated bad sign-in tokens trigger the address brake', async () => {
  resetProtectionState();
  process.env.RATE_LIMIT_BAD_TOKEN_PER_MIN = '5';
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const seen: number[] = [];
    for (let i = 0; i < 9; i++) seen.push((await fetch(`${base}/api/me`, { headers: { Authorization: 'Bearer junk' } })).status);
    assert.ok(seen.includes(429), `got ${seen.join(',')}`);
  } finally { delete process.env.RATE_LIMIT_BAD_TOKEN_PER_MIN; resetProtectionState(); server.close(); }
});

test('Flood protection — when too many requests are in progress, new ones get 503 SERVER_BUSY', async () => {
  resetProtectionState();
  process.env.MAX_IN_FLIGHT_REQUESTS = '1';
  const server = app.listen(0);
  try {
    // a request that stalls: body never finishes, so the handler chain stays open
    const port = (server.address() as { port: number }).port;
    const net = await import('node:net');
    const sock = net.connect(port, '127.0.0.1');
    sock.write('POST /api/me HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');
    await new Promise((r) => setTimeout(r, 150));
    const r = await fetch(`http://127.0.0.1:${port}/api/me`);
    assert.equal(r.status, 503);
    sock.destroy();
  } finally { delete process.env.MAX_IN_FLIGHT_REQUESTS; resetProtectionState(); server.close(); }
});
