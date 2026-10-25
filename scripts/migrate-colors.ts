/**
 * Colour migration tool (Sprint 8).
 *
 *   npx tsx scripts/migrate-colors.ts            dry run: shows what would change and what needs a human
 *   npx tsx scripts/migrate-colors.ts --write    applies the changes
 *   npx tsx scripts/migrate-colors.ts --check    fails (exit 1) if any hard-coded palette class remains
 *
 * Options: --dir <folder> (default src), --json <file> (save a machine-readable report), --quiet
 * Test files and CSS are never touched. Running --write twice changes nothing the second time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findLeftovers, migrateSource } from './colorMigration.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string, fallback: string) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };

const root = value('--dir', 'src');
const write = flag('--write');
const check = flag('--check');
const quiet = flag('--quiet');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(tsx|ts)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [p] : [];
  });
}

const files = walk(root);

if (check) {
  let total = 0;
  for (const f of files) {
    const left = findLeftovers(fs.readFileSync(f, 'utf8'));
    total += left.length;
    if (!quiet) for (const l of left) console.log(`${f}:${l.line}  ${l.token}`);
  }
  console.log(total === 0 ? 'OK: no hard-coded palette colours remain.' : `FAILED: ${total} hard-coded palette class(es) remain. Use theme roles (bg-surface, text-fg, border-line, bg-accent ...).`);
  process.exit(total === 0 ? 0 : 1);
}

const report: Record<string, { converted: number; pairs: number; notes: unknown[] }> = {};
let converted = 0, pairs = 0, changedFiles = 0;
const noteCounts = new Map<string, number>();
const review: string[] = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const r = migrateSource(src);
  if (r.converted === 0 && r.notes.length === 0) continue;
  report[f] = { converted: r.converted, pairs: r.pairs, notes: r.notes };
  converted += r.converted;
  pairs += r.pairs;
  if (r.changed) { changedFiles++; if (write) fs.writeFileSync(f, r.output); }
  for (const n of r.notes) {
    noteCounts.set(n.kind, (noteCounts.get(n.kind) ?? 0) + 1);
    review.push(`${f}:${n.line}  [${n.kind}] ${n.token}${n.partner ? `  (dark partner: ${n.partner})` : ''}`);
  }
}

console.log(`${write ? 'APPLIED' : 'DRY RUN'}: ${converted} class(es) converted (${pairs} light/dark pairs collapsed) in ${changedFiles} file(s).`);
if (!write) console.log('Nothing was written. Run again with --write to apply.');
console.log(review.length === 0 ? 'Nothing needs manual review.' : `\n${review.length} item(s) need a human:`);
if (!quiet) for (const line of review) console.log(`  ${line}`);
if (review.length) console.log(`\nBy kind: ${[...noteCounts].map(([k, v]) => `${k}=${v}`).join(', ')}`);

const jsonPath = value('--json', '');
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
