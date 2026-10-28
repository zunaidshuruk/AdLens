/**
 * Fonts for scripts the built-in PDF fonts cannot show (Sprint 38): Bengali and Devanagari (Hindi, Nepali).
 * Uses the open-licence Noto Sans fonts in server/assets/fonts. HarfBuzz (the same engine browsers use) does the letter joining
 * (conjuncts, vowel signs, marks); fontkit trims the font down to the glyphs used.
 * If a font file is missing the text falls back to "?" instead of failing.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import * as hb from 'harfbuzzjs';

export type Script = 'bn' | 'dv';
export interface Segment { script: Script | null; text: string }

const FILES: Record<Script, { regular: string; bold: string }> = {
  bn: { regular: 'NotoSansBengali-Regular.ttf', bold: 'NotoSansBengali-Bold.ttf' },
  dv: { regular: 'NotoSansDevanagari-Regular.ttf', bold: 'NotoSansDevanagari-Bold.ttf' },
};

let fontDir: string | null | undefined;
function findFontDir(): string | null {
  if (fontDir !== undefined) return fontDir;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, '../assets/fonts'), path.join(here, 'assets/fonts'), path.join(process.cwd(), 'server/assets/fonts'), path.join(process.cwd(), 'dist-server/assets/fonts')];
  fontDir = candidates.find((d) => existsSync(path.join(d, FILES.bn.regular))) ?? null;
  return fontDir;
}

const cache = new Map<string, fontkit.Font | null>();
const hbFonts = new Map<string, hb.Font>();
export function loadScriptFont(script: Script, bold: boolean): fontkit.Font | null {
  const key = `${script}${bold ? 'b' : 'r'}`;
  if (cache.has(key)) return cache.get(key)!;
  let font: fontkit.Font | null = null;
  try {
    const dir = findFontDir();
    if (dir) {
      const file = path.join(dir, bold ? FILES[script].bold : FILES[script].regular);
      if (existsSync(file)) {
        const data = readFileSync(file);
        font = fontkit.create(data) as fontkit.Font;
        hbFonts.set(key, new hb.Font(new hb.Face(new hb.Blob(data))));
      }
    }
  } catch { font = null; hbFonts.delete(key); }
  cache.set(key, font);
  return font;
}

const scriptOf = (c: number): Script | null => (c >= 0x980 && c <= 0x9ff ? 'bn' : (c >= 0x900 && c <= 0x97f) || (c >= 0xa8e0 && c <= 0xa8ff) ? 'dv' : null);
const NEUTRAL = /^[\s.,;:!?()\-–—'"“”‘’%/]*$/;

/** Splits text into runs by script. Spaces and punctuation between two words of one script stay with that script. */
export function splitScripts(s: string): Segment[] {
  const runs: Segment[] = [];
  let prev: Script | null = null;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    let sc: Script | null = scriptOf(c);
    if (c === 0x964 || c === 0x965) sc = prev ?? 'dv'; // danda: follows the surrounding script
    else if ((c === 0x200c || c === 0x200d) && prev) sc = prev;
    if (sc && !loadScriptFont(sc, false)) sc = null;
    prev = sc ?? (NEUTRAL.test(ch) ? prev : null);
    const last = runs[runs.length - 1];
    if (last && last.script === sc) last.text += ch; else runs.push({ script: sc, text: ch });
  }
  for (let i = 1; i < runs.length - 1; i++) {
    if (runs[i].script === null && runs[i - 1].script && runs[i - 1].script === runs[i + 1].script && NEUTRAL.test(runs[i].text)) runs[i].script = runs[i - 1].script;
  }
  const out: Segment[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.script === r.script) last.text += r.text; else out.push({ ...r });
  }
  return out;
}

export interface ShapedGlyph { id: number; /** the glyph's normal advance */ nominal: number; xAdvance: number; xOffset: number; yOffset: number; codePoints: number[] }
export interface Shaped { unitsPerEm: number; glyphs: ShapedGlyph[]; widthUnits: number }

const shapeCache = new Map<string, Shaped>();
export function shapeText(script: Script, bold: boolean, text: string): Shaped | null {
  const font = loadScriptFont(script, bold);
  const key = `${script}${bold ? 'b' : 'r'}`;
  const hbFont = hbFonts.get(key);
  if (!font || !hbFont) return null;
  const ck = `${key}|${text}`;
  const hit = shapeCache.get(ck);
  if (hit) return hit;
  const buf = new hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  hb.shape(hbFont, buf);
  const infos = buf.getGlyphInfos();
  const pos = buf.getGlyphPositions();
  // The text each glyph stands for (for copy and search): from its cluster start to the next cluster start.
  const starts = [...new Set(infos.map((i) => i.cluster))].sort((a, b) => a - b);
  const seen = new Set<number>();
  let widthUnits = 0;
  const glyphs = infos.map((info, i) => {
    widthUnits += pos[i].xAdvance;
    let codePoints: number[] = [];
    if (!seen.has(info.cluster)) {
      seen.add(info.cluster);
      const next = starts[starts.indexOf(info.cluster) + 1] ?? text.length;
      codePoints = Array.from(text.slice(info.cluster, next), (c) => c.codePointAt(0)!);
    }
    return { id: info.codepoint, nominal: font.getGlyph(info.codepoint).advanceWidth, xAdvance: pos[i].xAdvance, xOffset: pos[i].xOffset, yOffset: pos[i].yOffset, codePoints };
  });
  const shaped = { unitsPerEm: font.unitsPerEm, glyphs, widthUnits };
  if (shapeCache.size > 4000) shapeCache.clear();
  shapeCache.set(ck, shaped);
  return shaped;
}
