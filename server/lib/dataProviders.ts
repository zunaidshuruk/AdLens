/**
 * Paid market-data providers, bring your own key (Sprint 45).
 * Each workspace connects its own provider: the ready-made DataForSEO adapter, or a custom adapter the customer describes
 * (web address, how to sign in, where each number sits in the reply). Secrets are sealed and bound to the person who saved them.
 * Results are cached so the same lookup is never paid for twice in a day.
 */
import { z } from 'zod';
import { getAdminFirestore } from './firestore.js';
import { checkRateLimit } from './rateLimiter.js';
import { openAgentSecret } from './tokenVault.js';
import { getAgentKeyring } from './vault.js';
import { guardedRequest, validateOutboundUrl, type RequestFn } from './ssrfGuard.js';
import { getTestDataProvider, notConnectedProvider, type BacklinkSummary, type CompetitorKeyword, type MapsPlace, type DataProvider, type KeywordMetrics } from './dataProvider.js';

export class ProviderError extends Error {}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const LOCATION_CODES: Record<string, number> = { us: 2840, gb: 2826, uk: 2826, ca: 2124, au: 2036, in: 2356, bd: 2050, pk: 2586, de: 2276, fr: 250, es: 724, it: 380, nl: 528, ae: 784, sa: 682, sg: 702, my: 458, id: 360, ph: 608, za: 710, ng: 566, ke: 404, eg: 818, br: 76, mx: 484, jp: 392 };
export const COUNTRIES = Object.keys(LOCATION_CODES).filter((c) => c !== 'uk');
export const locationCode = (country: string): number => LOCATION_CODES[country.toLowerCase()] ?? 2840;

export function getPath(value: unknown, path: string): unknown {
  if (!path.trim()) return value;
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) { const i = Number(part); if (!Number.isInteger(i)) return undefined; cur = cur[i]; continue; }
    if (typeof cur !== 'object') return undefined;
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    cur = Object.prototype.hasOwnProperty.call(cur, part) ? (cur as Record<string, unknown>)[part] : undefined;
  }
  return cur;
}
const toNum = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const toStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

type Vars = { keywords?: string[]; keyword?: string; domain?: string; country: string; lat?: number; lng?: number; zoom?: number };
const varsOf = (v: Vars): Record<string, unknown> => ({ keywords: v.keywords ?? [], keyword: v.keyword ?? '', domain: v.domain ?? '', country: v.country.toLowerCase(), location_code: locationCode(v.country), language: 'en', lat: v.lat ?? 0, lng: v.lng ?? 0, zoom: v.zoom ?? 14 });
const asText = (x: unknown) => (Array.isArray(x) ? x.join(',') : String(x));

/** Fills {{placeholders}} in a web address (values are URL-encoded). */
export const fillUrl = (tpl: string, v: Vars): string => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => encodeURIComponent(asText(varsOf(v)[k] ?? '')));
/** Fills a JSON body template. A value that is exactly "{{name}}" is replaced by the real value (a list stays a list); inside longer text it is replaced as text. Nothing is ever pasted into the JSON structure itself. */
export function fillBody(tpl: string, v: Vars): unknown {
  const vars = varsOf(v);
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      const whole = /^\{\{(\w+)\}\}$/.exec(x);
      if (whole) return vars[whole[1]!] ?? '';
      return x.replace(/\{\{(\w+)\}\}/g, (_, k: string) => asText(vars[k] ?? ''));
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, walk(val)]));
    return x;
  };
  return walk(JSON.parse(tpl));
}

// ---------------------------------------------------------------------------
// Configuration shapes
// ---------------------------------------------------------------------------
const path = z.string().trim().max(200).default('');
const endpoint = z.object({ method: z.enum(['GET', 'POST']).default('GET'), url: z.string().trim().min(8).max(1000), body: z.string().max(4000).optional(), itemsPath: path });
export const customConfigSchema = z.object({
  name: z.string().trim().min(2).max(60),
  auth: z.object({ type: z.enum(['none', 'bearer', 'header', 'basic']), headerName: z.string().trim().max(60).regex(/^[A-Za-z0-9-]*$/).optional() }),
  keywordMetrics: endpoint.extend({ fields: z.object({ keyword: path, volume: path, cpc: path, difficulty: path, competition: path }) }).optional(),
  competitorKeywords: endpoint.extend({ fields: z.object({ keyword: path, position: path, volume: path, url: path }) }).optional(),
  backlinks: endpoint.extend({ fields: z.object({ referringDomains: path, backlinks: path, authority: path }) }).optional(),
  mapsSearch: endpoint.extend({ fields: z.object({ name: path, position: path, rating: path, reviews: path, category: path, address: path, website: path, placeId: path }) }).optional(),
}).strict();
export type CustomConfig = z.infer<typeof customConfigSchema>;

export const providerInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dataforseo'), enabled: z.boolean().default(true), credentials: z.object({ login: z.string().trim().min(3).max(200), password: z.string().min(3).max(200) }).optional() }),
  z.object({ kind: z.enum(['semrush', 'ahrefs', 'serpapi']), enabled: z.boolean().default(true), credentials: z.object({ secret: z.string().trim().min(8, 'Paste your API key.').max(300) }).optional() }),
  z.object({ kind: z.literal('custom'), enabled: z.boolean().default(true), config: customConfigSchema, credentials: z.object({ secret: z.string().max(500).default(''), username: z.string().max(200).optional() }).optional() }),
]);
export type ProviderInput = z.infer<typeof providerInputSchema>;

/** Checks a custom setup beyond its shape: each address must be a safe https address and each body must be valid JSON. */
export function validateCustomConfig(c: CustomConfig): string | null {
  if (!c.keywordMetrics && !c.competitorKeywords && !c.backlinks && !c.mapsSearch) return 'Describe at least one lookup (keyword numbers, competitor keywords, backlinks or map results).';
  if (c.auth.type === 'header' && !c.auth.headerName) return 'Type the name of the header that carries your key.';
  for (const [label, e] of [['Keyword numbers', c.keywordMetrics], ['Competitor keywords', c.competitorKeywords], ['Backlinks', c.backlinks], ['Map results', c.mapsSearch]] as const) {
    if (!e) continue;
    try { validateOutboundUrl(e.url.replace(/\{\{\w+\}\}/g, 'x')); } catch (err) { return `${label}: ${err instanceof Error ? err.message : 'the web address is not valid.'}`; }
    if (e.method === 'POST' && e.body) { try { fillBody(e.body, { country: 'us', lat: 1, lng: 1, zoom: 14 }); } catch { return `${label}: the request body is not valid JSON.`; } }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Calling out
// ---------------------------------------------------------------------------
interface Secrets { login?: string; password?: string; secret?: string; username?: string }
export interface ProviderDeps { request: RequestFn; now: () => number }
const defaultDeps = (): ProviderDeps => ({ request: (u, o) => guardedRequest(u, o), now: Date.now });

async function callText(deps: ProviderDeps, url: string, o: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown }): Promise<string> {
  let u: URL;
  try { u = validateOutboundUrl(url); } catch (e) { throw new ProviderError(e instanceof Error ? e.message : 'The provider address is not valid.'); }
  let r;
  try {
    r = await deps.request(u, { method: o.method, headers: { Accept: 'application/json', ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...o.headers }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}), timeoutMs: 25_000, maxResponseBytes: 2_000_000 });
  } catch { throw new ProviderError('The data provider could not be reached.'); }
  if (r.status === 401 || r.status === 403) throw new ProviderError('The provider did not accept your sign-in details. Check them and try again.');
  if (r.status === 402) throw new ProviderError('The provider says your account is out of credit.');
  if (r.status === 429) throw new ProviderError('The provider says you are sending too many requests. Try again later.');
  if (r.status >= 400) throw new ProviderError(`The provider answered with an error (${r.status}).`);
  return r.text;
}
async function callJson(deps: ProviderDeps, url: string, o: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown }): Promise<unknown> {
  const text = await callText(deps, url, o);
  try { return JSON.parse(text); } catch { throw new ProviderError('The provider did not answer with data we can read.'); }
}

// ---------------------------------------------------------------------------
// DataForSEO
// ---------------------------------------------------------------------------
const DFS = 'https://api.dataforseo.com/v3';
export function dataForSeoProvider(secrets: Secrets, deps: ProviderDeps = defaultDeps()): DataProvider {
  if (!secrets.login || !secrets.password) return notConnectedProvider;
  const headers = { Authorization: `Basic ${Buffer.from(`${secrets.login}:${secrets.password}`).toString('base64')}` };
  const post = async (endpointPath: string, task: Record<string, unknown>): Promise<unknown[]> => {
    const j = await callJson(deps, `${DFS}/${endpointPath}`, { method: 'POST', headers, body: [task] });
    const top = toNum(getPath(j, 'status_code'));
    if (top !== null && top !== 20000) throw new ProviderError(`DataForSEO: ${toStr(getPath(j, 'status_message')) ?? 'the request was refused.'}`);
    const t = toNum(getPath(j, 'tasks.0.status_code'));
    if (t !== null && t !== 20000) throw new ProviderError(`DataForSEO: ${toStr(getPath(j, 'tasks.0.status_message')) ?? 'the request was refused.'}`);
    const result = getPath(j, 'tasks.0.result');
    return Array.isArray(result) ? result : [];
  };
  return {
    id: 'dataforseo', name: 'DataForSEO', connected: true,
    async keywordMetrics(keywords, country) {
      const loc = locationCode(country);
      const list = [...new Set(keywords.map((k) => k.toLowerCase()))].slice(0, 1000);
      if (list.length === 0) return [];
      const vol = await post('keywords_data/google_ads/search_volume/live', { keywords: list, location_code: loc, language_code: 'en' });
      const diff = new Map<string, number>();
      try {
        const r = await post('dataforseo_labs/google/bulk_keyword_difficulty/live', { keywords: list, location_code: loc, language_code: 'en' });
        const items = getPath(r, '0.items');
        if (Array.isArray(items)) for (const it of items) { const k = toStr(getPath(it, 'keyword')); const d = toNum(getPath(it, 'keyword_difficulty')); if (k && d !== null) diff.set(k, d); }
      } catch { /* difficulty is a bonus; volume and cost still come through */ }
      return vol.map((row): KeywordMetrics => {
        const keyword = toStr(getPath(row, 'keyword')) ?? '';
        return { keyword, volume: toNum(getPath(row, 'search_volume')), cpc: toNum(getPath(row, 'cpc')), difficulty: diff.get(keyword) ?? null, competition: toNum(getPath(row, 'competition_index')) };
      }).filter((m) => m.keyword);
    },
    async competitorKeywords(domain, country) {
      const r = await post('dataforseo_labs/google/ranked_keywords/live', { target: domain, location_code: locationCode(country), language_code: 'en', limit: 100, item_types: ['organic'] });
      const items = getPath(r, '0.items');
      if (!Array.isArray(items)) return [];
      return items.map((it): CompetitorKeyword | null => {
        const keyword = toStr(getPath(it, 'keyword_data.keyword')); const position = toNum(getPath(it, 'ranked_serp_element.serp_item.rank_group'));
        return keyword && position !== null ? { keyword, position, volume: toNum(getPath(it, 'keyword_data.keyword_info.search_volume')), url: toStr(getPath(it, 'ranked_serp_element.serp_item.url')) } : null;
      }).filter((x): x is CompetitorKeyword => x !== null);
    },
    async backlinks(domain) {
      const r = await post('backlinks/summary/live', { target: domain, rank_scale: 'one_hundred' });
      const row = r[0];
      if (!row) return null;
      return { domain, referringDomains: toNum(getPath(row, 'referring_domains')), backlinks: toNum(getPath(row, 'backlinks')), authority: toNum(getPath(row, 'rank')) };
    },
    async mapsSearch(q) {
      const r = await post('serp/google/maps/live/advanced', { keyword: q.keyword, location_coordinate: `${q.lat.toFixed(6)},${q.lng.toFixed(6)},${q.zoom}z`, language_code: 'en', depth: 20 });
      const items = getPath(r, '0.items');
      if (!Array.isArray(items)) return [];
      return items.map((it, i): MapsPlace | null => {
        const name = toStr(getPath(it, 'title'));
        if (!name) return null;
        return { name, placeId: toStr(getPath(it, 'place_id')) ?? toStr(getPath(it, 'cid')), rank: toNum(getPath(it, 'rank_group')) ?? i + 1, rating: toNum(getPath(it, 'rating.value')), reviews: toNum(getPath(it, 'rating.votes_count')), category: toStr(getPath(it, 'category')), address: toStr(getPath(it, 'address')), website: toStr(getPath(it, 'domain')) ?? toStr(getPath(it, 'url')) };
      }).filter((x): x is MapsPlace => x !== null);
    },
  };
}

// ---------------------------------------------------------------------------
// Ready-made providers that only need one API key: Semrush, Ahrefs, SerpApi (built from each company's published API reference)
// ---------------------------------------------------------------------------
export type KeyProviderKind = 'semrush' | 'ahrefs' | 'serpapi';
export const KEY_PROVIDERS: Record<KeyProviderKind, { name: string; offers: { keywords: boolean; backlinks: boolean; maps: boolean } }> = {
  semrush: { name: 'Semrush', offers: { keywords: true, backlinks: true, maps: false } },
  ahrefs: { name: 'Ahrefs', offers: { keywords: true, backlinks: true, maps: false } },
  serpapi: { name: 'SerpApi', offers: { keywords: false, backlinks: false, maps: true } },
};
export const isKeyProvider = (k: string): k is KeyProviderKind => k === 'semrush' || k === 'ahrefs' || k === 'serpapi';
const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

/** Semrush answers with semicolon-separated text (a header row, then rows), or a line such as "ERROR 50 :: NOTHING FOUND". */
export function parseSemrush(text: string): Record<string, string>[] {
  const t = text.trim();
  if (!t) return [];
  if (/^ERROR/i.test(t)) {
    if (/^ERROR\s*50\b/i.test(t)) return [];
    if (/^ERROR\s*(120|130|131|132|133|134|135)\b/i.test(t)) throw new ProviderError('Semrush did not accept your API key, or your account has no API units left.');
    throw new ProviderError('Semrush refused the request.');
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0]!.split(';').map((h) => h.trim());
  return lines.slice(1).map((l) => { const cells = l.split(';'); return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()])); });
}
const semrushDb = (country: string): string => { const c = country.toLowerCase(); return c === 'gb' ? 'uk' : c; };

/** A cell as a number, with an empty cell meaning unknown (not zero). */
const cell = (v: string | undefined): number | null => (v === undefined || v.trim() === '' ? null : toNum(v));
export function semrushProvider(secrets: Secrets, deps: ProviderDeps = defaultDeps()): DataProvider {
  const key = secrets.secret;
  if (!key) return notConnectedProvider;
  const get = async (base: string, params: Record<string, string>): Promise<Record<string, string>[]> => {
    const u = new URL(base);
    u.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return parseSemrush(await callText(deps, u.toString(), { method: 'GET', headers: { Accept: 'text/plain' } }));
  };
  return {
    id: 'semrush', name: 'Semrush', connected: true, offers: KEY_PROVIDERS.semrush.offers,
    async keywordMetrics(keywords, country) {
      const list = [...new Set(keywords.map((k) => k.toLowerCase().replace(/;/g, ' ').trim()).filter(Boolean))].slice(0, 300);
      const out: KeywordMetrics[] = [];
      for (const part of chunk(list, 100)) {
        const rows = await get('https://api.semrush.com/', { type: 'phrase_these', phrase: part.join(';'), database: semrushDb(country), export_columns: 'Ph,Nq,Cp,Co,Kd' });
        for (const r of rows) {
          const keyword = (r['Keyword'] ?? '').toLowerCase(); if (!keyword) continue;
          const co = cell(r['Competition']);
          out.push({ keyword, volume: cell(r['Search Volume']), cpc: cell(r['CPC']), difficulty: cell(r['Keyword Difficulty Index']), competition: co === null ? null : Math.round(co * 100) });
        }
      }
      return out;
    },
    async competitorKeywords(domain, country) {
      const rows = await get('https://api.semrush.com/', { type: 'domain_organic', domain, database: semrushDb(country), display_limit: '100', export_columns: 'Ph,Po,Nq,Ur' });
      return rows.map((r): CompetitorKeyword | null => { const keyword = r['Keyword']; const position = cell(r['Position']); return keyword && position !== null ? { keyword, position, volume: cell(r['Search Volume']), url: r['Url'] || null } : null; }).filter((x): x is CompetitorKeyword => x !== null);
    },
    async backlinks(domain) {
      const rows = await get('https://api.semrush.com/analytics/v1/', { type: 'backlinks_overview', target: domain, target_type: 'root_domain', export_columns: 'ascore,total,domains_num' });
      const r = rows[0]; if (!r) return null;
      return { domain, referringDomains: cell(r['domains_num']), backlinks: cell(r['total']), authority: cell(r['ascore']) };
    },
  };
}

const ahrefsCountry = (c: string): string => { const x = c.toLowerCase(); return x === 'uk' ? 'gb' : x; };
export function ahrefsProvider(secrets: Secrets, deps: ProviderDeps = defaultDeps()): DataProvider {
  const key = secrets.secret;
  if (!key) return notConnectedProvider;
  const get = async (pathName: string, params: Record<string, string>): Promise<unknown> => {
    const u = new URL(`https://api.ahrefs.com/v3/${pathName}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const j = await callJson(deps, u.toString(), { method: 'GET', headers: { Authorization: `Bearer ${key}` } });
    const err = toStr(getPath(j, 'error'));
    if (err) throw new ProviderError(`Ahrefs: ${err.slice(0, 160)}`);
    return j;
  };
  const today = () => new Date(deps.now()).toISOString().slice(0, 10);
  return {
    id: 'ahrefs', name: 'Ahrefs', connected: true, offers: KEY_PROVIDERS.ahrefs.offers,
    async keywordMetrics(keywords, country) {
      const list = [...new Set(keywords.map((k) => k.toLowerCase().replace(/,/g, ' ').trim()).filter(Boolean))].slice(0, 300);
      const out: KeywordMetrics[] = [];
      for (const part of chunk(list, 100)) {
        const j = await get('keywords-explorer/overview', { select: 'keyword,volume,difficulty,cpc', country: ahrefsCountry(country), keywords: part.join(',') });
        const rows = getPath(j, 'keywords');
        if (!Array.isArray(rows)) continue;
        for (const r of rows) {
          const keyword = (toStr(getPath(r, 'keyword')) ?? '').toLowerCase(); if (!keyword) continue;
          const cents = toNum(getPath(r, 'cpc'));
          out.push({ keyword, volume: toNum(getPath(r, 'volume')), cpc: cents === null ? null : Math.round(cents) / 100, difficulty: toNum(getPath(r, 'difficulty')), competition: null });
        }
      }
      return out;
    },
    async competitorKeywords(domain, country) {
      const j = await get('site-explorer/organic-keywords', { select: 'keyword,best_position,best_position_url,volume', target: domain, date: today(), country: ahrefsCountry(country), limit: '100' });
      const rows = getPath(j, 'keywords');
      if (!Array.isArray(rows)) return [];
      return rows.map((r): CompetitorKeyword | null => { const keyword = toStr(getPath(r, 'keyword')); const position = toNum(getPath(r, 'best_position')); return keyword && position !== null ? { keyword, position, volume: toNum(getPath(r, 'volume')), url: toStr(getPath(r, 'best_position_url')) } : null; }).filter((x): x is CompetitorKeyword => x !== null);
    },
    async backlinks(domain) {
      const date = today();
      const dr = await get('site-explorer/domain-rating', { target: domain, date });
      const stats = await get('site-explorer/backlinks-stats', { target: domain, date, mode: 'domain' });
      const authority = toNum(getPath(dr, 'domain_rating.domain_rating'));
      const referringDomains = toNum(getPath(stats, 'metrics.live_refdomains')); const backlinks = toNum(getPath(stats, 'metrics.live'));
      if (authority === null && referringDomains === null && backlinks === null) return null;
      return { domain, referringDomains, backlinks, authority };
    },
  };
}

export function serpApiProvider(secrets: Secrets, deps: ProviderDeps = defaultDeps()): DataProvider {
  const key = secrets.secret;
  if (!key) return notConnectedProvider;
  return {
    id: 'serpapi', name: 'SerpApi', connected: true, offers: KEY_PROVIDERS.serpapi.offers,
    async keywordMetrics() { return []; },
    async competitorKeywords() { return []; },
    async backlinks() { return null; },
    async mapsSearch(q) {
      const u = new URL('https://serpapi.com/search.json');
      u.searchParams.set('engine', 'google_maps'); u.searchParams.set('type', 'search'); u.searchParams.set('q', q.keyword);
      u.searchParams.set('ll', `@${q.lat.toFixed(6)},${q.lng.toFixed(6)},${q.zoom}z`); u.searchParams.set('api_key', key);
      const j = await callJson(deps, u.toString(), { method: 'GET', headers: {} });
      const rows = getPath(j, 'local_results');
      if (!Array.isArray(rows)) { const err = toStr(getPath(j, 'error')); if (err && !/hasn't returned any results/i.test(err)) throw new ProviderError(`SerpApi: ${err.slice(0, 160)}`); return []; }
      return rows.map((it, i): MapsPlace | null => {
        const name = toStr(getPath(it, 'title')); if (!name) return null;
        return { name, placeId: toStr(getPath(it, 'place_id')), rank: toNum(getPath(it, 'position')) ?? i + 1, rating: toNum(getPath(it, 'rating')), reviews: toNum(getPath(it, 'reviews')), category: toStr(getPath(it, 'type')), address: toStr(getPath(it, 'address')), website: toStr(getPath(it, 'website')) };
      }).filter((x): x is MapsPlace => x !== null).slice(0, 30);
    },
  };
}

// ---------------------------------------------------------------------------
// Custom adapter
// ---------------------------------------------------------------------------
function authHeaders(c: CustomConfig, s: Secrets): Record<string, string> {
  if (c.auth.type === 'bearer' && s.secret) return { Authorization: `Bearer ${s.secret}` };
  if (c.auth.type === 'header' && s.secret && c.auth.headerName) return { [c.auth.headerName]: s.secret };
  if (c.auth.type === 'basic') return { Authorization: `Basic ${Buffer.from(`${s.username ?? ''}:${s.secret ?? ''}`).toString('base64')}` };
  return {};
}
type AnyEndpoint = { method: 'GET' | 'POST'; url: string; body?: string | undefined; itemsPath: string };
export function customProvider(c: CustomConfig, secrets: Secrets, deps: ProviderDeps = defaultDeps()): DataProvider {
  const headers = authHeaders(c, secrets);
  const run = async (e: AnyEndpoint, v: Vars): Promise<unknown> => {
    const body = e.method === 'POST' && e.body ? fillBody(e.body, v) : undefined;
    return callJson(deps, fillUrl(e.url, v), { method: e.method, headers, ...(body !== undefined ? { body } : {}) });
  };
  const items = (j: unknown, p: string): unknown[] => { const x = getPath(j, p); return Array.isArray(x) ? x : x && typeof x === 'object' ? [x] : []; };
  return {
    id: 'custom', name: c.name, connected: true,
    async keywordMetrics(keywords, country) {
      const e = c.keywordMetrics; if (!e) return [];
      const j = await run(e, { keywords, country });
      return items(j, e.itemsPath).map((it): KeywordMetrics => ({ keyword: (toStr(getPath(it, e.fields.keyword)) ?? '').toLowerCase(), volume: toNum(getPath(it, e.fields.volume)), cpc: toNum(getPath(it, e.fields.cpc)), difficulty: toNum(getPath(it, e.fields.difficulty)), competition: toNum(getPath(it, e.fields.competition)) })).filter((m) => m.keyword);
    },
    async competitorKeywords(domain, country) {
      const e = c.competitorKeywords; if (!e) return [];
      const j = await run(e, { domain, country });
      return items(j, e.itemsPath).map((it): CompetitorKeyword | null => {
        const keyword = toStr(getPath(it, e.fields.keyword)); const position = toNum(getPath(it, e.fields.position));
        return keyword && position !== null ? { keyword, position, volume: toNum(getPath(it, e.fields.volume)), url: toStr(getPath(it, e.fields.url)) } : null;
      }).filter((x): x is CompetitorKeyword => x !== null).slice(0, 200);
    },
    async backlinks(domain) {
      const e = c.backlinks; if (!e) return null;
      const j = await run(e, { domain, country: 'us' });
      const row = items(j, e.itemsPath)[0];
      if (!row) return null;
      return { domain, referringDomains: toNum(getPath(row, e.fields.referringDomains)), backlinks: toNum(getPath(row, e.fields.backlinks)), authority: toNum(getPath(row, e.fields.authority)) };
    },
    ...(c.mapsSearch ? {
      async mapsSearch(q: { keyword: string; lat: number; lng: number; zoom: number }): Promise<MapsPlace[]> {
        const e = c.mapsSearch!;
        const j = await run(e, { keyword: q.keyword, country: 'us', lat: q.lat, lng: q.lng, zoom: q.zoom });
        return items(j, e.itemsPath).map((it, i): MapsPlace | null => {
          const name = toStr(getPath(it, e.fields.name)); if (!name) return null;
          return { name, placeId: toStr(getPath(it, e.fields.placeId)), rank: toNum(getPath(it, e.fields.position)) ?? i + 1, rating: toNum(getPath(it, e.fields.rating)), reviews: toNum(getPath(it, e.fields.reviews)), category: toStr(getPath(it, e.fields.category)), address: toStr(getPath(it, e.fields.address)), website: toStr(getPath(it, e.fields.website)) };
        }).filter((x): x is MapsPlace => x !== null).slice(0, 30);
      },
    } : {}),
  };
}

// ---------------------------------------------------------------------------
// Saving what a workspace connected
// ---------------------------------------------------------------------------
export interface ProviderRecord {
  id: string; // the workspace id
  kind: 'dataforseo' | 'custom' | KeyProviderKind; enabled: boolean; config: CustomConfig | null; sealedSecret: string;
  createdBy: string; createdAt: string; updatedAt: string; lastTestedAt: string | null; lastTestOk: boolean | null; lastError: string | null;
}
export interface ProviderStore { get(wsId: string): Promise<ProviderRecord | null>; put(r: ProviderRecord): Promise<void>; delete(wsId: string): Promise<boolean> }
const COLLECTION = 'dataProviders';
const firestoreStore: ProviderStore = {
  async get(id) { const s = await getAdminFirestore().collection(COLLECTION).doc(id).get(); return s.exists ? ({ ...(s.data() as object), id: s.id } as ProviderRecord) : null; },
  async put(r) { const { id, ...rest } = r; await getAdminFirestore().collection(COLLECTION).doc(id).set(rest); },
  async delete(id) { const ref = getAdminFirestore().collection(COLLECTION).doc(id); const s = await ref.get(); if (!s.exists) return false; await ref.delete(); return true; },
};
export function createInMemoryProviderStore(): ProviderStore {
  const m = new Map<string, ProviderRecord>();
  return { async get(id) { const v = m.get(id); return v ? structuredClone(v) : null; }, async put(r) { m.set(r.id, structuredClone(r)); }, async delete(id) { return m.delete(id); } };
}
let testStore: ProviderStore | null = null;
export const setTestProviderStore = (s: ProviderStore | null): void => { testStore = s; };
export const getProviderStore = (): ProviderStore => testStore ?? firestoreStore;
export const secretScope = (wsId: string) => `dp-${wsId}`;

export function buildFromRecord(r: ProviderRecord, secrets: Secrets, deps?: ProviderDeps): DataProvider {
  if (r.kind === 'dataforseo') return dataForSeoProvider(secrets, deps);
  if (r.kind === 'semrush') return semrushProvider(secrets, deps);
  if (r.kind === 'ahrefs') return ahrefsProvider(secrets, deps);
  if (r.kind === 'serpapi') return serpApiProvider(secrets, deps);
  return r.config ? customProvider(r.config, secrets, deps) : notConnectedProvider;
}

// ---------------------------------------------------------------------------
// Cache and a safety cap, so a loop or a refresh habit cannot run up the customer's bill
// ---------------------------------------------------------------------------
const TTL_MS = 24 * 3_600_000;
const MAX_CALLS_PER_DAY = 300;
export const MAX_MAPS_PER_DAY = 1500;
const cache = new Map<string, { at: number; value: unknown }>();
export const clearProviderCache = (): void => cache.clear();
const remember = (key: string, value: unknown, now: number) => { if (cache.size > 5000) cache.delete(cache.keys().next().value as string); cache.set(key, { at: now, value }); };
const recall = <T>(key: string, now: number): T | undefined => { const h = cache.get(key); return h && now - h.at < TTL_MS ? (h.value as T) : undefined; };

export function withCache(inner: DataProvider, wsId: string, now: () => number = Date.now): DataProvider {
  const guard = async () => { const r = await checkRateLimit('provider-calls', wsId, MAX_CALLS_PER_DAY, 24 * 3_600_000); if (!r.allowed) throw new ProviderError(`Today's limit of ${MAX_CALLS_PER_DAY} lookups for this workspace is used up. It resets within a day.`); };
  return {
    id: inner.id, name: inner.name, connected: inner.connected, ...(inner.offers ? { offers: inner.offers } : {}),
    async keywordMetrics(keywords, country) {
      const t = now(); const out: KeywordMetrics[] = []; const missing: string[] = [];
      for (const k of new Set(keywords.map((x) => x.toLowerCase()))) { const hit = recall<KeywordMetrics>(`${wsId}|km|${country}|${k}`, t); if (hit) out.push(hit); else missing.push(k); }
      if (missing.length) {
        await guard();
        const got = await inner.keywordMetrics(missing, country);
        for (const m of got) { remember(`${wsId}|km|${country}|${m.keyword}`, m, t); out.push(m); }
      }
      return out;
    },
    async competitorKeywords(domain, country) {
      const key = `${wsId}|ck|${country}|${domain}`; const t = now(); const hit = recall<CompetitorKeyword[]>(key, t); if (hit) return hit;
      await guard(); const v = await inner.competitorKeywords(domain, country); remember(key, v, t); return v;
    },
    ...(inner.mapsSearch ? {
      // Map lookups are never cached (a re-scan should be fresh) but have their own, larger daily cap.
      async mapsSearch(q: { keyword: string; lat: number; lng: number; zoom: number }): Promise<MapsPlace[]> {
        const r = await checkRateLimit('maps-calls', wsId, MAX_MAPS_PER_DAY, 24 * 3_600_000);
        if (!r.allowed) throw new ProviderError(`Today's limit of ${MAX_MAPS_PER_DAY} map lookups for this workspace is used up. It resets within a day.`);
        return inner.mapsSearch!(q);
      },
    } : {}),
    async backlinks(domain) {
      const key = `${wsId}|bl|${domain}`; const t = now(); const hit = recall<BacklinkSummary | null>(key, t); if (hit !== undefined) return hit;
      await guard(); const v = await inner.backlinks(domain); remember(key, v, t); return v;
    },
  };
}

/** The provider this workspace connected (cached), or "not connected". Never throws: a broken connection reads as not connected. */
export async function getProviderFor(wsId: string): Promise<DataProvider> {
  const stand = getTestDataProvider();
  if (stand) return stand;
  try {
    const r = await getProviderStore().get(wsId);
    if (!r || !r.enabled) return notConnectedProvider;
    const secrets = JSON.parse(openAgentSecret(r.sealedSecret, r.createdBy, secretScope(wsId), getAgentKeyring())) as Secrets;
    return withCache(buildFromRecord(r, secrets), wsId);
  } catch { return notConnectedProvider; }
}
