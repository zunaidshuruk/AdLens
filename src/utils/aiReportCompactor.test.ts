import test from 'node:test';
import assert from 'node:assert/strict';
import { compactReport, estimateTokens } from './aiReportCompactor.js';

test('KPI report: metrics with comparison become one line each; nulls are dropped', () => {
  const r = compactReport({
    sessions: { value: 12345, previousValue: 11000, changePercent: 12.2273 },
    engagementRate: { value: 0.6123456, previousValue: 0.55, changePercent: null },
    propertyName: 'Demo Store',
    missing: null,
  });
  assert.equal(
    r.text,
    ['sessions: 12345 (prev 11000, +12.23%)', 'engagementRate: 0.61 (prev 0.55)', 'propertyName: Demo Store'].join('\n')
  );
  assert.equal(r.truncated, false);
});

test('rows become a small table with empty columns removed and long strings trimmed', () => {
  const r = compactReport({
    channels: [
      { channel: 'Organic Search', sessions: 5000, users: 4000, note: null },
      { channel: 'Paid Social', sessions: 1200.456, users: 900, note: null },
    ],
    topPages: [{ path: '/' + 'x'.repeat(200), views: 10 }],
  });
  assert.match(r.text, /^\[channels\] 2 rows\nchannel \| sessions \| users\nOrganic Search \| 5000 \| 4000\nPaid Social \| 1200\.5 \| 900/m);
  assert.ok(!r.text.includes('note'));
  const pathLine = r.text.split('\n').find((l) => l.startsWith('/xxx'))!;
  assert.ok(pathLine.length < 80 && pathLine.includes('…'));
});

test('nested objects flatten one level; metrics inside rows are inlined', () => {
  const r = compactReport([{ name: 'A', stats: { clicks: 10, ctr: 1.5 }, spend: { value: 50, previousValue: 40, changePercent: 25 } }]);
  assert.match(r.text, /name \| stats\.clicks \| stats\.ctr \| spend/);
  assert.match(r.text, /A \| 10 \| 1\.5 \| 50 \(prev 40, \+25%\)/);
});

test('long tables are cut to the row limit and say so', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ query: `q${i}`, clicks: 100 - i }));
  const r = compactReport({ queries: rows }, { maxRows: 10 });
  assert.equal(r.truncated, true);
  assert.match(r.text, /\[queries\] 60 rows/);
  assert.match(r.text, /showing first 10 of 60 rows/);
  assert.ok(r.text.includes('q9') && !r.text.includes('q10 '));
  assert.deepEqual(r.notes, ['queries: showing first 10 of 60 rows']);
});

test('daily series are summarised with min, max, average and a sample', () => {
  const days = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 21 + i)).toISOString().slice(0, 10);
    return { date: d, sessions: 100 + (i === 40 ? 500 : i % 7), compareDate: d, users: 50 };
  });
  const r = compactReport({ traffic: days });
  assert.match(r.text, /\[traffic\] daily series, 90 days \(2026-07-21 to 2026-10-18\)/);
  assert.match(r.text, /sessions: avg \d+(\.\d+)?, total \d+, min 100 \(2026-07-21\), max 600 \(2026-08-30\)/);
  assert.match(r.text, /sampled every 9 day\(s\):/);
  assert.ok(r.text.split('\n').length < 40);
  assert.ok(!/compareDate/.test(r.text.split('sampled')[0].split('\n').slice(1).join('\n')));
});

test('stays within the token budget by shrinking rows, then cutting lines', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ page: `/page-${i}`, views: i, title: 'A fairly long page title number ' + i }));
  const small = compactReport({ pages: rows }, { maxTokens: 300 });
  assert.ok(small.tokens <= 300, `tokens ${small.tokens}`);
  assert.equal(small.truncated, true);

  const wide = compactReport(Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`metric${i}`, i * 1.5])), { maxTokens: 200 });
  assert.ok(wide.tokens <= 200);
  assert.match(wide.text, /output truncated to fit/);
  assert.ok(wide.notes.some((n) => n.includes('lines omitted')));
});

test('handles empty, primitive and odd input without throwing', () => {
  assert.equal(compactReport(null).text, '(no data returned)');
  assert.equal(compactReport({}).text, '(no data returned)');
  assert.equal(compactReport([]).text, '[rows] 0 rows');
  assert.equal(compactReport({ a: [] }).text, '[a] 0 rows');
  assert.equal(compactReport({ list: ['a', 'b', 3] }).text, 'list: a, b, 3');
  assert.equal(compactReport({ n: Infinity, s: '  spaced   out  ' }).text, 'n: \ns: spaced out');
  assert.ok(estimateTokens('x'.repeat(350)) === 100);
});
