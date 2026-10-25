/**
 * AdLens service worker (Sprint 16.5). Built to dist/sw.js by scripts/build-sw.mjs.
 * All decisions live in swLogic.ts (unit-tested); this file only connects them to the browser.
 *
 * Deliberately no skipWaiting() on its own: a new version waits until the user taps "Refresh" in the app,
 * so a page is never swapped under someone's feet mid-session.
 */
import {
  NAVIGATION_TIMEOUT_MS,
  OFFLINE_URL,
  SHELL_URL,
  cacheKeyFor,
  cacheName,
  classifyRequest,
  offlineFallback,
  parseMessage,
  shouldStore,
  staleCaches,
  type Strategy,
} from './swLogic.js';

declare const __BUILD_ID__: string;

// Only the pieces of the worker API used here (the project is compiled with the browser typings, not the worker typings).
interface SwEvent { waitUntil(p: Promise<unknown>): void }
interface SwFetchEvent extends SwEvent { request: Request; respondWith(r: Promise<Response> | Response): void }
interface SwMessageEvent extends SwEvent { data: unknown }
interface SwScope {
  location: Location;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', l: (e: SwEvent) => void): void;
  addEventListener(type: 'fetch', l: (e: SwFetchEvent) => void): void;
  addEventListener(type: 'message', l: (e: SwMessageEvent) => void): void;
}
const sw = self as unknown as SwScope;
const CURRENT = cacheName(__BUILD_ID__);

const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

async function store(strategy: Strategy, request: Request, response: Response): Promise<void> {
  const path = new URL(request.url).pathname;
  const ok = shouldStore(strategy, path, {
    status: response.status,
    type: response.type,
    cacheControl: response.headers.get('cache-control'),
    contentType: response.headers.get('content-type'),
  });
  if (!ok) return;
  const cache = await caches.open(CURRENT);
  await cache.put(cacheKeyFor(strategy, request.url), response);
}

async function fallbackFor(strategy: Strategy): Promise<Response> {
  const shell = strategy === 'navigation' ? await caches.match(SHELL_URL) : undefined;
  const choice = offlineFallback(strategy, !!shell);
  if (choice === 'shell' && shell) return shell;
  return (await caches.match(OFFLINE_URL)) ?? new Response('You are offline.', { status: 503, headers: { 'content-type': 'text/plain' } });
}

async function handleNavigation(strategy: Strategy, request: Request): Promise<Response> {
  try {
    // Copy the response the moment it arrives, before anything can start reading it, then store the copy in the background.
    const arrival = fetch(request).then((response) => ({ response, copy: response.clone() }));
    arrival.then(({ copy }) => store(strategy, request, copy)).catch(() => undefined);
    // On a slow connection show the cached app instead of a blank screen; the real page still finishes and refreshes the cache.
    const { response } = strategy === 'navigation' ? await Promise.race([arrival, timeout(NAVIGATION_TIMEOUT_MS)]) : await arrival;
    return response;
  } catch {
    return fallbackFor(strategy);
  }
}

async function cacheFirst(strategy: Strategy, request: Request): Promise<Response> {
  const hit = await caches.match(request); // searches every AdLens cache, so the previous build's files still resolve
  if (hit) return hit;
  const response = await fetch(request);
  await store(strategy, request, response.clone());
  return response;
}

async function staleWhileRevalidate(strategy: Strategy, request: Request): Promise<Response> {
  const hit = await caches.match(request);
  const refresh = fetch(request).then(async (r) => { await store(strategy, request, r.clone()); return r; });
  if (hit) { refresh.catch(() => undefined); return hit; }
  return refresh;
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CURRENT);
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' })); // required: without it there is nothing to show offline
      await cache.add(new Request(SHELL_URL, { cache: 'reload' })).catch(() => undefined); // nice to have
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(staleCaches(names, CURRENT).map((n) => caches.delete(n)));
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  const strategy = classifyRequest({ url: req.url, method: req.method, mode: req.mode, hasAuthorization: req.headers.has('authorization') }, sw.location.origin);
  if (strategy === 'network-only') return; // untouched: the browser handles it as if there were no worker
  if (strategy === 'navigation' || strategy === 'navigation-uncached') event.respondWith(handleNavigation(strategy, req));
  else if (strategy === 'cache-first') event.respondWith(cacheFirst(strategy, req));
  else event.respondWith(staleWhileRevalidate(strategy, req));
});

sw.addEventListener('message', (event) => {
  if (parseMessage(event.data)?.type === 'SKIP_WAITING') event.waitUntil(sw.skipWaiting());
});
