import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExploreCatalogSource, ExploreResult } from '../types/explore.js';
import { csvCell, csvFileName, exploreToCsv } from './exploreCsv.js';
import { formatDuration, formatExploreCell } from './exploreFormat.js';
import { buildRunRequest, defaultDataSpec, defaultSpec, moveField, normaliseSpec, sameSpec, sanitiseSavedSpec, toggleField, validateSpec } from './exploreState.js';

const CAT: ExploreCatalogSource = {
  maxDimensions: 2, maxMetrics: 3,
  dimensions: [{ key: 'country', label: 'Country', type: 'text', group: 'a' }, { key: 'date', label: 'Date', type: 'date', group: 'b' }],
  metrics: [{ key: 'sessions', label: 'Sessions', type: 'integer', group: 'a' }, { key: 'engagementRate', label: 'Rate', type: 'percent', group: 'a' }],
};

test('csv: formula-looking text is neutralised, quotes and commas are escaped, numbers stay numbers', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
  assert.equal(csvCell('+1 555'), "'+1 555");
  assert.equal(csvCell('-cmd'), "'-cmd");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(Number.NaN), '');
});

test('csv: header, rows and a totals row', () => {
  const r: Pick<ExploreResult, 'columns' | 'rows' | 'totals'> = {
    columns: [{ key: 'country', label: 'Country', type: 'text', role: 'dimension' }, { key: 'sessions', label: 'Sessions', type: 'integer', role: 'metric' }],
    rows: [{ country: 'Bangladesh', sessions: 10 }, { country: '=evil', sessions: 5 }],
    totals: { sessions: 15 },
  };
  assert.equal(exploreToCsv(r), "Country,Sessions\nBangladesh,10\n'=evil,5\nTotal,15\n");
  assert.equal(exploreToCsv(r, false), "Country,Sessions\nBangladesh,10\n'=evil,5\n");
  assert.match(csvFileName('ga4', 'Sessions by Country!', new Date('2026-10-26T00:00:00Z')), /^adlens_ga4_sessions_by_country_2026-10-26\.csv$/);
});

test('format: numbers, percentages, durations, empty values', () => {
  assert.equal(formatExploreCell(null, 'integer'), '—');
  assert.equal(formatExploreCell('', 'text'), '—');
  assert.equal(formatExploreCell(61.234, 'percent'), `${(61.2).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
  assert.equal(formatExploreCell('Bangladesh', 'text'), 'Bangladesh');
  assert.equal(formatDuration(75), '1m 15s');
  assert.equal(formatDuration(3725), '1h 2m');
  assert.equal(formatDuration(9), '9s');
});

test('builder: toggling respects limits; moving columns; validation messages', () => {
  assert.deepEqual(toggleField(['a'], 'b', 2), ['a', 'b']);
  assert.deepEqual(toggleField(['a', 'b'], 'c', 2), ['a', 'b']);
  assert.deepEqual(toggleField(['a', 'b'], 'a', 2), ['b']);
  assert.deepEqual(moveField(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveField(['a', 'b'], 'a', -1), ['a', 'b']);
  const base = { dimensions: ['country'], metrics: ['sessions'], filters: [], limit: 100 };
  assert.deepEqual(validateSpec(base, CAT), []);
  assert.equal(validateSpec({ ...base, metrics: [] }, CAT).length, 1);
  assert.match(validateSpec({ ...base, filters: [{ field: 'country', op: 'equals', value: '  ' }] }, CAT)[0], /filter/);
  assert.equal(validateSpec({ ...base, orderBy: { field: 'date', desc: true } }, CAT).length, 1);
});

test('builder: request building trims filters and drops a sort column that is gone', () => {
  const spec = { dimensions: ['country'], metrics: ['sessions'], filters: [{ field: 'country', op: 'contains' as const, value: ' ban ' }], limit: 50, orderBy: { field: 'date', desc: true } };
  const body = buildRunRequest(spec, { startDate: '2026-10-01', endDate: '2026-10-07' });
  assert.deepEqual(body.filters, [{ field: 'country', op: 'contains', value: 'ban' }]);
  assert.equal('orderBy' in body, false);
  assert.equal(body.startDate, '2026-10-01');
  assert.equal(normaliseSpec(spec).orderBy, undefined);
});

test('saved reports: retired fields are removed; same-spec check ignores a dead sort', () => {
  const old = { dimensions: ['country', 'retiredDim'], metrics: ['sessions', 'retiredMetric'], filters: [{ field: 'retiredDim', op: 'equals' as const, value: 'x' }], limit: 10, orderBy: { field: 'retiredMetric', desc: true } };
  const clean = sanitiseSavedSpec(old, CAT);
  assert.deepEqual(clean.dimensions, ['country']); assert.deepEqual(clean.metrics, ['sessions']);
  assert.deepEqual(clean.filters, []); assert.equal(clean.orderBy, undefined);
  assert.equal(sameSpec(defaultSpec('ga4'), defaultSpec('ga4')), true);
  assert.equal(sameSpec(defaultSpec('ga4'), defaultSpec('search_console')), false);
});

test('uploaded data: first report breaks down by the first non-number column and counts rows; the request carries the table', () => {
  const ds = { id: 'd1', columns: [{ key: 'c1', type: 'number' }, { key: 'c2', type: 'text' }] };
  const spec = defaultDataSpec(ds);
  assert.deepEqual([spec.dimensions, spec.metrics, spec.datasetId], [['c2'], ['__rows'], 'd1']);
  const body = buildRunRequest({ ...spec, aggregate: 'avg' }, { startDate: '2026-10-01', endDate: '2026-10-02' });
  assert.equal(body.datasetId, 'd1');
  assert.equal(body.aggregate, 'avg');
  assert.equal('datasetId' in buildRunRequest(defaultSpec('ga4'), { startDate: 'a', endDate: 'b' }), false);
  assert.deepEqual(defaultDataSpec(undefined).dimensions, []);
});
