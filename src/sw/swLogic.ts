/**
 * Decisions for the AdLens service worker (Sprint 16.5). Pure functions, so every rule is unit-tested.
 *
 * THE RULE THAT MATTERS: the worker keeps AdLens's own files only (the app shell, build files, icons).
 * It never stores data from a user's accounts or anything related to sign-in:
 *   - /api/* (signed-in, per-user data) and /__/* (Firebase sign-in helper) are never cached;
 *   - only GET requests to our own address are ever cached (cross-origin, POST and friends are not);
 *   - pages carrying a one-time code (password reset, e-mail verification, OAuth return) are never cached;
 *   - responses marked no-store/private, and anything that is not what the URL promises, are not stored.
 */

export const CACHE_PREFIX = 'adlens-';
export const SHELL_URL = '/';
export const OFFLINE_URL = '/offline.html';
/** Files that must always come from the network. */
const ALWAYS_FRESH = new Set(['/sw.js', '/manifest.webmanifest', '/version.json']);
/** Query parameters that mean "this URL carries a secret or one-time value". */
const SECRET_PARAMS = ['oobCode', 'apiKey', 'code', 'state', 'token', 'access_token', 'id_token'];
/** Pages that handle one-time links (password reset, e-mail verification). */
const SENSITIVE_PATHS = ['/auth/action'];

export type Strategy =
  | 'network-only' //           never cached
  | 'navigation' //             app pages: network first, cached shell or offline page as a fallback
  | 'navigation-uncached' //    network only, offline page as a fallback, nothing stored
  | 'cache-first' //            hashed build files: their name changes whenever the content does
  | 'stale-while-revalidate'; // icons and other fixed files we host

export interface RequestInfo {
  url: string;
  method: string;
  /** "navigate" for page loads. */
  mode?: string;
  hasAuthorization?: boolean;
}

export function isSensitiveNavigation(url: URL): boolean {
  if (SENSITIVE_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return true;
  return SECRET_PARAMS.some((p) => url.searchParams.has(p));
}

/** "/assets/index-3f9aB2c1.js": Vite names build files after their content, so they can be kept forever. */
export function isHashedAsset(pathname: string): boolean {
  return /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|mjs|css|woff2?|png|jpe?g|svg|webp|avif|gif)$/.test(pathname);
}

export function classifyRequest(req: RequestInfo, selfOrigin: string): Strategy {
  if (req.method.toUpperCase() !== 'GET') return 'network-only';
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return 'network-only';
  }
  if (url.origin !== selfOrigin) return 'network-only';
  if (req.hasAuthorization) return 'network-only';
  const p = url.pathname;
  if (p === '/api' || p.startsWith('/api/')) return 'network-only';
  if (p.startsWith('/__/')) return 'network-only';
  if (ALWAYS_FRESH.has(p)) return 'network-only';

  if (req.mode === 'navigate') return isSensitiveNavigation(url) ? 'navigation-uncached' : 'navigation';

  if (isHashedAsset(p)) return 'cache-first';
  if (p.startsWith('/icons/') || p.startsWith('/fonts/') || p === '/logo.svg' || p === OFFLINE_URL) return 'stale-while-revalidate';
  return 'network-only'; // unknown files are not guessed at
}

// ---------------------------------------------------------------------------
// What may be stored
// ---------------------------------------------------------------------------

export interface ResponseInfo {
  status: number;
  /** "basic" = same-origin response (not opaque, not cross-origin). */
  type: string;
  cacheControl?: string | null;
  contentType?: string | null;
}

const EXPECTED_TYPE: [RegExp, RegExp][] = [
  [/\.m?js$/, /javascript|ecmascript/i],
  [/\.css$/, /text\/css/i],
  [/\.(?:png|jpe?g|webp|avif|gif|svg)$/, /^image\//i],
  [/\.woff2?$/, /font|octet-stream/i],
];

export function shouldStore(strategy: Strategy, pathname: string, res: ResponseInfo): boolean {
  if (strategy === 'network-only' || strategy === 'navigation-uncached') return false;
  if (res.status !== 200 || res.type !== 'basic') return false;
  if (/no-store|private/i.test(res.cacheControl ?? '')) return false;
  const ct = res.contentType ?? '';
  if (strategy === 'navigation') return /text\/html/i.test(ct);
  // The server answers unknown paths with the app page (200). That must never be stored as a script or image.
  if (/text\/html/i.test(ct) && pathname !== OFFLINE_URL) return false;
  for (const [pathRe, typeRe] of EXPECTED_TYPE) if (pathRe.test(pathname) && !typeRe.test(ct)) return false;
  return true;
}

/** Pages are always stored under one key so the address (and anything in it) is never kept. */
export const cacheKeyFor = (strategy: Strategy, requestUrl: string): string => (strategy === 'navigation' ? SHELL_URL : requestUrl);

export type Fallback = 'shell' | 'offline-page' | null;

export function offlineFallback(strategy: Strategy, hasCachedShell: boolean): Fallback {
  if (strategy === 'navigation') return hasCachedShell ? 'shell' : 'offline-page';
  if (strategy === 'navigation-uncached') return 'offline-page';
  return null;
}

// ---------------------------------------------------------------------------
// Cache names and clean-up
// ---------------------------------------------------------------------------

export const cacheName = (buildId: string): string => `${CACHE_PREFIX}${buildId}`;

/**
 * Caches to delete on activation: every AdLens cache except the current one and the most recent OTHER one.
 * That one is kept so a tab still open on it can finish loading its lazy files: after a normal update it is
 * the previous build, after a rollback it is the newer build users were just running. Build ids sort by time
 * (YYYYMMDDHHmm-sha), so the last one in sorted order is the most recent.
 */
export function staleCaches(allNames: string[], currentName: string): string[] {
  const others = allNames.filter((n) => n.startsWith(CACHE_PREFIX) && n !== currentName).sort();
  const keep = others.length ? others[others.length - 1] : null;
  return others.filter((n) => n !== keep);
}

/** Everything AdLens has stored (used on sign-out). Other sites' caches are never touched. */
export const allAppCaches = (allNames: string[]): string[] => allNames.filter((n) => n.startsWith(CACHE_PREFIX));

// ---------------------------------------------------------------------------
// Messages from the page
// ---------------------------------------------------------------------------

export type SwMessage = { type: 'SKIP_WAITING' };

export function parseMessage(data: unknown): SwMessage | null {
  if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'SKIP_WAITING') return { type: 'SKIP_WAITING' };
  return null;
}

/** How long to wait for the network before showing the cached app shell (slow connections). */
export const NAVIGATION_TIMEOUT_MS = 4000;
