/**
 * Turns the AI analyst's Markdown answer into plain data blocks (headings, lists, tables, charts…).
 * Pure functions, no DOM and no HTML strings: the screen renders these blocks as React elements, so
 * nothing the model writes can ever become raw HTML or script. Only https/http links are kept.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type ChartType = 'bar' | 'line' | 'area' | 'pie';

export interface ChartSpec {
  type: ChartType;
  title: string;
  labels: string[];
  series: { name: string; values: number[] }[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'quote'; content: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'hr' }
  | { type: 'chart'; spec: ChartSpec };

export const MAX_CHART_JSON_CHARS = 8000;
export const MAX_CHART_LABELS = 24;
export const MAX_CHART_SERIES = 5;
const MAX_NAME_CHARS = 60;

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim().slice(0, MAX_NAME_CHARS) : '');

/** Returns a safe chart spec, or null if the JSON is not a valid chart. Never throws. */
export function parseChartSpec(raw: string): ChartSpec | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CHART_JSON_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;

  const type = d.type;
  if (type !== 'bar' && type !== 'line' && type !== 'area' && type !== 'pie') return null;

  if (!Array.isArray(d.labels) || d.labels.length < 1 || d.labels.length > MAX_CHART_LABELS) return null;
  const labels = d.labels.map((l) => clean(typeof l === 'number' ? String(l) : l));
  if (labels.some((l) => l === '')) return null;

  if (!Array.isArray(d.series) || d.series.length < 1 || d.series.length > MAX_CHART_SERIES) return null;
  if (type === 'pie' && d.series.length !== 1) return null;

  const series: ChartSpec['series'] = [];
  for (const s of d.series) {
    if (typeof s !== 'object' || s === null) return null;
    const { name, values } = s as { name?: unknown; values?: unknown };
    if (!Array.isArray(values) || values.length !== labels.length) return null;
    if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    series.push({ name: clean(name) || 'Value', values: values as number[] });
  }
  if (type === 'pie' && series[0].values.some((v) => v < 0)) return null;

  return { type, title: clean(d.title), labels, series };
}

// ---------------------------------------------------------------------------
// Inline text: **bold**, *italic*, `code`, [text](https://link)
// ---------------------------------------------------------------------------

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9]/.test(ch);
const LINK_RE = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/;

export function parseInline(input: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push({ t: 'text', v: buf });
      buf = '';
    }
  };
  if (depth > 4) return [{ t: 'text', v: input }];

  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    const two = input.slice(i, i + 2);

    if (ch === '`') {
      const end = input.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (two === '**' || two === '__') {
      let end = input.indexOf(two, i + 2);
      // "**bold *italic***": the closing marker is the LAST two characters of a run of stars.
      while (end > i + 2 && two === '**' && input[end + 2] === '*') end += 1;
      if (end > i + 2 && !(two === '__' && (isWordChar(input[i - 1]) || isWordChar(input[end + 2])))) {
        flush();
        out.push({ t: 'bold', c: parseInline(input.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }

    if (ch === '*' && input[i + 1] !== '*' && input[i + 1] !== ' ') {
      let end = i + 1;
      while (end < input.length) {
        end = input.indexOf('*', end);
        if (end === -1 || input[end + 1] !== '*') break;
        end += 2;
      }
      if (end > i + 1 && input[end - 1] !== ' ') {
        flush();
        out.push({ t: 'italic', c: parseInline(input.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '_' && input[i + 1] !== '_' && input[i + 1] !== ' ' && !isWordChar(input[i - 1])) {
      const end = input.indexOf('_', i + 1);
      if (end > i + 1 && input[end - 1] !== ' ' && !isWordChar(input[end + 1])) {
        flush();
        out.push({ t: 'italic', c: parseInline(input.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const m = LINK_RE.exec(input.slice(i));
      if (m) {
        flush();
        out.push({ t: 'link', href: m[2], c: parseInline(m[1], depth + 1) });
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s{0,3}```\s*([A-Za-z0-9_-]*)\s*$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line) ||
    QUOTE_RE.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP_RE.test(next))
  );
}

export function parseAnalystMarkdown(input: string): Block[] {
  const text = typeof input === 'string' ? input.replace(/\r\n?/g, '\n') : '';
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[1].toLowerCase();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (or end of text)
      const joined = body.join('\n');
      if (lang === 'chart') {
        const spec = parseChartSpec(joined.trim());
        // A broken chart block is simply left out; the written answer still reads fine.
        if (spec) blocks.push({ type: 'chart', spec });
      } else {
        blocks.push({ type: 'code', text: joined });
      }
      continue;
    }

    if (HR_RE.test(line) && !BULLET_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(4, heading[1].length) as 1 | 2 | 3 | 4,
        content: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const header = splitRow(line).map((c) => parseInline(c));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        const cells = splitRow(lines[i]).map((c) => parseInline(c));
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, header.length));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        parts.push((QUOTE_RE.exec(lines[i]) as RegExpExecArray)[1]);
        i += 1;
      }
      blocks.push({ type: 'quote', content: parseInline(parts.join(' ').trim()) });
      continue;
    }

    const isBullet = BULLET_RE.test(line);
    if (isBullet || ORDERED_RE.test(line)) {
      const ordered = !isBullet;
      const re = ordered ? ORDERED_RE : BULLET_RE;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (m) {
          items.push(parseInline(m[1].trim()));
          i += 1;
        } else if (lines[i].trim() !== '' && /^\s{2,}\S/.test(lines[i]) && items.length > 0) {
          // An indented follow-on line (or nested item) is kept as part of the item above.
          const extra = lines[i].trim().replace(/^[-*+]\s+|^\d{1,3}[.)]\s+/, '');
          items[items.length - 1] = [...items[items.length - 1], { t: 'text', v: ' ' }, ...parseInline(extra)];
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
  }

  return blocks;
}
