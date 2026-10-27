import assert from 'node:assert/strict';
import test from 'node:test';
import { changeLabel, friendlyReportError, needsConnection, pageDetailLink, readPathParam, shortUrl, trendPercentLabel } from './intelligenceFormat.js';

test('page links round-trip and refuse anything that is not a path', () => {
  const link = pageDetailLink('/a b/c?x=1');
  const raw = new URL(link, 'http://x').searchParams.get('path');
  assert.equal(readPathParam(raw), '/a b/c?x=1');
  assert.equal(readPathParam('https://evil.com/x'), null);
  assert.equal(readPathParam('javascript:alert(1)'), null);
  assert.equal(readPathParam(''), null);
  assert.equal(readPathParam(null), null);
  assert.equal(readPathParam('/a\nb'), null);
  assert.equal(readPathParam('/' + 'a'.repeat(400)), null);
});

test('shortUrl strips protocol, www and trailing slash and truncates', () => {
  assert.equal(shortUrl('https://www.example.com/a/'), 'example.com/a');
  assert.equal(shortUrl('https://example.com/' + 'x'.repeat(100), 20).length, 20);
});

test('trend labels', () => {
  assert.equal(trendPercentLabel({ status: 'new', changePercent: null }), 'New');
  assert.equal(trendPercentLabel({ status: 'lost', changePercent: -100 }), 'Lost');
  assert.equal(trendPercentLabel({ status: 'rising', changePercent: 42.4 }), '+42%');
  assert.equal(trendPercentLabel({ status: 'falling', changePercent: -30 }), '-30%');
});

test('friendly errors point at the Connections page', () => {
  assert.match(friendlyReportError('GA4_NOT_SELECTED', 'x'), /Connections/);
  assert.equal(friendlyReportError('SOMETHING', 'fallback'), 'fallback');
  assert.ok(needsConnection('META_NOT_CONNECTED'));
  assert.ok(!needsConnection('REPORT_FAILED'));
});

test('changeLabel', () => {
  assert.equal(changeLabel(110, 100), '+10.0%');
  assert.equal(changeLabel(90, 100), '-10.0%');
  assert.equal(changeLabel(5, 0), null);
  assert.equal(changeLabel(5, undefined), null);
});

import { pagesToCsv } from './pagesCsv.js';

test('pages CSV neutralises formulas and keeps empty cells empty', () => {
  const csv = pagesToCsv([
    { path: '/=HYPERLINK("x")', title: '+evil', views: 5, users: null, avgEngagementSeconds: null, keyEvents: null, clicks: null, impressions: null, ctr: null, position: null, flags: ['analytics_only'] },
  ]);
  const [, row] = csv.trim().split('\n');
  assert.ok(row.startsWith(`"/=HYPERLINK(""x"")",'+evil,5,,`));
  assert.ok(row.endsWith('analytics_only'));
});
