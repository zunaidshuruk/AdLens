import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMetaExploreParams, mapMetaExplore, metaExploreInputSchema } from './exploreSpec.js';

const base = { startDate: '2026-10-01', endDate: '2026-10-07' };
const parse = (x: Record<string, unknown>) => metaExploreInputSchema.parse({ ...base, ...x });

test('Meta explore: only allow-listed fields are accepted', () => {
  assert.equal(metaExploreInputSchema.safeParse({ ...base, metrics: ['spend'], dimensions: ['campaign', 'age'] }).success, true);
  assert.equal(metaExploreInputSchema.safeParse({ ...base, metrics: ['password'] }).success, false);
  assert.equal(metaExploreInputSchema.safeParse({ ...base, metrics: ['spend'], dimensions: ['access_token'] }).success, false);
  assert.equal(metaExploreInputSchema.safeParse({ ...base, metrics: [] }).success, false);
  assert.equal(metaExploreInputSchema.safeParse({ ...base, metrics: ['spend'], filters: [{ field: 'country', op: 'equals', value: 'x' }] }).success, false);
});

test('Meta explore: request parameters pick the right level, breakdowns, dates and filters', () => {
  const p = buildMetaExploreParams(parse({ metrics: ['spend', 'ctr'], dimensions: ['date', 'campaign', 'country'], filters: [{ field: 'campaign', op: 'contains', value: 'Eid' }] }));
  assert.equal(p.level, 'campaign');
  assert.equal(p.breakdowns, 'country');
  assert.equal(p.time_increment, 1);
  assert.match(String(p.fields), /campaign_name/);
  assert.match(String(p.fields), /spend,ctr/);
  assert.deepEqual(JSON.parse(String(p.filtering)), [{ field: 'campaign.name', operator: 'CONTAIN', value: 'Eid' }]);
  assert.equal(buildMetaExploreParams(parse({ metrics: ['spend'] })).level, 'account');
  assert.equal(buildMetaExploreParams(parse({ metrics: ['spend'], dimensions: ['ad', 'campaign'] })).level, 'ad');
  assert.equal('breakdowns' in buildMetaExploreParams(parse({ metrics: ['spend'], dimensions: ['campaign'] })), false);
});

test('Meta explore: rows, sorting, country names and totals', () => {
  const input = parse({ metrics: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'reach'], dimensions: ['country'], limit: 2 });
  const out = mapMetaExplore([
    { country: 'BD', spend: '10.50', impressions: '1000', clicks: '50', ctr: '5', cpc: '0.21', reach: '800' },
    { country: 'IN', spend: '30', impressions: '3000', clicks: '30', ctr: '1', cpc: '1', reach: '2500' },
    { country: 'US', spend: '5', impressions: '500', clicks: '10', ctr: '2', cpc: '0.5', reach: '400' },
  ], input);
  assert.equal(out.source, 'meta');
  assert.deepEqual(out.rows.map((r) => r.country), ['India', 'Bangladesh']);
  assert.equal(out.rows.length, 2);
  assert.equal(out.truncated, true);
  assert.equal(out.rowCount, 3);
  assert.equal(out.totals?.spend, 45.5);
  assert.equal(out.totals?.clicks, 90);
  assert.equal(out.totals?.ctr, 2);
  assert.equal(out.totals?.cpc, 0.51);
  assert.equal(out.totals?.reach, null);
});

test('Meta explore: no rows means no totals', () => {
  const out = mapMetaExplore([], parse({ metrics: ['spend'] }));
  assert.equal(out.totals, null);
  assert.equal(out.rows.length, 0);
});
