/**
 * SEO tools, part 4: keyword ideas (Sprint 36). Uses Google's public search-suggestion endpoint (what people see when they type
 * into Google), so it works with no paid data. It does NOT give search volumes. Unofficial endpoint: failures are quiet.
 */
import { guardedRequest } from './ssrfGuard.js';

export type Intent = 'informational' | 'commercial' | 'transactional' | 'navigational';
export interface KeywordIdea { keyword: string; group: 'questions' | 'modifiers' | 'prepositions' | 'comparisons' | 'alphabet' | 'seed'; intent: Intent; words: number;
  /** How many of our probes Google's suggestions returned this phrase for (more = more people type it). */
  hits: number;
  /** Best place it held in a suggestion list, 0 = first. */
  bestRank: number }

export type DemandLevel = 'high' | 'medium' | 'low';
/**
 * AdLens "demand score" (0 to 100): an estimate of how much people look for a phrase, NOT a search volume.
 * Built only from free signals: how high and how often Google suggests it, plus your own Search Console views (90 days) when known.
 */
export function demandScore(hits: number, bestRank: number, impressions: number | null): { score: number; level: DemandLevel } {
  const rankPts = Math.max(0, 10 - Math.max(0, bestRank)) / 10 * 50;
  const hitPts = Math.min(Math.max(hits, 0), 6) / 6 * 30;
  const imp = impressions ?? 0;
  const impPts = imp >= 1000 ? 20 : imp >= 100 ? 14 : imp >= 10 ? 8 : imp > 0 ? 4 : 0;
  const score = Math.round(rankPts + hitPts + impPts);
  return { score, level: score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low' };
}

export const QUESTION_WORDS = ['how', 'what', 'why', 'when', 'where', 'which', 'can', 'is', 'do', 'are'];
export const SUFFIXES = ['best', 'for', 'vs', 'near me', 'price', 'cost', 'free', 'online', 'tips', 'examples', 'alternatives', 'reviews'];

export const PREPOSITIONS = ['for', 'with', 'without', 'near', 'to', 'like', 'in', 'on', 'from'];
export const COMPARISONS = ['vs', 'versus', 'or', 'and', 'compared to'];

export function classifyIntent(k: string): Intent {
  const s = k.toLowerCase();
  if (/\b(buy|price|prices|cost|cheap|discount|coupon|order|hire|quote|near me|for sale|pricing|deal)\b/.test(s)) return 'transactional';
  if (/\b(best|top|vs|versus|review|reviews|compare|comparison|alternative|alternatives|better)\b/.test(s)) return 'commercial';
  if (/^(how|what|why|when|where|which|who|can|is|are|do|does|should)\b|\b(guide|tutorial|tips|examples|ideas|meaning|learn)\b/.test(s)) return 'informational';
  return 'navigational';
}

export type SuggestFetcher = (query: string, lang: string) => Promise<string[]>;

export const googleSuggest: SuggestFetcher = async (query, lang) => {
  try {
    const url = new URL('https://suggestqueries.google.com/complete/search');
    url.searchParams.set('client', 'firefox');
    url.searchParams.set('hl', lang);
    url.searchParams.set('q', query);
    const res = await guardedRequest(url, { method: 'GET', timeoutMs: 4_000, maxResponseBytes: 60_000, headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; AdLens)' } });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.text) as unknown;
    const list = Array.isArray(data) && Array.isArray(data[1]) ? (data[1] as unknown[]) : [];
    return list.filter((x): x is string => typeof x === 'string').slice(0, 10);
  } catch { return []; }
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Builds a set of probes from one seed, asks the fetcher for each, and returns de-duplicated ideas. */
export async function keywordIdeas(seedRaw: string, fetcher: SuggestFetcher = googleSuggest, opts: { lang?: string; alphabet?: boolean; concurrency?: number } = {}): Promise<KeywordIdea[]> {
  const seed = norm(seedRaw).slice(0, 80);
  if (!seed) return [];
  const lang = opts.lang ?? 'en';
  const probes: { q: string; group: KeywordIdea['group'] }[] = [{ q: seed, group: 'seed' }];
  for (const w of QUESTION_WORDS) probes.push({ q: `${w} ${seed}`, group: 'questions' });
  for (const s of SUFFIXES) probes.push({ q: `${seed} ${s}`, group: 'modifiers' });
  for (const s of PREPOSITIONS) if (!SUFFIXES.includes(s)) probes.push({ q: `${seed} ${s}`, group: 'prepositions' });
  for (const s of COMPARISONS) if (!SUFFIXES.includes(s)) probes.push({ q: `${seed} ${s}`, group: 'comparisons' });
  if (opts.alphabet) for (const ch of 'abcdefghijklmnopqrstuvwxyz') probes.push({ q: `${seed} ${ch}`, group: 'alphabet' });

  const found = new Map<string, KeywordIdea>();
  let next = 0;
  const worker = async () => {
    while (next < probes.length) {
      const p = probes[next++];
      const list = await fetcher(p.q, lang).catch(() => []);
      for (let rank = 0; rank < list.length; rank++) {
        const k = norm(list[rank]);
        if (!k || k.length > 120 || k === seed) continue;
        const group: KeywordIdea['group'] = /^(how|what|why|when|where|which|who|can|is|are|do|does|should)\b/.test(k) ? 'questions' : p.group === 'seed' ? 'seed' : p.group;
        const cur = found.get(k);
        if (!cur) found.set(k, { keyword: k, group, intent: classifyIntent(k), words: k.split(' ').length, hits: 1, bestRank: rank });
        else { cur.hits += 1; cur.bestRank = Math.min(cur.bestRank, rank); }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(6, opts.concurrency ?? 5)) }, worker));
  return [...found.values()].sort((a, b) => a.words - b.words || a.keyword.localeCompare(b.keyword)).slice(0, 300);
}
