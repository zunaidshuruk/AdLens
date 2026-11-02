import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('Phone rules stay in place: 16px form fields (outside any layer), non-sticky header, notice above the bottom bar', () => {
  const css = read('./index.css');
  const tail = css.slice(css.lastIndexOf('@media (max-width: 767px)'));
  assert.match(tail, /font-size:\s*16px/, 'form fields must be 16px on phones or iPhones zoom on tap');
  assert.ok(css.lastIndexOf('@media (max-width: 767px)') > css.indexOf('@layer base'), 'the rule sits after the base layer so Tailwind text-xs does not beat it');
  assert.doesNotMatch(read('./components/Header.tsx'), /<header className="sticky /, 'header must not stay pinned on phones (it takes over a third of the screen)');
  assert.match(read('./components/CookieNotice.tsx'), /bottom-\[calc\(4\.25rem/, 'the cookie notice must sit above the bottom navigation on phones');
});
