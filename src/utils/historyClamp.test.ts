import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDateRange, presetAllowedByPlan } from './dateUtils.js';

const REF = new Date('2026-10-28T10:00:00Z'); // a Wednesday; 28th of the month

test('Plan history — a Free workspace (10 days): long presets are refused, short ones stay', () => {
  for (const p of ['Today', 'Last 7 days'] as const) assert.equal(presetAllowedByPlan(p, 'UTC', 10, REF), true, p);
  for (const p of ['Last 28 days', 'Last 90 days', 'This month', 'Last month'] as const) assert.equal(presetAllowedByPlan(p, 'UTC', 10, REF), false, p);
  assert.equal(presetAllowedByPlan('Custom', 'UTC', 10, REF), true);
  assert.equal(presetAllowedByPlan('Last 90 days', 'UTC', null, REF), true, 'no limit on other plans');
});

test('Plan history — a saved long preset becomes the last 7 days, a custom range is cut to the oldest allowed day', () => {
  const r = computeDateRange('Last 90 days', 'UTC', undefined, REF, true, 10);
  assert.deepEqual([r.startDate, r.endDate, r.limitedByPlan], ['2026-10-22', '2026-10-28', true]);
  const c = computeDateRange('Custom', 'UTC', { startDate: '2026-08-01', endDate: '2026-10-20' }, REF, true, 10);
  assert.deepEqual([c.startDate, c.endDate, c.limitedByPlan], ['2026-10-18', '2026-10-20', true]);
  const gone = computeDateRange('Custom', 'UTC', { startDate: '2026-07-01', endDate: '2026-07-31' }, REF, true, 10);
  assert.equal(gone.startDate, gone.endDate, 'a range entirely too old collapses to the oldest allowed day');
  const ok = computeDateRange('Last 7 days', 'UTC', undefined, REF, true, 10);
  assert.equal(ok.limitedByPlan, undefined);
  assert.equal(computeDateRange('Last 90 days', 'UTC', undefined, REF, true, null).startDate, '2026-07-31');
  assert.equal(computeDateRange('Last 28 days', 'UTC', undefined, REF, true, 487).limitedByPlan, undefined);
});

test('Plan history — the server limit is never tighter than what the picker allows', async () => {
  const { historyViolation } = await import('../../server/config/plans.js');
  const r = computeDateRange('Custom', 'UTC', { startDate: '2020-01-01', endDate: '2026-10-28' }, REF, true, 10);
  assert.equal(historyViolation('free', r.startDate, REF), null);
});
