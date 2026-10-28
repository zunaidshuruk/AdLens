/** Sitemap reading shared by the domain overview and the competitor watch (Sprint 43). */
import type { PageFetcher } from './seoFetch.js';
import { fetchFollowing } from './seoFetch.js';

export interface SitemapEntry { loc: string; lastmod?: string }
export interface ParsedSitemap { kind: 'index' | 'urlset' | 'unknown'; entries: SitemapEntry[] }

const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

export function parseSitemapXml(xml: string): ParsedSitemap {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? 'index' : /<urlset[\s>]/i.test(xml) ? 'urlset' : 'unknown';
  if (kind === 'unknown') return { kind, entries: [] };
  const tag = kind === 'index' ? 'sitemap' : 'url';
  const entries: SitemapEntry[] = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi'))) {
    const loc = /<loc[^>]*>([\s\S]*?)<\/loc>/i.exec(m[0])?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod[^>]*>([\s\S]*?)<\/lastmod>/i.exec(m[0])?.[1];
    entries.push({ loc: dec(loc), ...(lastmod ? { lastmod: dec(lastmod) } : {}) });
  }
  return { kind, entries };
}

export interface RobotsInfo { sitemaps: string[]; blocksAll: boolean; blockedBots: string[] }
const BOT_NAMES = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Bytespider', 'Applebot-Extended'];
export function parseRobots(text: string): RobotsInfo {
  const sitemaps: string[] = [];
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let cur: { agents: string[]; disallow: string[] } | null = null; let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!.toLowerCase(); const v = m[2]!.trim();
    if (k === 'sitemap' && v) sitemaps.push(v);
    else if (k === 'user-agent') { if (!cur || !lastWasAgent) { cur = { agents: [], disallow: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    else if (k === 'disallow' && cur) cur.disallow.push(v);
    lastWasAgent = false;
  }
  const blocks = (g: { disallow: string[] }) => g.disallow.includes('/');
  const blocksAll = groups.some((g) => g.agents.includes('*') && blocks(g));
  const blockedBots = BOT_NAMES.filter((b) => groups.some((g) => g.agents.includes(b.toLowerCase()) && blocks(g)));
  return { sitemaps: [...new Set(sitemaps)].slice(0, 10), blocksAll, blockedBots };
}

/** Reads a sitemap (and, for an index, up to maxFiles child sitemaps). */
export async function collectSitemap(startUrls: string[], fetcher: PageFetcher, o: { maxFiles?: number; maxUrls?: number } = {}): Promise<{ entries: SitemapEntry[]; files: number; truncated: boolean; found: boolean }> {
  const maxFiles = o.maxFiles ?? 6; const maxUrls = o.maxUrls ?? 3000;
  const queue = [...startUrls]; const seen = new Set<string>(); const entries: SitemapEntry[] = [];
  let files = 0; let truncated = false; let found = false;
  while (queue.length) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (files >= maxFiles) { truncated = true; break; }
    const page = await fetchFollowing(url, fetcher);
    if (page.error || page.status !== 200) continue;
    const parsed = parseSitemapXml(page.text);
    if (parsed.kind === 'unknown') continue;
    found = true; files++;
    if (parsed.kind === 'index') { for (const e of parsed.entries) queue.push(e.loc); continue; }
    for (const e of parsed.entries) { if (entries.length >= maxUrls) { truncated = true; break; } entries.push(e); }
    if (entries.length >= maxUrls) break;
  }
  return { entries, files, truncated, found };
}
