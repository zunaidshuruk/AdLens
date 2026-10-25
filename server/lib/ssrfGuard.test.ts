import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SsrfError, createGuardedLookup, guardedRequest, isPrivateIp, validateOutboundUrl } from './ssrfGuard.js';

const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof SsrfError ? e.code : `other:${String(e)}`; }
  return 'no-error';
};

test('private, loopback, link-local and reserved addresses are blocked (IPv4)', () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.0.2.5', '192.168.1.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '142.250.80.46']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('private and special IPv6 addresses are blocked, including embedded IPv4', () => {
  for (const ip of ['::', '::1', '[::1]', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::1', '2002:a9fe:a9fe::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '::127.0.0.1', '100::1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('anything unparseable is treated as private (fails closed)', () => {
  for (const ip of ['', 'not-an-ip', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-4', '::g', '1::2::3', '12345::1']) assert.equal(isPrivateIp(ip), true, ip);
});

test('URL validation accepts ordinary https endpoints', () => {
  assert.equal(validateOutboundUrl('https://api.example.com/v1').hostname, 'api.example.com');
  assert.equal(validateOutboundUrl('  https://llm.my-company.io:8443/hook?x=1 ').port, '8443');
  assert.equal(validateOutboundUrl('https://API.Example.COM./v1').hostname, 'api.example.com.');
});

test('URL validation rejects dangerous or malformed addresses', () => {
  const cases: [unknown, string][] = [
    ['http://api.example.com/', 'URL_NOT_HTTPS'],
    ['ftp://api.example.com/', 'URL_NOT_HTTPS'],
    ['javascript:alert(1)', 'URL_NOT_HTTPS'],
    ['file:///etc/passwd', 'URL_NOT_HTTPS'],
    ['https://user:pw@api.example.com/', 'URL_HAS_CREDENTIALS'],
    ['https://api.example.com:8080/', 'URL_BAD_PORT'],
    ['https://api.example.com:22/', 'URL_BAD_PORT'],
    ['https://localhost/', 'HOST_BLOCKED'],
    ['https://app.localhost/', 'HOST_BLOCKED'],
    ['https://127.0.0.1/', 'HOST_BLOCKED'],
    ['https://0x7f.1/', 'HOST_BLOCKED'], // hex/short forms are normalised to 127.0.0.1
    ['https://2130706433/', 'HOST_BLOCKED'], // decimal form of 127.0.0.1
    ['https://017700000001/', 'HOST_BLOCKED'], // octal form
    ['https://[::1]/', 'HOST_BLOCKED'],
    ['https://[::ffff:127.0.0.1]/', 'HOST_BLOCKED'],
    ['https://169.254.169.254/latest/meta-data', 'HOST_BLOCKED'],
    ['https://8.8.8.8/', 'HOST_BLOCKED'], // even public IP literals: use a domain name
    ['https://metadata.google.internal/', 'HOST_BLOCKED'],
    ['https://printer.local/', 'HOST_BLOCKED'],
    ['https://db.internal/', 'HOST_BLOCKED'],
    ['https://intranet/', 'HOST_BLOCKED'], // single-label host
    ['https://', 'URL_INVALID'],
    ['not a url', 'URL_INVALID'],
    ['', 'URL_INVALID'],
    [undefined, 'URL_INVALID'],
    [12345, 'URL_INVALID'],
    [`https://example.com/${'a'.repeat(2100)}`, 'URL_INVALID'],
  ];
  for (const [input, expected] of cases) assert.equal(code(() => validateOutboundUrl(input)), expected, String(input).slice(0, 60));
  assert.equal(code(() => validateOutboundUrl('https://api.example.com:8443/', { allowedPorts: [443] })), 'URL_BAD_PORT');
});

const lookupOnce = (lookup: ReturnType<typeof createGuardedLookup>, host: string, all = false) =>
  new Promise<{ err: unknown; res: unknown; family?: number }>((resolve) => {
    lookup(host, all ? { all: true } : {}, (err: unknown, res: unknown, family?: number) => resolve({ err, res, family }));
  });

test('connect-time lookup: public addresses pass, private or mixed answers are refused', async () => {
  const mk = (addrs: { address: string; family: number }[]) => createGuardedLookup({ resolveAll: async () => addrs });
  const ok = await lookupOnce(mk([{ address: '93.184.216.34', family: 4 }]), 'example.com');
  assert.deepEqual([ok.err, ok.res, ok.family], [null, '93.184.216.34', 4]);
  const all = await lookupOnce(mk([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1', family: 6 }]), 'example.com', true);
  assert.equal(all.err, null);
  assert.equal((all.res as unknown[]).length, 2);

  for (const bad of [
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '169.254.169.254', family: 4 }],
    [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }], // mixed answer
    [{ address: '::ffff:192.168.1.1', family: 6 }],
  ]) {
    const r = await lookupOnce(mk(bad), 'evil.example.com');
    assert.equal((r.err as SsrfError).code, 'HOST_NOT_PUBLIC');
  }
  assert.equal(((await lookupOnce(mk([]), 'x.example.com')).err as SsrfError).code, 'HOST_UNRESOLVED');
  const failing = createGuardedLookup({ resolveAll: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(((await lookupOnce(failing, 'x.example.com')).err as SsrfError).code, 'HOST_UNRESOLVED');
});

// ---- real sockets against a local server, using the permissive address filter only inside tests ----

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;
async function withServer(handler: Handler, run: (url: URL) => Promise<void>) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try { await run(new URL(`http://agent.test:${port}/hook?a=1`)); }
  finally { await new Promise<void>((r) => server.close(() => r())); }
}
const localLookup = createGuardedLookup({ resolveAll: async () => [{ address: '127.0.0.1', family: 4 }], isAllowedAddress: () => true });
const deps = { transport: http, lookup: localLookup };

test('guardedRequest: POST round trip with headers and body', async () => {
  await withServer((req, res, body) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ method: req.method, path: req.url, auth: req.headers.authorization, ua: req.headers['user-agent'], body }));
  }, async (url) => {
    const r = await guardedRequest(url, { headers: { authorization: 'Bearer abc' }, body: '{"q":1}' }, deps);
    const j = JSON.parse(r.text);
    assert.deepEqual([r.status, j.method, j.path, j.auth, j.ua, j.body], [200, 'POST', '/hook?a=1', 'Bearer abc', 'AdLens-Agent/1', '{"q":1}']);
  });
});

test('guardedRequest: redirects are never followed', async () => {
  await withServer((_req, res) => { res.statusCode = 302; res.setHeader('location', 'http://169.254.169.254/'); res.end(); }, async (url) => {
    await assert.rejects(guardedRequest(url, { body: '{}' }, deps), (e: unknown) => e instanceof SsrfError && e.code === 'REDIRECT_BLOCKED');
  });
});

test('guardedRequest: oversized responses are cut off', async () => {
  await withServer((_req, res) => { res.end('x'.repeat(5000)); }, async (url) => {
    await assert.rejects(guardedRequest(url, { body: '{}', maxResponseBytes: 1000 }, deps), (e: unknown) => e instanceof SsrfError && e.code === 'RESPONSE_TOO_LARGE');
    assert.equal((await guardedRequest(url, { body: '{}', maxResponseBytes: 10_000 }, deps)).text.length, 5000);
  });
});

test('guardedRequest: slow servers time out and callers can cancel', async () => {
  await withServer(() => { /* never answers */ }, async (url) => {
    await assert.rejects(guardedRequest(url, { body: '{}', timeoutMs: 80 }, deps), (e: unknown) => e instanceof SsrfError && e.code === 'REQUEST_TIMEOUT');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 40);
    await assert.rejects(guardedRequest(url, { body: '{}', signal: ac.signal }, deps), (e: unknown) => e instanceof SsrfError && e.code === 'REQUEST_ABORTED');
    const pre = new AbortController();
    pre.abort();
    await assert.rejects(guardedRequest(url, { body: '{}', signal: pre.signal }, deps), /cancelled/);
  });
});

test('guardedRequest: header injection is refused before anything is sent', async () => {
  const url = new URL('https://api.example.com/');
  const bad: Record<string, string>[] = [{ authorization: 'Bearer x\r\nX-Evil: 1' }, { 'bad header': 'v' }, { authorization: 'Bearer ключ' }];
  for (const headers of bad) {
    await assert.rejects(guardedRequest(url, { headers, body: '{}' }), (e: unknown) => e instanceof SsrfError && e.code === 'REQUEST_FAILED');
  }
});

test('guardedRequest with the DEFAULT guard refuses a name that resolves to a private address', async () => {
  await withServer((_req, res) => res.end('secret'), async (url) => {
    const strict = createGuardedLookup({ resolveAll: async () => [{ address: '127.0.0.1', family: 4 }] }); // default filter
    await assert.rejects(guardedRequest(url, { body: '{}' }, { transport: http, lookup: strict }), (e: unknown) => e instanceof SsrfError && e.code === 'HOST_NOT_PUBLIC');
    // DNS rebinding: first answer public, second private → each connection re-checks
    let n = 0;
    const rebinding = createGuardedLookup({ resolveAll: async () => [{ address: n++ === 0 ? '93.184.216.34' : '127.0.0.1', family: 4 }] });
    const first = await new Promise<unknown>((r) => rebinding('x.example.com', {}, (e: unknown) => r(e)));
    const second = await new Promise<unknown>((r) => rebinding('x.example.com', {}, (e: unknown) => r(e)));
    assert.equal(first, null);
    assert.equal((second as SsrfError).code, 'HOST_NOT_PUBLIC');
  });
});
