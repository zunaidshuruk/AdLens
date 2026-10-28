/** Helpers that reshape explore rows for the extra dashboard chart types. */

export interface PivotResult {
  /** One row per first-dimension value: { label, <series name>: number, ... } */
  data: Array<Record<string, string | number>>;
  series: string[];
}

/** Turns rows of (dim1, dim2, metric) into one row per dim1 with a column per dim2. Keeps the biggest series, folds the rest into "Other". */
export function pivotTwoDimensions(
  rows: Array<Record<string, unknown>>,
  dim1: string,
  dim2: string,
  metric: string,
  maxSeries = 6
): PivotResult {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const s = String(r[dim2] ?? '');
    const v = typeof r[metric] === 'number' ? (r[metric] as number) : 0;
    totals.set(s, (totals.get(s) ?? 0) + v);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const keep = new Set(ranked.slice(0, maxSeries));
  const hasOther = ranked.length > maxSeries;
  const byLabel = new Map<string, Record<string, string | number>>();
  for (const r of rows) {
    const label = String(r[dim1] ?? '');
    const raw = String(r[dim2] ?? '');
    const s = keep.has(raw) ? raw : 'Other';
    const v = typeof r[metric] === 'number' ? (r[metric] as number) : 0;
    const row = byLabel.get(label) ?? { label };
    row[s] = ((row[s] as number | undefined) ?? 0) + v;
    byLabel.set(label, row);
  }
  const series = hasOther ? [...ranked.slice(0, maxSeries), 'Other'] : ranked.slice(0, maxSeries);
  return { data: [...byLabel.values()], series };
}

/** Pie slices: biggest first, tail folded into "Other" so the pie stays readable. */
export function pieSlices(data: Array<{ label: string; value: number }>, maxSlices = 6): Array<{ label: string; value: number }> {
  const positive = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (positive.length <= maxSlices) return positive;
  const head = positive.slice(0, maxSlices - 1);
  const rest = positive.slice(maxSlices - 1).reduce((s, d) => s + d.value, 0);
  return [...head, { label: 'Other', value: rest }];
}

/** 0..1 fill for a gauge. Percent metrics are already 0-100; others need a target. Null when it cannot be drawn. */
export function gaugeFraction(value: number, isPercent: boolean, target?: number): number | null {
  if (!Number.isFinite(value)) return null;
  const max = isPercent ? (target && target > 0 ? target : 100) : target;
  if (!max || max <= 0) return null;
  return Math.max(0, Math.min(1, value / max));
}

/** Heat map grid: rows x columns with a 0..1 intensity per cell. */
export function heatGrid(
  rows: Array<Record<string, unknown>>,
  rowKey: string,
  colKey: string,
  metric: string,
  maxRows = 12,
  maxCols = 12
): { rowLabels: string[]; colLabels: string[]; cells: Array<Array<{ value: number | null; intensity: number }>> } {
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  const cell = new Map<string, number>();
  for (const r of rows) {
    const a = String(r[rowKey] ?? '');
    const b = String(r[colKey] ?? '');
    const v = typeof r[metric] === 'number' ? (r[metric] as number) : 0;
    rowTotals.set(a, (rowTotals.get(a) ?? 0) + v);
    colTotals.set(b, (colTotals.get(b) ?? 0) + v);
    cell.set(`${a}\u0000${b}`, (cell.get(`${a}\u0000${b}`) ?? 0) + v);
  }
  const rowLabels = [...rowTotals.entries()].sort((x, y) => y[1] - x[1]).slice(0, maxRows).map(([k]) => k);
  const colLabels = [...colTotals.entries()].sort((x, y) => y[1] - x[1]).slice(0, maxCols).map(([k]) => k);
  let max = 0;
  for (const a of rowLabels) for (const b of colLabels) max = Math.max(max, cell.get(`${a}\u0000${b}`) ?? 0);
  const cells = rowLabels.map((a) =>
    colLabels.map((b) => {
      const v = cell.get(`${a}\u0000${b}`);
      return v === undefined ? { value: null, intensity: 0 } : { value: v, intensity: max > 0 ? v / max : 0 };
    })
  );
  return { rowLabels, colLabels, cells };
}
