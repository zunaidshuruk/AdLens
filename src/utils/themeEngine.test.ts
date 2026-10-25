import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APPEARANCE,
  FONT_SCALES,
  PRESET_IDS,
  SCALE_STEPS,
  THEME_PRESETS,
  buildTheme,
  chartColors,
  contrastRatio,
  ensureContrast,
  generateAccentScale,
  hexToOklch,
  hexToRgb,
  normalizeHex,
  oklchToHex,
  relativeLuminance,
  resolveAppearance,
  sanitizeAppearance,
  suggestAccentFix,
  themeToCss,
  type ThemeOptions,
} from './themeEngine.js';

const opts = (o: Partial<ThemeOptions> = {}): ThemeOptions => ({
  mode: 'light', accent: '#1d4ed8', tint: 'none', radius: 'default', density: 'comfortable', fontScale: 'default', chartPalette: 'default', contrast: 'standard', ...o,
});
const HEX = /^#[0-9a-f]{6}$/;

test('hex parsing and normalisation', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex(' 1D4ED8 '), '#1d4ed8');
  for (const bad of ['', '#12', '#12345', '#gggggg', 'blue', null, undefined, 12345]) assert.equal(normalizeHex(bad), null);
  assert.deepEqual(hexToRgb('#1d4ed8'), [29, 78, 216]);
  assert.throws(() => hexToRgb('nope'), /Invalid colour/);
});

test('OKLCH round trip returns the same colour', () => {
  for (const hex of ['#1d4ed8', '#e11d48', '#16a34a', '#f97316', '#64748b', '#ffffff', '#000000', '#ffff00', '#7c3aed']) {
    const { L, C, h } = hexToOklch(hex);
    assert.equal(oklchToHex(L, C, h), hex, hex);
  }
  // known reference: pure white has L≈1, black L≈0
  assert.ok(Math.abs(hexToOklch('#ffffff').L - 1) < 0.001 && hexToOklch('#000000').L < 0.001);
});

test('out-of-gamut colours keep lightness and lose chroma instead of breaking', () => {
  const hex = oklchToHex(0.7, 0.6, 145); // far outside sRGB
  assert.match(hex, HEX);
  assert.ok(Math.abs(hexToOklch(hex).L - 0.7) < 0.02);
});

test('WCAG contrast matches published reference values', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(Math.round(contrastRatio('#767676', '#ffffff') * 100) / 100, 4.54); // the classic AA grey
  assert.equal(Math.round(contrastRatio('#777777', '#ffffff') * 100) / 100, 4.48);
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9);
});

test('ensureContrast leaves passing colours alone and fixes failing ones', () => {
  const ok = ensureContrast('#1d4ed8', '#ffffff', 4.5);
  assert.deepEqual([ok.hex, ok.changed], ['#1d4ed8', false]);

  const light = ensureContrast('#93c5fd', '#ffffff', 4.5); // pale blue on white
  assert.ok(light.changed && light.ratio >= 4.5);
  assert.ok(Math.abs(hexToOklch(light.hex).h - hexToOklch('#93c5fd').h) < 8); // hue preserved

  const onDark = ensureContrast('#1e3a8a', '#111111', 4.5); // dark blue on near-black → lightened
  assert.ok(onDark.ratio >= 4.5 && hexToOklch(onDark.hex).L > hexToOklch('#1e3a8a').L);

  // impossible target on a mid-grey background falls back to the best of black/white
  const impossible = ensureContrast('#888888', '#777777', 7);
  assert.ok(['#000000', '#ffffff'].includes(impossible.hex));
});

test('accent scale: 11 valid steps, strictly darkening, hue kept', () => {
  const s = generateAccentScale('#1d4ed8');
  assert.deepEqual(Object.keys(s).map(Number), [...SCALE_STEPS]);
  const ls = SCALE_STEPS.map((k) => hexToOklch(s[k]).L);
  for (let i = 1; i < ls.length; i++) assert.ok(ls[i] < ls[i - 1], `step ${SCALE_STEPS[i]}`);
  assert.ok(ls[0] > 0.95 && ls[ls.length - 1] < 0.3);
  Object.values(s).forEach((h) => assert.match(h, HEX));
  const hue = hexToOklch('#1d4ed8').h;
  assert.ok(Math.abs(hexToOklch(s[500]).h - hue) < 6);
  // grey accents stay grey
  assert.ok(hexToOklch(generateAccentScale('#808080')[500]).C < 0.02);
});

test('every preset in both modes passes all contrast checks (AAA for high contrast)', () => {
  for (const id of PRESET_IDS) {
    const p = THEME_PRESETS[id];
    for (const mode of ['light', 'dark'] as const) {
      const t = buildTheme(opts({ mode, accent: p.accent, tint: p.tint, contrast: p.contrast }));
      const failing = t.checks.filter((c) => !c.pass).map((c) => `${c.label} ${c.ratio}<${c.required}`);
      assert.deepEqual(failing, [], `${id}/${mode}`);
      if (p.contrast === 'high') {
        assert.ok(contrastRatio(t.vars['--color-text'], t.vars['--color-bg']) >= 7);
        assert.ok(t.checks.some((c) => c.label === 'Borders'));
      }
    }
  }
});

test('ANY accent colour gives readable text (seeded random + extremes)', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const accents = ['#ffff00', '#ffffff', '#000000', '#808080', '#00ff00', '#ff00ff', '#00ffff', '#7777ff'];
  for (let i = 0; i < 60; i++) accents.push(`#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`);
  for (const accent of accents)
    for (const mode of ['light', 'dark'] as const)
      for (const tint of ['none', 'cool', 'warm', 'accent'] as const)
        for (const contrast of ['standard', 'high'] as const) {
          const t = buildTheme(opts({ accent, mode, tint, contrast }));
          const failing = t.checks.filter((c) => !c.pass).map((c) => `${c.label} ${c.ratio}`);
          assert.deepEqual(failing, [], `${accent} ${mode} ${tint} ${contrast}`);
          Object.entries(t.vars).filter(([k]) => k.startsWith('--color-') || k.startsWith('--chart-') || k.startsWith('--accent-')).forEach(([k, v]) => assert.match(v, HEX, k));
        }
});

test('the user accent is kept exactly; adjustments are reported when text colours had to change', () => {
  const t = buildTheme(opts({ accent: '#93c5fd' }));
  assert.equal(t.vars['--color-accent'], '#93c5fd');
  assert.notEqual(t.vars['--color-accent-text'], '#93c5fd');
  assert.equal(t.adjustments.length, 1);
  assert.equal(t.vars['--color-on-accent'], '#000000'); // dark text on a pale button
  const dark = buildTheme(opts({ accent: '#1e3a8a', mode: 'dark' }));
  assert.match(dark.adjustments[0], /lightened/);
  assert.equal(buildTheme(opts({ accent: '#1d4ed8' })).adjustments.length, 0);
});

test('font scale, radius and density tokens', () => {
  assert.equal(buildTheme(opts({ fontScale: 'small' })).vars['--root-font-size'], '87.5%');
  assert.equal(buildTheme(opts({ fontScale: 'default' })).vars['--root-font-size'], '100%');
  assert.equal(buildTheme(opts({ fontScale: 'large' })).vars['--root-font-size'], '112.5%');
  assert.equal(buildTheme(opts({ fontScale: 'xlarge' })).vars['--root-font-size'], '125%');
  assert.equal(FONT_SCALES.xlarge.label, 'Extra large');
  assert.deepEqual(['sharp', 'default', 'round'].map((r) => buildTheme(opts({ radius: r as 'sharp' })).vars['--radius-md']), ['4px', '8px', '14px']);
  assert.equal(buildTheme(opts({ density: 'compact' })).vars['--density'], '0.875');
});

test('chart palettes: colour-blind is canonical Okabe–Ito; others meet 3:1; monochrome is ordered', () => {
  for (const mode of ['light', 'dark'] as const) {
    const surface = buildTheme(opts({ mode })).vars['--color-surface'];
    const cb = chartColors('colorblind', '#1d4ed8', surface, mode);
    assert.deepEqual(cb.slice(0, 7), ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7']);
    for (const id of ['default', 'brand', 'monochrome'] as const) {
      const cs = chartColors(id, '#1d4ed8', surface, mode);
      assert.equal(cs.length, 8);
      cs.forEach((c) => assert.ok(contrastRatio(c, surface) >= 3, `${id}/${mode} ${c}`));
      assert.equal(new Set(cs).size, 8, `${id} colours are distinct`);
    }
    const mono = chartColors('monochrome', '#1d4ed8', surface, mode).map((c) => hexToOklch(c).L);
    for (let i = 1; i < mono.length; i++) assert.ok(mono[i] > mono[i - 1]);
  }
  assert.equal(chartColors('brand', '#e11d48', '#ffffff', 'light')[0].length, 7);
});

test('themeToCss writes every variable', () => {
  const t = buildTheme(opts());
  const css = themeToCss(t.vars, '.theme');
  assert.match(css, /^\.theme \{\n  --color-bg: #[0-9a-f]{6};/);
  assert.equal(css.split('\n').length, Object.keys(t.vars).length + 2);
  assert.ok(Object.keys(t.vars).every((k) => k.startsWith('--')));
});

test('accent fix suggestions for the colour picker', () => {
  const pale = suggestAccentFix('#fde047', 'light')!;
  assert.deepEqual([pale.readableAsText, pale.visibleAsUi], [false, false]);
  assert.ok(contrastRatio(pale.fixedForText, '#ffffff') >= 4.5 && contrastRatio(pale.fixedForUi, '#ffffff') >= 3);
  const good = suggestAccentFix('#1d4ed8', 'light')!;
  assert.deepEqual([good.readableAsText, good.visibleAsUi, good.fixedForText], [true, true, '#1d4ed8']);
  assert.equal(suggestAccentFix('banana', 'light'), null);
});

test('resolveAppearance: presets, system and custom', () => {
  const d = DEFAULT_APPEARANCE;
  assert.equal(resolveAppearance(d, false).accent, '#1d4ed8');
  assert.equal(resolveAppearance({ ...d, preset: 'system' }, true).mode, 'dark');
  assert.equal(resolveAppearance({ ...d, preset: 'system' }, false).mode, 'light');
  assert.equal(resolveAppearance({ ...d, preset: 'midnight' }, false).mode, 'dark');
  const custom = resolveAppearance({ ...d, preset: 'custom', custom: { mode: 'dark', accent: '#e11d48', tint: 'warm' }, fontScale: 'large' }, false);
  assert.deepEqual([custom.mode, custom.accent, custom.tint, custom.fontScale], ['dark', '#e11d48', 'warm', 'large']);
});

test('sanitizeAppearance: accepts good data, repairs bad data and reports why', () => {
  assert.deepEqual(sanitizeAppearance(DEFAULT_APPEARANCE), { value: DEFAULT_APPEARANCE, errors: [] });
  assert.deepEqual(sanitizeAppearance(undefined), { value: DEFAULT_APPEARANCE, errors: [] });
  const bad = sanitizeAppearance({ preset: 'neon', custom: { accent: 'red', mode: 'sepia', tint: 'warm' }, fontScale: 'huge', radius: 'round', chartPalette: 7 });
  assert.equal(bad.value.preset, 'adlens-light');
  assert.equal(bad.value.custom.accent, '#1d4ed8');
  assert.equal(bad.value.custom.mode, 'light');
  assert.equal(bad.value.custom.tint, 'warm');
  assert.equal(bad.value.fontScale, 'default');
  assert.equal(bad.value.radius, 'round');
  assert.equal(bad.errors.length, 5);
  assert.equal(sanitizeAppearance({ custom: { accent: '#F00' } }).value.custom.accent, '#ff0000');
});
