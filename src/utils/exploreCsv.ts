import type { ExploreColumn, ExploreResult } from '../types/explore.js';

/**
 * Cell text that is safe to open in Excel or Google Sheets. Text that starts with = + - @ (or a tab or return) could be run as a
 * formula by the spreadsheet (search queries and page titles come from the public, so they are not trusted); a leading apostrophe
 * makes it plain text. Numbers are written as they are.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exploreToCsv(result: Pick<ExploreResult, 'columns' | 'rows' | 'totals'>, includeTotals = true): string {
  const cols: ExploreColumn[] = result.columns;
  const lines = [cols.map((c) => csvCell(c.label)).join(',')];
  for (const row of result.rows) lines.push(cols.map((c) => csvCell(row[c.key])).join(','));
  if (includeTotals && result.totals) {
    let labelled = false;
    lines.push(cols.map((c) => {
      if (c.role === 'metric') return csvCell(result.totals![c.key]);
      if (!labelled) { labelled = true; return 'Total'; }
      return '';
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

export function csvFileName(source: string, label: string, date: Date = new Date()): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'report';
  return `adlens_${source}_${slug}_${date.toISOString().slice(0, 10)}.csv`;
}
