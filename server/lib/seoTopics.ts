/**
 * Topic gap (Sprint 40): which words and phrases competitors' pages use that your page does not.
 * Works from the pages' own text, so it is a content hint, not a ranking report.
 */
import { decodeEntities } from './seoPage.js';

const STOP = new Set(('a an the and or of for to in on with without is are was were be been being it its this that these those as at by from into your you we our they their them he she his her not no yes can will would should could may might do does did have has had but if then than so such more most very just also about over under up down out all any each other some what which who whom how why when where there here one two get got use used using').split(' '));

export function visibleText(html: string): string {
  const body = html.replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
  return decodeEntities(body).replace(/\s+/g, ' ').trim();
}

export function tokenise(text: string): string[] {
  return text.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Counts single words and two-word phrases (never across a stop word). */
export function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const toks = tokenise(text);
  const good = (t: string) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (!good(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    const next = toks[i + 1];
    if (next && good(next)) { const b = `${t} ${next}`; counts.set(b, (counts.get(b) ?? 0) + 1); }
  }
  return counts;
}

export interface GapTerm { term: string; competitors: number; avgCount: number; yourCount: number }
export interface TopicGap { missing: GapTerm[]; underused: GapTerm[]; sharedStrengths: GapTerm[]; competitorCount: number }

export function topicGap(yourText: string, competitorTexts: string[], limit = 40): TopicGap {
  const you = termCounts(yourText);
  const comps = competitorTexts.map(termCounts);
  const n = comps.length;
  const need = n >= 2 ? 2 : 1;
  const all = new Set<string>();
  for (const c of comps) for (const [t, k] of c) if (k >= 2 || t.includes(' ')) all.add(t);
  const rows: GapTerm[] = [];
  for (const term of all) {
    const counts = comps.map((c) => c.get(term) ?? 0);
    const competitors = counts.filter((k) => k >= 1).length;
    if (competitors < need) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / n;
    rows.push({ term, competitors, avgCount: Math.round(avg * 10) / 10, yourCount: you.get(term) ?? 0 });
  }
  const score = (r: GapTerm) => r.competitors * 10 + r.avgCount + (r.term.includes(' ') ? 2 : 0);
  const byScore = (a: GapTerm, b: GapTerm) => score(b) - score(a) || a.term.localeCompare(b.term);
  // Drop single words that only appear inside a listed phrase, to keep the list short.
  const missing = rows.filter((r) => r.yourCount === 0).sort(byScore);
  const phrases = missing.filter((r) => r.term.includes(' '));
  const cleaned = missing.filter((r) => r.term.includes(' ') || !phrases.some((p) => p.term.split(' ').includes(r.term) && p.competitors >= r.competitors));
  return {
    missing: cleaned.slice(0, limit),
    underused: rows.filter((r) => r.yourCount > 0 && r.avgCount >= 3 && r.avgCount >= r.yourCount * 3).sort(byScore).slice(0, 20),
    sharedStrengths: rows.filter((r) => r.yourCount >= 2 && r.yourCount >= r.avgCount * 0.5).sort(byScore).slice(0, 15),
    competitorCount: n,
  };
}
