/**
 * Domain overview (Sprint 43, free version): what we can read about any public website without a paid database.
 * Size comes from its sitemap, so it is an estimate; there is no traffic or backlink data here.
 */
import { termCounts, visibleText } from './seoTopics.js';
import { collectSitemap, parseRobots, type RobotsInfo } from './seoSitemap.js';
import { fetchFollowing, type PageFetcher } from './seoFetch.js';
import { analyzeHtml } from './seoPage.js';

const SOCIAL: [string, RegExp][] = [['Facebook', /(^|\.)facebook\.com$/], ['X', /(^|\.)(twitter|x)\.com$/], ['LinkedIn', /(^|\.)linkedin\.com$/], ['Instagram', /(^|\.)instagram\.com$/], ['YouTube', /(^|\.)youtube\.com$/], ['TikTok', /(^|\.)tiktok\.com$/], ['GitHub', /(^|\.)github\.com$/]];
const TECH: [string, RegExp][] = [
  ['WordPress', /wp-content|wp-includes|<meta[^>]+generator[^>]+wordpress/i], ['Shopify', /cdn\.shopify\.com|shopify\.theme/i], ['Wix', /static\.wixstatic\.com|wix\.com/i], ['Squarespace', /squarespace\.com|static1\.squarespace/i],
  ['Webflow', /webflow\.(com|io)|data-wf-/i], ['Next.js', /_next\/static|__NEXT_DATA__/i], ['Nuxt', /_nuxt\//i], ['React', /data-reactroot|react(\.production|-dom)/i], ['Vue', /vue(\.runtime)?(\.min)?\.js|data-v-[0-9a-f]{6}/i],
  ['Joomla', /<meta[^>]+generator[^>]+joomla/i], ['Drupal', /<meta[^>]+generator[^>]+drupal|sites\/default\/files/i], ['Cloudflare', /cdn-cgi\/|cloudflare/i], ['Bootstrap', /bootstrap(\.min)?\.(css|js)/i], ['jQuery', /jquery(\.min)?\.js/i],
];
const TRACKERS: [string, RegExp][] = [['Google Tag Manager', /GTM-[A-Z0-9]{4,}/], ['Google Analytics 4', /\bG-[A-Z0-9]{6,}\b/], ['Meta Pixel', /fbq\(|connect\.facebook\.net\/[^"']*fbevents/i], ['LinkedIn Insight', /snap\.licdn\.com/i], ['Hotjar', /static\.hotjar\.com/i], ['Microsoft Clarity', /clarity\.ms/i]];

export const detectTech = (html: string): string[] => TECH.filter(([, re]) => re.test(html)).map(([n]) => n);
export const detectTrackers = (html: string): string[] => TRACKERS.filter(([, re]) => re.test(html)).map(([n]) => n);

export interface DomainOverview {
  domain: string; url: string; status: number; reachable: true;
  title: string | null; description: string | null; lang: string | null; httpsOnly: boolean; ms: number; htmlKb: number;
  structuredData: string[]; social: { name: string; url: string }[]; tech: string[]; trackers: string[]; topTerms: string[];
  robots: (RobotsInfo & { found: boolean }); sitemap: { found: boolean; urls: number; truncated: boolean; sections: { section: string; urls: number }[]; latestChange: string | null };
}

export async function domainOverview(domain: string, fetcher: PageFetcher): Promise<DomainOverview | { reachable: false; error: string }> {
  const home = await fetchFollowing(`https://${domain}/`, fetcher);
  if (home.error || home.status === 0) return { reachable: false, error: home.error || 'The website could not be reached.' };
  if (home.status >= 400) return { reachable: false, error: `The website answered with an error (${home.status}).` };
  const facts = analyzeHtml(home.text, home.url, { status: home.status, contentType: home.contentType, xRobots: home.xRobots, ms: home.ms, bytes: home.bytes });
  const base = new URL(home.url).origin;
  const robotsPage = await fetchFollowing(`${base}/robots.txt`, fetcher);
  const robotsOk = !robotsPage.error && robotsPage.status === 200 && !/<html/i.test(robotsPage.text.slice(0, 200));
  const robots = robotsOk ? parseRobots(robotsPage.text) : { sitemaps: [], blocksAll: false, blockedBots: [] };
  const sm = await collectSitemap([...robots.sitemaps, `${base}/sitemap.xml`].slice(0, 4), fetcher, { maxFiles: 6, maxUrls: 20_000 });
  const sections = new Map<string, number>();
  let latest: string | null = null;
  for (const e of sm.entries) {
    try { const p = new URL(e.loc).pathname.split('/').filter(Boolean); const sec = p.length > 1 ? `/${p[0]}/` : '/'; sections.set(sec, (sections.get(sec) ?? 0) + 1); } catch { /* ignore */ }
    if (e.lastmod && (!latest || e.lastmod > latest)) latest = e.lastmod;
  }
  const social: { name: string; url: string }[] = [];
  for (const l of facts.links) {
    if (l.internal) continue;
    try { const h = new URL(l.href).hostname.toLowerCase(); const hit = SOCIAL.find(([, re]) => re.test(h)); if (hit && !social.some((s) => s.name === hit[0])) social.push({ name: hit[0], url: l.href }); } catch { /* ignore */ }
  }
  const terms = [...termCounts(visibleText(home.text)).entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15).map(([t]) => t);
  return {
    domain, url: home.url, status: home.status, reachable: true, title: facts.title, description: facts.description, lang: facts.lang, httpsOnly: home.url.startsWith('https://'), ms: home.ms, htmlKb: Math.round(home.bytes / 1024),
    structuredData: [...new Set(facts.structuredData)], social, tech: detectTech(home.text), trackers: detectTrackers(home.text), topTerms: terms,
    robots: { ...robots, found: robotsOk },
    sitemap: { found: sm.found, urls: sm.entries.length, truncated: sm.truncated, sections: [...sections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([section, urls]) => ({ section, urls })), latestChange: latest },
  };
}
