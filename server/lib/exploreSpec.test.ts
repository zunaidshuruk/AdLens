import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGA4ExplorePayload, buildSCExplorePayload, ga4ExploreInputSchema, mapGA4Explore, mapSCExplore,
  scExploreInputSchema, GA4_DIMENSIONS, GA4_METRICS, SC_DIMENSIONS, SC_METRICS, ga4SpecSchema,
} from './exploreSpec.js';

const D = { startDate: '2026-10-01', endDate: '2026-10-07' };

test('GA4 input: valid input gets defaults; unknown or duplicate fields are refused', () => {
  const ok = ga4ExploreInputSchema.parse({ ...D, metrics: ['sessions'] });
  assert.deepEqual(ok.dimensions, []); assert.equal(ok.limit, 100);
  for (const bad of [
    { ...D, metrics: [] },
    { ...D, metrics: ['sessions; DROP'] },
    { ...D, metrics: ['sessions'], dimensions: ['notADimension'] },
    { ...D, metrics: ['sessions', 'sessions'] },
    { ...D, metrics: ['sessions'], dimensions: ['country', 'country'] },
    { ...D, metrics: ['sessions'], dimensions: ['a', 'b', 'c', 'd', 'e'] },
    { ...D, metrics: ['sessions'], limit: 5000 },
    { ...D, metrics: ['sessions'], filters: [{ field: 'country', op: 'equals', value: '' }] },
    { ...D, metrics: ['sessions'], filters: [{ field: 'sessions', op: 'equals', value: 'x' }] },
    { ...D, metrics: ['sessions'], orderBy: { field: 'users', desc: true } },
    { startDate: '2026-10-09', endDate: '2026-10-01', metrics: ['sessions'] },
    { startDate: 'yesterday', endDate: '2026-10-01', metrics: ['sessions'] },
  ]) assert.equal(ga4ExploreInputSchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test('GA4 payload: dimensions, metrics, filters, order and totals', () => {
  const input = ga4ExploreInputSchema.parse({
    ...D, dimensions: ['country'], metrics: ['sessions', 'engagementRate'], limit: 25,
    filters: [{ field: 'country', op: 'equals', value: 'Bangladesh' }, { field: 'deviceCategory', op: 'notContains', value: 'tablet' }],
  });
  const p = buildGA4ExplorePayload(input) as Record<string, any>;
  assert.deepEqual(p.dateRanges, [{ startDate: D.startDate, endDate: D.endDate }]);
  assert.deepEqual(p.dimensions, [{ name: 'country' }]);
  assert.deepEqual(p.metrics, [{ name: 'sessions' }, { name: 'engagementRate' }]);
  assert.equal(p.limit, 25);
  assert.deepEqual(p.metricAggregations, ['TOTAL']);
  assert.equal(p.dimensionFilter.andGroup.expressions.length, 2);
  assert.equal(p.dimensionFilter.andGroup.expressions[0].filter.stringFilter.matchType, 'EXACT');
  assert.ok(p.dimensionFilter.andGroup.expressions[1].notExpression);
  assert.deepEqual(p.orderBys, [{ metric: { metricName: 'sessions' }, desc: true }]);
});

test('GA4 payload: a single filter is not wrapped; date reports sort by date; explicit sort wins', () => {
  const one = buildGA4ExplorePayload(ga4ExploreInputSchema.parse({ ...D, metrics: ['sessions'], filters: [{ field: 'country', op: 'startsWith', value: 'Ban' }] })) as Record<string, any>;
  assert.equal(one.dimensionFilter.filter.stringFilter.matchType, 'BEGINS_WITH');
  const byDate = buildGA4ExplorePayload(ga4ExploreInputSchema.parse({ ...D, dimensions: ['date'], metrics: ['sessions'] })) as Record<string, any>;
  assert.deepEqual(byDate.orderBys, [{ dimension: { dimensionName: 'date' } }]);
  const sorted = buildGA4ExplorePayload(ga4ExploreInputSchema.parse({ ...D, dimensions: ['country'], metrics: ['sessions'], orderBy: { field: 'country', desc: false } })) as Record<string, any>;
  assert.deepEqual(sorted.orderBys, [{ dimension: { dimensionName: 'country' }, desc: false }]);
});

test('GA4 mapping: dates, percentages, rounding, totals, truncation', () => {
  const input = ga4ExploreInputSchema.parse({ ...D, dimensions: ['date', 'country'], metrics: ['sessions', 'engagementRate', 'averageSessionDuration'] });
  const r = mapGA4Explore({
    rows: [{ dimensionValues: [{ value: '20261001' }, { value: 'Bangladesh' }], metricValues: [{ value: '120' }, { value: '0.6123' }, { value: '63.456' }] }],
    totals: [{ metricValues: [{ value: '120' }, { value: '0.6123' }, { value: '63.456' }] }],
    rowCount: 250,
  }, input);
  assert.deepEqual(r.rows[0], { date: '2026-10-01', country: 'Bangladesh', sessions: 120, engagementRate: 61.23, averageSessionDuration: 63.46 });
  assert.equal(r.totals?.sessions, 120);
  assert.equal(r.truncated, true); assert.equal(r.rowCount, 250);
  assert.deepEqual(r.columns.map((c) => c.role), ['dimension', 'dimension', 'metric', 'metric', 'metric']);
  const empty = mapGA4Explore({}, input);
  assert.deepEqual(empty.rows, []); assert.equal(empty.totals, null); assert.equal(empty.truncated, false);
});

test('Search Console: input, payload with filters, no starts-with', () => {
  const input = scExploreInputSchema.parse({ ...D, dimensions: ['query'], metrics: ['clicks', 'position'], filters: [{ field: 'page', op: 'contains', value: '/blog' }] });
  const p = buildSCExplorePayload(input);
  assert.deepEqual(p.dimensions, ['query']); assert.equal(p.rowLimit, 100);
  assert.deepEqual(p.dimensionFilterGroups, [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'contains', expression: '/blog' }] }]);
  assert.equal(scExploreInputSchema.safeParse({ ...D, metrics: ['clicks'], filters: [{ field: 'page', op: 'startsWith', value: 'x' }] }).success, false);
  assert.equal(scExploreInputSchema.safeParse({ ...D, metrics: ['sessions'] }).success, false);
});

test('Search Console mapping: country names, percent, weighted totals, sorting', () => {
  const input = scExploreInputSchema.parse({ ...D, dimensions: ['country'], metrics: ['clicks', 'impressions', 'ctr', 'position'], orderBy: { field: 'clicks', desc: true } });
  const r = mapSCExplore({ rows: [
    { keys: ['bgd'], clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
    { keys: ['usa'], clicks: 30, impressions: 300, ctr: 0.1, position: 8 },
  ] }, input);
  assert.equal(r.rows[0].country, 'United States'); assert.equal(r.rows[0].clicks, 30);
  assert.equal(r.rows[1].ctr, 10);
  assert.deepEqual(r.totals, { clicks: 40, impressions: 400, ctr: 10, position: 7 }); // (4*100 + 8*300) / 400 = 7, not the plain average 6
  assert.equal(mapSCExplore({}, input).totals, null);
});

test('Search Console mapping: date reports are sorted by date', () => {
  const input = scExploreInputSchema.parse({ ...D, dimensions: ['date'], metrics: ['clicks'] });
  const r = mapSCExplore({ rows: [{ keys: ['2026-10-03'], clicks: 1 }, { keys: ['2026-10-01'], clicks: 2 }] }, input);
  assert.deepEqual(r.rows.map((x) => x.date), ['2026-10-01', '2026-10-03']);
});

test('catalogues: keys are unique and every field has a label', () => {
  for (const list of [GA4_DIMENSIONS, GA4_METRICS, SC_DIMENSIONS, SC_METRICS]) {
    assert.equal(new Set(list.map((f) => f.key)).size, list.length);
    for (const f of list) assert.ok(f.label.length > 1 && f.group.length > 1);
  }
});

test('saved spec leaves dates out', () => {
  const spec = ga4SpecSchema.parse({ metrics: ['sessions'], startDate: '2026-01-01' });
  assert.equal('startDate' in spec, false);
});
