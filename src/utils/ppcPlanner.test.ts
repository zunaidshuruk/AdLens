import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdsCsv, groupKeywords, intentOf, notation, parseKeywords, suggestNegatives } from './ppcPlanner.js';

test('parseKeywords cleans, dedupes and drops over-long phrases', () => {
  const r = parseKeywords('Leather Wallet!, leather wallet\n  mens   wallet ; ' + Array.from({ length: 11 }, (_, i) => `w${i}`).join(' ') + '\n');
  assert.deepEqual(r.keywords, ['leather wallet', 'mens wallet']);
  assert.equal(r.dropped.length, 1); assert.match(r.dropped[0]!.reason, /10 words/);
});

test('intentOf separates buyers from researchers', () => {
  assert.equal(intentOf('buy leather wallet'), 'buy');
  assert.equal(intentOf('how to clean a leather wallet'), 'research');
  assert.equal(intentOf('leather wallet'), 'other');
  assert.equal(intentOf('wallet reviews best'), 'research', 'research words win');
});

test('groupKeywords themes by shared word and splits big groups', () => {
  const g = groupKeywords(['leather wallet', 'mens leather wallet', 'leather belt', 'canvas bag', 'travel bag']);
  assert.deepEqual(g.map((x) => x.name), ['Leather', 'Bag']);
  assert.deepEqual(g[0]!.keywords, ['leather belt', 'leather wallet', 'mens leather wallet']);
  const big = groupKeywords(Array.from({ length: 25 }, (_, i) => `wallet ${String.fromCharCode(97 + i)}${i}`), { maxPerGroup: 10 });
  assert.deepEqual(big.map((x) => x.keywords.length), [10, 10, 5]);
  assert.equal(big[1]!.name, 'Wallet 2');
});

test('suggestNegatives never blocks a word you bid on', () => {
  const s = suggestNegatives(['free shipping wallet', 'wallet course']).map((x) => x.word);
  assert.equal(s.includes('free'), false); assert.equal(s.includes('course'), false);
  assert.ok(s.includes('jobs') && s.includes('pdf'));
});

test('buildAdsCsv writes match types, CPC and negatives, and protects against formulas', () => {
  const { csv, rows } = buildAdsCsv({ campaign: 'Wallets, UK', groups: [{ name: 'Leather', keywords: ['leather wallet'] }], matchTypes: ['phrase', 'exact'], maxCpc: 1.5, negatives: ['free', '=cmd'], negativeType: 'phrase' });
  const lines = csv.trim().split('\r\n');
  assert.equal(rows, 4); assert.equal(lines.length, 5);
  assert.equal(lines[0], 'Campaign,Ad Group,Keyword,Criterion Type,Max CPC,Status');
  assert.equal(lines[1], '"Wallets, UK",Leather,leather wallet,Phrase,1.50,Enabled');
  assert.equal(lines[2]!.split(',').slice(-3, -1).join(), 'Exact,1.50');
  assert.equal(lines[3], '"Wallets, UK",,free,Negative Phrase,,Enabled');
  assert.ok(lines[4]!.includes("'=cmd"));
  assert.equal(notation('a b', 'phrase'), '"a b"'); assert.equal(notation('a b', 'exact'), '[a b]'); assert.equal(notation('a b', 'broad'), 'a b');
});
