import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { chooseAuthDomain, createRateLimiter, parseAllowedHosts, proxyAuthRequest, registerAuthProxy, resolveUpstreamPath, upstreamHostFor } from './authProxy.js';

const HOST = 'adlens-404e6.firebaseapp.com';

test('only Firebase\'s helper files can be requested', () => {
  for (const p of ['/__/auth/handler', '/__/auth/iframe', '/__/auth/handler.js', '/__/auth/iframe.js', '/__/auth/experiments.js', '/__/auth/links', '/__/firebase/init.json', '/__/auth/sub/dir/file.js']) assert.equal(resolveUpstreamPath(p), p, p);
  const bad = ['/__/auth', '/__/auth/', '/__/firebase/init.js', '/__/firebase/other.json', '/__/other', '/__', '/api/ga4', '/', '',
    '/__/auth/../../etc/passwd', '/__/auth/./handler', '/__/auth/%2e%2e/x', '/__/auth/..%2fx', '/__/auth/a%2Fb', '/__/auth//handler', '/__/auth/a\\b',
    '/__/auth/handler?x=1', '/__/auth/hand ler', '/__/auth/h\u0000', '/__/auth/é', `/__/auth/${'a'.repeat(300)}`, '/__/AUTH/handler', '//__/auth/handler'];
  for (const p of bad) assert.equal(resolveUpstreamPath(p), null, JSON.stringify(p));
  assert.equal(resolveUpstreamPath(undefined as unknown as string), null);
});

test('project ids become the firebaseapp.com host; anything odd is refused', () => {
  assert.equal(upstreamHostFor('adlens-404e6'), HOST);
  for (const bad of ['', 'ab', 'Has-Upper', 'has space', 'evil.com/x', 'a'.repeat(31), '-start', 'end-', 'x@y']) assert.throws(() => upstreamHostFor(bad), /Invalid Firebase project id/);
});

function upstream(handler: (url: string, init: RequestInit) => Response | Promise<Response> | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const page = (body: string, type: string, extra: Record<string, string> = {}) => new Response(body, { status: 200, headers: { 'content-type': type, ...extra } });

test('a sign-in return request is forwarded with its query, with nothing else about the client', async () => {
  const u = upstream(() => page('<html>handler</html>', 'text/html; charset=utf-8', { 'set-cookie': 'a=b', 'content-security-policy': "default-src 'self'", 'x-secret-internal': 'nope' }));
  const r = await proxyAuthRequest({ method: 'GET', pathname: '/__/auth/handler', search: '?state=S&code=C&apiKey=K' }, { upstreamHost: HOST, fetchImpl: u.fetchImpl });
  assert.equal(u.calls[0].url, `https://${HOST}/__/auth/handler?state=S&code=C&apiKey=K`);
  const sent = u.calls[0].init;
  assert.equal(sent.redirect, 'manual');
  assert.deepEqual(Object.keys(sent.headers as object).sort(), ['accept', 'user-agent']);
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), '<html>handler</html>');
  assert.equal(r.headers['cache-control'], 'no-store'); // pages carrying one-time values are never cached
  assert.equal(r.headers['content-security-policy'], "default-src 'self'");
  assert.ok(!('set-cookie' in r.headers) && !('x-secret-internal' in r.headers));
});

test('helper scripts may be cached briefly; HEAD returns headers only', async () => {
  const u = upstream(() => page('console.log(1)', 'text/javascript'));
  const js = await proxyAuthRequest({ method: 'GET', pathname: '/__/auth/handler.js', search: '' }, { upstreamHost: HOST, fetchImpl: u.fetchImpl });
  assert.equal(js.headers['cache-control'], 'public, max-age=300');
  const head = await proxyAuthRequest({ method: 'HEAD', pathname: '/__/auth/handler.js', search: '' }, { upstreamHost: HOST, fetchImpl: u.fetchImpl });
  assert.deepEqual([head.status, head.body.length], [200, 0]);
});

test('refuses everything outside the allow-list without contacting Firebase', async () => {
  const u = upstream(() => page('x', 'text/plain'));
  const run = (r: Parameters<typeof proxyAuthRequest>[0]) => proxyAuthRequest(r, { upstreamHost: HOST, fetchImpl: u.fetchImpl });
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await run({ method, pathname: '/__/auth/handler', search: '' });
    assert.deepEqual([r.status, r.headers.allow], [405, 'GET, HEAD']);
  }
  assert.equal((await run({ method: 'GET', pathname: '/__/auth/../x', search: '' })).status, 404);
  assert.equal((await run({ method: 'GET', pathname: '/api/ga4', search: '' })).status, 404);
  for (const search of ['?a=\r\nX: y', `?${'a'.repeat(5000)}`, '?a b', '?ключ=1']) assert.equal((await run({ method: 'GET', pathname: '/__/auth/handler', search })).status, 400, search.slice(0, 20));
  assert.equal(u.calls.length, 0);
});

test('redirects, errors, slowness and oversize answers are turned into safe failures', async () => {
  const run = (handler: Parameters<typeof upstream>[0], o: { timeoutMs?: number; maxBytes?: number } = {}) => proxyAuthRequest({ method: 'GET', pathname: '/__/auth/handler', search: '' }, { upstreamHost: HOST, fetchImpl: upstream(handler).fetchImpl, ...o });
  const redirect = await run(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
  assert.equal(redirect.status, 502);
  assert.match(redirect.body.toString(), /redirect/); // reported as a refused redirect, not as a generic outage
  assert.ok(!('location' in redirect.headers));
  assert.equal((await run(() => new Response('x', { status: 500 }))).status, 502);
  assert.equal((await run(() => new Response('x', { status: 403 }))).status, 502);
  assert.equal((await run(() => new Response('nope', { status: 404 }))).status, 404);
  assert.equal((await run(() => new Error('ECONNRESET'))).status, 502);
  assert.equal((await run(() => new Promise<Response>(() => undefined), { timeoutMs: 30 })).status, 504); // even if the network layer ignores the abort signal
  assert.equal((await run(() => page('x'.repeat(5000), 'text/plain'), { maxBytes: 1000 })).status, 502);
  assert.equal((await run(() => page('ok', 'text/plain', { 'content-length': '999999999' }), { maxBytes: 1000 })).status, 502);
});

test('a hung upstream times out as 504 (abort signal respected)', async () => {
  const fetchImpl = ((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))))) as unknown as typeof fetch;
  const r = await proxyAuthRequest({ method: 'GET', pathname: '/__/auth/handler', search: '' }, { upstreamHost: HOST, fetchImpl, timeoutMs: 30 });
  assert.equal(r.status, 504);
});

test('rate limiter allows a burst up to the limit, then blocks until the window ends', () => {
  let t = 0;
  const allow = createRateLimiter(3, 1000, () => t);
  assert.deepEqual([1, 2, 3, 4, 5].map(() => allow('a')), [true, true, true, false, false]);
  assert.equal(allow('b'), true); // other clients are unaffected
  t = 1001;
  assert.equal(allow('a'), true);
});

test('IN THE REAL SERVER: forwards sign-in files, hides cookies, falls through for the app, refuses the rest, limits abuse', async () => {
  const u = upstream((url) => page(url.includes('init.json') ? '{"apiKey":"k"}' : '<html>handler</html>', url.includes('init.json') ? 'application/json' : 'text/html', { 'set-cookie': 'x=y' }));
  const app = express();
  registerAuthProxy(app, { upstreamHost: HOST, fetchImpl: u.fetchImpl, limitPerMinute: 5 });
  app.get('*', (_req, res) => res.send('SPA PAGE'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const handler = await fetch(`${base}/__/auth/handler?state=abc&code=def`, { headers: { cookie: 'session=TOPSECRET', authorization: 'Bearer SECRET' } });
    assert.equal(await handler.text(), '<html>handler</html>');
    assert.equal(handler.headers.get('cache-control'), 'no-store');
    assert.equal(handler.headers.get('set-cookie'), null);
    assert.equal(u.calls[0].url, `https://${HOST}/__/auth/handler?state=abc&code=def`);
    assert.ok(!JSON.stringify(u.calls[0].init).includes('TOPSECRET') && !JSON.stringify(u.calls[0].init).includes('SECRET'));
    assert.equal(await (await fetch(`${base}/__/firebase/init.json`)).text(), '{"apiKey":"k"}');
    assert.equal(await (await fetch(`${base}/ga4`)).text(), 'SPA PAGE'); // the app is not affected
    assert.equal((await fetch(`${base}/__/auth/handler`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/__/other`)).status, 404);
    assert.equal((await fetch(`${base}/__/auth/..%2f..%2fetc`)).status, 404);
    assert.equal((await fetch(`${base}/__/auth/handler`)).status, 429); // the 6th request under /__ in the window (the app page does not count)
  } finally { server.close(); }
});

test('the sign-in address: own domain only when enabled and on the allow-list', () => {
  const allowed = parseAllowedHosts('https://app.adlens.example/', 'www.adlens.example, bad host, localhost, EVIL');
  assert.deepEqual(allowed, ['app.adlens.example', 'www.adlens.example']);
  assert.deepEqual(parseAllowedHosts(undefined, undefined), []);
  assert.deepEqual(parseAllowedHosts('not a url', undefined), []);
  const choose = (o: Partial<Parameters<typeof chooseAuthDomain>[0]>) => chooseAuthDomain({ proxyEnabled: true, requestHost: 'app.adlens.example', configuredAuthDomain: HOST, allowedHosts: allowed, ...o });
  assert.equal(choose({}), 'app.adlens.example');
  assert.equal(choose({ requestHost: 'APP.ADLENS.EXAMPLE' }), 'app.adlens.example');
  assert.equal(choose({ proxyEnabled: false }), HOST);
  for (const requestHost of [undefined, '', 'evil.example', 'app.adlens.example:3000', 'app.adlens.example/x', 'app adlens', 'aрр.adlens.example', 'localhost']) assert.equal(choose({ requestHost }), HOST, String(requestHost));
});
