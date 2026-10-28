import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreWriting } from './contentScore.js';

const para = 'Leather wallet care is simple when you know the basics. Clean it gently and store it flat. Use a soft cloth.';
test('empty text scores zero', () => { assert.equal(scoreWriting('', { keyword: 'x' }).score, 0); });
test('a decent draft scores well and counts keyword and terms', () => {
  const text = `## Leather wallet care guide\n\n${Array.from({ length: 30 }, () => para).join(' ')}\n\n## Cleaning\n\n${Array.from({ length: 10 }, () => para).join(' ')}`;
  const r = scoreWriting(text, { keyword: 'leather wallet', targetWords: 600, terms: ['soft cloth', 'conditioner'] });
  assert.ok(r.score >= 70, `score ${r.score}`);
  assert.equal(r.headings, 2); assert.equal(r.termsUsed, 1); assert.equal(r.termsTotal, 2);
  assert.ok(r.checks.find((c) => c.id === 'hkw')!.status === 'good');
});
test('stuffing and missing keyword are flagged', () => {
  assert.equal(scoreWriting('Buy wallet wallet wallet wallet wallet wallet wallet wallet. wallet wallet.', { keyword: 'wallet', targetWords: 10 }).checks.find((c) => c.id === 'kw')!.status, 'warn');
  assert.equal(scoreWriting('Some text about bags and more bags here today.', { keyword: 'wallet', targetWords: 10 }).checks.find((c) => c.id === 'kw')!.status, 'bad');
});
