/**
 * Same-origin Firebase sign-in helper (Sprint 16.5, PWA-5).
 *
 * WHY: Firebase's Google/Microsoft sign-in loads a helper page from <project>.firebaseapp.com. When the app runs on
 * a different address, finishing sign-in needs cross-site storage, which Safari, Chrome and installed iPhone apps
 * increasingly block. Firebase's documented fix is to serve the helper from the app's own address. This module is
 * that proxy: AdLens answers /__/auth/* by fetching the same files from Firebase.
 *
 * WHAT IT WILL (AND WILL NOT) DO
 * - Forwards only GET/HEAD for /__/auth/<plain file path> and /__/firebase/init.json. Everything else is refused.
 * - Never forwards cookies, authorisation or referrer, and never passes back Set-Cookie.
 * - Never follows redirects, caps the response size and time, and rate-limits per client.
 * - The OAuth return address (/__/auth/handler?state=...&code=...) carries one-time values: it is never logged
 *   here and its response is sent with Cache-Control: no-store.
 * Note: these files are scripts from Google served from our own address. That is how Firebase Hosting works too.
 *
 * Register BEFORE the single-page-app fallback. Imports in this folder end in .js.
 */

import type { Express, Request, Response } from 'express';

export const MAX_QUERY_LENGTH = 4096;
const PATH_AUTH = /^\/__\/auth(?:\/[A-Za-z0-9._-]+)+$/;
const PATH_INIT = '/__/firebase/init.json';

/** Firebase project ids: 6–30 characters, lower-case letters, digits and hyphens. */
export function upstreamHostFor(projectId: string): string {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('Invalid Firebase project id.');
  return `${projectId}.firebaseapp.com`;
}

/** The exact path to fetch from Firebase, or null when the request is not one of the helper files. */
export function resolveUpstreamPath(pathname: string): string | null {
  if (typeof pathname !== 'string' || pathname.length > 200) return null;
  if (pathname === PATH_INIT) return pathname;
  if (!PATH_AUTH.test(pathname)) return null;
  if (pathname.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  return pathname;
}

export interface ProxyRequest {
  method: string;
  /** Raw path, not decoded. */
  pathname: string;
  /** Raw query string including the "?", or "". */
  search: string;
}

export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface AuthProxyOptions {
  upstreamHost: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const COPY_HEADERS = ['content-type', 'content-security-policy', 'x-content-type-options', 'referrer-policy'];

const fail = (status: number, message: string, extra: Record<string, string> = {}): ProxyResult => ({
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra },
  body: Buffer.from(message),
});

export async function proxyAuthRequest(req: ProxyRequest, opts: AuthProxyOptions): Promise<ProxyResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return fail(405, 'Method not allowed.', { allow: 'GET, HEAD' });
  const path = resolveUpstreamPath(req.pathname);
  if (!path) return fail(404, 'Not found.');
  if (req.search !== '' && (req.search.length > MAX_QUERY_LENGTH || !/^\?[\x21-\x7e]*$/.test(req.search))) return fail(400, 'Invalid query.');

  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let upstream: globalThis.Response;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Our own timer as well as the abort signal, so a misbehaving network layer can never leave a request hanging.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), timeoutMs);
    });
    upstream = await Promise.race([
      doFetch(`https://${opts.upstreamHost}${path}${req.search}`, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        // Deliberately minimal: no cookies, no authorisation, no referrer, no client address.
        headers: { accept: '*/*', 'user-agent': 'AdLens-AuthProxy/1' },
      }),
      deadline,
    ]);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    return name === 'TimeoutError' || name === 'AbortError' ? fail(504, 'The sign-in helper took too long.') : fail(502, 'Could not reach the sign-in helper.');
  } finally {
    clearTimeout(timer);
  }

  if (upstream.status >= 300 && upstream.status < 400) return fail(502, 'The sign-in helper tried to redirect, which is not allowed.');
  if (upstream.status === 404) return fail(404, 'Not found.');
  if (upstream.status < 200 || upstream.status >= 300) return fail(502, 'The sign-in helper is unavailable.');

  const declared = Number(upstream.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return fail(502, 'The sign-in helper response was too large.');
  const body = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await upstream.arrayBuffer());
  if (body.length > maxBytes) return fail(502, 'The sign-in helper response was too large.');

  const headers: Record<string, string> = {};
  for (const name of COPY_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers[name] = v;
  }
  // Pages that receive one-time values are never cached; the helper scripts may be, briefly.
  headers['cache-control'] = /text\/html/i.test(headers['content-type'] ?? '') ? 'no-store' : 'public, max-age=300';
  return { status: upstream.status, headers, body };
}

// ---------------------------------------------------------------------------
// Limits and wiring
// ---------------------------------------------------------------------------

/** Simple fixed-window limiter. Returns true when the request is allowed. */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): (key: string) => boolean {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key) => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: t + windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (t >= v.resetAt) hits.delete(k);
      return true;
    }
    entry.count++;
    return entry.count <= max;
  };
}

export function registerAuthProxy(app: Express, opts: AuthProxyOptions & { limitPerMinute?: number }): void {
  const allow = createRateLimiter(opts.limitPerMinute ?? 120, 60_000);
  app.use('/__', async (req: Request, res: Response) => {
    if (!allow(req.ip ?? 'unknown')) {
      res.status(429).type('text/plain').set('cache-control', 'no-store').send('Too many requests.');
      return;
    }
    const url = new URL(req.originalUrl, 'http://placeholder.invalid');
    const result = await proxyAuthRequest({ method: req.method, pathname: req.originalUrl.split('?')[0], search: url.search }, opts);
    res.status(result.status);
    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
    res.end(result.body);
  });
}

// ---------------------------------------------------------------------------
// Which address the browser should use for sign-in
// ---------------------------------------------------------------------------

/** Hostnames AdLens is allowed to sign people in on: the app's own address plus an optional comma-separated list. */
export function parseAllowedHosts(appBaseUrl: string | undefined, extra: string | undefined): string[] {
  const hosts = new Set<string>();
  try {
    if (appBaseUrl) hosts.add(new URL(appBaseUrl).hostname.toLowerCase());
  } catch {
    /* ignore a malformed base URL */
  }
  for (const h of (extra ?? '').split(',').map((s) => s.trim().toLowerCase())) if (/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) && h.includes('.')) hosts.add(h);
  return [...hosts];
}

/**
 * The `authDomain` to give the browser. With the proxy on, it is the address the page was loaded from, but only
 * if that address is on the allow-list (a forged Host header can never become the sign-in address).
 */
export function chooseAuthDomain(o: { proxyEnabled: boolean; requestHost: string | undefined; configuredAuthDomain: string; allowedHosts: string[] }): string {
  if (!o.proxyEnabled) return o.configuredAuthDomain;
  const host = (o.requestHost ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return o.configuredAuthDomain; // rejects ports, spaces, unicode
  return o.allowedHosts.includes(host) ? host : o.configuredAuthDomain;
}
