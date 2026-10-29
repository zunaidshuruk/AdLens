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
import { getTestDataProvider, notConnectedProvider, type BacklinkSummary, type CompetitorKeyword, type DataProvider, type KeywordMetrics } from './dataProvider.js';

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

type Vars = { keywords?: string[]; keyword?: string; domain?: string; country: string };
const varsOf = (v: Vars): Record<string, unknown> => ({ keywords: v.keywords ?? [], keyword: v.keyword ?? '', domain: v.domain ?? '', country: v.country.toLowerCase(), location_code: locationCode(v.country), language: 'en' });
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
}).strict();
export type CustomConfig = z.infer<typeof customConfigSchema>;

export const providerInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dataforseo'), enabled: z.boolean().default(true), credentials: z.object({ login: z.string().trim().min(3).max(200), password: z.string().min(3).max(200) }).optional() }),
  z.object({ kind: z.literal('custom'), enabled: z.boolean().default(true), config: customConfigSchema, credentials: z.object({ secret: z.string().max(500).default(''), username: z.string().max(200).optional() }).optional() }),
]);
export type ProviderInput = z.infer<typeof providerInputSchema>;

/** Checks a custom setup beyond its shape: each address must be a safe https address and each body must be valid JSON. */
export function validateCustomConfig(c: CustomConfig): string | null {
  if (!c.keywordMetrics && !c.competitorKeywords && !c.backlinks) return 'Describe at least one lookup (keyword numbers, competitor keywords or backlinks).';
  if (c.auth.type === 'header' && !c.auth.headerName) return 'Type the name of the header that carries your key.';
  for (const [label, e] of [['Keyword numbers', c.keywordMetrics], ['Competitor keywords', c.competitorKeywords], ['Backlinks', c.backlinks]] as const) {
    if (!e) continue;
    try { validateOutboundUrl(e.url.replace(/\{\{\w+\}\}/g, 'x')); } catch (err) { return `${label}: ${err instanceof Error ? err.message : 'the web address is not valid.'}`; }
    if (e.method === 'POST' && e.body) { try { fillBody(e.body, { country: 'us' }); } catch { return `${label}: the request body is not valid JSON.`; } }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Calling out
// ---------------------------------------------------------------------------
interface Secrets { login?: string; password?: string; secret?: string; username?: string }
export interface ProviderDeps { request: RequestFn; now: () => number }
const defaultDeps = (): ProviderDeps => ({ request: (u, o) => guardedRequest(u, o), now: Date.now });

async function callJson(deps: ProviderDeps, url: string, o: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown }): Promise<unknown> {
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
  try { return JSON.parse(r.text); } catch { throw new ProviderError('The provider did not answer with data we can read.'); }
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
  };
}

// ---------------------------------------------------------------------------
// Saving what a workspace connected
// ---------------------------------------------------------------------------
export interface ProviderRecord {
  id: string; // the workspace id
  kind: 'dataforseo' | 'custom'; enabled: boolean; config: CustomConfig | null; sealedSecret: string;
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
  return r.config ? customProvider(r.config, secrets, deps) : notConnectedProvider;
}

// ---------------------------------------------------------------------------
// Cache and a safety cap, so a loop or a refresh habit cannot run up the customer's bill
// ---------------------------------------------------------------------------
const TTL_MS = 24 * 3_600_000;
const MAX_CALLS_PER_DAY = 300;
const cache = new Map<string, { at: number; value: unknown }>();
export const clearProviderCache = (): void => cache.clear();
const remember = (key: string, value: unknown, now: number) => { if (cache.size > 5000) cache.delete(cache.keys().next().value as string); cache.set(key, { at: now, value }); };
const recall = <T>(key: string, now: number): T | undefined => { const h = cache.get(key); return h && now - h.at < TTL_MS ? (h.value as T) : undefined; };

export function withCache(inner: DataProvider, wsId: string, now: () => number = Date.now): DataProvider {
  const guard = async () => { const r = await checkRateLimit('provider-calls', wsId, MAX_CALLS_PER_DAY, 24 * 3_600_000); if (!r.allowed) throw new ProviderError(`Today's limit of ${MAX_CALLS_PER_DAY} lookups for this workspace is used up. It resets within a day.`); };
  return {
    id: inner.id, name: inner.name, connected: inner.connected,
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
