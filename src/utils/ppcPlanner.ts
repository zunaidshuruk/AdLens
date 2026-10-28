/** PPC keyword planner (Sprint 44): turns a keyword list into ad groups, match types and negative keywords, and writes a Google Ads Editor CSV. Runs in the browser. */

export type MatchType = 'broad' | 'phrase' | 'exact';
export type Intent = 'buy' | 'research' | 'other';

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'is', 'are', 'how', 'what', 'near', 'me', 'my', 'your', 'vs', 'do', 'does', 'can', 'i', 'at', 'by', 'from']);
const BUY = ['buy', 'price', 'prices', 'cheap', 'cheapest', 'order', 'deal', 'deals', 'discount', 'shop', 'sale', 'hire', 'quote', 'cost', 'near me', 'online', 'book', 'booking', 'best'];
const RESEARCH = ['how', 'what', 'why', 'when', 'guide', 'tutorial', 'tips', 'ideas', 'examples', 'example', 'meaning', 'definition', 'vs', 'versus', 'review', 'reviews', 'history', 'learn', 'explained'];

export interface ParsedKeywords { keywords: string[]; dropped: { text: string; reason: string }[] }
const clean = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();

/** One keyword per line or separated by commas. Google Ads allows at most 10 words and 80 characters per keyword. */
export function parseKeywords(text: string, max = 2000): ParsedKeywords {
  const seen = new Set<string>(); const keywords: string[] = []; const dropped: ParsedKeywords['dropped'] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const k = clean(raw);
    if (!k) continue;
    if (seen.has(k)) continue;
    if (k.split(' ').length > 10) { dropped.push({ text: k.slice(0, 60), reason: 'More than 10 words' }); continue; }
    if (k.length > 80) { dropped.push({ text: k.slice(0, 60), reason: 'Longer than 80 characters' }); continue; }
    if (keywords.length >= max) { dropped.push({ text: k.slice(0, 60), reason: `Over the ${max} keyword limit` }); continue; }
    seen.add(k); keywords.push(k);
  }
  return { keywords, dropped };
}

const hasWord = (k: string, w: string) => (` ${k} `).includes(` ${w} `);
export function intentOf(k: string): Intent {
  if (RESEARCH.some((w) => hasWord(k, w))) return 'research';
  if (BUY.some((w) => hasWord(k, w))) return 'buy';
  return 'other';
}

export interface AdGroup { name: string; keywords: string[] }
const title = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** Groups phrases that share their most common meaningful word, and splits big groups so each stays tightly themed. */
export function groupKeywords(list: string[], opts: { minSize?: number; maxPerGroup?: number } = {}): AdGroup[] {
  const minSize = opts.minSize ?? 2; const maxPer = Math.max(2, opts.maxPerGroup ?? 20);
  const remaining = new Set(list);
  const tok = (k: string) => k.split(' ').filter((t) => t.length > 1 && !STOP.has(t));
  const raw: AdGroup[] = [];
  for (;;) {
    const freq = new Map<string, number>();
    for (const k of remaining) for (const t of new Set(tok(k))) freq.set(t, (freq.get(t) ?? 0) + 1);
    let best = ''; let bestN = 0;
    for (const [t, n] of freq) if (n > bestN || (n === bestN && t < best)) { best = t; bestN = n; }
    if (bestN < minSize) break;
    const members = [...remaining].filter((k) => tok(k).includes(best)).sort();
    for (const m of members) remaining.delete(m);
    raw.push({ name: title(best), keywords: members });
  }
  if (remaining.size) raw.push({ name: 'Other', keywords: [...remaining].sort() });
  const out: AdGroup[] = [];
  for (const g of raw) {
    if (g.keywords.length <= maxPer) { out.push(g); continue; }
    for (let i = 0; i < g.keywords.length; i += maxPer) out.push({ name: `${g.name} ${i / maxPer + 1}`, keywords: g.keywords.slice(i, i + maxPer) });
  }
  return out;
}

export interface NegativeSuggestion { word: string; reason: string }
const NEGATIVES: [string, string][] = [
  ['free', 'People looking for free options rarely buy'], ['jobs', 'Job seekers'], ['job', 'Job seekers'], ['salary', 'Job seekers'], ['career', 'Job seekers'], ['hiring', 'Job seekers'],
  ['course', 'Learners, not buyers'], ['courses', 'Learners, not buyers'], ['tutorial', 'Learners, not buyers'], ['training', 'Learners, not buyers'], ['class', 'Learners, not buyers'],
  ['diy', 'Do-it-yourself researchers'], ['pdf', 'Looking for documents'], ['download', 'Looking for downloads'], ['torrent', 'Looking for pirated copies'], ['crack', 'Looking for pirated copies'],
  ['wiki', 'Reading, not buying'], ['wikipedia', 'Reading, not buying'], ['meaning', 'Looking for a definition'], ['definition', 'Looking for a definition'], ['definition of', 'Looking for a definition'],
  ['sample', 'Looking for examples'], ['template', 'Looking for templates'], ['used', 'Second-hand searches'], ['secondhand', 'Second-hand searches'], ['repair', 'Fixing, not buying'], ['manual', 'Looking for instructions'],
  ['review', 'Comparison reading'], ['reviews', 'Comparison reading'], ['history', 'Reading, not buying'], ['images', 'Looking for pictures'], ['youtube', 'Looking for videos'], ['reddit', 'Reading forums'], ['complaint', 'Unhappy customers'], ['scam', 'Doubters'],
];
/** Words that tend to bring clicks that do not buy. A word is skipped when one of your keywords uses it, so you never block yourself. */
export function suggestNegatives(keywords: string[]): NegativeSuggestion[] {
  const used = new Set(keywords.flatMap((k) => k.split(' ')));
  const out: NegativeSuggestion[] = [];
  for (const [word, reason] of NEGATIVES) {
    const parts = word.split(' ');
    if (parts.some((p) => used.has(p))) continue;
    if (keywords.some((k) => hasWord(k, word))) continue;
    out.push({ word, reason });
  }
  return out;
}

export const notation = (k: string, m: MatchType): string => (m === 'phrase' ? `"${k}"` : m === 'exact' ? `[${k}]` : k);

export interface PlanInput { campaign: string; groups: AdGroup[]; matchTypes: MatchType[]; maxCpc: number | null; negatives: string[]; negativeType: 'phrase' | 'exact' }
const csvCell = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);
const CRITERION: Record<MatchType, string> = { broad: 'Broad', phrase: 'Phrase', exact: 'Exact' };

/** CSV in the column layout Google Ads Editor imports. Keywords are plain text and the match type is in Criterion Type. */
export function buildAdsCsv(p: PlanInput): { csv: string; rows: number } {
  const campaign = p.campaign.trim().replace(/[\r\n]+/g, ' ').slice(0, 128) || 'My campaign';
  const lines = [['Campaign', 'Ad Group', 'Keyword', 'Criterion Type', 'Max CPC', 'Status'].join(',')];
  const cpc = p.maxCpc !== null && Number.isFinite(p.maxCpc) && p.maxCpc > 0 ? p.maxCpc.toFixed(2) : '';
  let rows = 0;
  for (const g of p.groups) for (const k of g.keywords) for (const m of p.matchTypes) {
    lines.push([campaign, g.name, k, CRITERION[m], cpc, 'Enabled'].map(csvCell).join(',')); rows++;
  }
  for (const n of p.negatives) { lines.push([campaign, '', n, p.negativeType === 'exact' ? 'Negative Exact' : 'Negative Phrase', '', 'Enabled'].map(csvCell).join(',')); rows++; }
  return { csv: lines.join('\r\n') + '\r\n', rows };
}
