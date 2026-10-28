/**
 * Uploaded data (CSV) as a data source. Small tables only: they are stored as one document per table and queried in memory.
 * Pure functions plus a thin store layer. Nothing here talks to the network.
 */
import { z } from 'zod';
import { newDocId, type ProjectDocsStore, type StoredDoc } from './projectDocs.js';
import type { ColumnType, ExploreCell, ExploreColumn, ExploreResult } from './exploreSpec.js';

export const MAX_CSV_CHARS = 240_000;
export const MAX_DATASET_ROWS = 5_000;
export const MAX_DATASET_COLUMNS = 20;
export const ROW_COUNT_KEY = '__rows';
const MAX_RESULT_ROWS = 1000;

export type DataCell = string | number | null;
export interface DataColumn { key: string; label: string; type: 'text' | 'number' | 'date' }
export interface Dataset {
  id: string;
  name: string;
  columns: DataColumn[];
  rows: DataCell[][];
  rowCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the table is pulled from an outside service (Sheets, Shopify…) and can be refreshed. Holds no secrets. */
  connector?: { id: string; label: string; params: Record<string, string> };
  /** The connector's secrets, sealed with the server key. Never sent to the browser. */
  sealedSecret?: string;
  syncedAt?: string;
  note?: string;
}
export type DatasetSummary = Omit<Dataset, 'rows' | 'sealedSecret'>;

export class DatasetError extends Error {
  constructor(readonly code: 'INVALID_CSV' | 'LIMIT_REACHED' | 'NOT_FOUND' | 'INVALID_QUERY' | 'CONNECTOR_FAILED', message: string, readonly status: number) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// CSV reading
// ---------------------------------------------------------------------------

function detectDelimiter(firstLine: string): string {
  const counts: [string, number][] = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** Small RFC 4180 reader: quoted cells, doubled quotes, line breaks inside quotes, comma / semicolon / tab. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delim = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const ISO_DATE = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ].*)?$/;
function toIsoDate(raw: string): string | null {
  const m = ISO_DATE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return `${y}-${mo}-${d}`;
}

function toNumber(raw: string): number | null {
  const t = raw.trim().replace(/[\s$£€৳%]/g, '').replace(/,/g, '');
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const cleanLabel = (raw: string, i: number): string => (raw.replace(/\s+/g, ' ').trim().slice(0, 60) || `Column ${i + 1}`);

/** Turns CSV text into a table with guessed column types. Throws DatasetError with a plain-language reason. */
export function buildTable(text: string): { columns: DataColumn[]; rows: DataCell[][] } {
  if (typeof text !== 'string' || text.trim() === '') throw new DatasetError('INVALID_CSV', 'The file is empty.', 400);
  if (text.length > MAX_CSV_CHARS) throw new DatasetError('INVALID_CSV', `The file is too big. Keep it under ${Math.round(MAX_CSV_CHARS / 1000)} KB (about ${MAX_DATASET_ROWS.toLocaleString()} rows).`, 400);
  return tableFromGrid(parseCsv(text));
}

/** The same table building, starting from rows of text cells (used by CSV files and by JSON connectors). */
export function tableFromGrid(grid: string[][]): { columns: DataColumn[]; rows: DataCell[][] } {
  if (grid.length < 2) throw new DatasetError('INVALID_CSV', 'Add a header row and at least one row of data.', 400);
  const header = grid[0];
  if (header.length > MAX_DATASET_COLUMNS) throw new DatasetError('INVALID_CSV', `Too many columns. The limit is ${MAX_DATASET_COLUMNS}.`, 400);
  const body = grid.slice(1);
  if (body.length > MAX_DATASET_ROWS) throw new DatasetError('INVALID_CSV', `Too many rows. The limit is ${MAX_DATASET_ROWS.toLocaleString()}.`, 400);

  const seen = new Map<string, number>();
  const labels = header.map((h, i) => {
    const base = cleanLabel(h, i);
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });

  const columns: DataColumn[] = labels.map((label, i) => {
    const cells = body.map((r) => (r[i] ?? '').trim()).filter((c) => c !== '');
    let type: DataColumn['type'] = 'text';
    if (cells.length > 0) {
      const dates = cells.filter((c) => toIsoDate(c) !== null).length;
      const nums = cells.filter((c) => toNumber(c) !== null).length;
      if (dates / cells.length >= 0.9) type = 'date';
      else if (nums / cells.length >= 0.9) type = 'number';
    }
    return { key: `c${i + 1}`, label, type };
  });

  const rows = body.map((r) => columns.map((c, i) => {
    const raw = (r[i] ?? '').trim();
    if (raw === '') return null;
    if (c.type === 'number') return toNumber(raw);
    if (c.type === 'date') return toIsoDate(raw);
    return raw.slice(0, 200);
  }));
  return { columns, rows };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const datasetInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the table a name').max(80),
  csv: z.string().min(1, 'The file is empty.').max(MAX_CSV_CHARS + 1000, 'The file is too big.'),
});

const asDataset = (d: StoredDoc): Dataset => d as unknown as Dataset;
/** What the browser may see of a table: no rows, no secrets. */
export const summary = (d: Dataset): DatasetSummary => { const { rows: _r, sealedSecret: _s, ...rest } = d; return rest; };

export async function listDatasets(store: ProjectDocsStore, ws: string, project: string): Promise<DatasetSummary[]> {
  const docs = await store.list(ws, project, 'datasets');
  return docs.map(asDataset).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDataset(store: ProjectDocsStore, ws: string, project: string, id: string): Promise<Dataset> {
  const doc = await store.get(ws, project, 'datasets', id);
  if (!doc) throw new DatasetError('NOT_FOUND', 'That table was not found. It may have been deleted.', 404);
  return asDataset(doc);
}

export async function createDataset(store: ProjectDocsStore, ws: string, project: string, uid: string, input: { name: string; csv: string }, maxDatasets: number, now = new Date()): Promise<Dataset> {
  const existing = await store.list(ws, project, 'datasets');
  if (existing.length >= maxDatasets) {
    throw new DatasetError('LIMIT_REACHED', `Your plan allows ${maxDatasets} uploaded ${maxDatasets === 1 ? 'table' : 'tables'} per project. Delete one or upgrade to add more.`, 409);
  }
  const { columns, rows } = buildTable(input.csv);
  const iso = now.toISOString();
  const doc: Dataset = { id: newDocId(), name: input.name, columns, rows, rowCount: rows.length, createdBy: uid, createdAt: iso, updatedAt: iso };
  await store.put(ws, project, 'datasets', doc as unknown as StoredDoc);
  return doc;
}

export async function deleteDataset(store: ProjectDocsStore, ws: string, project: string, id: string): Promise<void> {
  if (!(await store.delete(ws, project, 'datasets', id))) throw new DatasetError('NOT_FOUND', 'That table was not found.', 404);
}

// ---------------------------------------------------------------------------
// Querying (group, add up, filter, sort), same result shape as the other sources
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const AGGREGATES = ['sum', 'avg', 'min', 'max', 'count'] as const;

export const dataExploreInputSchema = z.object({
  datasetId: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  startDate: z.string().regex(ISO).optional(),
  endDate: z.string().regex(ISO).optional(),
  dimensions: z.array(z.string().max(10)).max(3).default([]),
  metrics: z.array(z.string().max(10)).min(1, 'Pick at least one number').max(6),
  aggregate: z.enum(AGGREGATES).default('sum'),
  filters: z.array(z.object({
    field: z.string().max(10),
    op: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'startsWith']),
    value: z.string().trim().min(1).max(200),
  })).max(5).default([]),
  orderBy: z.object({ field: z.string().max(10), desc: z.boolean().default(true) }).optional(),
  limit: z.number().int().min(1).max(MAX_RESULT_ROWS).default(100),
});
export type DataExploreInput = z.infer<typeof dataExploreInputSchema>;

/** The saved form of a query (no dates: the date picker supplies them). */
export const dataSpecSchema = z.object({
  datasetId: dataExploreInputSchema.shape.datasetId,
  dimensions: dataExploreInputSchema.shape.dimensions,
  metrics: dataExploreInputSchema.shape.metrics,
  aggregate: dataExploreInputSchema.shape.aggregate,
  filters: dataExploreInputSchema.shape.filters,
  orderBy: dataExploreInputSchema.shape.orderBy,
  limit: dataExploreInputSchema.shape.limit,
});

const bad = (message: string) => new DatasetError('INVALID_QUERY', message, 400);
const cellText = (v: DataCell) => (v === null ? '' : String(v));

function matches(op: string, cell: DataCell, value: string): boolean {
  const a = cellText(cell).toLowerCase();
  const b = value.toLowerCase();
  switch (op) {
    case 'equals': return a === b;
    case 'notEquals': return a !== b;
    case 'contains': return a.includes(b);
    case 'notContains': return !a.includes(b);
    default: return a.startsWith(b);
  }
}

export function runDataQuery(ds: Dataset, input: DataExploreInput): ExploreResult {
  const col = new Map(ds.columns.map((c, i) => [c.key, { c, i }]));
  for (const k of input.dimensions) if (!col.has(k)) throw bad('A breakdown column is no longer in this table.');
  for (const k of input.metrics) if (k !== ROW_COUNT_KEY && col.get(k)?.c.type !== 'number') throw bad('Pick number columns for the numbers.');
  for (const f of input.filters) if (!col.has(f.field)) throw bad('A filter column is no longer in this table.');
  if (new Set(input.dimensions).size !== input.dimensions.length || new Set(input.metrics).size !== input.metrics.length) throw bad('Each column can be used once.');
  if (input.orderBy && ![...input.dimensions, ...input.metrics].includes(input.orderBy.field)) throw bad('Sort by a column that is in the report.');

  // Date range applies to the table's date column, when it has one (the first one).
  const dateIdx = ds.columns.findIndex((c) => c.type === 'date');
  let rows = ds.rows;
  if (dateIdx >= 0 && (input.startDate || input.endDate)) {
    rows = rows.filter((r) => {
      const d = r[dateIdx];
      if (typeof d !== 'string') return false;
      return (!input.startDate || d >= input.startDate) && (!input.endDate || d <= input.endDate);
    });
  }
  for (const f of input.filters) {
    const i = col.get(f.field)!.i;
    rows = rows.filter((r) => matches(f.op, r[i], f.value));
  }

  const dimIdx = input.dimensions.map((k) => col.get(k)!.i);
  const groups = new Map<string, { dims: DataCell[]; rows: DataCell[][] }>();
  for (const r of rows) {
    const dims = dimIdx.map((i) => r[i]);
    const key = JSON.stringify(dims);
    const g = groups.get(key) ?? { dims, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  if (input.dimensions.length === 0 && rows.length > 0) groups.set('[]', { dims: [], rows });

  const agg = (list: DataCell[][], metric: string): number | null => {
    if (metric === ROW_COUNT_KEY || input.aggregate === 'count') {
      if (metric === ROW_COUNT_KEY) return list.length;
      const i = col.get(metric)!.i;
      return list.filter((r) => typeof r[i] === 'number').length;
    }
    const i = col.get(metric)!.i;
    const nums = list.map((r) => r[i]).filter((v): v is number => typeof v === 'number');
    if (nums.length === 0) return null;
    const sum = nums.reduce((s, v) => s + v, 0);
    switch (input.aggregate) {
      case 'avg': return sum / nums.length;
      case 'min': return Math.min(...nums);
      case 'max': return Math.max(...nums);
      default: return sum;
    }
  };
  const round = (n: number | null): number | null => (n === null ? null : Number(n.toFixed(2)));

  const columns: ExploreColumn[] = [
    ...input.dimensions.map((k) => {
      const c = col.get(k)!.c;
      return { key: k, label: c.label, type: (c.type === 'date' ? 'date' : c.type === 'number' ? 'decimal' : 'text') as ColumnType, role: 'dimension' as const };
    }),
    ...input.metrics.map((k) => ({
      key: k,
      label: k === ROW_COUNT_KEY ? 'Number of rows' : `${input.aggregate === 'sum' ? '' : `${input.aggregate[0].toUpperCase()}${input.aggregate.slice(1)} of `}${col.get(k)!.c.label}`,
      type: (k === ROW_COUNT_KEY || input.aggregate === 'count' ? 'integer' : 'decimal') as ColumnType,
      role: 'metric' as const,
    })),
  ];

  let out: Record<string, ExploreCell>[] = [...groups.values()].map((g) => {
    const row: Record<string, ExploreCell> = {};
    input.dimensions.forEach((k, i) => { row[k] = g.dims[i] === null ? '(empty)' : (g.dims[i] as string | number); });
    input.metrics.forEach((k) => { row[k] = round(agg(g.rows, k)); });
    return row;
  });

  if (input.orderBy) {
    const { field, desc } = input.orderBy;
    const dir = desc ? -1 : 1;
    out.sort((a, b) => {
      const x = a[field]; const y = b[field];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x ?? '').localeCompare(String(y ?? '')) * dir;
    });
  } else if (input.dimensions.length > 0 && col.get(input.dimensions[0])!.c.type === 'date') {
    out.sort((a, b) => String(a[input.dimensions[0]]).localeCompare(String(b[input.dimensions[0]])));
  } else {
    const first = input.metrics[0];
    out.sort((a, b) => Number(b[first] ?? 0) - Number(a[first] ?? 0));
  }

  const totals: Record<string, ExploreCell> | null = rows.length > 0 ? Object.fromEntries(input.metrics.map((k) => [k, round(agg(rows, k))])) : null;
  const truncated = out.length > input.limit;
  const rowCount = out.length;
  out = out.slice(0, input.limit);
  return { source: 'data', columns, rows: out, totals, rowCount, truncated };
}

/** What the picker on screen needs to describe one table. */
export function datasetCatalog(ds: DatasetSummary): { dimensions: { key: string; label: string; type: ColumnType; group: string }[]; metrics: { key: string; label: string; type: ColumnType; group: string }[] } {
  return {
    dimensions: ds.columns.map((c) => ({ key: c.key, label: c.label, type: (c.type === 'date' ? 'date' : c.type === 'number' ? 'decimal' : 'text') as ColumnType, group: 'Columns' })),
    metrics: [
      { key: ROW_COUNT_KEY, label: 'Number of rows', type: 'integer' as ColumnType, group: 'Counts' },
      ...ds.columns.filter((c) => c.type === 'number').map((c) => ({ key: c.key, label: c.label, type: 'decimal' as ColumnType, group: 'Numbers' })),
    ],
  };
}
