import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRanges, moveSelection, normalize, rankCommands, type Command } from './commandPalette.js';

const CMDS: Command[] = [
  { id: 'nav.overview', label: 'Overview', group: 'Navigate', keywords: ['home', 'dashboard', 'snapshot'] },
  { id: 'nav.ga4', label: 'Google Analytics', group: 'Navigate', keywords: ['ga4', 'traffic', 'sessions'] },
  { id: 'nav.gsc', label: 'Search Console', group: 'Navigate', keywords: ['seo', 'queries', 'ranking'] },
  { id: 'nav.meta', label: 'Meta Ads', group: 'Navigate', keywords: ['facebook', 'instagram', 'campaigns'] },
  { id: 'nav.ai', label: 'AI Traffic', group: 'Navigate', keywords: ['chatgpt', 'perplexity'] },
  { id: 'set.appearance', label: 'Appearance', group: 'Settings', keywords: ['theme', 'dark mode', 'colors', 'font size'] },
  { id: 'set.account', label: 'Account', group: 'Settings', keywords: ['profile', 'password'] },
  { id: 'proj.new', label: 'New project', group: 'Project', keywords: ['add site', 'create'] },
  { id: 'act.export', label: 'Export CSV', group: 'Actions' },
  { id: 'met.cpl', label: 'Cost per lead (CPL)', group: 'Metrics', keywords: ['cost'] },
];
const ids = (q: string, o = {}) => rankCommands(q, CMDS, o).map((c) => c.id);

test('normalize strips accents, case and punctuation', () => {
  assert.equal(normalize('  Café — Ads!! '), 'cafe ads');
});

test('exact and prefix matches beat keyword and fuzzy matches', () => {
  assert.equal(ids('overview')[0], 'nav.overview');
  assert.equal(ids('goo')[0], 'nav.ga4');
  assert.equal(ids('meta')[0], 'nav.meta');
  assert.equal(ids('facebook')[0], 'nav.meta'); // keyword
  assert.equal(ids('chatgpt')[0], 'nav.ai');
  assert.equal(ids('dark mode')[0], 'set.appearance'); // multi-word keyword
  assert.equal(ids('theme')[0], 'set.appearance');
});

test('every typed word must match; unrelated queries return nothing', () => {
  assert.deepEqual(ids('zzzz'), []);
  assert.ok(!ids('meta qwerty').length);
  assert.ok(ids('search console').includes('nav.gsc'));
  assert.equal(ids('cost lead')[0], 'met.cpl');
});

test('initials and letters-in-order work ("gsc", "ga", "sch")', () => {
  assert.ok(ids('sch').includes('nav.gsc')); // s…c…h in order (fuzzy, 3+ letters)
  assert.equal(ids('ga')[0], 'nav.ga4'); // initials of Google Analytics
  assert.ok(ids('ma').includes('nav.meta')); // initials of Meta Ads
  const fuzzy = rankCommands('gsc', [{ id: 'x', label: 'Google Search Console', group: 'Navigate' }]);
  assert.equal(fuzzy[0].id, 'x'); // initials of Google Search Console
  assert.deepEqual(rankCommands('gc', [{ id: 'x', label: 'Google Search Console', group: 'Navigate' }]), []); // not consecutive initials, too short to fuzz
});

test('accents and capitals do not matter', () => {
  const list: Command[] = [{ id: 'a', label: 'Café Analytics', group: 'Navigate' }];
  assert.equal(rankCommands('CAFE', list)[0].id, 'a');
  assert.equal(rankCommands('analytíc', list)[0].id, 'a');
});

test('recent commands rank first for an empty query and get a boost otherwise', () => {
  assert.deepEqual(ids('', { recentIds: ['act.export', 'nav.meta'], limit: 4 }).slice(0, 2), ['act.export', 'nav.meta']);
  assert.equal(ids('', { limit: 3 }).length, 3);
  assert.equal(CMDS.find((c) => c.id === ids('', { limit: 1 })[0])!.group, 'Navigate');
  // "a" matches several; the recent one floats up
  const base = ids('a', { limit: 20 });
  const boosted = ids('a', { limit: 20, recentIds: [base[base.length - 1]] });
  assert.ok(boosted.indexOf(base[base.length - 1]) < base.indexOf(base[base.length - 1]));
  assert.deepEqual(ids('', { recentIds: ['does-not-exist'], limit: 2 }).length, 2);
});

test('limit is respected and ties break by shorter label', () => {
  assert.equal(ids('a', { limit: 2 }).length, 2);
  const tie = rankCommands('ads', [
    { id: 'long', label: 'Ads manager overview', group: 'Navigate' },
    { id: 'short', label: 'Ads', group: 'Navigate' },
  ]);
  assert.equal(tie[0].id, 'short');
});

test('matchRanges highlights the typed words, merging overlaps', () => {
  assert.deepEqual(matchRanges('Google Analytics', 'goo'), [[0, 3]]);
  assert.deepEqual(matchRanges('Google Analytics', 'anal goo'), [[0, 3], [7, 11]]);
  assert.deepEqual(matchRanges('Meta Ads', 'meta me'), [[0, 4]]);
  assert.deepEqual(matchRanges('Meta Ads', ''), []);
  assert.deepEqual(matchRanges('Meta Ads', 'zzz'), []);
});

test('arrow-key selection wraps around', () => {
  assert.equal(moveSelection(0, -1, 5), 4);
  assert.equal(moveSelection(4, 1, 5), 0);
  assert.equal(moveSelection(2, 1, 5), 3);
  assert.equal(moveSelection(3, 1, 0), 0);
});
