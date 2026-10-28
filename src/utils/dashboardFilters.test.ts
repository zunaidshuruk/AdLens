import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExploreSpec } from '../types/explore.js';
import { activeFilterCount, applyDashboardFilters, filtersForSource, parseFilters, writeFilters } from './dashboardFilters.js';

const spec = (n = 0): ExploreSpec => ({ dimensions: [], metrics: ['sessions'], filters: Array.from({ length: n }, (_, i) => ({ field: 'city', op: 'equals' as const, value: `c${i}` })), limit: 10 });

test('Stage 20 — filters: read from and written to the page address', () => {
  const f = parseFilters(new URLSearchParams('country=Bangladesh&campaign=%20eid%20&device=MOBILE&x=1'));
  assert.deepEqual(f, { country: 'Bangladesh', campaign: 'eid', device: 'mobile' });
  assert.deepEqual(parseFilters(new URLSearchParams('device=fridge')), {});
  const p = writeFilters(new URLSearchParams('x=1&country=old'), { campaign: 'a' });
  assert.equal(p.get('x'), '1');
  assert.equal(p.has('country'), false);
  assert.equal(p.get('campaign'), 'a');
  assert.equal(activeFilterCount(f), 3);
});

test('Stage 20 — filters: each source gets only the filters it supports', () => {
  const all = { country: 'Bangladesh', campaign: 'eid', device: 'mobile' };
  assert.deepEqual(filtersForSource('ga4', all).map((x) => x.field), ['country', 'sessionCampaignName', 'deviceCategory']);
  const sc = filtersForSource('search_console', all);
  assert.deepEqual(sc.map((x) => x.field), ['country', 'device']);
  assert.equal(sc[1].value, 'MOBILE');
});

test('Stage 20 — filters: added to the panel own filters, never past five, original untouched', () => {
  const base = spec(4);
  const out = applyDashboardFilters('ga4', base, { country: 'India', device: 'tablet' });
  assert.equal(out.filters.length, 5);
  assert.equal(base.filters.length, 4);
  assert.equal(applyDashboardFilters('ga4', base, {}), base);
});
