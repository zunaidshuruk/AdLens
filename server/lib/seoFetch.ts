import { SsrfError, guardedRequest, validateOutboundUrl } from './ssrfGuard.js';
import { resolveLink } from './seoPage.js';

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  xRobots?: string;
  ms: number;
  bytes: number;
  text: string;
  redirectTo?: string;
  /** Set when nothing came back (blocked address, timeout, refused). Short and safe to show. */
  error?: string;
}
export type PageFetcher = (url: string) => Promise<FetchedPage>;

export const SEO_USER_AGENT = 'AdLensBot/1.0 (site audit; +https://adlens.app)';

/** Turns what people type ("example.com", "http://example.com/a") into a checkable https address. */
export function normaliseInputUrl(input: string): URL {
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/^http:\/\//i, 'https://');
  return validateOutboundUrl(s);
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '');

/** One GET, no redirects followed. A redirect comes back as status 301 with `redirectTo`. */
export const fetchOnce: PageFetcher = async (url) => {
  const started = Date.now();
  try {
    const u = validateOutboundUrl(url);
    const res = await guardedRequest(u, { method: 'GET', timeoutMs: 8_000, maxResponseBytes: 1_500_000, headers: { 'user-agent': SEO_USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } });
    return { url, status: res.status, contentType: one(res.headers['content-type']).toLowerCase(), ...(res.headers['x-robots-tag'] ? { xRobots: one(res.headers['x-robots-tag']) } : {}), ms: Date.now() - started, bytes: Buffer.byteLength(res.text), text: res.text };
  } catch (e) {
    if (e instanceof SsrfError && e.code === 'REDIRECT_BLOCKED') {
      const loc = (e as SsrfError & { location?: string }).location;
      const target = loc ? resolveLink(loc, new URL(url)) : null;
      return { url, status: 301, contentType: '', ms: Date.now() - started, bytes: 0, text: '', ...(target ? { redirectTo: target.toString() } : {}) };
    }
    const msg = e instanceof SsrfError
      ? e.code === 'REQUEST_TIMEOUT' ? 'The site took too long to answer.' : e.code === 'RESPONSE_TOO_LARGE' ? 'The page is too large to read.' : e.code === 'HOST_NOT_PUBLIC' || e.code === 'HOST_BLOCKED' ? 'That address is not a public website.' : e.code === 'HOST_UNRESOLVED' ? 'That domain could not be found.' : 'The site could not be reached.'
      : 'The site could not be reached.';
    return { url, status: 0, contentType: '', ms: Date.now() - started, bytes: 0, text: '', error: msg };
  }
};

/** Follows up to 4 redirects (each hop re-checked by the guard) and returns the last page, remembering where it started. */
export async function fetchFollowing(url: string, fetcher: PageFetcher = fetchOnce): Promise<FetchedPage & { chain: string[] }> {
  const chain: string[] = [];
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const page = await fetcher(current);
    if (page.redirectTo && hop < 4) {
      chain.push(current);
      try { validateOutboundUrl(page.redirectTo); } catch { return { ...page, chain, error: 'The page redirects somewhere that cannot be checked.' }; }
      current = page.redirectTo;
      continue;
    }
    return { ...page, chain };
  }
  return { url: current, status: 0, contentType: '', ms: 0, bytes: 0, text: '', chain, error: 'Too many redirects.' };
}
