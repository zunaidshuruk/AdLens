/**
 * Shrinks a report result to a compact text block that fits a small model's context window
 * (Sprint 15). Chrome's on-device model has a window of roughly 9k tokens shared between the
 * question and the answer, so each tool result must be a few hundred to ~2,000 tokens.
 *
 * Pure function; works on any JSON-like value returned by a report function.
 * - Metrics with comparison ({ value, previousValue, changePercent }) become one line.
 * - Arrays of rows become small pipe-separated tables (nulls and empty columns dropped).
 * - Daily time series (rows with a "date") become min / max / average plus ~10 evenly spaced points.
 * - Numbers are rounded, long strings trimmed. The output always says what was cut.
 */

export interface CompactOptions {
  /** Token budget for the whole result. Default 1500. */
  maxTokens?: number;
  /** Maximum table rows before the budget shrinks them further. Default 25. */
  maxRows?: number;
  /** Strings longer than this are shortened. Default 60. */
  maxStringLength?: number;
}

export interface CompactResult {
  text: string;
  tokens: number;
  truncated: boolean;
  notes: string[];
}

/** Conservative estimate (numbers and symbols cost more tokens than plain words). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

type Json = unknown;
type Obj = Record<string, unknown>;

const isObj = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: Json): v is number => typeof v === 'number' && Number.isFinite(v);
const SUM_COLUMNS = /(sessions|users|clicks|impressions|spend|leads|conversions|events|views|reach)$/i;

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const r = Math.abs(n) >= 100 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  return String(r);
}

function fmtSigned(n: number): string {
  const s = fmtNum(n);
  return n > 0 ? `+${s}` : s;
}

function isMetric(v: Json): v is { value: number; previousValue?: number; changePercent?: number | null } {
  return isObj(v) && isNum(v.value) && ('previousValue' in v || 'changePercent' in v) && Object.keys(v).length <= 4;
}

class Renderer {
  notes: string[] = [];
  constructor(readonly maxRows: number, readonly maxStr: number) {}

  scalar(v: Json): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? fmtNum(v) : '';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s.length > this.maxStr ? `${s.slice(0, this.maxStr - 1)}…` : s;
  }

  metric(m: { value: number; previousValue?: number; changePercent?: number | null }): string {
    const parts = [fmtNum(m.value)];
    const extra: string[] = [];
    if (isNum(m.previousValue)) extra.push(`prev ${fmtNum(m.previousValue)}`);
    if (isNum(m.changePercent)) extra.push(`${fmtSigned(m.changePercent)}%`);
    return extra.length ? `${parts[0]} (${extra.join(', ')})` : parts[0];
  }

  /** Flatten one level of nesting into "a.b" keys; metrics become strings. */
  flatten(row: Obj): Obj {
    const out: Obj = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) continue;
      if (isMetric(v)) out[k] = this.metric(v);
      else if (isObj(v)) {
        for (const [k2, v2] of Object.entries(v)) {
          if (v2 !== null && v2 !== undefined && !isObj(v2) && !Array.isArray(v2)) out[`${k}.${k2}`] = v2;
        }
      } else if (!Array.isArray(v)) out[k] = v;
    }
    return out;
  }

  table(rows: Obj[], label: string): string[] {
    const flat = rows.map((r) => this.flatten(r));
    const total = flat.length;

    // Daily time series: summarise instead of listing every day.
    const isSeries = total > this.maxRows && flat.every((r) => typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date));
    if (isSeries) return this.series(flat, label);

    const shown = flat.slice(0, this.maxRows);
    const columns = [...new Set(shown.flatMap((r) => Object.keys(r)))].filter((c) =>
      shown.some((r) => r[c] !== undefined && r[c] !== null && r[c] !== '')
    );
    const lines = [`[${label}] ${total} row${total === 1 ? '' : 's'}`];
    if (columns.length === 0) return lines;
    lines.push(columns.join(' | '));
    for (const r of shown) lines.push(columns.map((c) => this.scalar(r[c])).join(' | '));
    if (total > shown.length) {
      const note = `${label}: showing first ${shown.length} of ${total} rows`;
      this.notes.push(note);
      lines.push(`(showing first ${shown.length} of ${total} rows)`);
    }
    return lines;
  }

  series(rows: Obj[], label: string): string[] {
    const numericCols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
      (c) => c !== 'date' && c !== 'compareDate' && rows.some((r) => isNum(r[c]))
    );
    const lines = [`[${label}] daily series, ${rows.length} days (${rows[0].date} to ${rows[rows.length - 1].date})`];
    for (const c of numericCols) {
      const pts = rows.filter((r) => isNum(r[c])).map((r) => ({ d: String(r.date), v: r[c] as number }));
      if (!pts.length) continue;
      const min = pts.reduce((a, b) => (b.v < a.v ? b : a));
      const max = pts.reduce((a, b) => (b.v > a.v ? b : a));
      const avg = pts.reduce((s, p) => s + p.v, 0) / pts.length;
      const sum = SUM_COLUMNS.test(c) ? `, total ${fmtNum(pts.reduce((s, p) => s + p.v, 0))}` : '';
      lines.push(`${c}: avg ${fmtNum(avg)}${sum}, min ${fmtNum(min.v)} (${min.d}), max ${fmtNum(max.v)} (${max.d})`);
    }
    const step = Math.max(1, Math.ceil(rows.length / 10));
    const sample = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    const cols = ['date', ...numericCols.slice(0, 4)];
    lines.push(`sampled every ${step} day(s):`, cols.join(' | '));
    for (const r of sample) lines.push(cols.map((c) => this.scalar(r[c])).join(' | '));
    this.notes.push(`${label}: daily values summarised (${rows.length} days)`);
    return lines;
  }

  value(v: Json, label: string, depth: number): string[] {
    if (v === null || v === undefined) return [];
    if (isMetric(v)) return [`${label}: ${this.metric(v)}`];
    if (Array.isArray(v)) {
      if (v.length === 0) return [`[${label}] 0 rows`];
      if (v.every(isObj)) return this.table(v as Obj[], label);
      return [`${label}: ${v.slice(0, 20).map((x) => this.scalar(x)).join(', ')}${v.length > 20 ? ` … (+${v.length - 20} more)` : ''}`];
    }
    if (isObj(v)) {
      const lines: string[] = [];
      const entries = Object.entries(v);
      // Plain scalars and metrics first (KPI block), then nested sections.
      for (const [k, x] of entries) {
        if (x === null || x === undefined) continue;
        if (isMetric(x)) lines.push(`${label ? label + '.' : ''}${k}: ${this.metric(x)}`);
        else if (!isObj(x) && !Array.isArray(x)) lines.push(`${label ? label + '.' : ''}${k}: ${this.scalar(x)}`);
      }
      for (const [k, x] of entries) {
        if (isObj(x) && !isMetric(x)) {
          if (depth >= 3) continue;
          lines.push(...this.value(x, `${label ? label + '.' : ''}${k}`, depth + 1));
        } else if (Array.isArray(x)) lines.push(...this.value(x, `${label ? label + '.' : ''}${k}`, depth + 1));
      }
      return lines;
    }
    return [`${label}: ${this.scalar(v)}`];
  }
}

export function compactReport(result: Json, opts: CompactOptions = {}): CompactResult {
  const maxTokens = opts.maxTokens ?? 1500;
  const maxStr = opts.maxStringLength ?? 60;
  let maxRows = Math.max(3, opts.maxRows ?? 25);

  for (;;) {
    const r = new Renderer(maxRows, maxStr);
    const rootLabel = Array.isArray(result) ? 'rows' : '';
    let lines = r.value(result, rootLabel, 0);
    let text = lines.join('\n');
    let truncated = r.notes.length > 0;

    if (estimateTokens(text) > maxTokens && maxRows > 3) {
      maxRows = Math.max(3, Math.floor(maxRows / 2));
      continue;
    }
    if (estimateTokens(text) > maxTokens) {
      // Last resort: cut whole lines from the end until it fits.
      const keep: string[] = [];
      let used = 0;
      for (const line of lines) {
        const cost = estimateTokens(line + '\n');
        if (used + cost > maxTokens - 12) break;
        keep.push(line);
        used += cost;
      }
      r.notes.push(`output cut to fit ${maxTokens} tokens (${lines.length - keep.length} lines omitted)`);
      lines = [...keep, '(output truncated to fit)'];
      text = lines.join('\n');
      truncated = true;
    }
    if (text.trim() === '') text = '(no data returned)';
    return { text, tokens: estimateTokens(text), truncated, notes: r.notes };
  }
}
