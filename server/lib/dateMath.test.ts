import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonPeriod, dayCount, previousPeriod } from './dateMath.js';

test('dayCount is inclusive', () => {
  assert.equal(dayCount('2026-10-01', '2026-10-01'), 1);
  assert.equal(dayCount('2026-10-01', '2026-10-07'), 7);
  assert.equal(dayCount('2026-02-27', '2026-03-02'), 4);
});

test('previousPeriod has equal length and ends the day before', () => {
  assert.deepEqual(previousPeriod('2026-10-08', '2026-10-14'), { startDate: '2026-10-01', endDate: '2026-10-07' });
  assert.deepEqual(previousPeriod('2026-03-01', '2026-03-03'), { startDate: '2026-02-26', endDate: '2026-02-28' });
  assert.deepEqual(previousPeriod('2026-01-01', '2026-01-01'), { startDate: '2025-12-31', endDate: '2025-12-31' });
});

test('comparisonPeriod prefers the chosen comparison dates', () => {
  assert.deepEqual(
    comparisonPeriod({ startDate: '2026-10-08', endDate: '2026-10-14', compareStartDate: '2025-10-08', compareEndDate: '2025-10-14' }),
    { startDate: '2025-10-08', endDate: '2025-10-14' },
  );
  assert.deepEqual(comparisonPeriod({ startDate: '2026-10-08', endDate: '2026-10-14' }), { startDate: '2026-10-01', endDate: '2026-10-07' });
});

test('rejects malformed dates', () => {
  assert.throws(() => dayCount('10/01/2026', '2026-10-02'));
});
