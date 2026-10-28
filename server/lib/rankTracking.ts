/**
 * Rank tracking and keyword manager (Sprint 39).
 * Free data: Google Search Console already knows the average position of every search phrase on every day.
 * We save a daily copy for the phrases the team tracks, so history builds up beyond what Google keeps (about 16 months) and charts load fast.
 * Honest limit: this is the position of YOUR site as Google reports it (an average, only on days it showed). It is not a live check of a competitor.
 */
import { z } from 'zod';
import { getAdminFirestore } from './firestore.js';
import type { ProjectDocsStore, StoredDoc } from './projectDocs.js';
import { expectedCtr } from './seoOpportunities.js';
import { classifyIntent, type Intent } from './seoKeywords.js';

export const MAX_KEYWORDS_PER_LIST = 500;
export const KEEP_DAYS = 400;
const DAY = 86_400_000;

export interface KeywordList { id: string; name: string; keywords: string[]; tracked: boolean; createdBy: string; createdAt: string; updatedAt: string }
/** One day for one tracked phrase: k = phrase, p = average position, c = clicks, i = impressions. */
export interface RankRow { k: string; p: number; c: number; i: number }
export interface RankDay { id: string; rows: RankRow[] }

export const normaliseKeyword = (k: string): string => k.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Turns pasted text (one per line or comma separated) into clean, unique phrases. */
export function parseKeywords(text: string, max = MAX_KEYWORDS_PER_LIST): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n\r,;]+/)) {
    const k = normaliseKeyword(part);
    if (k.length < 2 || k.length > 100 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

export const listInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the list a name').max(60),
  keywords: z.array(z.string().max(120)).max(MAX_KEYWORDS_PER_LIST * 2).default([]),
  /** Or paste text; parsed on the server. */
  text: z.string().max(60_000).optional(),
  tracked: z.boolean().default(true),
});

export const toList = (d: StoredDoc): KeywordList => ({
  id: d.id,
  name: String(d.name ?? ''),
  keywords: Array.isArray(d.keywords) ? (d.keywords as unknown[]).map(String) : [],
  tracked: d.tracked !== false,
  createdBy: String(d.createdBy ?? ''),
  createdAt: String(d.createdAt ?? ''),
  updatedAt: String(d.updatedAt ?? ''),
});

/** Every phrase that is in a list marked "track", without repeats. */
export function trackedKeywords(lists: KeywordList[]): string[] {
  const out = new Set<string>();
  for (const l of lists) if (l.tracked) for (const k of l.keywords) out.add(normaliseKeyword(k));
  return [...out];
}

// ---------------------------------------------------------------------------
// Reading Search Console
// ---------------------------------------------------------------------------

export type ScQuery = (payload: { startDate: string; endDate: string; dimensions: string[]; rowLimit: number; startRow: number }) => Promise<{ rows?: { keys?: string[]; clicks?: number; impressions?: number; position?: number }[] }>;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const lastCompleteDay = (nowMs: number): string => isoDay(nowMs - 3 * DAY); // Search Console lags a couple of days

/** Reads day-by-day rows for the tracked phrases (pages through up to 200,000 Search Console rows). */
export async function fetchRankDays(query: ScQuery, tracked: string[], startDate: string, endDate: string): Promise<RankDay[]> {
  const want = new Set(tracked);
  const byDay = new Map<string, RankRow[]>();
  const PAGE = 25_000;
  for (let page = 0; page < 8; page++) {
    const resp = await query({ startDate, endDate, dimensions: ['date', 'query'], rowLimit: PAGE, startRow: page * PAGE });
    const rows = resp.rows ?? [];
    for (const r of rows) {
      const [date, q] = r.keys ?? [];
      if (!date || !q) continue;
      const k = normaliseKeyword(q);
      if (!want.has(k)) continue;
      const list = byDay.get(date) ?? [];
      list.push({ k, p: Math.round((r.position ?? 0) * 100) / 100, c: r.clicks ?? 0, i: r.impressions ?? 0 });
      byDay.set(date, list);
    }
    if (rows.length < PAGE) break;
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, rows]) => ({ id, rows }));
}

/** Newer data replaces older data for the same day; days older than KEEP_DAYS are dropped. */
export function mergeDays(existing: RankDay[], fresh: RankDay[], today: string): RankDay[] {
  const map = new Map(existing.map((d) => [d.id, d]));
  for (const d of fresh) map.set(d.id, d);
  const cutoff = isoDay(Date.parse(today) - KEEP_DAYS * DAY);
  return [...map.values()].filter((d) => d.id >= cutoff).sort((a, b) => a.id.localeCompare(b.id));
}

export function daysToPrune(existing: RankDay[], today: string): string[] {
  const cutoff = isoDay(Date.parse(today) - KEEP_DAYS * DAY);
  return existing.filter((d) => d.id < cutoff).map((d) => d.id);
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface KeywordRank {
  keyword: string;
  position: number | null;
  previous: number | null;
  /** Positive = moved up (better). */
  change: number | null;
  clicks: number;
  impressions: number;
  best: number | null;
  intent: Intent;
  trend: (number | null)[];
}
export interface RankSummary {
  asOf: string;
  trackedCount: number;
  rankingCount: number;
  buckets: { top3: number; top10: number; top20: number; top50: number; below50: number; notRanking: number };
  /** 0 to 100: how much of the traffic a #1 spot on every phrase would bring, that you are getting by your positions. */
  visibility: number;
  visibilityPrevious: number | null;
  averagePosition: number | null;
  series: { date: string; averagePosition: number | null; visibility: number; clicks: number; impressions: number }[];
  volatility: { score: number; label: 'calm' | 'normal' | 'bumpy' | 'stormy' | 'unknown' };
  keywords: KeywordRank[];
  winners: KeywordRank[];
  losers: KeywordRank[];
}

interface Agg { p: number; c: number; i: number }
function windowAgg(byDay: Map<string, Map<string, RankRow>>, k: string, from: string, to: string): Agg | null {
  let w = 0; let pw = 0; let c = 0; let i = 0;
  for (const [date, rows] of byDay) {
    if (date < from || date > to) continue;
    const r = rows.get(k);
    if (!r) continue;
    const weight = Math.max(r.i, 1);
    w += weight; pw += r.p * weight; c += r.c; i += r.i;
  }
  return w === 0 ? null : { p: pw / w, c, i };
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const addDays = (date: string, n: number) => isoDay(Date.parse(date) + n * DAY);

export function summariseRank(days: RankDay[], tracked: string[], asOfOverride?: string): RankSummary {
  const byDay = new Map<string, Map<string, RankRow>>();
  for (const d of days) byDay.set(d.id, new Map(d.rows.map((r) => [r.k, r])));
  const asOf = asOfOverride ?? (days.length ? days[days.length - 1]!.id : isoDay(Date.now()));
  const curFrom = addDays(asOf, -6);
  const prevFrom = addDays(asOf, -13);
  const prevTo = addDays(asOf, -7);
  const total = Math.max(tracked.length, 1);
  const top = expectedCtr(1);

  const keywords: KeywordRank[] = tracked.map((k) => {
    const cur = windowAgg(byDay, k, curFrom, asOf);
    const prev = windowAgg(byDay, k, prevFrom, prevTo);
    let best: number | null = null;
    for (const rows of byDay.values()) { const r = rows.get(k); if (r && (best === null || r.p < best)) best = r.p; }
    const trend: (number | null)[] = [];
    for (let w = 7; w >= 0; w--) { const to = addDays(asOf, -w * 3); const a = windowAgg(byDay, k, addDays(to, -2), to); trend.push(a ? r1(a.p) : null); }
    return {
      keyword: k,
      position: cur ? r1(cur.p) : null,
      previous: prev ? r1(prev.p) : null,
      change: cur && prev ? r1(prev.p - cur.p) : null,
      clicks: cur?.c ?? 0,
      impressions: cur?.i ?? 0,
      best: best === null ? null : r1(best),
      intent: classifyIntent(k),
      trend,
    };
  });

  const buckets = { top3: 0, top10: 0, top20: 0, top50: 0, below50: 0, notRanking: 0 };
  let visSum = 0; let posSum = 0; let ranking = 0;
  for (const k of keywords) {
    if (k.position === null) { buckets.notRanking++; continue; }
    ranking++; posSum += k.position; visSum += expectedCtr(k.position);
    if (k.position <= 3) buckets.top3++; else if (k.position <= 10) buckets.top10++; else if (k.position <= 20) buckets.top20++; else if (k.position <= 50) buckets.top50++; else buckets.below50++;
  }
  let prevVis = 0; let prevAny = false;
  for (const k of keywords) if (k.previous !== null) { prevVis += expectedCtr(k.previous); prevAny = true; }

  // Daily series for the chart (all tracked phrases, impression-weighted).
  const series: RankSummary['series'] = [];
  const set = new Set(tracked);
  for (const d of days) {
    let w = 0; let pw = 0; let c = 0; let i = 0; let v = 0;
    for (const r of d.rows) {
      if (!set.has(r.k)) continue;
      const weight = Math.max(r.i, 1);
      w += weight; pw += r.p * weight; c += r.c; i += r.i; v += expectedCtr(r.p);
    }
    series.push({ date: d.id, averagePosition: w ? r1(pw / w) : null, visibility: Math.round((v / (total * top)) * 1000) / 10, clicks: c, impressions: i });
  }

  // "Sensor": how much did the average position jump about day to day in the last 14 days?
  const recent = series.filter((s) => s.date >= addDays(asOf, -13) && s.averagePosition !== null);
  let volatility: RankSummary['volatility'] = { score: 0, label: 'unknown' };
  if (recent.length >= 5) {
    let sum = 0;
    for (let n = 1; n < recent.length; n++) sum += Math.abs(recent[n]!.averagePosition! - recent[n - 1]!.averagePosition!);
    const score = r1(sum / (recent.length - 1));
    volatility = { score, label: score < 0.5 ? 'calm' : score < 1.5 ? 'normal' : score < 3 ? 'bumpy' : 'stormy' };
  }

  const moved = keywords.filter((k) => k.change !== null && k.impressions >= 5);
  const winners = [...moved].filter((k) => k.change! > 0).sort((a, b) => b.change! - a.change!).slice(0, 10);
  const losers = [...moved].filter((k) => k.change! < 0).sort((a, b) => a.change! - b.change!).slice(0, 10);

  return {
    asOf,
    trackedCount: tracked.length,
    rankingCount: ranking,
    buckets,
    visibility: Math.round((visSum / (total * top)) * 1000) / 10,
    visibilityPrevious: prevAny ? Math.round((prevVis / (total * top)) * 1000) / 10 : null,
    averagePosition: ranking ? r1(posSum / ranking) : null,
    series,
    volatility,
    keywords: keywords.sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
    winners,
    losers,
  };
}

// ---------------------------------------------------------------------------
// Grouping phrases (a free stand-in for "keyword clusters")
// ---------------------------------------------------------------------------

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'is', 'are', 'how', 'what', 'best', 'near', 'me', 'my', 'your', 'vs', 'do', 'does', 'can', 'i']);
const tokens = (k: string) => normaliseKeyword(k).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1 && !STOP.has(t));

export interface KeywordCluster { name: string; keywords: string[] }
/** Groups phrases that share their most common word. Simple and predictable; not semantic. */
export function clusterKeywords(list: string[], minSize = 2): KeywordCluster[] {
  const remaining = new Set(list.map(normaliseKeyword));
  const out: KeywordCluster[] = [];
  for (;;) {
    const freq = new Map<string, number>();
    for (const k of remaining) for (const t of new Set(tokens(k))) freq.set(t, (freq.get(t) ?? 0) + 1);
    let best = ''; let bestN = 0;
    for (const [t, n] of freq) if (n > bestN || (n === bestN && t < best)) { best = t; bestN = n; }
    if (bestN < minSize) break;
    const members = [...remaining].filter((k) => tokens(k).includes(best));
    for (const m of members) remaining.delete(m);
    out.push({ name: best, keywords: members.sort() });
  }
  if (remaining.size) out.push({ name: 'Other', keywords: [...remaining].sort() });
  return out;
}

// ---------------------------------------------------------------------------
// Organic traffic insights (GA4 + Search Console)
// ---------------------------------------------------------------------------

export interface PageTraffic { page: string; sessions: number; clicks: number; impressions: number; position: number | null; topQuery: string | null; hiddenClicks: number }
/** Joins GA4 organic landing pages with Search Console. "hidden" = clicks Google does not tell us the phrase for. */
export function joinTraffic(
  ga: { page: string; sessions: number }[],
  scPages: { page: string; clicks: number; impressions: number; position: number }[],
  scPageQueries: { page: string; query: string; clicks: number }[],
): PageTraffic[] {
  const path = (u: string) => { try { const x = new URL(u, 'https://x.invalid'); return (x.pathname.replace(/\/+$/, '') || '/') + ''; } catch { return u; } };
  const sc = new Map<string, { clicks: number; impressions: number; wp: number }>();
  for (const r of scPages) {
    const k = path(r.page);
    const a = sc.get(k) ?? { clicks: 0, impressions: 0, wp: 0 };
    a.clicks += r.clicks; a.impressions += r.impressions; a.wp += r.position * Math.max(r.impressions, 1);
    sc.set(k, a);
  }
  const qs = new Map<string, { top: string; topClicks: number; sum: number }>();
  for (const r of scPageQueries) {
    const k = path(r.page);
    const a = qs.get(k) ?? { top: '', topClicks: -1, sum: 0 };
    a.sum += r.clicks;
    if (r.clicks > a.topClicks) { a.top = r.query; a.topClicks = r.clicks; }
    qs.set(k, a);
  }
  const gaByPath = new Map<string, number>();
  for (const r of ga) gaByPath.set(path(r.page), (gaByPath.get(path(r.page)) ?? 0) + r.sessions);
  const keys = new Set([...gaByPath.keys(), ...sc.keys()]);
  const out: PageTraffic[] = [];
  for (const k of keys) {
    const s = sc.get(k); const q = qs.get(k);
    out.push({
      page: k,
      sessions: gaByPath.get(k) ?? 0,
      clicks: s?.clicks ?? 0,
      impressions: s?.impressions ?? 0,
      position: s && s.impressions >= 0 ? r1(s.wp / Math.max(s.impressions, 1)) : null,
      topQuery: q && q.topClicks > 0 ? q.top : null,
      hiddenClicks: s ? Math.max(0, Math.round(s.clicks - (q?.sum ?? 0))) : 0,
    });
  }
  return out.sort((a, b) => b.sessions + b.clicks - (a.sessions + a.clicks)).slice(0, 100);
}

// ---------------------------------------------------------------------------
// Daily refresh settings (one record per project)
// ---------------------------------------------------------------------------

export interface RankTrackingSettings {
  id: string; // `${workspaceId}_${projectId}`
  workspaceId: string;
  projectId: string;
  /** Whose Google connection the daily job uses. */
  ownerUid: string;
  enabled: boolean;
  refreshedAt: string | null;
  pausedReason: string | null;
}
export interface RankTrackingStore {
  listAll(): Promise<RankTrackingSettings[]>;
  get(id: string): Promise<RankTrackingSettings | null>;
  put(s: RankTrackingSettings): Promise<void>;
  delete(id: string): Promise<boolean>;
}
export const trackingId = (ws: string, project: string) => `${ws}_${project}`;
const COLLECTION = 'rankTracking';

const firestoreStore: RankTrackingStore = {
  async listAll() { const snap = await getAdminFirestore().collection(COLLECTION).get(); return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as RankTrackingSettings); },
  async get(id) { const s = await getAdminFirestore().collection(COLLECTION).doc(id).get(); return s.exists ? ({ ...(s.data() as object), id: s.id } as RankTrackingSettings) : null; },
  async put(s) { const { id, ...rest } = s; await getAdminFirestore().collection(COLLECTION).doc(id).set(rest); },
  async delete(id) { const ref = getAdminFirestore().collection(COLLECTION).doc(id); const s = await ref.get(); if (!s.exists) return false; await ref.delete(); return true; },
};
export function createInMemoryRankTrackingStore(): RankTrackingStore {
  const m = new Map<string, RankTrackingSettings>();
  return {
    async listAll() { return [...m.values()].map((v) => ({ ...v })); },
    async get(id) { const v = m.get(id); return v ? { ...v } : null; },
    async put(s) { m.set(s.id, { ...s }); },
    async delete(id) { return m.delete(id); },
  };
}
let testStore: RankTrackingStore | null = null;
export const setTestRankTrackingStore = (s: RankTrackingStore | null): void => { testStore = s; };
export const getRankTrackingStore = (): RankTrackingStore => testStore ?? firestoreStore;

// ---------------------------------------------------------------------------
// Loading and saving days
// ---------------------------------------------------------------------------

export async function loadLists(store: ProjectDocsStore, ws: string, project: string): Promise<KeywordList[]> {
  return (await store.list(ws, project, 'keywordLists')).map(toList).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function loadDays(store: ProjectDocsStore, ws: string, project: string, sinceDate?: string): Promise<RankDay[]> {
  const docs = await store.list(ws, project, 'rankDays');
  return docs
    .filter((d) => !sinceDate || d.id >= sinceDate)
    .map((d) => ({ id: d.id, rows: Array.isArray(d.rows) ? (d.rows as RankRow[]) : [] }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export async function saveDays(store: ProjectDocsStore, ws: string, project: string, fresh: RankDay[], existing: RankDay[], today: string): Promise<void> {
  for (const d of fresh) await store.put(ws, project, 'rankDays', { id: d.id, rows: d.rows });
  for (const id of daysToPrune(existing, today)) await store.delete(ws, project, 'rankDays', id);
}

/** Pulls the latest days for a project's tracked phrases and saves them. Returns how many days were written. */
export async function refreshProject(
  deps: { docs: ProjectDocsStore; query: ScQuery; now: () => number },
  ws: string, project: string, daysBack: number,
): Promise<{ days: number; tracked: number }> {
  const tracked = trackedKeywords(await loadLists(deps.docs, ws, project));
  if (tracked.length === 0) return { days: 0, tracked: 0 };
  const end = lastCompleteDay(deps.now());
  const start = addDays(end, -(daysBack - 1));
  const fresh = await fetchRankDays(deps.query, tracked, start, end);
  const existing = await loadDays(deps.docs, ws, project, addDays(end, -KEEP_DAYS - 5));
  await saveDays(deps.docs, ws, project, fresh, existing, end);
  return { days: fresh.length, tracked: tracked.length };
}
