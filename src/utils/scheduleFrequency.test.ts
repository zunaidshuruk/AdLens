import assert from 'node:assert/strict';
import test from 'node:test';
import * as server from '../../server/lib/scheduleFrequency.js';
import * as client from './scheduleFrequency.js';

// The page shows the same words the email uses, so the two copies must agree.
test('client and server frequency wording and due rules are identical', () => {
  const cases: client.FrequencyFields[] = [
    { frequency: 'daily' }, { frequency: 'weekly' }, { frequency: 'weekly', weekdays: [5, 1, 0] }, { frequency: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    { frequency: 'monthly' }, { frequency: 'monthly', monthDay: 22 }, { frequency: 'monthly', monthDay: 31 }, { frequency: 'interval', intervalDays: 3 }, { frequency: 'interval', intervalDays: 1 },
  ];
  for (const c of cases) {
    assert.equal(client.frequencyLabel(c), server.frequencyLabel(c));
    assert.equal(client.frequencyShort(c), server.frequencyShort(c));
    for (const day of ['2026-10-26', '2026-10-29', '2026-11-01', '2026-11-30']) assert.equal(client.dueToday(c, new Date(`${day}T06:00:00Z`)), server.dueToday(c, new Date(`${day}T06:00:00Z`)));
  }
});
