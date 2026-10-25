/**
 * Colour shift report (Sprint 8): how far the new theme roles are from the hard-coded colours they replace,
 * weighted by how often each mapping is used in the app. Run it before applying the migration:
 *
 *   npx tsx scripts/color-shift-report.ts [folder]      (default folder: src)
 *
 * Distances are OKLab: about 0.02 is barely visible, 0.10 or more is clearly different. The Tailwind
 * palette below is the standard one; the app's own palette is within a hair of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { migrateSource } from './colorMigration.js';
import { buildTheme, hexToOklch, presetToOptions } from '../src/utils/themeEngine.js';

// Tailwind v3 palette (v4 uses near-identical OKLCH versions)
const P: Record<string, string> = {
  white: '#ffffff', black: '#000000',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',
  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe', 'blue-300': '#93c5fd', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af', 'blue-900': '#1e3a8a', 'blue-950': '#172554',
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca', 'red-300': '#fca5a5', 'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626', 'red-700': '#b91c1c', 'red-800': '#991b1b', 'red-900': '#7f1d1d', 'red-950': '#450a0a',
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-200': '#a7f3d0', 'emerald-300': '#6ee7b7', 'emerald-400': '#34d399', 'emerald-500': '#10b981', 'emerald-600': '#059669', 'emerald-700': '#047857', 'emerald-800': '#065f46', 'emerald-900': '#064e3b', 'emerald-950': '#022c22',
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a', 'amber-300': '#fcd34d', 'amber-400': '#fbbf24', 'amber-500': '#f59e0b', 'amber-600': '#d97706', 'amber-700': '#b45309', 'amber-800': '#92400e', 'amber-900': '#78350f', 'amber-950': '#451a03',
};
const light = buildTheme(presetToOptions('adlens-light')).vars;
const dark = buildTheme(presetToOptions('adlens-dark')).vars;
const lab = (hex: string) => { const { L, C, h } = hexToOklch(hex); const r = (h * Math.PI) / 180; return [L, C * Math.cos(r), C * Math.sin(r)]; };
const dist = (a: string, b: string) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const usage = new Map<string, { n: number; info: { light: string; dark: string | null; role: string } }>();
for (const f of walk(process.argv[2] ?? 'src').filter((f) => /\.tsx$/.test(f))) migrateSource(fs.readFileSync(f, 'utf8'), (m) => { const k = `${m.light}|${m.dark}|${m.role}`; const u = usage.get(k) ?? { n: 0, info: m }; u.n++; usage.set(k, u); });
let tot = 0, wsum = 0, under = 0; const contrib: { k: string; n: number; dLight: number; dDark: number | null }[] = [];
for (const [k, u] of usage) {
  const rv = `--color-${u.info.role}`; const dl = P[u.info.light] ? dist(P[u.info.light], light[rv]) : null; const dd = u.info.dark && P[u.info.dark] ? dist(P[u.info.dark], dark[rv]) : null;
  const e = [dl, dd].filter((x): x is number => x !== null); if (!e.length) continue;
  const m = Math.max(...e); tot += u.n; wsum += u.n * m; if (m < 0.06) under += u.n; contrib.push({ k, n: u.n, dLight: dl ?? -1, dDark: dd });
}
console.log(`\nUSAGE-WEIGHTED over ${tot} real conversions: mean dE=${(wsum / tot).toFixed(3)}; ${Math.round((100 * under) / tot)}% of usages shift by less than 0.06`);
console.log('largest contributors (count x shift):');
for (const c of contrib.sort((a, b) => b.n * Math.max(b.dLight, b.dDark ?? 0) - a.n * Math.max(a.dLight, a.dDark ?? 0)).slice(0, 14)) console.log(`${String(c.n).padStart(4)}x  ${c.k.padEnd(34)} light dE=${c.dLight.toFixed(3)}  dark dE=${c.dDark === null ? '-' : c.dDark.toFixed(3)}`);
