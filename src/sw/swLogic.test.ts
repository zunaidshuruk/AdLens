import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFLINE_URL, allAppCaches, cacheKeyFor, cacheName, classifyRequest, isHashedAsset, isSensitiveNavigation, offlineFallback, parseMessage, shouldStore, staleCaches } from './swLogic.js';

const ORIGIN = 'https://app.example.com';
const c = (path: string, o: { method?: string; mode?: string; hasAuthorization?: boolean; origin?: string } = {}) =>
  classifyRequest({ url: `${o.origin ?? ORIGIN}${path}`, method: o.method ?? 'GET', mode: o.mode, hasAuthorization: o.hasAuthorization }, ORIGIN);

test('user data and sign-in traffic are never touched', () => {
  for (const path of ['/api/ga4/overview?x=1', '/api/ai/ask', '/api', '/api/connections', '/__/auth/handler?state=abc&code=xyz', '/__/auth/iframe', '/__/firebase/init.json']) {
    assert.equal(c(path), 'network-only', path);
    assert.equal(c(path, { mode: 'navigate' }), 'network-only', `${path} as a page load`);
  }
  assert.equal(c('/assets/index-abcdef12.js', { hasAuthorization: true }), 'network-only');
});

test('only GET requests to our own address are ever cached', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) assert.equal(c('/assets/index-abcdef12.js', { method }), 'network-only', method);
  assert.equal(c('/assets/index-abcdef12.js', { method: 'get' }), 'cache-first');
  assert.equal(c('/assets/index-abcdef12.js', { origin: 'https://evil.example' }), 'network-only');
  assert.equal(c('/x', { origin: 'https://firestore.googleapis.com' }), 'network-only');
  assert.equal(classifyRequest({ url: 'not a url', method: 'GET' }, ORIGIN), 'network-only');
});

test('pages use the app shell; one-time-code pages are never stored', () => {
  assert.equal(c('/ga4', { mode: 'navigate' }), 'navigation');
  assert.equal(c('/', { mode: 'navigate' }), 'navigation');
  assert.equal(c('/settings?tab=appearance', { mode: 'navigate' }), 'navigation');
  for (const path of ['/auth/action?mode=resetPassword&oobCode=SECRET', '/auth/action', '/auth/action/x', '/anything?oobCode=1', '/x?code=abc&state=def', '/x?apiKey=k', '/x?id_token=t', '/x?access_token=t']) {
    assert.equal(c(path, { mode: 'navigate' }), 'navigation-uncached', path);
  }
  assert.equal(isSensitiveNavigation(new URL(`${ORIGIN}/ga4?range=7`)), false);
});

test('build files are kept forever, our fixed files are refreshed in the background, unknown files are left alone', () => {
  for (const path of ['/assets/index-3f9aB2c1.js', '/assets/vendor-react-Zk81_dQ-.js', '/assets/index-abcdef12.css', '/assets/font-abcdef12.woff2', '/assets/logo-abc123_x.svg']) {
    assert.equal(isHashedAsset(path), true, path);
    assert.equal(c(path), 'cache-first', path);
  }
  for (const path of ['/assets/index.js', '/assets/a-b.js', '/assets/nested/index-abcdef12.js', '/index-abcdef12.js', '/assets/index-abcdef12.exe']) assert.equal(isHashedAsset(path), false, path);
  for (const path of ['/icons/icon-192.png', '/icons/favicon-32.png', '/logo.svg', '/fonts/plus-jakarta.woff2', OFFLINE_URL]) assert.equal(c(path), 'stale-while-revalidate', path);
  for (const path of ['/sw.js', '/manifest.webmanifest', '/version.json']) assert.equal(c(path), 'network-only', path);
  for (const path of ['/robots.txt', '/random.json', '/uploads/x.png']) assert.equal(c(path), 'network-only', path);
});

const ok = { status: 200, type: 'basic', cacheControl: 'public, max-age=0', contentType: 'text/javascript; charset=utf-8' };

test('what may be stored: only normal same-origin successes that are what the address promises', () => {
  assert.equal(shouldStore('cache-first', '/assets/index-abcdef12.js', ok), true);
  assert.equal(shouldStore('cache-first', '/assets/index-abcdef12.css', { ...ok, contentType: 'text/css' }), true);
  assert.equal(shouldStore('cache-first', '/assets/a-abcdef12.woff2', { ...ok, contentType: 'font/woff2' }), true);
  assert.equal(shouldStore('stale-while-revalidate', '/icons/icon-192.png', { ...ok, contentType: 'image/png' }), true);
  assert.equal(shouldStore('navigation', '/ga4', { ...ok, contentType: 'text/html; charset=utf-8' }), true);
  // never
  assert.equal(shouldStore('network-only', '/x', ok), false);
  assert.equal(shouldStore('navigation-uncached', '/auth/action', { ...ok, contentType: 'text/html' }), false);
  for (const bad of [{ status: 404 }, { status: 500 }, { status: 206 }, { status: 304 }, { type: 'opaque' }, { type: 'cors' }, { type: 'error' }, { cacheControl: 'no-store' }, { cacheControl: 'private, max-age=60' }, { cacheControl: 'NO-STORE' }]) {
    assert.equal(shouldStore('cache-first', '/assets/index-abcdef12.js', { ...ok, ...bad }), false, JSON.stringify(bad));
  }
});

test('the app page returned for an unknown path is never stored as a script, style or image', () => {
  // Our server answers unknown paths with index.html (200); keeping that as "/assets/x.js" would break the app.
  assert.equal(shouldStore('cache-first', '/assets/missing-abcdef12.js', { ...ok, contentType: 'text/html; charset=utf-8' }), false);
  assert.equal(shouldStore('stale-while-revalidate', '/icons/missing.png', { ...ok, contentType: 'text/html' }), false);
  // paths whose extension we have no type rule for must still never receive the app page
  assert.equal(shouldStore('stale-while-revalidate', '/fonts/plus-jakarta.ttf', { ...ok, contentType: 'text/html' }), false);
  assert.equal(shouldStore('stale-while-revalidate', '/icons/unknown-name', { ...ok, contentType: 'text/html; charset=utf-8' }), false);
  assert.equal(shouldStore('stale-while-revalidate', '/fonts/plus-jakarta.ttf', { ...ok, contentType: 'font/ttf' }), true);
  assert.equal(shouldStore('cache-first', '/assets/index-abcdef12.js', { ...ok, contentType: 'text/css' }), false); // wrong type
  assert.equal(shouldStore('cache-first', '/assets/x-abcdef12.css', { ...ok, contentType: 'application/javascript' }), false);
  assert.equal(shouldStore('cache-first', '/assets/x-abcdef12.png', { ...ok, contentType: 'text/plain' }), false);
  assert.equal(shouldStore('navigation', '/ga4', { ...ok, contentType: 'application/json' }), false); // a page must be HTML
  assert.equal(shouldStore('stale-while-revalidate', OFFLINE_URL, { ...ok, contentType: 'text/html; charset=utf-8' }), true);
});

test('pages are stored under one fixed key, so addresses and their contents are never kept', () => {
  assert.equal(cacheKeyFor('navigation', 'https://app.example.com/ga4?project=secret-123'), '/');
  assert.equal(cacheKeyFor('cache-first', 'https://app.example.com/assets/index-abcdef12.js'), 'https://app.example.com/assets/index-abcdef12.js');
});

test('offline fallback: cached app for normal pages, offline page for one-time-code pages', () => {
  assert.equal(offlineFallback('navigation', true), 'shell');
  assert.equal(offlineFallback('navigation', false), 'offline-page');
  assert.equal(offlineFallback('navigation-uncached', true), 'offline-page');
  assert.equal(offlineFallback('cache-first', true), null);
  assert.equal(offlineFallback('network-only', false), null);
});

test('old caches are retired but one previous build is kept for tabs still open on it', () => {
  const [a, b, d] = ['202610010900-aaa1111', '202610150900-bbb2222', '202610251530-ccc3333'].map(cacheName);
  assert.deepEqual(staleCaches([a, b, d], d), [a]);
  assert.deepEqual(staleCaches([b, d], d), []);
  assert.deepEqual(staleCaches([d], d), []);
  assert.deepEqual(staleCaches([a, b, d, 'other-app-cache', 'workbox-precache', 'adlens-' + 'x'], d).includes('other-app-cache'), false); // other sites' caches are never touched
  assert.deepEqual(staleCaches(['other-app-cache'], d), []);
  // after a rollback the newer build is the one tabs are still running: keep it, retire the older one
  const newer = cacheName('202611010000-ddd4444');
  assert.deepEqual(staleCaches([a, d, newer], d), [a]);
  assert.deepEqual(staleCaches([d, newer], d), []);
  assert.deepEqual(allAppCaches([a, d, 'other', 'workbox-x']), [a, d]);
});

test('only the update message is understood', () => {
  assert.deepEqual(parseMessage({ type: 'SKIP_WAITING' }), { type: 'SKIP_WAITING' });
  for (const bad of [null, undefined, 'SKIP_WAITING', 42, {}, { type: 'CLEAR' }, { type: 'skip_waiting' }, []]) assert.equal(parseMessage(bad), null);
});
