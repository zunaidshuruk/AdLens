import assert from 'node:assert/strict';
import test from 'node:test';
import { isDue, emailScheduleInputSchema, type StoredSchedule } from './lib/emailSchedules.js';
import { cleanWeekdays, dueToday, frequencyLabel, frequencyShort } from './lib/scheduleFrequency.js';

const d = (s: string) => new Date(`${s}T06:00:00Z`);

test('Frequency labels read like plain words', () => {
  assert.equal(frequencyLabel({ frequency: 'daily' }), 'every day');
  assert.equal(frequencyLabel({ frequency: 'weekly' }), 'every Monday');
  assert.equal(frequencyLabel({ frequency: 'weekly', weekdays: [4, 1] }), 'every Monday and Thursday');
  assert.equal(frequencyLabel({ frequency: 'weekly', weekdays: [0, 6, 3] }), 'every Wednesday, Saturday and Sunday');
  assert.equal(frequencyLabel({ frequency: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }), 'every day');
  assert.equal(frequencyLabel({ frequency: 'monthly' }), 'on the 1st of every month');
  assert.equal(frequencyLabel({ frequency: 'monthly', monthDay: 15 }), 'on the 15th of every month');
  assert.equal(frequencyLabel({ frequency: 'monthly', monthDay: 22 }), 'on the 22nd of every month');
  assert.equal(frequencyLabel({ frequency: 'monthly', monthDay: 13 }), 'on the 13th of every month');
  assert.equal(frequencyLabel({ frequency: 'monthly', monthDay: 31 }), 'on the last day of every month');
  assert.equal(frequencyLabel({ frequency: 'interval', intervalDays: 3 }), 'every 3 days');
  assert.equal(frequencyShort({ frequency: 'interval', intervalDays: 3 }), 'every 3 days');
  assert.equal(frequencyShort({ frequency: 'daily' }), 'daily');
  assert.deepEqual(cleanWeekdays([0, 6, 1, 1, 9, -1]), [1, 6, 0]);
  assert.deepEqual(cleanWeekdays([]), [1]);
});

test('Due rules: daily, chosen weekdays, day of month (short months), every N days, never twice in a day', () => {
  assert.equal(dueToday({ frequency: 'daily' }, d('2026-10-27')), true);
  assert.equal(dueToday({ frequency: 'daily', lastSentAt: '2026-10-27T01:00:00Z' }, d('2026-10-27')), false);
  // Mon 26 Oct 2026, Thu 29 Oct, Sat 31 Oct
  const mt = { frequency: 'weekly' as const, weekdays: [1, 4] };
  assert.deepEqual(['2026-10-26', '2026-10-27', '2026-10-29', '2026-10-31'].map((x) => dueToday(mt, d(x))), [true, false, true, false]);
  assert.equal(dueToday({ frequency: 'weekly' }, d('2026-10-26')), true, 'old schedules mean Monday');
  assert.equal(dueToday({ frequency: 'monthly', monthDay: 15 }, d('2026-10-15')), true);
  assert.equal(dueToday({ frequency: 'monthly', monthDay: 15 }, d('2026-10-16')), false);
  assert.equal(dueToday({ frequency: 'monthly', monthDay: 15, lastSentAt: '2026-10-15T05:00:00Z' }, d('2026-10-15')), false);
  assert.equal(dueToday({ frequency: 'monthly' }, d('2026-11-01')), true, 'old schedules mean the 1st');
  assert.equal(dueToday({ frequency: 'monthly', monthDay: 31 }, d('2026-11-30')), true, 'November has 30 days');
  assert.equal(dueToday({ frequency: 'monthly', monthDay: 31 }, d('2026-11-29')), false);
  assert.equal(dueToday({ frequency: 'monthly', monthDay: 30 }, d('2027-02-28')), true, 'February uses its last day');
  assert.equal(dueToday({ frequency: 'monthly', monthDay: 31 }, d('2026-10-31')), true);
  const every3 = { frequency: 'interval' as const, intervalDays: 3 };
  assert.equal(dueToday(every3, d('2026-10-27')), true, 'never sent: first run sends');
  assert.equal(dueToday({ ...every3, lastSentAt: '2026-10-25T20:00:00Z' }, d('2026-10-27')), false);
  assert.equal(dueToday({ ...every3, lastSentAt: '2026-10-25T20:00:00Z' }, d('2026-10-28')), true);
  assert.equal(dueToday({ ...every3, lastSentAt: '2026-10-25T20:00:00Z' }, d('2026-10-30')), true, 'a missed day still catches up');
  assert.equal(dueToday({ ...every3, lastSentAt: '2026-10-28T01:00:00Z' }, d('2026-10-28')), false);
});

test('isDue keeps old stored schedules working and respects paused ones', () => {
  const old = { frequency: 'weekly', enabled: true } as StoredSchedule;
  assert.equal(isDue(old, d('2026-10-26')), true);
  assert.equal(isDue({ ...old, weekdays: [2, 5] }, d('2026-10-26')), false);
  assert.equal(isDue({ ...old, weekdays: [2, 5] }, d('2026-10-27')), true);
  assert.equal(isDue({ ...old, enabled: false }, d('2026-10-26')), false);
});

test('Schedule input: sensible limits and defaults', () => {
  const base = { kind: 'report', targetId: 'r1', emails: ['a@b.com'] };
  const ok = emailScheduleInputSchema.parse({ ...base, frequency: 'interval', intervalDays: 5 });
  assert.equal(ok.intervalDays, 5);
  assert.deepEqual(emailScheduleInputSchema.parse({ ...base, frequency: 'weekly' }).weekdays, [1]);
  assert.equal(emailScheduleInputSchema.safeParse({ ...base, frequency: 'weekly', weekdays: [] }).success, false);
  assert.equal(emailScheduleInputSchema.safeParse({ ...base, frequency: 'weekly', weekdays: [7] }).success, false);
  assert.equal(emailScheduleInputSchema.safeParse({ ...base, frequency: 'monthly', monthDay: 0 }).success, false);
  assert.equal(emailScheduleInputSchema.safeParse({ ...base, frequency: 'monthly', monthDay: 32 }).success, false);
  assert.equal(emailScheduleInputSchema.safeParse({ ...base, frequency: 'interval', intervalDays: 1 }).success, false);
  assert.equal(emailScheduleInputSchema.safeParse({ ...base, frequency: 'interval', intervalDays: 61 }).success, false);
  assert.equal(emailScheduleInputSchema.safeParse({ ...base, frequency: 'hourly' }).success, false);
  assert.equal(emailScheduleInputSchema.parse({ ...base, frequency: 'daily' }).frequency, 'daily');
});
