/**
 * Ranking and highlighting for the Ctrl/⌘+K command palette (Sprint 8). Pure functions.
 *
 * Every word the user types must match something (label, keywords or group), so results stay
 * relevant. Better matches rank first: exact > starts-with > word-starts-with > keyword > fuzzy
 * (letters in order). Recently used commands get a boost, and with an empty query they are listed first.
 */

export type CommandGroup = 'Navigate' | 'Project' | 'Metrics' | 'Settings' | 'Actions';

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  keywords?: string[];
  hint?: string;
}

export const GROUP_ORDER: CommandGroup[] = ['Navigate', 'Project', 'Metrics', 'Actions', 'Settings'];

/** Lower-case, strip accents and punctuation noise. */
export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** Score for one query word against a single piece of text; 0 = no match. */
function scoreWord(q: string, text: string): number {
  const t = normalize(text);
  if (!t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (words(t).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 45;
  // Initials of the words ("gsc" → Google Search Console, "ga" → Google Analytics).
  if (q.length >= 2 && words(t).map((w) => w[0]).join('').startsWith(q)) return 55;
  // Letters in order, tightly grouped ("gsc" → "Google Search Console"). Only for 3+ letters.
  if (q.length >= 3) {
    let ti = 0, first = -1, last = -1;
    for (const ch of q) {
      const idx = t.indexOf(ch, ti);
      if (idx === -1) return 0;
      if (first === -1) first = idx;
      last = idx;
      ti = idx + 1;
    }
    const span = last - first + 1;
    if (span <= q.length * 3) return 20 + Math.round(10 * (q.length / span));
  }
  return 0;
}

function scoreCommand(queryWords: string[], c: Command): number {
  let total = 0;
  for (const q of queryWords) {
    const label = scoreWord(q, c.label);
    const kw = Math.max(0, ...(c.keywords ?? []).map((k) => scoreWord(q, k) * 0.7));
    const group = scoreWord(q, c.group) * 0.4;
    const best = Math.max(label, kw, group);
    if (best === 0) return 0; // every typed word must match something
    total += best;
  }
  return total / queryWords.length;
}

export interface RankOptions {
  limit?: number;
  /** Most recent first. */
  recentIds?: string[];
}

export function rankCommands(query: string, commands: Command[], opts: RankOptions = {}): Command[] {
  const limit = opts.limit ?? 8;
  const recent = opts.recentIds ?? [];
  const recentBoost = (id: string) => {
    const i = recent.indexOf(id);
    return i === -1 ? 0 : Math.max(4, 15 - i * 3);
  };
  const qWords = words(query);

  if (qWords.length === 0) {
    const byId = new Map(commands.map((c) => [c.id, c]));
    const recents = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c);
    const seen = new Set(recents.map((c) => c.id));
    const rest = commands
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    return [...recents, ...rest].slice(0, limit);
  }

  return commands
    .map((c) => ({ c, s: scoreCommand(qWords, c) }))
    .filter((x) => x.s > 0)
    .map((x) => ({ ...x, s: x.s + recentBoost(x.c.id) }))
    .sort((a, b) => b.s - a.s || a.c.label.length - b.c.label.length || a.c.label.localeCompare(b.c.label))
    .slice(0, limit)
    .map((x) => x.c);
}

/**
 * Character ranges of `label` to render in bold for the typed query, as [start, end) pairs.
 * Works on the original label, so accents and capitals are kept.
 */
export function matchRanges(label: string, query: string): [number, number][] {
  const qWords = words(query);
  if (qWords.length === 0) return [];
  const lower = label.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  // NFKD can change length (ligatures); only highlight when positions still line up.
  if (lower.length !== label.length) return [];
  const ranges: [number, number][] = [];
  for (const q of qWords) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(q, from);
      if (idx === -1) break;
      const atWordStart = idx === 0 || /[^\p{L}\p{N}]/u.test(lower[idx - 1]);
      if (atWordStart || ranges.length === 0) {
        ranges.push([idx, idx + q.length]);
        break;
      }
      from = idx + 1;
    }
  }
  // merge overlaps
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** Moves the highlighted row with the arrow keys, wrapping at both ends. */
export function moveSelection(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}
