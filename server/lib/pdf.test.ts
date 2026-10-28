import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { PdfDoc, pdfString, snapshotToPdf, textWidth } from './pdf.js';
import type { Snapshot } from './shares.js';

const res = (cols: [string, string, string][], rows: Record<string, string | number>[], totals: Record<string, number> | null = null) =>
  ({ source: 'ga4' as const, columns: cols.map(([key, label, type]) => ({ key, label, type: type as never, role: (type === 'text' || type === 'date' ? 'dimension' : 'metric') as 'dimension' | 'metric' })), rows, totals, rowCount: rows.length, truncated: false });

const snap = (n = 1): Snapshot => ({
  title: 'Weekly (report) \\ ünïcode ☃', description: 'Numbers for the team', kind: 'dashboard', range: { startDate: '2026-10-19', endDate: '2026-10-25' }, generatedAt: '2026-10-26T06:00:00.000Z',
  widgets: Array.from({ length: n }, (_, i) => [
    { id: `k${i}`, title: `Visits ${i}`, layout: { x: 0, y: i * 10, w: 4, h: 2 }, kind: 'kpi' as const, result: res([['s', 'Sessions', 'integer']], [], { s: 12345 }) },
    { id: `b${i}`, title: 'By country', layout: { x: 0, y: i * 10 + 2, w: 6, h: 4 }, kind: 'bar' as const, result: res([['c', 'Country', 'text'], ['s', 'Sessions', 'integer']], [{ c: 'Bangladesh', s: 900 }, { c: 'India', s: 400 }]) },
    { id: `l${i}`, title: 'Trend', layout: { x: 0, y: i * 10 + 4, w: 6, h: 4 }, kind: 'line' as const, result: res([['d', 'Date', 'date'], ['s', 'Sessions', 'integer']], Array.from({ length: 30 }, (_, k) => ({ d: `2026-09-${String(k + 1).padStart(2, '0')}`, s: 100 + k * 3 }))) },
    { id: `t${i}`, title: 'Table', layout: { x: 0, y: i * 10 + 6, w: 6, h: 4 }, kind: 'table' as const, result: res([['c', 'Country', 'text'], ['s', 'Sessions', 'integer'], ['p', 'Share', 'percent']], Array.from({ length: 40 }, (_, k) => ({ c: `Row ${k} (x)`, s: k, p: k / 2 }))) },
    { id: `n${i}`, title: 'Note', layout: { x: 0, y: i * 10 + 8, w: 6, h: 2 }, kind: 'text' as const, text: 'A long note '.repeat(60) },
    { id: `e${i}`, title: 'Broken', layout: { x: 0, y: i * 10 + 9, w: 6, h: 2 }, kind: 'kpi' as const, error: 'Could not load this panel.' },
  ]).flat(),
});

test('PDF strings: escapes brackets, keeps Western letters, replaces what the fonts cannot show', () => {
  assert.equal(pdfString('a(b)c\\d').toString('latin1'), 'a\\(b\\)c\\\\d');
  assert.equal(pdfString('café').toString('latin1'), 'caf\xe9');
  assert.equal(pdfString('বাংলা').toString('latin1'), '?????');
  assert.equal(pdfString('“hi” – ok').toString('latin1'), '\x93hi\x94 \x96 ok');
  assert.ok(textWidth('Hello world', 10) > textWidth('Hello', 10));
  assert.ok(textWidth('Hello', 10, true) > textWidth('Hello', 10));
});

test('PDF: a valid file with a correct cross-reference table, text inside, and as many pages as the content needs', () => {
  const small = snapshotToPdf(snap(1), 'My project');
  const s = small.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const entries = [...s.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  const count = Number(/\/Count (\d+)/.exec(s)![1]);
  assert.ok(count >= 2, 'a 40-row table and a long note need more than one page');
  const first = /stream\n([\s\S]*?)\nendstream/.exec(s)!;
  const content = inflateSync(Buffer.from(first[1], 'latin1')).toString('latin1');
  assert.match(content, /Weekly \\\(report\\\)/);
  assert.match(content, /12,345/);
  assert.match(content, /Page 1 of \d+/);
  assert.match(content, /Bangladesh/);
  const big = snapshotToPdf(snap(8));
  assert.ok(Number(/\/Count (\d+)/.exec(big.toString('latin1'))![1]) > count);
});

test('PDF: wrapping never exceeds the width and cuts words that are too long', () => {
  const d = new PdfDoc();
  const lines = d.wrap('word '.repeat(80) + 'x'.repeat(400), 10, 300);
  assert.ok(lines.length > 5);
  for (const l of lines) assert.ok(textWidth(l, 10) <= 300 + 0.01, l);
});

test('PDF: Bangla and Hindi text is embedded with real fonts, joined letters and clean line breaks', () => {
  const bn = 'ট্রাফিক ক্ষত্রিয় বাংলাদেশ';
  assert.ok(textWidth(bn, 10) > textWidth('?'.repeat(bn.length), 10) * 0.5, 'measured with the Bangla font, not as question marks');
  // mixed text measures as the sum of its parts
  assert.ok(Math.abs(textWidth(`Hello ${bn}`, 12) - (textWidth('Hello ', 12) + textWidth(bn, 12))) < 40);

  const s = snapshotToPdf({ ...snap(1), title: 'সাপ্তাহিক রিপোর্ট नमस्ते', description: bn }, 'প্রজেক্ট').toString('latin1');
  assert.match(s, /\/Subtype \/Type0/);
  assert.match(s, /NotoSansBengali/);
  assert.match(s, /NotoSansDevanagari/);
  assert.match(s, /\/FontFile2/);
  assert.match(s, /\/ToUnicode/);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
  const entries = [...s.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));

  // a plain English document still needs no embedded font
  assert.ok(!snapshotToPdf(snap(1)).toString('latin1').includes('/Type0'));

  // long Bangla text wraps inside the width and never splits a joined letter from its marks
  const d = new PdfDoc();
  const lines = d.wrap('ক্ষত্রিয় '.repeat(40) + 'ক্ষ'.repeat(120), 10, 200);
  assert.ok(lines.length > 4);
  for (const l of lines) {
    assert.ok(textWidth(l, 10) <= 200 + 0.01, l);
    assert.ok(!l.startsWith('\u09cd') && !l.endsWith('\u09cd'), 'no line starts or ends in the middle of a joined letter');
  }
  // other scripts still fall back to a question mark
  assert.equal(pdfString('日本').toString('latin1'), '??');
});
