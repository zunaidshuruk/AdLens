/**
 * Theme engine for AdLens (Sprint 8). Pure functions, no DOM access.
 *
 * One accent colour in, a complete accessible theme out:
 * - Colours are generated in OKLCH (perceptually even), then gamut-clipped to sRGB.
 * - Every text colour is derived and checked against WCAG contrast (AA 4.5:1, AAA 7:1 in
 *   high-contrast mode). Users can only pick the accent, so unreadable text is impossible;
 *   the contrast guard reports (and fixes) the cases where the accent itself is used as text.
 * - Output is a flat map of CSS variables that the UI applies to :root.
 */

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

export type RGB = [number, number, number]; // 0..255
export interface Oklch { L: number; C: number; h: number } // L 0..1, C ≥ 0, h degrees

/** "#RGB" / "#RRGGBB" (with or without #) → "#rrggbb", or null when invalid. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

export function hexToRgb(hex: string): RGB {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`Invalid colour: ${hex}`);
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (c255: number): number => {
  const v = c255 / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const toGamma255 = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Oklch {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = toLinear(r8), g = toLinear(g8), b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  const h = C < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { L, C, h };
}

function oklchToLinearRgb(L: number, C: number, h: number): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = ([r, g, b]: number[]): boolean => [r, g, b].every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH → "#rrggbb". Out-of-gamut colours keep their lightness and hue; chroma is reduced. */
export function oklchToHex(L: number, C: number, h: number): string {
  const Lc = Math.max(0, Math.min(1, L));
  let chroma = Math.max(0, C);
  if (!inGamut(oklchToLinearRgb(Lc, chroma, h))) {
    let lo = 0, hi = chroma;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearRgb(Lc, mid, h))) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  const lin = oklchToLinearRgb(Lc, chroma, h).map((v) => toGamma255(Math.max(0, Math.min(1, v)))) as RGB;
  return rgbToHex(lin);
}

// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastFix { hex: string; changed: boolean; ratio: number }

/**
 * Returns `fg` unchanged when it already meets `min` against `bg`; otherwise the closest colour
 * (same hue and chroma, adjusted lightness) that does. Falls back to black or white when the
 * background makes the target impossible for a coloured foreground.
 */
export function ensureContrast(fgInput: string, bgInput: string, min: number): ContrastFix {
  const fg = normalizeHex(fgInput), bg = normalizeHex(bgInput);
  if (!fg || !bg) throw new Error('Invalid colour');
  const start = contrastRatio(fg, bg);
  if (start >= min) return { hex: fg, changed: false, ratio: start };

  const blackOk = contrastRatio('#000000', bg) >= min;
  const whiteOk = contrastRatio('#ffffff', bg) >= min;
  const bestExtreme = contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg) ? '#000000' : '#ffffff';
  const extreme = (): ContrastFix => ({ hex: bestExtreme, changed: true, ratio: contrastRatio(bestExtreme, bg) });
  if (!blackOk && !whiteOk) return extreme();

  const { L, C, h } = hexToOklch(fg);
  const dir: 1 | -1 = blackOk && whiteOk ? (relativeLuminance(bg) > 0.179 ? -1 : 1) : blackOk ? -1 : 1;
  let l = L;
  for (let i = 0; i < 120; i++) {
    l = Math.max(0, Math.min(1, l + dir * 0.01));
    const hex = oklchToHex(l, C, h);
    const r = contrastRatio(hex, bg);
    if (r >= min) return { hex, changed: true, ratio: r };
    if (l <= 0 || l >= 1) break;
  }
  return extreme();
}

const bestOn = (bg: string): string => (contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type Mode = 'light' | 'dark';
export type Tint = 'none' | 'cool' | 'warm' | 'accent';
export type Radius = 'sharp' | 'default' | 'round';
export type Density = 'comfortable' | 'compact';
export type FontScale = 'small' | 'default' | 'large' | 'xlarge';

export type FontFamilyId = 'plus-jakarta' | 'mada' | 'poppins' | 'noto-sans' | 'inter' | 'roboto' | 'system';

/** Bangla text always falls back to Noto Sans Bengali, whichever Latin font is chosen. */
const FONT_TAIL = "'Noto Sans Bengali', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const FONT_FAMILIES: Record<FontFamilyId, { label: string; note: string; stack: string }> = {
  'plus-jakarta': { label: 'Plus Jakarta Sans', note: 'AdLens default', stack: `'Plus Jakarta Sans', ${FONT_TAIL}` },
  mada: { label: 'Mada', note: 'Clean and compact', stack: `'Mada', ${FONT_TAIL}` },
  poppins: { label: 'Poppins', note: 'Round and friendly', stack: `'Poppins', ${FONT_TAIL}` },
  'noto-sans': { label: 'Noto Sans', note: 'Very easy to read', stack: `'Noto Sans', ${FONT_TAIL}` },
  inter: { label: 'Inter', note: 'Standard screen font', stack: `'Inter', ${FONT_TAIL}` },
  roboto: { label: 'Roboto', note: 'Standard Android font', stack: `'Roboto', ${FONT_TAIL}` },
  system: { label: 'Your device font', note: 'Fastest, nothing to download', stack: `system-ui, ${FONT_TAIL}` },
};
export const FONT_FAMILY_IDS = Object.keys(FONT_FAMILIES) as FontFamilyId[];
export type ChartPaletteId = 'default' | 'colorblind' | 'monochrome' | 'brand';
export type ContrastLevel = 'standard' | 'high';

export interface ThemeOptions {
  mode: Mode;
  accent: string;
  tint: Tint;
  radius: Radius;
  density: Density;
  fontScale: FontScale;
  /** Optional so older callers keep working; missing means the AdLens default. */
  fontFamily?: FontFamilyId;
  chartPalette: ChartPaletteId;
  contrast: ContrastLevel;
}

export const FONT_SCALES: Record<FontScale, { label: string; factor: number }> = {
  small: { label: 'Small', factor: 0.875 },
  default: { label: 'Default', factor: 1 },
  large: { label: 'Large', factor: 1.125 },
  xlarge: { label: 'Extra large', factor: 1.25 },
};

const RADII: Record<Radius, [string, string, string]> = {
  sharp: ['2px', '4px', '6px'],
  default: ['4px', '8px', '12px'],
  round: ['8px', '14px', '20px'],
};

// ---------------------------------------------------------------------------
// Palette generation
// ---------------------------------------------------------------------------

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const SCALE_L = [0.97, 0.94, 0.88, 0.8, 0.71, 0.63, 0.55, 0.47, 0.4, 0.33, 0.26];
const SCALE_C = [0.1, 0.22, 0.45, 0.7, 0.9, 1, 0.95, 0.85, 0.7, 0.55, 0.42];

/** 11-step shade scale (50 lightest … 950 darkest) in the accent's hue. */
export function generateAccentScale(accentInput: string): Record<number, string> {
  const accent = normalizeHex(accentInput);
  if (!accent) throw new Error(`Invalid colour: ${accentInput}`);
  const { C, h } = hexToOklch(accent);
  const base = C < 0.02 ? C : Math.max(0.03, Math.min(0.22, C));
  const out: Record<number, string> = {};
  SCALE_STEPS.forEach((step, i) => {
    out[step] = oklchToHex(SCALE_L[i], base * SCALE_C[i], h);
  });
  return out;
}

const TINTS: Record<Exclude<Tint, 'accent'>, { h: number; c: number }> = {
  none: { h: 0, c: 0 },
  cool: { h: 250, c: 0.005 },
  warm: { h: 75, c: 0.009 },
};

const OKABE_ITO = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999'];
const CATEGORICAL = ['#2563eb', '#f97316', '#16a34a', '#9333ea', '#e11d48', '#0891b2', '#ca8a04', '#64748b'];

export function chartColors(id: ChartPaletteId, accentInput: string, surface: string, mode: Mode): string[] {
  const accent = normalizeHex(accentInput) ?? '#1d4ed8';
  const { C, h } = hexToOklch(accent);
  switch (id) {
    case 'colorblind':
      // Canonical Okabe–Ito colours, kept as published so they stay colour-blind safe.
      return [...OKABE_ITO];
    case 'monochrome': {
      const [from, to] = mode === 'light' ? [0.3, 0.62] : [0.6, 0.9];
      const chroma = Math.max(0.03, Math.min(0.16, C));
      return Array.from({ length: 8 }, (_, i) => oklchToHex(from + ((to - from) * i) / 7, chroma, h));
    }
    case 'brand': {
      const rest = Array.from({ length: 7 }, (_, i) => oklchToHex(i % 2 ? 0.7 : 0.6, 0.14, h + 45 * (i + 1)));
      return [accent, ...rest].map((c) => ensureContrast(c, surface, 3).hex);
    }
    case 'default':
    default:
      return CATEGORICAL.map((c) => ensureContrast(c, surface, 3).hex);
  }
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface ContrastCheck {
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  pass: boolean;
}

export interface Theme {
  vars: Record<string, string>;
  checks: ContrastCheck[];
  passesAll: boolean;
  /** Messages for anything the engine adjusted (e.g. "Accent darkened to stay readable as link text"). */
  adjustments: string[];
}

/** Pushes a colour until it meets `min` against every background (all backgrounds share one polarity). */
function ensureOnAll(fg: string, bgs: string[], min: number): string {
  let c = fg;
  for (let round = 0; round < 3; round++) {
    for (const bg of bgs) c = ensureContrast(c, bg, min).hex;
    if (bgs.every((bg) => contrastRatio(c, bg) >= min)) break;
  }
  return c;
}

const STATUS_HUES = { success: 150, warning: 75, danger: 25 } as const;

export function buildTheme(options: ThemeOptions): Theme {
  const accent = normalizeHex(options.accent);
  if (!accent) throw new Error(`Invalid accent colour: ${options.accent}`);
  const { mode, contrast } = options;
  const light = mode === 'light';
  const high = contrast === 'high';
  const textMin = high ? 7 : 4.5;
  const accentHue = hexToOklch(accent).h;
  const tint = options.tint === 'accent' ? { h: accentHue, c: 0.01 } : TINTS[options.tint];
  const scale = generateAccentScale(accent);
  const adjustments: string[] = [];
  const tinted = (L: number, k = 1) => oklchToHex(L, tint.c * k, tint.h);

  // Neutral surfaces: page < surface < raised, plus three fill levels for panels, chips and hover states.
  const bg = light ? tinted(0.98) : tinted(0.17);
  const surface = light ? '#ffffff' : tinted(0.21);
  const raised = light ? '#ffffff' : tinted(0.25);
  const fill1 = light ? tinted(0.965) : tinted(0.26);
  const fill2 = light ? tinted(0.94) : tinted(0.3);
  const fill3 = light ? tinted(0.905) : tinted(0.35);
  const border = high ? (light ? tinted(0.45, 1.2) : tinted(0.75, 1.2)) : light ? tinted(0.91, 1.2) : tinted(0.33, 1.2);
  const lineStrong = ensureOnAll(high ? (light ? tinted(0.35) : tinted(0.85)) : light ? tinted(0.7, 1.5) : tinted(0.5, 1.5), [surface, bg], 3);
  const grounds = [bg, surface, fill1, fill2, fill3];

  // Text roles, each guaranteed on every ground it can sit on.
  const fgBase = high ? (light ? '#000000' : '#ffffff') : light ? tinted(0.21) : tinted(0.96);
  const fg = ensureOnAll(fgBase, grounds, textMin);
  const mutedBase = high ? fg : light ? tinted(0.48) : tinted(0.74);
  const fgMuted = ensureOnAll(mutedBase, grounds, textMin);
  const fgSubtle = ensureOnAll(high ? fgMuted : light ? tinted(0.62) : tinted(0.6), [bg, surface, fill1, fill2], 3);

  // Accent family.
  const accentSoft = light ? scale[100] : scale[900];
  const accentLine = light ? scale[200] : scale[800];
  const onAccent = bestOn(accent);
  const accentTextRaw = ensureOnAll(accent, [surface, bg], textMin);
  const accentText = ensureOnAll(accentTextRaw, [surface, bg, accentSoft, fill1], textMin);
  if (accentText.toLowerCase() !== accent) {
    adjustments.push(`Your accent colour was ${light ? 'darkened' : 'lightened'} where it is used as text or links, to stay readable.`);
  }
  const focusRing = ensureContrast(accent, bg, 3).hex;

  // Status families: text, soft panel background and panel border.
  const status = (name: keyof typeof STATUS_HUES, lightBase: string, darkBase: string) => {
    const h = STATUS_HUES[name];
    const soft = light ? oklchToHex(0.965, 0.028, h) : oklchToHex(0.27, 0.05, h);
    const line = light ? oklchToHex(0.89, 0.06, h) : oklchToHex(0.38, 0.075, h);
    const text = ensureOnAll(light ? lightBase : darkBase, [surface, bg, soft], textMin);
    return { soft, line, text };
  };
  const success = status('success', '#15803d', '#4ade80');
  const warning = status('warning', '#b45309', '#fbbf24');
  const danger = status('danger', '#b91c1c', '#f87171');

  const charts = chartColors(options.chartPalette, accent, surface, mode);
  const [rSm, rMd, rLg] = RADII[options.radius];
  const factor = FONT_SCALES[options.fontScale].factor;

  const vars: Record<string, string> = {
    '--color-page': bg,
    '--color-surface': surface,
    '--color-raised': raised,
    '--color-fill-1': fill1,
    '--color-fill-2': fill2,
    '--color-fill-3': fill3,
    '--color-line': border,
    '--color-line-strong': lineStrong,
    '--color-fg': fg,
    '--color-fg-muted': fgMuted,
    '--color-fg-subtle': fgSubtle,
    '--color-accent': accent,
    '--color-accent-hover': light ? scale[700] : scale[300],
    '--color-accent-soft': accentSoft,
    '--color-accent-line': accentLine,
    '--color-on-accent': onAccent,
    '--color-accent-text': accentText,
    '--color-focus': focusRing,
    '--color-on-success': bestOn(success.text),
    '--color-on-warning': bestOn(warning.text),
    '--color-on-danger': bestOn(danger.text),
    '--color-scrim': light ? '#0f172a' : '#000000',
    '--color-on-scrim': '#ffffff',
    '--color-success': success.text,
    '--color-success-soft': success.soft,
    '--color-success-line': success.line,
    '--color-warning': warning.text,
    '--color-warning-soft': warning.soft,
    '--color-warning-line': warning.line,
    '--color-danger': danger.text,
    '--color-danger-soft': danger.soft,
    '--color-danger-line': danger.line,
    '--radius-sm': rSm,
    '--radius-md': rMd,
    '--radius-lg': rLg,
    '--density': options.density === 'compact' ? '0.875' : '1',
    '--font-sans': FONT_FAMILIES[options.fontFamily ?? 'plus-jakarta'].stack,
    '--font-scale': String(factor),
    '--root-font-size': `${factor * 100}%`,
  };
  SCALE_STEPS.forEach((st) => (vars[`--color-accent-${st}`] = scale[st]));
  charts.forEach((c, i) => (vars[`--chart-${i + 1}`] = c));

  const check = (label: string, foreground: string, background: string, required: number): ContrastCheck => {
    const ratio = Math.round(contrastRatio(foreground, background) * 100) / 100;
    return { label, foreground, background, ratio, required, pass: ratio >= required };
  };
  const checks: ContrastCheck[] = [
    check('Body text on page', fg, bg, textMin),
    check('Body text on cards', fg, surface, textMin),
    check('Body text on panels', fg, fill3, textMin),
    check('Secondary text on page', fgMuted, bg, textMin),
    check('Secondary text on cards', fgMuted, surface, textMin),
    check('Secondary text on panels', fgMuted, fill3, textMin),
    check('Faint text and icons on cards', fgSubtle, surface, 3),
    check('Faint text and icons on panels', fgSubtle, fill2, 3),
    check('Text on accent buttons', onAccent, accent, 4.5),
    check('Accent used as text', accentText, surface, textMin),
    check('Accent text on accent panels', accentText, accentSoft, textMin),
    check('Focus ring', focusRing, bg, 3),
    check('Input borders', lineStrong, surface, 3),
    check('Success text', success.text, surface, textMin),
    check('Success text on its panel', success.text, success.soft, textMin),
    check('Warning text', warning.text, surface, textMin),
    check('Warning text on its panel', warning.text, warning.soft, textMin),
    check('Danger text', danger.text, surface, textMin),
    check('Danger text on its panel', danger.text, danger.soft, textMin),
    check('Text on solid success buttons', bestOn(success.text), success.text, 4.5),
    check('Text on solid warning buttons', bestOn(warning.text), warning.text, 4.5),
    check('Text on solid danger buttons', bestOn(danger.text), danger.text, 4.5),
  ];
  if (high) checks.push(check('Borders', border, bg, 3));
  if (options.chartPalette !== 'colorblind') {
    charts.forEach((c, i) => checks.push(check(`Chart colour ${i + 1}`, c, surface, 3)));
  }

  return { vars, checks, passesAll: checks.every((c) => c.pass), adjustments };
}

/**
 * Tailwind v4 `@theme` block holding the default (AdLens Light) values. Paste it into src/index.css.
 * At runtime the ThemeProvider overrides the same variables on <html>, so utilities such as
 * bg-surface, text-fg, text-fg-muted, border-line, bg-accent, hover:bg-accent-hover, bg-accent-soft,
 * text-on-accent, text-accent-text, ring-focus, text-success/warning/danger follow the user's theme.
 */
export function tailwindThemeCss(vars: Record<string, string> = buildTheme(presetToOptions('adlens-light')).vars): string {
  const colorVars = Object.entries(vars).filter(([k]) => k.startsWith('--color-'));
  return `@theme {\n${colorVars.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;
}

/** CSS text for a variables map, e.g. ":root {\n  --color-page: #fff;\n}". */
export function themeToCss(vars: Record<string, string>, selector = ':root'): string {
  return `${selector} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;
}

/** "Fix it for me" for the accent picker: the closest accent that is readable as text and as a UI element. */
export function suggestAccentFix(accentInput: string, mode: Mode, contrast: ContrastLevel = 'standard') {
  const accent = normalizeHex(accentInput);
  if (!accent) return null;
  const surface = mode === 'light' ? '#ffffff' : oklchToHex(0.21, 0, 0);
  const asText = ensureContrast(accent, surface, contrast === 'high' ? 7 : 4.5);
  const asUi = ensureContrast(accent, surface, 3);
  return {
    accent,
    ratioOnSurface: Math.round(contrastRatio(accent, surface) * 100) / 100,
    readableAsText: !asText.changed,
    visibleAsUi: !asUi.changed,
    fixedForText: asText.hex,
    fixedForUi: asUi.hex,
  };
}

// ---------------------------------------------------------------------------
// Presets and saved settings
// ---------------------------------------------------------------------------

export type PresetId = 'adlens-light' | 'adlens-dark' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'high-contrast';

export const THEME_PRESETS: Record<PresetId, { label: string; mode: Mode; accent: string; tint: Tint; contrast: ContrastLevel }> = {
  'adlens-light': { label: 'AdLens Light', mode: 'light', accent: '#1d4ed8', tint: 'cool', contrast: 'standard' },
  'adlens-dark': { label: 'AdLens Dark', mode: 'dark', accent: '#3b82f6', tint: 'cool', contrast: 'standard' },
  midnight: { label: 'Midnight', mode: 'dark', accent: '#818cf8', tint: 'cool', contrast: 'standard' },
  ocean: { label: 'Ocean', mode: 'light', accent: '#0e7490', tint: 'cool', contrast: 'standard' },
  forest: { label: 'Forest', mode: 'light', accent: '#15803d', tint: 'warm', contrast: 'standard' },
  sunset: { label: 'Sunset', mode: 'light', accent: '#c2410c', tint: 'warm', contrast: 'standard' },
  'high-contrast': { label: 'High contrast', mode: 'light', accent: '#0033cc', tint: 'none', contrast: 'high' },
};

export const PRESET_IDS = Object.keys(THEME_PRESETS) as PresetId[];

export function presetToOptions(id: PresetId, overrides: Partial<ThemeOptions> = {}): ThemeOptions {
  const p = THEME_PRESETS[id];
  return { mode: p.mode, accent: p.accent, tint: p.tint, contrast: p.contrast, radius: 'default', density: 'comfortable', fontScale: 'default', chartPalette: 'default', ...overrides };
}

/** What is saved per user (Firestore `settings.appearance`). */
export interface AppearanceSettings {
  preset: PresetId | 'system' | 'custom';
  /** Used when preset is "custom". */
  custom: { mode: Mode; accent: string; tint: Tint };
  radius: Radius;
  density: Density;
  fontScale: FontScale;
  fontFamily: FontFamilyId;
  chartPalette: ChartPaletteId;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  preset: 'adlens-light',
  custom: { mode: 'light', accent: '#1d4ed8', tint: 'none' },
  radius: 'default',
  density: 'comfortable',
  fontScale: 'default',
  fontFamily: 'plus-jakarta',
  chartPalette: 'default',
};

/** Turns saved settings into theme options. "system" picks AdLens Light or Dark from the OS setting. */
export function resolveAppearance(a: AppearanceSettings, prefersDark: boolean): ThemeOptions {
  const common = { radius: a.radius, density: a.density, fontScale: a.fontScale, fontFamily: a.fontFamily, chartPalette: a.chartPalette };
  if (a.preset === 'custom') {
    return { ...common, mode: a.custom.mode, accent: a.custom.accent, tint: a.custom.tint, contrast: 'standard' };
  }
  const id: PresetId = a.preset === 'system' ? (prefersDark ? 'adlens-dark' : 'adlens-light') : a.preset;
  const p = THEME_PRESETS[id];
  return { ...common, mode: p.mode, accent: p.accent, tint: p.tint, contrast: p.contrast };
}

const ENUMS = {
  tint: ['none', 'cool', 'warm', 'accent'],
  mode: ['light', 'dark'],
  radius: ['sharp', 'default', 'round'],
  density: ['comfortable', 'compact'],
  fontScale: ['small', 'default', 'large', 'xlarge'],
  fontFamily: FONT_FAMILY_IDS,
  chartPalette: ['default', 'colorblind', 'monochrome', 'brand'],
} as const;

/** Validates anything read from storage or a form. Unknown or invalid values fall back to defaults. */
export function sanitizeAppearance(raw: unknown): { value: AppearanceSettings; errors: string[] } {
  const errors: string[] = [];
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof typeof ENUMS>(key: K, v: unknown, fallback: (typeof ENUMS)[K][number]): (typeof ENUMS)[K][number] => {
    if (v === undefined) return fallback;
    if ((ENUMS[key] as readonly unknown[]).includes(v)) return v as (typeof ENUMS)[K][number];
    errors.push(`Invalid ${key}`);
    return fallback;
  };

  let preset: AppearanceSettings['preset'] = DEFAULT_APPEARANCE.preset;
  if (r.preset !== undefined) {
    if (r.preset === 'system' || r.preset === 'custom' || PRESET_IDS.includes(r.preset as PresetId)) preset = r.preset as AppearanceSettings['preset'];
    else errors.push('Invalid preset');
  }
  const c = (typeof r.custom === 'object' && r.custom !== null ? r.custom : {}) as Record<string, unknown>;
  let accent = DEFAULT_APPEARANCE.custom.accent;
  if (c.accent !== undefined) {
    const n = normalizeHex(c.accent);
    if (n) accent = n;
    else errors.push('Invalid accent colour');
  }
  return {
    value: {
      preset,
      custom: { mode: pick('mode', c.mode, 'light'), accent, tint: pick('tint', c.tint, 'none') },
      radius: pick('radius', r.radius, 'default'),
      density: pick('density', r.density, 'comfortable'),
      fontScale: pick('fontScale', r.fontScale, 'default'),
      fontFamily: pick('fontFamily', r.fontFamily, 'plus-jakarta'),
      chartPalette: pick('chartPalette', r.chartPalette, 'default'),
    },
    errors,
  };
}
