import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findLeftovers } from './colorMigration.js';

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(tsx|ts)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [p] : [];
  });
}

test('no hard-coded palette colours in src (use theme colour roles; see npm run check:colors)', () => {
  const problems: string[] = [];
  for (const f of walk(path.join(process.cwd(), 'src'))) {
    for (const l of findLeftovers(fs.readFileSync(f, 'utf8'))) problems.push(`${path.relative(process.cwd(), f)}:${l.line}  ${l.token}`);
  }
  assert.deepEqual(problems, []);
});
