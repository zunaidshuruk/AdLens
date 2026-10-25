/**
 * Colour migration (Sprint 8): rewrites hard-coded Tailwind palette classes into the named theme roles
 * defined in src/utils/themeEngine.ts, so that a user's theme can restyle the whole app.
 *
 *   bg-white dark:bg-slate-900   →  bg-surface
 *   text-slate-500 dark:text-slate-400  →  text-fg-muted
 *   bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70  →  bg-danger-soft border-danger-line
 *
 * How it works
 * 1. An exact scanner finds the text of every string literal and template-literal segment (class names
 *    live there). JSX text, comments and code are never touched.
 * 2. Inside each string, a light class and its `dark:` partner (same variants, same kind of utility) are
 *    collapsed into ONE role class. The rule table below was built from the pairs actually used in the app.
 * 3. Anything that does not fit a rule is left exactly as it was and reported, never guessed.
 *
 * The migration is idempotent (running it twice changes nothing) and never edits code outside strings.
 * Imports in this folder end in .js.
 */

// ---------------------------------------------------------------------------
// 1. Finding string literals exactly
// ---------------------------------------------------------------------------

export interface Chunk {
  /** Offset of the first character of the text (after the opening quote). */
  start: number;
  /** Offset just after the last character of the text (at the closing quote). */
  end: number;
}

const KEYWORDS_BEFORE_STRING = new Set([
  'return', 'case', 'from', 'in', 'of', 'default', 'else', 'typeof', 'void', 'yield', 'await', 'delete',
  'new', 'throw', 'extends', 'instanceof', 'export', 'import', 'as', 'satisfies',
]);

/** A quote starts a string only after punctuation or a keyword; an apostrophe in JSX text ("Don't") does not. */
function quoteStartsString(src: string, at: number): boolean {
  let j = at - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const ch = src[j];
  if ('(,=:?{[+&|!;'.includes(ch)) return true;
  if (ch === '>' && src[j - 1] === '=') return true; // arrow function
  if (/[A-Za-z_$]/.test(ch)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
    return KEYWORDS_BEFORE_STRING.has(src.slice(k + 1, j + 1));
  }
  return false;
}

export function findStringChunks(src: string): Chunk[] {
  const chunks: Chunk[] = [];
  const n = src.length;
  let i = 0;

  const stringEnd = (quote: string, from: number): number => {
    for (let k = from; k < n; k++) {
      const c = src[k];
      if (c === '\\') { k++; continue; }
      if (c === '\n') return -1; // quoted strings never span lines
      if (c === quote) return k;
    }
    return -1;
  };

  const scanTemplate = (): void => {
    let segStart = i;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { if (i > segStart) chunks.push({ start: segStart, end: i }); i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        if (i > segStart) chunks.push({ start: segStart, end: i });
        i += 2;
        scanCode(true);
        segStart = i;
        continue;
      }
      i++;
    }
    if (n > segStart) chunks.push({ start: segStart, end: n });
  };

  const scanCode = (untilCloseBrace: boolean): void => {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
      if (c === '`') { i++; scanTemplate(); continue; }
      if ((c === '"' || c === "'") && quoteStartsString(src, i)) {
        const e = stringEnd(c, i + 1);
        if (e !== -1) { if (e > i + 1) chunks.push({ start: i + 1, end: e }); i = e + 1; continue; }
      }
      if (c === '{') depth++;
      else if (c === '}') {
        if (untilCloseBrace && depth === 0) { i++; return; }
        depth--;
      }
      i++;
    }
  };

  scanCode(false);
  return chunks;
}

// ---------------------------------------------------------------------------
// 2. Classes and rules
// ---------------------------------------------------------------------------

const UTIL = '(?:bg|text|border|border-[trblxy]|ring|ring-offset|divide|from|to|via|fill|stroke|placeholder|outline|shadow|accent|decoration|caret)';
const COLOR = '(?:white|black|transparent|slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)';

/** A palette class such as "dark:hover:bg-slate-800/50". */
export const PALETTE_TOKEN = new RegExp(
  `(?<![\\w:/\\[-])((?:[a-z0-9-]+:)*)(${UTIL})-(${COLOR})(?:-(\\d{2,3}))?(?:/(\\d{1,3}))?(?![\\w-])`,
  'g'
);

type Family = 'bg' | 'text' | 'border' | 'ring';

const FAMILY_OF_UTIL: Record<string, Family> = {
  bg: 'bg', from: 'bg', to: 'bg', via: 'bg', 'ring-offset': 'bg',
  text: 'text', fill: 'text', stroke: 'text', placeholder: 'text', decoration: 'text', caret: 'text',
  border: 'border', 'border-t': 'border', 'border-r': 'border', 'border-b': 'border', 'border-l': 'border',
  'border-x': 'border', 'border-y': 'border', divide: 'border', outline: 'border',
  ring: 'ring',
};

/** Colours that are interchangeable for our purposes. */
const CANONICAL_COLOR: Record<string, string> = {
  gray: 'slate', zinc: 'slate', neutral: 'slate', stone: 'slate',
  green: 'emerald', yellow: 'amber', orange: 'amber', rose: 'red', indigo: 'blue', sky: 'blue',
};

const canonKey = (color: string, shade: string | null): string => {
  const c = CANONICAL_COLOR[color] ?? color;
  return shade ? `${c}-${shade}` : c;
};

interface Rule {
  family: Family;
  /** Light-mode colours this rule covers, e.g. "slate-900". */
  light: string[];
  /** Dark-mode partners that are acceptable. Omit when the rule only applies to a class with no dark partner. */
  dark?: string[];
  /** Also applies when there is no dark partner. */
  lonely?: boolean;
  role: string;
  /** Force an opacity (percent) on the role class. */
  alpha?: number;
}

const S_FG_DARK = ['slate-50', 'slate-100', 'slate-200', 'slate-300', 'white'];
const NEUTRAL_FILL_DARK = ['slate-700', 'slate-800', 'slate-900'];

export const RULES: Rule[] = [
  // ---- backgrounds ----
  { family: 'bg', light: ['white'], dark: ['slate-900', 'slate-950'], lonely: true, role: 'surface' },
  { family: 'bg', light: ['white'], dark: ['slate-800', 'slate-700'], role: 'raised' },
  { family: 'bg', light: ['slate-50'], dark: ['slate-950', 'slate-900'], role: 'page' },
  { family: 'bg', light: ['slate-50'], dark: ['slate-800', 'slate-700'], lonely: true, role: 'fill-1' },
  { family: 'bg', light: ['slate-100'], dark: NEUTRAL_FILL_DARK, lonely: true, role: 'fill-2' },
  { family: 'bg', light: ['slate-200', 'slate-300'], dark: ['slate-600', ...NEUTRAL_FILL_DARK], lonely: true, role: 'fill-3' },
  { family: 'bg', light: ['black'], dark: ['white'], role: 'fill-2' },
  // Inverted neutral buttons: dark in light mode, light in dark mode ("bg-slate-800 dark:bg-slate-700").
  { family: 'bg', light: ['slate-800'], dark: ['slate-700', 'slate-600', 'slate-200', 'slate-100', 'white'], role: 'fg' },
  { family: 'bg', light: ['slate-900'], dark: ['slate-600', 'slate-500', 'slate-100', 'slate-200', 'white'], role: 'fg', alpha: 90 },
  { family: 'bg', light: ['slate-900', 'slate-950', 'black'], lonely: true, role: 'scrim' },
  { family: 'bg', light: ['blue-600', 'blue-500'], dark: ['blue-500', 'blue-400', 'blue-600'], lonely: true, role: 'accent' },
  { family: 'bg', light: ['blue-700'], dark: ['blue-400', 'blue-500', 'blue-600'], lonely: true, role: 'accent-hover' },
  { family: 'bg', light: ['blue-50', 'blue-100'], dark: ['blue-950', 'blue-900', 'slate-800', 'slate-700'], lonely: true, role: 'accent-soft' },
  { family: 'bg', light: ['red-50', 'red-100'], dark: ['red-950', 'red-900'], lonely: true, role: 'danger-soft' },
  { family: 'bg', light: ['red-200', 'red-300'], dark: ['red-800', 'red-900'], lonely: true, role: 'danger-line' },
  { family: 'bg', light: ['red-600', 'red-500'], dark: ['red-500', 'red-600'], lonely: true, role: 'danger' },
  { family: 'bg', light: ['red-700'], dark: ['red-600', 'red-500'], lonely: true, role: 'danger', alpha: 90 },
  { family: 'bg', light: ['emerald-50', 'emerald-100'], dark: ['emerald-950', 'emerald-900'], lonely: true, role: 'success-soft' },
  { family: 'bg', light: ['emerald-200', 'emerald-300'], dark: ['emerald-800', 'emerald-900'], lonely: true, role: 'success-line' },
  { family: 'bg', light: ['emerald-500', 'emerald-600'], dark: ['emerald-500', 'emerald-400'], lonely: true, role: 'success' },
  { family: 'bg', light: ['emerald-700'], lonely: true, role: 'success', alpha: 90 },
  { family: 'bg', light: ['amber-50', 'amber-100', 'amber-200'], dark: ['amber-950', 'amber-900'], lonely: true, role: 'warning-soft' },
  { family: 'bg', light: ['amber-400', 'amber-500', 'amber-600'], dark: ['amber-500', 'amber-400'], lonely: true, role: 'warning' },
  { family: 'bg', light: ['amber-700'], lonely: true, role: 'warning', alpha: 90 },

  // ---- text ----
  { family: 'text', light: ['slate-900', 'slate-800', 'slate-700'], dark: S_FG_DARK, lonely: true, role: 'fg' },
  // Hover emphasis: a muted colour that gets stronger on hover ("hover:text-slate-600 dark:hover:text-slate-200").
  { family: 'text', light: ['slate-600'], dark: ['slate-200', 'slate-100', 'white'], role: 'fg' },
  { family: 'text', light: ['slate-600', 'slate-500'], dark: ['slate-300', 'slate-400', 'slate-500'], lonely: true, role: 'fg-muted' },
  { family: 'text', light: ['slate-400'], dark: ['slate-500', 'slate-600', 'slate-400'], lonely: true, role: 'fg-subtle' },
  { family: 'text', light: ['slate-300'], dark: ['slate-700', 'slate-600'], lonely: true, role: 'line-strong' },
  { family: 'text', light: ['blue-800', 'blue-900'], dark: ['white', 'blue-100', 'blue-200'], role: 'accent-hover' },
  { family: 'text', light: ['blue-500', 'blue-600', 'blue-700', 'blue-800'], dark: ['blue-300', 'blue-400', 'blue-500'], lonely: true, role: 'accent-text' },
  { family: 'text', light: ['red-500', 'red-600', 'red-700', 'red-800', 'red-900'], dark: ['red-100', 'red-200', 'red-300', 'red-400'], lonely: true, role: 'danger' },
  { family: 'text', light: ['emerald-500', 'emerald-600', 'emerald-700', 'emerald-800', 'emerald-900'], dark: ['emerald-100', 'emerald-200', 'emerald-300', 'emerald-400'], lonely: true, role: 'success' },
  { family: 'text', light: ['amber-500', 'amber-600', 'amber-700', 'amber-800', 'amber-900', 'amber-950'], dark: ['amber-100', 'amber-200', 'amber-300', 'amber-400'], lonely: true, role: 'warning' },

  // ---- borders and dividers ----
  { family: 'border', light: ['slate-100', 'slate-200'], dark: ['slate-700', 'slate-800', 'slate-900'], lonely: true, role: 'line' },
  { family: 'border', light: ['slate-300', 'slate-400'], dark: ['slate-600', 'slate-700'], lonely: true, role: 'line-strong' },
  { family: 'border', light: ['white'], dark: ['slate-900', 'slate-800'], lonely: true, role: 'surface' },
  { family: 'border', light: ['blue-600', 'blue-500'], dark: ['blue-500', 'blue-400'], lonely: true, role: 'accent' },
  { family: 'border', light: ['blue-400'], dark: ['blue-400', 'blue-500', 'blue-600'], lonely: true, role: 'accent' },
  { family: 'border', light: ['blue-200', 'blue-300'], dark: ['blue-700', 'blue-800', 'blue-900'], lonely: true, role: 'accent-line' },
  { family: 'border', light: ['red-200', 'red-300'], dark: ['red-800', 'red-900'], lonely: true, role: 'danger-line' },
  { family: 'border', light: ['emerald-200', 'emerald-300'], dark: ['emerald-700', 'emerald-800', 'emerald-900'], lonely: true, role: 'success-line' },
  { family: 'border', light: ['amber-200', 'amber-300'], dark: ['amber-700', 'amber-800', 'amber-900'], lonely: true, role: 'warning-line' },

  // ---- focus rings ----
  { family: 'ring', light: ['blue-400', 'blue-500', 'blue-600'], dark: ['blue-400', 'blue-500', 'blue-600'], lonely: true, role: 'focus' },
  { family: 'ring', light: ['slate-100', 'slate-200', 'slate-300'], dark: ['slate-700', 'slate-800'], lonely: true, role: 'line' },
  { family: 'ring', light: ['red-400', 'red-500'], dark: ['red-400', 'red-500'], lonely: true, role: 'danger' },
];

/** Roles whose original opacity is kept (translucent headers, overlays, focus halos). */
const KEEP_ALPHA = new Set(['surface', 'page', 'raised', 'scrim', 'focus']);

/** Solid colour roles that have a matching "text on top of it" role. */
const ON_ROLE: Record<string, string> = { accent: 'on-accent', danger: 'on-danger', success: 'on-success', warning: 'on-warning', fg: 'surface' };

// ---------------------------------------------------------------------------
// 3. Migration of one string
// ---------------------------------------------------------------------------

interface Tok {
  start: number;
  end: number;
  full: string;
  variants: string;
  util: string;
  family: Family | null;
  key: string; // canonical "slate-900"
  alpha: string | null;
  isDark: boolean;
  base: string; // variants without "dark:"
}

export type NoteKind = 'no-rule' | 'partner-mismatch' | 'unsupported-utility' | 'white-text-without-solid-background' | 'orphan-dark';

export interface Note {
  kind: NoteKind;
  token: string;
  partner?: string;
}

export interface ChunkResult {
  text: string;
  converted: number;
  pairs: number;
  notes: Note[];
}

function parseTokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(PALETTE_TOKEN)) {
    const color = m[3];
    if (color === 'transparent') continue;
    const variants = m[1] ?? '';
    const isDark = variants.split(':').includes('dark');
    const base = variants.split(':').filter((v) => v && v !== 'dark').map((v) => `${v}:`).join('');
    out.push({
      start: m.index!, end: m.index! + m[0].length, full: m[0], variants, util: m[2],
      family: FAMILY_OF_UTIL[m[2]] ?? null, key: canonKey(color, m[4] ?? null), alpha: m[5] ?? null, isDark, base,
    });
  }
  return out;
}

function findRule(family: Family, lightKey: string, darkKey: string | null): Rule | null {
  for (const r of RULES) {
    if (r.family !== family || !r.light.includes(lightKey)) continue;
    if (darkKey === null) { if (r.lonely) return r; continue; }
    if (r.dark?.includes(darkKey)) return r;
  }
  return null;
}

/** "bg" + "surface" + "/95" with the original variants, e.g. "hover:bg-fill-2". */
const roleClass = (t: Tok, role: string, alpha: string | null): string => `${t.base}${t.util}-${role}${alpha ? `/${alpha}` : ''}`;

export interface MappingInfo {
  family: string;
  light: string;
  dark: string | null;
  role: string;
}

export function migrateChunk(text: string, onMap?: (info: MappingInfo) => void): ChunkResult {
  const toks = parseTokens(text);
  const notes: Note[] = [];
  if (toks.length === 0) return { text, converted: 0, pairs: 0, notes };

  type Edit = { start: number; end: number; replacement: string };
  const edits: Edit[] = [];
  const handled = new Set<Tok>();
  let converted = 0;
  let pairs = 0;
  const produced = new Map<Tok, string>(); // light token → role class (for the white-text pass)

  const lights = toks.filter((t) => !t.isDark);
  const darks = toks.filter((t) => t.isDark);
  const usedDark = new Set<Tok>();

  for (const light of lights) {
    if (light.family === null) { notes.push({ kind: 'unsupported-utility', token: light.full }); handled.add(light); continue; }
    if (light.key === 'white' && light.family === 'text') continue; // decided in the second pass
    const candidates = darks.filter((d) => !usedDark.has(d) && d.base === light.base && d.util === light.util);

    let rule: Rule | null = null;
    let partner: Tok | null = null;
    for (const d of candidates) {
      const r = findRule(light.family, light.key, d.key);
      if (r) { rule = r; partner = d; break; }
    }
    if (!rule && candidates.length === 0) rule = findRule(light.family, light.key, null);

    if (!rule) {
      handled.add(light);
      if (candidates.length > 0) notes.push({ kind: 'partner-mismatch', token: light.full, partner: candidates[0].full });
      else notes.push({ kind: 'no-rule', token: light.full });
      continue;
    }

    const alpha = rule.alpha !== undefined ? String(rule.alpha) : KEEP_ALPHA.has(rule.role) ? light.alpha : null;
    const replacement = roleClass(light, rule.role, alpha);
    edits.push({ start: light.start, end: light.end, replacement });
    onMap?.({ family: light.family, light: light.key, dark: partner ? partner.key : null, role: rule.role });
    produced.set(light, replacement);
    handled.add(light);
    converted++;
    if (partner) {
      usedDark.add(partner);
      handled.add(partner);
      edits.push({ start: partner.start, end: partner.end, replacement: '' });
      converted++;
      pairs++;
    }
  }

  // White text sits on a solid colour: use that colour's "on" role. Otherwise leave it and report.
  for (const light of lights) {
    if (!(light.key === 'white' && light.family === 'text')) continue;
    const solid = [...produced.values()].map((c) => c.match(/(?:^|:)bg-(accent|danger|success|warning|fg)(?:\/\d+)?$/)).find(Boolean);
    const darkPartners = darks.filter((d) => !usedDark.has(d) && d.base === light.base && d.util === light.util);
    if (!solid) { notes.push({ kind: 'white-text-without-solid-background', token: light.full }); continue; }
    edits.push({ start: light.start, end: light.end, replacement: roleClass(light, ON_ROLE[solid[1]], null) });
    converted++;
    for (const d of darkPartners) { usedDark.add(d); handled.add(d); edits.push({ start: d.start, end: d.end, replacement: '' }); converted++; }
  }

  for (const d of darks) if (!usedDark.has(d) && !handled.has(d)) notes.push({ kind: 'orphan-dark', token: d.full });

  // Apply from the end so offsets stay valid. Deleting a token also removes one neighbouring space.
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) {
    let { start, end } = e;
    if (e.replacement === '') {
      if (start > 0 && out[start - 1] === ' ') start--;
      else if (out[end] === ' ') end++;
    }
    out = out.slice(0, start) + e.replacement + out.slice(end);
  }
  return { text: dedupeClasses(out, new Set([...produced.values()])), converted, pairs, notes };
}

/** Removes repeats of the role classes this tool produced (never touches other classes), with one neighbouring space. */
function dedupeClasses(text: string, produced: Set<string>): string {
  if (produced.size === 0) return text;
  const seen = new Set<string>();
  const cuts: [number, number][] = [];
  for (const m of text.matchAll(/(?<![\w:/\[-])[a-z0-9:-]+(?:\/\d+)?(?![\w-])/g)) {
    const cls = m[0];
    if (!produced.has(cls)) continue;
    if (!seen.has(cls)) { seen.add(cls); continue; }
    let start = m.index!;
    let end = start + cls.length;
    if (start > 0 && text[start - 1] === ' ') start--;
    else if (text[end] === ' ') end++;
    cuts.push([start, end]);
  }
  let out = text;
  for (const [start, end] of cuts.reverse()) out = out.slice(0, start) + out.slice(end);
  return out;
}

// ---------------------------------------------------------------------------
// 4. Whole files
// ---------------------------------------------------------------------------

export interface FileNote extends Note {
  line: number;
}

export interface FileResult {
  output: string;
  converted: number;
  pairs: number;
  notes: FileNote[];
  changed: boolean;
}

export function migrateSource(src: string, onMap?: (info: MappingInfo) => void): FileResult {
  const chunks = findStringChunks(src);
  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  let converted = 0, pairs = 0;
  const notes: FileNote[] = [];
  const replacements: { start: number; end: number; text: string }[] = [];
  for (const c of chunks) {
    const original = src.slice(c.start, c.end);
    if (!/(?:bg|text|border|ring|divide|from|to|via|fill|stroke|placeholder|outline|decoration|caret|accent|shadow)-/.test(original)) continue;
    const r = migrateChunk(original, onMap);
    converted += r.converted;
    pairs += r.pairs;
    for (const n of r.notes) notes.push({ ...n, line: lineOf(c.start) });
    if (r.text !== original) replacements.push({ start: c.start, end: c.end, text: r.text });
  }
  let output = src;
  for (const r of replacements.sort((a, b) => b.start - a.start)) output = output.slice(0, r.start) + r.text + output.slice(r.end);
  return { output, converted, pairs, notes, changed: output !== src };
}

/**
 * Every hard-coded palette class in a file (anything the theme cannot restyle), with its line number.
 * Used by the "no hard-coded colours" check: new code should use theme roles instead.
 */
export function findLeftovers(src: string): { token: string; line: number }[] {
  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const out: { token: string; line: number }[] = [];
  for (const c of findStringChunks(src)) {
    const text = src.slice(c.start, c.end);
    for (const t of parseTokens(text)) out.push({ token: t.full, line: lineOf(c.start + t.start) });
  }
  return out;
}
