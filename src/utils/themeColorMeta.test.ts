import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeThemeColor, syncThemeColorMeta, type MetaDoc } from './themeColorMeta.js';

function tag() {
  const attrs: Record<string, string> = {};
  return { attrs, setAttribute: (n: string, v: string) => { attrs[n] = v; } };
}

test('colour values: normal colours pass, anything else is refused', () => {
  for (const ok of ['#f6f9fc', '#0e1012', 'rgb(1, 2, 3)', 'oklch(0.2 0.01 250)']) assert.equal(isSafeThemeColor(ok), true, ok);
  for (const bad of ['', 'red; x', '"><script>', 'url(x)', 42, null, 'a'.repeat(100)]) assert.equal(isSafeThemeColor(bad), false, String(bad));
});

test('every existing theme-color tag gets the colour and applies to all modes', () => {
  const a = tag(); const b = tag();
  const doc: MetaDoc = { querySelectorAll: () => [a, b] };
  assert.equal(syncThemeColorMeta(doc, '#123456'), true);
  assert.equal(a.attrs.content, '#123456'); assert.equal(b.attrs.content, '#123456');
  assert.equal(a.attrs.media, 'all');
});

test('a tag is created when none exists; bad input changes nothing', () => {
  const made: ReturnType<typeof tag>[] = []; const added: unknown[] = [];
  const doc: MetaDoc = { querySelectorAll: () => [], head: { appendChild: (n) => added.push(n) }, createElement: () => { const t = tag(); made.push(t); return t; } };
  assert.equal(syncThemeColorMeta(doc, '#abcdef'), true);
  assert.equal(made[0].attrs.name, 'theme-color'); assert.equal(added.length, 1);
  assert.equal(syncThemeColorMeta(doc, 'javascript:1'), false);
  assert.equal(syncThemeColorMeta(null, '#fff'), false);
});
