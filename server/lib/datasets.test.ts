import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DatasetError, MAX_DATASET_COLUMNS, ROW_COUNT_KEY, buildTable, createDataset, dataExploreInputSchema, datasetCatalog, deleteDataset, getDataset, listDatasets, parseCsv, runDataQuery, type Dataset,
} from './datasets.js';
import { createInMemoryProjectDocsStore } from './projectDocs.js';

const CSV = [
  'Date,Channel,Spend,Leads',
  '2026-10-01,Facebook,"1,200.50",10',
  '2026-10-01,TikTok,300,3',
  '2026-10-02,Facebook,800,8',
  '2026-10-03,TikTok,$100,',
  '2026-10-03,"Face, book",50,1',
].join('\n');

const make = (): Dataset => {
  const { columns, rows } = buildTable(CSV);
  return { id: 'd1', name: 'Ads', columns, rows, rowCount: rows.length, createdBy: 'u', createdAt: '', updatedAt: '' };
};
const q = (x: Record<string, unknown>) => dataExploreInputSchema.parse({ datasetId: 'd1', ...x });

test('CSV reader: quotes, commas inside quotes, line breaks inside quotes, semicolons, tabs, BOM', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(parseCsv('a,b\r\n"line1\nline2",2'), [['a', 'b'], ['line1\nline2', '2']]);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('﻿a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
});

test('CSV table: guesses date, number and text columns and cleans the numbers', () => {
  const t = buildTable(CSV);
  assert.deepEqual(t.columns.map((c) => c.type), ['date', 'text', 'number', 'number']);
  assert.deepEqual(t.columns.map((c) => c.key), ['c1', 'c2', 'c3', 'c4']);
  assert.equal(t.rows[0][2], 1200.5);
  assert.equal(t.rows[3][2], 100);
  assert.equal(t.rows[3][3], null);
  assert.equal(t.rows[4][1], 'Face, book');
});

test('CSV table: duplicate and empty headers get unique names; bad files give plain reasons', () => {
  const t = buildTable('Name,Name,\nx,y,z');
  assert.deepEqual(t.columns.map((c) => c.label), ['Name', 'Name (2)', 'Column 3']);
  assert.throws(() => buildTable(''), /empty/);
  assert.throws(() => buildTable('a,b'), /header row and at least one row/);
  assert.throws(() => buildTable(`${Array.from({ length: MAX_DATASET_COLUMNS + 1 }, (_, i) => `h${i}`).join(',')}\n1`), /Too many columns/);
  assert.throws(() => buildTable('a,b\n' + 'x'.repeat(250_000)), /too big/);
  assert.throws(() => buildTable('a,b\n' + '1,2\n'.repeat(5001)), /Too many rows/);
});

test('Data query: group, add up, filter by date and text, sort', () => {
  const ds = make();
  const r = runDataQuery(ds, q({ dimensions: ['c2'], metrics: ['c3', ROW_COUNT_KEY] }));
  assert.equal(r.source, 'data');
  assert.deepEqual(r.rows.map((x) => x.c2), ['Facebook', 'TikTok', 'Face, book']);
  assert.equal(r.rows[0].c3, 2000.5);
  assert.equal(r.rows[0][ROW_COUNT_KEY], 2);
  assert.equal(r.totals?.c3, 2450.5);
  const dated = runDataQuery(ds, q({ dimensions: ['c1'], metrics: ['c3'], startDate: '2026-10-02', endDate: '2026-10-03' }));
  assert.deepEqual(dated.rows.map((x) => x.c1), ['2026-10-02', '2026-10-03']);
  assert.equal(dated.rows[1].c3, 150);
  const filtered = runDataQuery(ds, q({ metrics: ['c4'], filters: [{ field: 'c2', op: 'equals', value: 'facebook' }] }));
  assert.equal(filtered.rows[0].c4, 18);
  const avg = runDataQuery(ds, q({ dimensions: ['c2'], metrics: ['c3'], aggregate: 'avg', orderBy: { field: 'c2', desc: false } }));
  assert.deepEqual(avg.rows.map((x) => x.c2), ['Face, book', 'Facebook', 'TikTok']);
  assert.equal(avg.rows[1].c3, 1000.25);
  assert.equal(avg.columns[1].label, 'Avg of Spend');
});

test('Data query: counts, empty cells, limits and refusals', () => {
  const ds = make();
  const c = runDataQuery(ds, q({ dimensions: ['c2'], metrics: ['c4'], aggregate: 'count', limit: 1 }));
  assert.equal(c.truncated, true);
  assert.equal(c.rowCount, 3);
  assert.equal(c.rows.length, 1);
  assert.throws(() => runDataQuery(ds, q({ metrics: ['c2'] })), (e) => e instanceof DatasetError && e.code === 'INVALID_QUERY');
  assert.throws(() => runDataQuery(ds, q({ metrics: ['c9'] })), DatasetError);
  assert.throws(() => runDataQuery(ds, q({ dimensions: ['nope'], metrics: ['c3'] })), DatasetError);
  assert.throws(() => runDataQuery(ds, q({ metrics: ['c3'], filters: [{ field: 'zz', op: 'equals', value: 'x' }] })), DatasetError);
  assert.equal(runDataQuery(ds, q({ metrics: ['c3'], filters: [{ field: 'c2', op: 'equals', value: 'nobody' }] })).totals, null);
  assert.equal(dataExploreInputSchema.safeParse({ datasetId: '../x', metrics: ['c3'] }).success, false);
});

test('Datasets: stored per project, plan limit enforced, catalog lists number columns as metrics', async () => {
  const store = createInMemoryProjectDocsStore();
  const a = await createDataset(store, 'w', 'p', 'u', { name: 'Ads', csv: CSV }, 1);
  assert.equal(a.rowCount, 5);
  await assert.rejects(createDataset(store, 'w', 'p', 'u', { name: 'More', csv: CSV }, 1), (e) => e instanceof DatasetError && e.code === 'LIMIT_REACHED');
  await createDataset(store, 'w', 'other', 'u', { name: 'Elsewhere', csv: CSV }, 1);
  const list = await listDatasets(store, 'w', 'p');
  assert.equal(list.length, 1);
  assert.equal('rows' in list[0], false);
  const cat = datasetCatalog(list[0]);
  assert.deepEqual(cat.metrics.map((m) => m.key), [ROW_COUNT_KEY, 'c3', 'c4']);
  assert.equal(cat.dimensions.length, 4);
  assert.equal((await getDataset(store, 'w', 'p', a.id)).rows.length, 5);
  await deleteDataset(store, 'w', 'p', a.id);
  await assert.rejects(getDataset(store, 'w', 'p', a.id), (e) => e instanceof DatasetError && e.code === 'NOT_FOUND');
  await assert.rejects(deleteDataset(store, 'w', 'p', a.id), DatasetError);
});
