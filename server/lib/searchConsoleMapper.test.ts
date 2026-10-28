import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSCExplorePayload } from './exploreSpec.js';
import { countryToAlpha3 } from './searchConsoleMapper.js';

test('Stage 20 — country filter: names, 2-letter and 3-letter codes all become the 3-letter code Search Console wants', () => {
  assert.equal(countryToAlpha3('Bangladesh'), 'bgd');
  assert.equal(countryToAlpha3('bangladesh'), 'bgd');
  assert.equal(countryToAlpha3('BD'), 'bgd');
  assert.equal(countryToAlpha3('USA'), 'usa');
  assert.equal(countryToAlpha3('Narnia'), 'narnia');
  assert.equal(countryToAlpha3(''), '');
});

test('Stage 20 — Search Console explore payload converts a country name in an equals filter', () => {
  const p = buildSCExplorePayload({
    startDate: '2026-10-01', endDate: '2026-10-07', dimensions: ['query'], metrics: ['clicks'],
    filters: [{ field: 'country', op: 'equals', value: 'India' }, { field: 'query', op: 'contains', value: 'India' }], limit: 10,
  } as never);
  const f = (p as { dimensionFilterGroups: { filters: { dimension: string; expression: string }[] }[] }).dimensionFilterGroups[0].filters;
  assert.equal(f[0].expression, 'ind');
  assert.equal(f[1].expression, 'India');
});
