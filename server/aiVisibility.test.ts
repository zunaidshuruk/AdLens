import assert from 'node:assert/strict';
import test from 'node:test';
import { analyseAnswer, askEngine, extractSources, promptsInputSchema, summariseRuns, type RunRecord } from './lib/aiVisibility.js';

test('extractSources finds links and bare domains', () => {
  assert.deepEqual(extractSources('See https://www.Convay.com/pricing and zoom.us? also teams.microsoft.com, plus docs.google.com.'), ['convay.com', 'zoom.us', 'teams.microsoft.com', 'docs.google.com']);
});

test('analyseAnswer: brand mention, rank among competitors, sentiment, own-domain citation', () => {
  const text = 'For video meetings consider Zoom, which is popular. Convay is a reliable and secure choice built in Bangladesh (convay.com). Google Meet is also easy.';
  const a = analyseAnswer(text, ['Convay', 'Synesis'], ['Zoom', 'Google Meet', 'Webex'], 'convay.com');
  assert.equal(a.mentioned, true); assert.equal(a.rank, 2);
  assert.deepEqual(a.competitors, [{ name: 'Zoom', mentioned: true }, { name: 'Google Meet', mentioned: true }, { name: 'Webex', mentioned: false }]);
  assert.equal(a.sentiment, 'positive'); assert.equal(a.citedOwn, true); assert.ok(a.excerpt.startsWith('For video'));
  const none = analyseAnswer('Try Zoom or Webex.', ['Convay'], ['Zoom']);
  assert.equal(none.mentioned, false); assert.equal(none.rank, null); assert.equal(none.sentiment, null);
  assert.equal(analyseAnswer('Convay is slow and expensive with many problems.', ['Convay'], []).sentiment, 'negative');
  assert.equal(analyseAnswer('Convaying goods is easy.', ['Convay'], []).mentioned, false, 'whole words only');
  assert.equal(analyseAnswer('convay first, then Zoom', ['Convay'], ['Zoom']).rank, 1);
});

test('askEngine sends only the question, no tools, and handles failure', async () => {
  let sent: unknown;
  const ok = await askEngine('What is the best video meeting tool in Bangladesh?', { complete: async (r) => { sent = r; return { text: ' Answer ', toolCalls: [] }; } });
  assert.ok(ok.ok && ok.text === 'Answer'); assert.deepEqual((sent as any).tools, []);
  assert.equal((await askEngine('question text here', { complete: async () => { throw new Error('x'); } })).ok, false);
  assert.equal((await askEngine('question text here', { complete: async () => ({ text: '', toolCalls: [] }) })).ok, false);
});

test('prompt input is checked; summary counts', () => {
  assert.equal(promptsInputSchema.safeParse({ texts: ['short'] }).success, false);
  assert.ok(promptsInputSchema.safeParse({ texts: ['What is the best CRM for small teams?'] }).success);
  const run = (mentioned: boolean, comps: boolean[], sentiment: 'positive' | null, citedOwn = false): RunRecord => ({ id: 'r', promptId: 'p', engine: 'e', at: '', analysis: { mentioned, rank: mentioned ? 1 : null, competitors: comps.map((m, i) => ({ name: `c${i}`, mentioned: m })), sentiment, sources: [], citedOwn, excerpt: '' } });
  const s = summariseRuns([run(true, [true, false], 'positive', true), run(false, [true], null), null]);
  assert.deepEqual(s, { run: 2, visibility: 50, shareOfVoice: 33, citedOwn: 1, sentiment: { positive: 1, neutral: 0, negative: 0 } });
});
