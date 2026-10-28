import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { encryptPayload } from './lib/crypto.js';
import { openSecret, sealSecret } from './lib/twoStep.js';
import vercel from '../vercel.json' with { type: 'json' };

test('Security audit — every response carries the browser security headers and hides Express', async () => {
  const server = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/health`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(r.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    assert.match(r.headers.get('content-security-policy-report-only') ?? '', /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-powered-by'), null);
  } finally { server.close(); }
});

test('Security audit — vercel.json sends the same headers for the pages Vercel serves itself', () => {
  const rule = (vercel as { headers: { source: string; headers: { key: string; value: string }[] }[] }).headers.find((h) => h.source === '/(.*)');
  const keys = rule?.headers.map((h) => h.key) ?? [];
  for (const k of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy-Report-Only']) assert.ok(keys.includes(k), k);
});

test('Security audit — two-step secrets survive a key change (old key kept in TOKEN_ENCRYPTION_KEY_PREVIOUS)', () => {
  const oldKey = 'old-key-for-rotation-test-0123456789abcdef';
  const newKey = 'new-key-for-rotation-test-0123456789abcdef';
  process.env.TOKEN_ENCRYPTION_KEY = oldKey;
  delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
  const sealedWithOld = sealSecret('JBSWY3DPEHPK3PXP');
  process.env.TOKEN_ENCRYPTION_KEY = newKey;
  assert.throws(() => openSecret(sealedWithOld), 'without the old key it cannot be opened');
  process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = oldKey;
  assert.equal(openSecret(sealedWithOld), 'JBSWY3DPEHPK3PXP');
  assert.equal(openSecret(sealSecret('ABC')), 'ABC');
  assert.notEqual(encryptPayload('x', newKey), '');
  delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
});

test('Security audit — a 200,000-character logo fits the request limit, a huge body is still refused', async () => {
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (n: number) => fetch(`${base}/api/me`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: 'a'.repeat(n) }) });
    assert.equal((await post(210_000)).status, 401, 'reaches the sign-in check (not refused for size)');
    assert.equal((await post(300_000)).status, 413);
  } finally { server.close(); }
});
