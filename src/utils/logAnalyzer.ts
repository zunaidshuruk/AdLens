/**
 * Log file analyzer (Sprint 41). Runs in the browser, so the log never leaves the computer.
 * Reads web server access logs in the common "combined" format (nginx, Apache, most CDNs) and shows how search and AI crawlers use the site.
 * Honest limit: crawlers are recognised by their name in the log. We cannot confirm a visitor is genuinely Google (that needs a reverse address lookup).
 */
export interface Bot { id: string; label: string; kind: 'search' | 'ai' | 'seo-tool' | 'other'; test: RegExp }
export const BOTS: Bot[] = [
  { id: 'googlebot', label: 'Googlebot', kind: 'search', test: /googlebot|google-inspectiontool|adsbot-google|mediapartners-google/i },
  { id: 'google-extended', label: 'Google-Extended', kind: 'ai', test: /google-extended/i },
  { id: 'bingbot', label: 'Bingbot', kind: 'search', test: /bingbot|bingpreview|msnbot/i },
  { id: 'applebot', label: 'Applebot', kind: 'search', test: /applebot/i },
  { id: 'baidu', label: 'Baiduspider', kind: 'search', test: /baiduspider/i },
  { id: 'yandex', label: 'YandexBot', kind: 'search', test: /yandex(bot|images)/i },
  { id: 'duck', label: 'DuckDuckBot', kind: 'search', test: /duckduckbot/i },
  { id: 'gptbot', label: 'GPTBot (OpenAI)', kind: 'ai', test: /gptbot/i },
  { id: 'oai-search', label: 'OAI-SearchBot', kind: 'ai', test: /oai-searchbot/i },
  { id: 'chatgpt-user', label: 'ChatGPT-User', kind: 'ai', test: /chatgpt-user/i },
  { id: 'claude', label: 'ClaudeBot (Anthropic)', kind: 'ai', test: /claudebot|claude-web|anthropic-ai/i },
  { id: 'perplexity', label: 'PerplexityBot', kind: 'ai', test: /perplexity/i },
  { id: 'ccbot', label: 'CCBot (Common Crawl)', kind: 'ai', test: /ccbot/i },
  { id: 'bytespider', label: 'Bytespider (ByteDance)', kind: 'ai', test: /bytespider/i },
  { id: 'ahrefs', label: 'AhrefsBot', kind: 'seo-tool', test: /ahrefsbot/i },
  { id: 'semrush', label: 'SemrushBot', kind: 'seo-tool', test: /semrushbot/i },
  { id: 'mj12', label: 'MJ12bot', kind: 'seo-tool', test: /mj12bot/i },
];

const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) (\S+)(?: [^"]*)?" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/;
const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const STATIC = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|mp3|pdf|zip|xml|txt|json)$/i;

export interface ParsedLine { ip: string; day: string; method: string; path: string; status: number; bytes: number; agent: string }
export function parseLine(line: string): ParsedLine | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const d = /^(\d{1,2})\/(\w{3})\/(\d{4})/.exec(m[2]!);
  if (!d || !MONTHS[d[2]!]) return null;
  return { ip: m[1]!, day: `${d[3]}-${MONTHS[d[2]!]}-${d[1]!.padStart(2, '0')}`, method: m[3]!, path: m[4]!, status: Number(m[5]), bytes: m[6] === '-' ? 0 : Number(m[6]) || 0, agent: m[8] ?? '' };
}
export const botFor = (agent: string): Bot | null => BOTS.find((b) => b.test.test(agent)) ?? null;

interface BotStats { hits: number; bytes: number; status: Record<'2xx' | '3xx' | '4xx' | '5xx', number>; urls: Map<string, number>; days: Map<string, number> }
export interface LogAnalyzer {
  add(line: string): void;
  result(): LogReport;
}
export interface LogReport {
  lines: number; parsed: number; unparsed: number; firstDay: string | null; lastDay: string | null; humanOrOtherHits: number; botHits: number;
  bots: { id: string; label: string; kind: Bot['kind']; hits: number; share: number; bytes: number; status: BotStats['status']; uniqueUrls: number; topUrls: { path: string; hits: number }[]; perDay: { day: string; hits: number }[] }[];
  crawl: { search: CrawlSummary; ai: CrawlSummary };
  issues: { kind: 'errors' | 'redirects' | 'parameters' | 'static' | 'server'; label: string; hits: number; share: number; examples: { path: string; hits: number; status?: number }[]; advice: string }[];
  neverCrawledHint: string;
}
export interface CrawlSummary { hits: number; uniqueUrls: number; sectionHits: { section: string; hits: number }[]; paths: string[] }

const sectionOf = (path: string) => { const p = path.split('?')[0]!.split('/').filter(Boolean); return p.length > 1 ? `/${p[0]}/` : '/'; };
const top = <K,>(m: Map<K, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

export function createLogAnalyzer(): LogAnalyzer {
  let lines = 0; let parsed = 0; let other = 0; let first: string | null = null; let last: string | null = null;
  const stats = new Map<string, BotStats>();
  const search = { hits: 0, urls: new Set<string>(), sections: new Map<string, number>() };
  const ai = { hits: 0, urls: new Set<string>(), sections: new Map<string, number>() };
  const bad = { errors: new Map<string, { n: number; s: number }>(), redirects: new Map<string, { n: number; s: number }>(), parameters: new Map<string, number>(), staticHits: new Map<string, number>(), server: new Map<string, { n: number; s: number }>() };
  const tot = { errors: 0, redirects: 0, parameters: 0, staticHits: 0, server: 0 };
  let botTotal = 0;
  return {
    add(line) {
      if (!line.trim()) return;
      lines++;
      const p = parseLine(line);
      if (!p) return;
      parsed++;
      if (!first || p.day < first) first = p.day;
      if (!last || p.day > last) last = p.day;
      const bot = botFor(p.agent);
      if (!bot) { other++; return; }
      botTotal++;
      const st = stats.get(bot.id) ?? { hits: 0, bytes: 0, status: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }, urls: new Map(), days: new Map() };
      st.hits++; st.bytes += p.bytes;
      const cls = p.status >= 500 ? '5xx' : p.status >= 400 ? '4xx' : p.status >= 300 ? '3xx' : '2xx';
      st.status[cls]++;
      st.urls.set(p.path, (st.urls.get(p.path) ?? 0) + 1);
      st.days.set(p.day, (st.days.get(p.day) ?? 0) + 1);
      stats.set(bot.id, st);
      if (bot.kind === 'search' || bot.kind === 'ai') {
        const bucket = bot.kind === 'search' ? search : ai;
        bucket.hits++; bucket.urls.add(p.path.split('?')[0]!); bucket.sections.set(sectionOf(p.path), (bucket.sections.get(sectionOf(p.path)) ?? 0) + 1);
      }
      if (bot.kind === 'seo-tool') return; // crawl-budget advice is about search and AI crawlers
      const add = (m: Map<string, { n: number; s: number }>) => { const e = m.get(p.path) ?? { n: 0, s: p.status }; e.n++; m.set(p.path, e); };
      if (cls === '4xx') { add(bad.errors); tot.errors++; } else if (cls === '5xx') { add(bad.server); tot.server++; } else if (cls === '3xx') { add(bad.redirects); tot.redirects++; }
      else if (p.path.includes('?')) { bad.parameters.set(p.path, (bad.parameters.get(p.path) ?? 0) + 1); tot.parameters++; }
      else if (STATIC.test(p.path.split('?')[0]!)) { bad.staticHits.set(p.path, (bad.staticHits.get(p.path) ?? 0) + 1); tot.staticHits++; }
    },
    result() {
      const summary = (b: typeof search): CrawlSummary => ({ hits: b.hits, uniqueUrls: b.urls.size, sectionHits: top(b.sections, 8).map(([section, hits]) => ({ section, hits })), paths: [...b.urls].slice(0, 100_000) });
      const crawlTotal = search.hits + ai.hits || 1;
      const mk = (kind: LogReport['issues'][number]['kind'], label: string, hits: number, ex: { path: string; hits: number; status?: number }[], advice: string) => ({ kind, label, hits, share: Math.round((hits / crawlTotal) * 1000) / 10, examples: ex, advice });
      const withStatus = (m: Map<string, { n: number; s: number }>) => [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([path, v]) => ({ path, hits: v.n, status: v.s }));
      const issues = [
        mk('server', 'Server errors (5xx) served to crawlers', tot.server, withStatus(bad.server), 'Fix first: repeated server errors make Google crawl your site less.'),
        mk('errors', 'Pages not found (4xx) that crawlers keep asking for', tot.errors, withStatus(bad.errors), 'Redirect removed pages that have links, or remove the links that point to them.'),
        mk('redirects', 'Crawlers following redirects (3xx)', tot.redirects, withStatus(bad.redirects), 'Update internal links to point straight at the final address.'),
        mk('parameters', 'Crawlers opening addresses with parameters (?…)', tot.parameters, top(bad.parameters, 8).map(([path, hits]) => ({ path, hits })), 'Filters, sorting and tracking parameters can waste crawling. Use canonical tags or robots.txt rules.'),
        mk('static', 'Crawlers fetching files (images, scripts, styles, feeds)', tot.staticHits, top(bad.staticHits, 8).map(([path, hits]) => ({ path, hits })), 'Normal for rendering. Only a concern when it dwarfs page requests.'),
      ].filter((i) => i.hits > 0);
      const bots = [...stats.entries()].map(([id, st]) => {
        const b = BOTS.find((x) => x.id === id)!;
        return { id, label: b.label, kind: b.kind, hits: st.hits, share: botTotal ? Math.round((st.hits / botTotal) * 1000) / 10 : 0, bytes: st.bytes, status: st.status, uniqueUrls: st.urls.size, topUrls: top(st.urls, 10).map(([path, hits]) => ({ path, hits })), perDay: [...st.days.entries()].sort((a, c) => a[0].localeCompare(c[0])).map(([day, hits]) => ({ day, hits })) };
      }).sort((a, b) => b.hits - a.hits);
      return {
        lines, parsed, unparsed: lines - parsed, firstDay: first, lastDay: last, humanOrOtherHits: other, botHits: botTotal, bots,
        crawl: { search: summary(search), ai: summary(ai) }, issues,
        neverCrawledHint: 'To find pages crawlers never visit, compare the crawled addresses with your sitemap.',
      };
    },
  };
}

/** Compares crawled addresses with a list of addresses you expect crawled (for example your sitemap). */
export function neverCrawled(crawledPaths: Iterable<string>, expected: string[]): string[] {
  const seen = new Set<string>();
  for (const p of crawledPaths) seen.add(pathOnly(p));
  return [...new Set(expected.map(pathOnly))].filter((p) => !seen.has(p));
}
export function pathOnly(u: string): string {
  try { const x = new URL(u, 'https://x.invalid'); return (x.pathname.replace(/\/+$/, '') || '/'); } catch { return u.split('?')[0]!.replace(/\/+$/, '') || '/'; }
}
