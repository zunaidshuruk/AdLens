import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RULES, findLeftovers, findStringChunks, migrateChunk, migrateSource } from './colorMigration.js';
import { buildTheme, presetToOptions } from '../src/utils/themeEngine.js';

const m = (s: string) => migrateChunk(s).text;
const texts = (src: string) => findStringChunks(src).map((c) => src.slice(c.start, c.end));

test('scanner finds string contents, template segments and nested expressions', () => {
  assert.deepEqual(texts(`const a = "x y"; const b = 'z';`), ['x y', 'z']);
  assert.deepEqual(texts('const c = `a ${b ? \'one\' : "two"} c ${d} e`;'), ['a ', 'one', 'two', ' c ', ' e']);
  assert.deepEqual(texts('const c = `a ${`inner ${x}`} b`;'), ['a ', 'inner ', ' b']);
});

test('scanner ignores comments and apostrophes in JSX text', () => {
  assert.deepEqual(texts(`// it's "quoted"\nconst a = 'real'; /* 'no' */`), ['real']);
  const jsx = `<p className="text-slate-500">Don't forget it's here</p>;\nconst z = 'after';`;
  assert.deepEqual(texts(jsx), ['text-slate-500', 'after']);
  assert.deepEqual(texts(`return 'kw'; case 'k2': x = cond ? 'a' : 'b'; f('c', 'd'); import x from 'mod';`), ['kw', 'k2', 'a', 'b', 'c', 'd', 'mod']);
  assert.deepEqual(texts(`const s = 'unterminated\nconst t = "ok";`), ['ok']); // a quote never spans lines
  assert.deepEqual(texts('const re = /a\\/\\/b/; const s = "x";'), ['x']);
});

test('light/dark pairs collapse into one role; variants are kept', () => {
  assert.equal(m('bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'), 'bg-surface border border-line text-fg');
  assert.equal(m('bg-slate-50 dark:bg-slate-950'), 'bg-page');
  assert.equal(m('bg-slate-50 dark:bg-slate-800'), 'bg-fill-1');
  assert.equal(m('bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'), 'bg-fill-2 hover:bg-fill-3');
  assert.equal(m('hover:bg-slate-100 dark:hover:bg-slate-800'), 'hover:bg-fill-2');
  assert.equal(m('md:bg-white dark:md:bg-slate-900'), 'md:bg-surface');
  assert.equal(m('group-hover:text-slate-900 dark:group-hover:text-slate-100'), 'group-hover:text-fg');
  assert.equal(m('dark:bg-slate-900 bg-white'), 'bg-surface'); // dark class first
  assert.equal(m('text-slate-500 dark:text-slate-400'), 'text-fg-muted');
  assert.equal(m('text-slate-400 dark:text-slate-500'), 'text-fg-subtle');
  assert.equal(m('text-slate-300 dark:text-slate-700'), 'text-line-strong');
  assert.equal(m('border-slate-300 dark:border-slate-700'), 'border-line-strong');
  assert.equal(m('divide-slate-200 dark:divide-slate-800'), 'divide-line');
  assert.equal(m('hover:text-slate-600 dark:hover:text-slate-200'), 'hover:text-fg');
  assert.equal(m('text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800'), 'text-accent-text bg-accent-soft border-accent-line');
});

test('opacity: kept for translucent surfaces and focus rings, dropped for panels', () => {
  assert.equal(m('bg-white/95 dark:bg-slate-900/95'), 'bg-surface/95');
  assert.equal(m('bg-slate-900/60'), 'bg-scrim/60');
  assert.equal(m('bg-emerald-50/80 dark:bg-emerald-950/40'), 'bg-success-soft');
  assert.equal(m('bg-slate-50/70 dark:bg-slate-800/40'), 'bg-fill-1');
  assert.equal(m('focus:ring-blue-600 focus:ring-indigo-500/20'), 'focus:ring-focus focus:ring-focus/20');
});

test('status panels and solid buttons use their own roles', () => {
  assert.equal(m('bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'), 'bg-danger-soft border-danger-line text-danger');
  assert.equal(m('bg-amber-100/90 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200'), 'bg-warning-soft text-warning');
  assert.equal(m('bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'), 'bg-success-soft border-success-line text-success');
  assert.equal(m('text-white bg-blue-600 hover:bg-blue-700'), 'text-on-accent bg-accent hover:bg-accent-hover');
  assert.equal(m('bg-indigo-600 hover:bg-indigo-700 text-white'), 'bg-accent hover:bg-accent-hover text-on-accent');
  assert.equal(m('text-white bg-red-600 hover:bg-red-700'), 'text-on-danger bg-danger hover:bg-danger/90');
  assert.equal(m('bg-emerald-500'), 'bg-success');
  assert.equal(m('text-white bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600'), 'text-surface bg-fg hover:bg-fg/90');
  assert.equal(m('bg-blue-600 text-white border-blue-600'), 'bg-accent text-on-accent border-accent');
});

test('duplicates are removed and non-palette classes are never touched', () => {
  assert.equal(m('text-slate-900 dark:text-slate-100 text-slate-800 dark:text-slate-200'), 'text-fg');
  const plain = 'flex items-center gap-2 text-[11px] bg-transparent w-5 text-sm font-bold rounded-lg px-3 py-2';
  const r = migrateChunk(plain);
  assert.deepEqual([r.text, r.converted, r.notes.length], [plain, 0, 0]);
  assert.equal(m('border-transparent text-slate-700'), 'border-transparent text-fg');
});

test('anything that does not fit a rule is left exactly as written and reported', () => {
  const odd = migrateChunk('bg-blue-600 dark:bg-slate-800');
  assert.equal(odd.text, 'bg-blue-600 dark:bg-slate-800');
  assert.deepEqual(odd.notes.map((n) => n.kind).sort(), ['orphan-dark', 'partner-mismatch']);
  const white = migrateChunk('text-white drop-shadow');
  assert.equal(white.text, 'text-white drop-shadow');
  assert.equal(white.notes[0].kind, 'white-text-without-solid-background');
  assert.equal(migrateChunk('shadow-blue-500/30').notes[0].kind, 'unsupported-utility');
  assert.equal(migrateChunk('bg-fuchsia-500').notes[0].kind, 'no-rule');
});

test('whole files: strings change, code and JSX text do not', () => {
  const src = [
    "export const A = () => {",
    "  // bg-white dark:bg-slate-900 in a comment stays",
    "  const [on] = useState(false);",
    "  return (",
    '    <p className="text-slate-500 dark:text-slate-400">Don\'t forget it\'s here</p>',
    "    <b className={`px-2 ${on ? 'bg-blue-600 text-white' : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'} rounded`}>x</b>",
    "  );",
    "};",
  ].join('\n');
  const r = migrateSource(src);
  assert.equal(r.output, [
    "export const A = () => {",
    "  // bg-white dark:bg-slate-900 in a comment stays",
    "  const [on] = useState(false);",
    "  return (",
    '    <p className="text-fg-muted">Don\'t forget it\'s here</p>',
    "    <b className={`px-2 ${on ? 'bg-accent text-on-accent' : 'bg-fill-1 text-fg'} rounded`}>x</b>",
    "  );",
    "};",
  ].join('\n'));
  assert.deepEqual([r.changed, r.pairs], [true, 3]);
  assert.equal(migrateSource(r.output).changed, false); // idempotent
});

test('notes carry the right line numbers; the leftover check flags any palette class', () => {
  const src = "const a = 'ok';\nconst b = 'bg-fuchsia-500';\nconst c = `x ${y ? 'text-white' : 'z'}`;";
  assert.deepEqual(migrateSource(src).notes.map((n) => [n.kind, n.line]), [['no-rule', 2], ['white-text-without-solid-background', 3]]);
  assert.deepEqual(findLeftovers(src), [{ token: 'bg-fuchsia-500', line: 2 }, { token: 'text-white', line: 3 }]);
  assert.deepEqual(findLeftovers("const d = 'bg-surface text-fg border-line bg-transparent';"), []);
  assert.deepEqual(findLeftovers("const e = 'bg-white dark:bg-slate-900';").map((l) => l.token), ['bg-white', 'dark:bg-slate-900']); // convertible but not yet converted → still a violation
});

test('every role the rules can produce exists in the theme, so Tailwind will generate it', () => {
  const vars = buildTheme(presetToOptions('adlens-light')).vars;
  const roles = new Set(RULES.map((r) => r.role));
  ['on-accent', 'on-danger', 'on-success', 'on-warning', 'surface'].forEach((r) => roles.add(r));
  for (const role of roles) assert.ok(`--color-${role}` in vars, `theme is missing --color-${role}`);
  const dark = buildTheme(presetToOptions('adlens-dark')).vars;
  for (const role of roles) assert.ok(`--color-${role}` in dark, `dark theme is missing --color-${role}`);
});

test('real app files: migration is idempotent and changes only the inside of strings', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk('src').filter((f) => /\.tsx$/.test(f));
  assert.ok(files.length > 10);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const r = migrateSource(src);
    assert.equal(migrateSource(r.output).changed, false, `${f} is not idempotent`);
    // Everything outside string literals must be byte-for-byte identical.
    const outside = (s: string) => { const cs = findStringChunks(s); let pos = 0; const parts: string[] = []; for (const c of cs) { parts.push(s.slice(pos, c.start)); pos = c.end; } parts.push(s.slice(pos)); return parts; };
    assert.deepEqual(outside(r.output), outside(src), `${f}: code outside strings changed`);
  }
});
