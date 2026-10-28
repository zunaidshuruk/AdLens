/**
 * SEO tools, part 2: a small, polite site audit (Sprint 36). Starts at the home page (and the sitemap), follows links on the same
 * site, obeys robots.txt, and stops at the page cap or the time budget. Everything is injected so tests run on fake sites.
 */
import { analyzeHtml, pageIssues, resolveLink, scoreFor, type PageFacts, type SeoIssue } from './seoPage.js';
import type { FetchedPage, PageFetcher } from './seoFetch.js';

export interface RobotsRules { disallow: string[]; allow: string[]; sitemaps: string[] }

export function parseRobots(text: string, agent = 'adlensbot'): RobotsRules {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  const sitemaps: string[] = [];
  let cur: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'sitemap') { if (/^https?:\/\//i.test(val)) sitemaps.push(val); continue; }
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], disallow: [], allow: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'disallow' && val) cur.disallow.push(val);
    if (key === 'allow' && val) cur.allow.push(val);
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { disallow: chosen.flatMap((g) => g.disallow), allow: chosen.flatMap((g) => g.allow), sitemaps };
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(`^${body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return re.test(path);
}
/** Longest matching rule wins; Allow wins ties (the common reading of the standard). */
export function robotsAllows(r: RobotsRules, pathAndQuery: string): boolean {
  let best = { len: -1, allow: true };
  for (const d of r.disallow) if (ruleMatches(d, pathAndQuery) && d.length > best.len) best = { len: d.length, allow: false };
  for (const a of r.allow) if (ruleMatches(a, pathAndQuery) && a.length >= best.len) best = { len: a.length, allow: true };
  return best.allow;
}

const SKIP_EXT = /\.(jpe?g|png|gif|webp|avif|svg|ico|pdf|zip|gz|rar|mp[34]|mov|avi|css|js|json|xml|txt|woff2?|ttf|eot|docx?|xlsx?|pptx?|csv)$/i;
const hostKey = (h: string) => h.toLowerCase().replace(/^www\./, '');

export function normaliseCrawlUrl(u: URL): string {
  const x = new URL(u.toString());
  x.hash = '';
  x.hostname = x.hostname.toLowerCase();
  if (x.pathname !== '/' && x.pathname.endsWith('/')) x.pathname = x.pathname.replace(/\/+$/, '');
  for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|msclkid|mc_)/i.test(k)) x.searchParams.delete(k);
  x.searchParams.sort();
  return x.toString();
}

export function sitemapUrls(xml: string, limit = 300): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&')).slice(0, limit);
}

export interface CrawlPage {
  url: string;
  status: number;
  title: string | null;
  words: number;
  h1: number;
  ms: number;
  issues: number;
  score: number;
  redirectTo?: string;
  linkedFrom?: string;
  error?: string;
}
export interface IssueGroup { id: string; severity: SeoIssue['severity']; title: string; fix: string; count: number; urls: string[] }
export interface CrawlReport {
  startUrl: string;
  crawled: number;
  stoppedBecause: 'finished' | 'page_limit' | 'time_limit';
  seconds: number;
  statusCounts: Record<string, number>;
  averageScore: number;
  robotsBlocked: number;
  sitemapFound: boolean;
  groups: IssueGroup[];
  pages: CrawlPage[];
}

export interface CrawlOptions { maxPages: number; timeBudgetMs: number; concurrency?: number; now?: () => number }

export async function crawlSite(startUrl: string, fetcher: PageFetcher, opts: CrawlOptions): Promise<CrawlReport> {
  const now = opts.now ?? Date.now;
  const started = now();
  const root = new URL(startUrl);
  const rootKey = hostKey(root.hostname);
  const origin = `${root.protocol}//${root.host}`;

  let robots: RobotsRules = { disallow: [], allow: [], sitemaps: [] };
  try {
    const r = await fetcher(`${origin}/robots.txt`);
    if (r.status === 200 && !/html/.test(r.contentType)) robots = parseRobots(r.text);
  } catch { /* no robots.txt */ }

  const queue: { url: string; from?: string }[] = [{ url: normaliseCrawlUrl(root) }];
  const seen = new Set<string>([queue[0].url]);
  const push = (u: URL, from?: string) => {
    if (hostKey(u.hostname) !== rootKey || SKIP_EXT.test(u.pathname)) return;
    if ([...u.searchParams.keys()].length > 2) return; // endless filter / calendar pages
    const key = normaliseCrawlUrl(u);
    if (seen.has(key) || seen.size >= opts.maxPages * 4) return;
    seen.add(key);
    queue.push({ url: key, from });
  };

  let sitemapFound = false;
  try {
    const maps = robots.sitemaps.length ? robots.sitemaps.slice(0, 2) : [`${origin}/sitemap.xml`];
    for (const m of maps) {
      const r = await fetcher(m);
      if (r.status === 200 && /<loc>/i.test(r.text)) {
        sitemapFound = true;
        for (const loc of sitemapUrls(r.text)) { const u = resolveLink(loc, root); if (u) push(u, 'sitemap'); }
      }
    }
  } catch { /* optional */ }

  const pages: CrawlPage[] = [];
  const facts = new Map<string, PageFacts>();
  const issuesByUrl = new Map<string, SeoIssue[]>();
  const statusOf = new Map<string, number>();
  let robotsBlocked = 0;
  let stopped: CrawlReport['stoppedBecause'] = 'finished';
  let inFlight = 0;
  let index = 0;

  const visit = async (item: { url: string; from?: string }) => {
    const u = new URL(item.url);
    if (!robotsAllows(robots, `${u.pathname}${u.search}`)) { robotsBlocked++; return; }
    const page: FetchedPage = await fetcher(item.url);
    statusOf.set(item.url, page.status);
    if (page.redirectTo) {
      const t = resolveLink(page.redirectTo, u);
      if (t) push(t, item.url);
      pages.push({ url: item.url, status: page.status, title: null, words: 0, h1: 0, ms: page.ms, issues: 1, score: 99, redirectTo: page.redirectTo, linkedFrom: item.from });
      issuesByUrl.set(item.url, [{ id: 'redirect', severity: 'info', title: 'The address redirects', detail: `Sends visitors to ${page.redirectTo}.`, fix: 'Link to the final address directly so Google and visitors skip the extra step.' }]);
      return;
    }
    if (page.error || page.status === 0) {
      pages.push({ url: item.url, status: 0, title: null, words: 0, h1: 0, ms: page.ms, issues: 1, score: 88, linkedFrom: item.from, error: page.error ?? 'Could not be reached.' });
      issuesByUrl.set(item.url, [{ id: 'unreachable', severity: 'error', title: 'The page could not be reached', detail: page.error ?? '', fix: 'Check that the address works and the server is up.' }]);
      return;
    }
    if (page.status >= 400 || !/html|xml/.test(page.contentType || 'text/html')) {
      const list = page.status >= 400 ? pageIssues(analyzeHtml('', item.url, { status: page.status, ms: page.ms, bytes: page.bytes })).filter((i) => i.id.startsWith('status')) : [];
      pages.push({ url: item.url, status: page.status, title: null, words: 0, h1: 0, ms: page.ms, issues: list.length, score: scoreFor(list), linkedFrom: item.from });
      if (list.length) issuesByUrl.set(item.url, list);
      return;
    }
    const f = analyzeHtml(page.text, item.url, { status: page.status, contentType: page.contentType, xRobots: page.xRobots, ms: page.ms, bytes: page.bytes });
    facts.set(item.url, f);
    for (const l of f.links) if (l.internal && !l.nofollow) { const lu = resolveLink(l.href, u); if (lu) push(lu, item.url); }
    const list = pageIssues(f);
    issuesByUrl.set(item.url, list);
    pages.push({ url: item.url, status: page.status, title: f.title, words: f.wordCount, h1: f.h1.length, ms: page.ms, issues: list.length, score: scoreFor(list), linkedFrom: item.from });
  };

  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 5));
  await new Promise<void>((resolve) => {
    const pump = () => {
      while (inFlight < concurrency && index < queue.length) {
        if (pages.length + robotsBlocked + inFlight >= opts.maxPages) { if (index < queue.length) stopped = 'page_limit'; break; }
        if (now() - started > opts.timeBudgetMs) { stopped = 'time_limit'; break; }
        const item = queue[index++];
        inFlight++;
        visit(item).catch(() => undefined).finally(() => { inFlight--; pump(); });
      }
      if (inFlight === 0 && (index >= queue.length || stopped !== 'finished' || pages.length + robotsBlocked >= opts.maxPages)) resolve();
    };
    pump();
  });
  if (stopped === 'finished' && index < queue.length) stopped = 'page_limit';

  // Problems that only show up when pages are compared with each other.
  const cross = new Map<string, SeoIssue[]>();
  const add = (url: string, i: SeoIssue) => cross.set(url, [...(cross.get(url) ?? []), i]);
  const dupes = (pick: (f: PageFacts) => string | null, id: string, title: string, fix: string) => {
    const by = new Map<string, string[]>();
    for (const [url, f] of facts) { const v = pick(f)?.trim().toLowerCase(); if (v && f.status === 200 && !f.noindex) by.set(v, [...(by.get(v) ?? []), url]); }
    for (const urls of by.values()) if (urls.length > 1) for (const url of urls) add(url, { id, severity: 'warning', title, detail: `${urls.length} pages share it.`, fix });
  };
  dupes((f) => f.title, 'title-duplicate', 'Same title as another page', 'Give every page its own title that describes that page.');
  dupes((f) => f.description, 'description-duplicate', 'Same description as another page', 'Write a unique description for each page.');
  for (const [url, f] of facts) {
    for (const l of f.links) {
      if (!l.internal) continue;
      const key = (() => { try { return normaliseCrawlUrl(new URL(l.href)); } catch { return ''; } })();
      const st = statusOf.get(key);
      if (st !== undefined && (st >= 400 || st === 0)) {
        add(url, { id: 'broken-link', severity: 'error', title: 'Links to a page that does not work', detail: `Links to ${key} (status ${st || 'unreachable'}).`, fix: 'Update or remove the link.' });
      }
    }
  }

  const groups = new Map<string, IssueGroup>();
  const all = new Map<string, SeoIssue[]>();
  for (const [url, list] of issuesByUrl) all.set(url, [...list]);
  for (const [url, list] of cross) all.set(url, [...(all.get(url) ?? []), ...list]);
  for (const [url, list] of all) {
    const seenIds = new Set<string>();
    for (const i of list) {
      if (seenIds.has(i.id)) continue;
      seenIds.add(i.id);
      const g = groups.get(i.id) ?? { id: i.id, severity: i.severity, title: i.title, fix: i.fix, count: 0, urls: [] };
      g.count++;
      if (g.urls.length < 25) g.urls.push(url);
      groups.set(i.id, g);
    }
    const p = pages.find((x) => x.url === url);
    if (p && cross.has(url)) { p.issues += cross.get(url)!.length; p.score = scoreFor(list); }
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  const statusCounts: Record<string, number> = {};
  for (const p of pages) { const k = p.status === 0 ? 'unreachable' : `${Math.floor(p.status / 100)}xx`; statusCounts[k] = (statusCounts[k] ?? 0) + 1; }
  const scored = pages.filter((p) => p.status === 200);
  return {
    startUrl, crawled: pages.length, stoppedBecause: stopped, seconds: Math.round((now() - started) / 100) / 10,
    statusCounts, averageScore: scored.length ? Math.round(scored.reduce((n, p) => n + p.score, 0) / scored.length) : 0,
    robotsBlocked, sitemapFound,
    groups: [...groups.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count),
    pages: pages.sort((a, b) => a.score - b.score).slice(0, 500),
  };
}
