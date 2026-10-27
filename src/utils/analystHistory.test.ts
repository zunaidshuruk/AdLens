import assert from 'node:assert/strict';
import test from 'node:test';
import { historyForCloud, type ChatTurn } from '../pages/AIAnalystPage.js';

test('Sprint 15b — chat turns answered on the device are never sent to the cloud or to your agents as history', () => {
  const turns: ChatTurn[] = [
    { id: '1', role: 'user', content: 'cloud question' },
    { id: '2', role: 'assistant', content: 'cloud answer' },
    { id: '3', role: 'user', content: 'private question', private: true },
    { id: '4', role: 'assistant', content: 'private answer', private: true },
    { id: '5', role: 'user', content: 'another cloud question' },
  ];
  const sent = historyForCloud(turns);
  assert.deepEqual(sent.map((m) => m.content), ['cloud question', 'cloud answer', 'another cloud question']);
  assert.ok(!JSON.stringify(sent).includes('private'));
  assert.deepEqual(historyForCloud([{ id: 'x', role: 'user', content: 'only private', private: true }]), []);
});
