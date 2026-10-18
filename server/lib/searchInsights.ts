/**
 * Search Console insights for AdLens (Sprint 7). Pure functions, no network calls.
 *
 * - SEO opportunities: queries ranking 5–20 whose CTR is well below typical for that position
 * - Cannibalisation: queries where 2+ of your pages split the impressions
 * - Trending: items rising, falling, new or lost versus the previous period
 * - Topics: heuristic grouping of queries by shared words/phrases
 *
 * All thresholds are parameters with documented defaults; every result carries
 * the rules that produced it, so the UI and AI tools can explain themselves.
 */

// ---------------------------------------------------------------------------
// Typical CTR by position
// ---------------------------------------------------------------------------

/**
 * Approximate organic CTR (%) by rounded average position, positions 1–20.
 * Heuristic benchmark from public industry CTR studies; real CTR varies a lot by
 * query type, brand terms and SERP features. Shown to users as "typical", not exact.
 */
export const TYPICAL_CTR_BY_POSITION: Record<number, number> = {
  1: 28.0, 2: 15.5, 3: 11.0, 4: 8.0, 5: 6.5,
  6: 5.0, 7: 4.0, 8: 3.2, 9: 2.7, 10: 2.3,
  11: 1.6, 12: 1.4, 13: 1.2, 14: 1.1, 15: 1.0,
  16: 0.9, 17: 0.8, 18: 0.7, 19: 0.6, 20: 0.5,
};

/** Typical CTR (%) for a fractional position, linearly interpolated; 0.4% beyond 20. */
export function typicalCtr(position: number): number {
  if (!Number.isFinite(position) || position <= 1) return TYPICAL_CTR_BY_POSITION[1];
  if (position >= 20) return position > 20 ? 0.4 : TYPICAL_CTR_BY_POSITION[20];
  const lo = Math.floor(position);
  const hi = lo + 1;
  const t = position - lo;
  return TYPICAL_CTR_BY_POSITION[lo] + (TYPICAL_CTR_BY_POSITION[hi] - TYPICAL_CTR_BY_POSITION[lo]) * t;
}

function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export interface SearchRow {
  query?: string;
  page?: string;
  clicks: number;
  impressions: number;
  /** Percent (0–100). If omitted it is computed from clicks / impressions. */
  ctr?: number;
  position: number;
}

export interface OpportunityOptions {
  minImpressions?: number; // default 100
  minPosition?: number; // default 5
  maxPosition?: number; // default 20
  ctrRatioThreshold?: number; // default 0.5 → CTR below half of typical
  limit?: number; // default 50
}

export interface Opportunity {
  query: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  typicalCtr: number;
  estimatedExtraClicks: number;
}

export interface OpportunityResult {
  rules: string[];
  opportunities: Opportunity[];
}

/** CTR in percent. Derived from clicks / impressions so 0–1 vs 0–100 input can never be confused. */
function ctrOf(r: SearchRow): number {
  if (r.impressions > 0) return (r.clicks / r.impressions) * 100;
  return r.ctr ?? 0;
}

/**
 * Queries worth improving: enough impressions, ranking 5–20, CTR below half of typical.
 * Estimated extra clicks = impressions × (typical CTR − actual CTR), i.e. the gain if the
 * snippet performed like an average result at the same position. Sorted by that gain.
 */
export function findOpportunities(rows: SearchRow[], opts: OpportunityOptions = {}): OpportunityResult {
  const minImpressions = opts.minImpressions ?? 100;
  const minPosition = opts.minPosition ?? 5;
  const maxPosition = opts.maxPosition ?? 20;
  const ratio = opts.ctrRatioThreshold ?? 0.5;
  const limit = opts.limit ?? 50;

  const opportunities: Opportunity[] = [];
  for (const r of rows) {
    if (!r.query || r.impressions < minImpressions) continue;
    if (r.position < minPosition || r.position > maxPosition) continue;
    const ctr = ctrOf(r);
    const typ = typicalCtr(r.position);
    if (ctr >= typ * ratio) continue;
    opportunities.push({
      query: r.query,
      ...(r.page ? { page: r.page } : {}),
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: round(ctr, 2),
      position: round(r.position, 1),
      typicalCtr: round(typ, 1),
      estimatedExtraClicks: Math.max(0, Math.round((r.impressions * (typ - ctr)) / 100)),
    });
  }
  opportunities.sort((a, b) => b.estimatedExtraClicks - a.estimatedExtraClicks);

  return {
    rules: [
      `At least ${minImpressions} impressions in the period.`,
      `Average position between ${minPosition} and ${maxPosition}.`,
      `CTR below ${Math.round(ratio * 100)}% of the typical CTR for that position (industry benchmark, approximate).`,
      'Estimated extra clicks = impressions × (typical CTR − actual CTR).',
    ],
    opportunities: opportunities.slice(0, limit),
  };
}

// ---------------------------------------------------------------------------
// Cannibalisation
// ---------------------------------------------------------------------------

export interface CannibalisationOptions {
  minPageSharePercent?: number; // default 10
  minQueryImpressions?: number; // default 50
}

export interface CannibalisedQuery {
  query: string;
  totalImpressions: number;
  totalClicks: number;
  pages: { page: string; impressions: number; clicks: number; position: number; sharePercent: number }[];
}

/** Rows must have both query and page (Search Console dimensions ["query","page"]). */
export function detectCannibalisation(rows: SearchRow[], opts: CannibalisationOptions = {}): CannibalisedQuery[] {
  const minShare = opts.minPageSharePercent ?? 10;
  const minImpr = opts.minQueryImpressions ?? 50;

  const byQuery = new Map<string, SearchRow[]>();
  for (const r of rows) {
    if (!r.query || !r.page) continue;
    const list = byQuery.get(r.query) ?? [];
    list.push(r);
    byQuery.set(r.query, list);
  }

  const result: CannibalisedQuery[] = [];
  for (const [query, list] of byQuery) {
    const totalImpressions = list.reduce((s, r) => s + r.impressions, 0);
    if (totalImpressions < minImpr) continue;
    const pages = list
      .map((r) => ({
        page: r.page!,
        impressions: r.impressions,
        clicks: r.clicks,
        position: round(r.position, 1),
        sharePercent: round((r.impressions / totalImpressions) * 100, 1),
      }))
      .filter((p) => p.sharePercent >= minShare)
      .sort((a, b) => b.impressions - a.impressions);
    if (pages.length >= 2) {
      result.push({ query, totalImpressions, totalClicks: list.reduce((s, r) => s + r.clicks, 0), pages });
    }
  }
  return result.sort((a, b) => b.totalImpressions - a.totalImpressions);
}

// ---------------------------------------------------------------------------
// Trending (works for queries or pages)
// ---------------------------------------------------------------------------

export type TrendStatus = 'rising' | 'falling' | 'new' | 'lost';

export interface TrendOptions {
  /** Minimum value in the period where the item exists, for new/lost. Default 10. */
  minVolume?: number;
  /** Minimum % change for rising/falling. Default 25. */
  minChangePercent?: number;
  /** Minimum absolute change for rising/falling. Default 5. */
  minAbsoluteChange?: number;
  limitPerStatus?: number; // default 25
}

export interface TrendItem {
  key: string;
  status: TrendStatus;
  current: number;
  previous: number;
  change: number;
  changePercent: number | null; // null for new items
}

export interface TrendResult {
  rules: string[];
  rising: TrendItem[];
  falling: TrendItem[];
  new: TrendItem[];
  lost: TrendItem[];
}

/**
 * Compare one metric (e.g. clicks or impressions) per key across two equal-length periods.
 * Pass maps of key → value. Keys missing from a map count as 0.
 */
export function classifyTrends(
  current: Map<string, number>,
  previous: Map<string, number>,
  opts: TrendOptions = {}
): TrendResult {
  const minVolume = opts.minVolume ?? 10;
  const minPct = opts.minChangePercent ?? 25;
  const minAbs = opts.minAbsoluteChange ?? 5;
  const limit = opts.limitPerStatus ?? 25;

  const out: Record<TrendStatus, TrendItem[]> = { rising: [], falling: [], new: [], lost: [] };
  const keys = new Set([...current.keys(), ...previous.keys()]);

  for (const key of keys) {
    const c = current.get(key) ?? 0;
    const p = previous.get(key) ?? 0;
    const change = c - p;
    if (p === 0 && c >= minVolume) {
      out.new.push({ key, status: 'new', current: c, previous: 0, change, changePercent: null });
    } else if (c === 0 && p >= minVolume) {
      out.lost.push({ key, status: 'lost', current: 0, previous: p, change, changePercent: -100 });
    } else if (p > 0 && c > 0 && Math.abs(change) >= minAbs) {
      const changePercent = round((change / p) * 100, 1);
      if (changePercent >= minPct) out.rising.push({ key, status: 'rising', current: c, previous: p, change, changePercent });
      else if (changePercent <= -minPct) out.falling.push({ key, status: 'falling', current: c, previous: p, change, changePercent });
    }
  }

  out.rising.sort((a, b) => b.change - a.change);
  out.falling.sort((a, b) => a.change - b.change);
  out.new.sort((a, b) => b.current - a.current);
  out.lost.sort((a, b) => b.previous - a.previous);

  return {
    rules: [
      `New: zero in the previous period, at least ${minVolume} now.`,
      `Lost: at least ${minVolume} in the previous period, zero now.`,
      `Rising / falling: changed by at least ${minPct}% and at least ${minAbs} in absolute terms.`,
      'Periods are equal length; the previous period immediately precedes the current one.',
    ],
    rising: out.rising.slice(0, limit),
    falling: out.falling.slice(0, limit),
    new: out.new.slice(0, limit),
    lost: out.lost.slice(0, limit),
  };
}

// ---------------------------------------------------------------------------
// Topic grouping (heuristic)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'best', 'by', 'can', 'do', 'does', 'for', 'free',
  'from', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'near', 'of', 'on', 'online', 'or', 'the',
  'to', 'top', 'vs', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
]);

function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export interface TopicGroup {
  topic: string;
  queries: string[];
  clicks: number;
  impressions: number;
}

export interface TopicOptions {
  /** Phrases (lowercase) to ignore as topics, e.g. your brand name. */
  ignore?: string[];
  minQueriesPerTopic?: number; // default 2
}

/**
 * Groups queries by their most widely shared phrase (two-word phrases preferred over single
 * words when equally common). Queries with no shared phrase go to "Other".
 * This is a heuristic for orientation, not semantic clustering.
 */
export function groupQueriesIntoTopics(rows: SearchRow[], opts: TopicOptions = {}): TopicGroup[] {
  const ignore = new Set((opts.ignore ?? []).map((s) => s.toLowerCase()));
  const minQ = opts.minQueriesPerTopic ?? 2;

  const phrasesPerQuery = new Map<string, string[]>();
  const phraseCount = new Map<string, number>();
  for (const r of rows) {
    if (!r.query || phrasesPerQuery.has(r.query)) continue;
    const t = tokens(r.query).filter((w) => !ignore.has(w));
    const bigrams = t.slice(0, -1).map((w, i) => `${w} ${t[i + 1]}`).filter((b) => !ignore.has(b));
    const phrases = [...new Set([...bigrams, ...t])];
    phrasesPerQuery.set(r.query, phrases);
    for (const ph of phrases) phraseCount.set(ph, (phraseCount.get(ph) ?? 0) + 1);
  }

  const groups = new Map<string, TopicGroup>();
  for (const r of rows) {
    if (!r.query) continue;
    const phrases = (phrasesPerQuery.get(r.query) ?? []).filter((ph) => (phraseCount.get(ph) ?? 0) >= minQ);
    phrases.sort((a, b) => {
      const diff = (phraseCount.get(b) ?? 0) - (phraseCount.get(a) ?? 0);
      return diff !== 0 ? diff : b.split(' ').length - a.split(' ').length;
    });
    const topic = phrases[0] ?? 'Other';
    const g = groups.get(topic) ?? { topic, queries: [], clicks: 0, impressions: 0 };
    if (!g.queries.includes(r.query)) g.queries.push(r.query);
    g.clicks += r.clicks;
    g.impressions += r.impressions;
    groups.set(topic, g);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.topic === 'Other') return 1;
    if (b.topic === 'Other') return -1;
    return b.clicks - a.clicks || b.impressions - a.impressions;
  });
}
