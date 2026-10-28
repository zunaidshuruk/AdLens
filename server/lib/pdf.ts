/**
 * A small PDF writer (Sprint 37), no outside package: A4 pages, the built-in Helvetica fonts, text, lines, rectangles.
 * `snapshotToPdf` turns a dashboard or report snapshot into a readable document (numbers, tables, simple bar and line charts).
 * Limits: the built-in fonts cover Western European letters only; other characters print as "?".
 */
import { deflateSync } from 'node:zlib';
import { formatCell } from './snapshotFormat.js';
import type { Snapshot, SnapshotWidget } from './shares.js';

const W = 595.28;
const H = 841.89;
const MARGIN = 40;
const CONTENT_W = W - MARGIN * 2;

// Helvetica glyph widths for ASCII 32..126, in 1/1000 em.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) { const c = ch.codePointAt(0)!; w += c >= 32 && c <= 126 ? HELV[c - 32] : 556; }
  return (w / 1000) * size * (bold ? 1.07 : 1);
}

const CP1252: Record<number, number> = { 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0x20ac: 0x80, 0x2122: 0x99 };
/** Text as bytes the standard fonts can show (WinAnsi), with (, ) and \ escaped. */
export function pdfString(s: string): Buffer {
  const bytes: number[] = [];
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    let b: number;
    if (c === 0x0a || c === 0x0d || c === 0x09) b = 0x20;
    else if (c >= 32 && c < 127) b = c;
    else if (c >= 0xa0 && c <= 0xff) b = c;
    else b = CP1252[c] ?? 0x3f;
    if (b === 0x28 || b === 0x29 || b === 0x5c) bytes.push(0x5c);
    bytes.push(b);
  }
  return Buffer.from(bytes);
}

type RGB = [number, number, number];
const INK: RGB = [0.09, 0.1, 0.12];
const MUTED: RGB = [0.4, 0.42, 0.46];
const LINE: RGB = [0.85, 0.86, 0.88];
const ACCENT: RGB = [0.15, 0.39, 0.92];
const f = (n: number) => (Math.round(n * 100) / 100).toString();
const col = (c: RGB) => `${f(c[0])} ${f(c[1])} ${f(c[2])}`;

export class PdfDoc {
  private pages: Buffer[][] = [[]];
  y = H - MARGIN;
  private get ops() { return this.pages[this.pages.length - 1]; }
  private push(s: string | Buffer) { this.ops.push(Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')); }
  get pageCount() { return this.pages.length; }

  newPage() { this.pages.push([]); this.y = H - MARGIN; }
  ensure(height: number) { if (this.y - height < MARGIN + 24) this.newPage(); }

  text(x: number, y: number, s: string, size = 10, o: { bold?: boolean; color?: RGB; align?: 'left' | 'right' } = {}) {
    const xx = o.align === 'right' ? x - textWidth(s, size, o.bold) : x;
    this.push(`BT /${o.bold ? 'F2' : 'F1'} ${f(size)} Tf ${col(o.color ?? INK)} rg 1 0 0 1 ${f(xx)} ${f(y)} Tm (`);
    this.push(pdfString(s));
    this.push(') Tj ET\n');
  }
  line(x1: number, y1: number, x2: number, y2: number, color: RGB = LINE, width = 0.6) { this.push(`${col(color)} RG ${f(width)} w ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S\n`); }
  rect(x: number, y: number, w: number, h: number, color: RGB) { this.push(`${col(color)} rg ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f\n`); }
  polyline(points: [number, number][], color: RGB = ACCENT, width = 1.2) {
    if (points.length < 2) return;
    this.push(`${col(color)} RG ${f(width)} w ${f(points[0][0])} ${f(points[0][1])} m ${points.slice(1).map((p) => `${f(p[0])} ${f(p[1])} l`).join(' ')} S\n`);
  }

  /** Splits text into lines that fit `width`. Long unbroken words are cut. */
  wrap(s: string, size: number, width: number, bold = false): string[] {
    const out: string[] = [];
    for (const para of s.split(/\r?\n/)) {
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        let w = word;
        while (textWidth(w, size, bold) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > width) cut--;
          if (cur) { out.push(cur); cur = ''; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const next = cur ? `${cur} ${w}` : w;
        if (textWidth(next, size, bold) <= width) cur = next; else { if (cur) out.push(cur); cur = w; }
      }
      out.push(cur);
    }
    return out;
  }
  paragraph(s: string, size = 10, o: { bold?: boolean; color?: RGB; gap?: number } = {}) {
    const lh = size * 1.35;
    for (const ln of this.wrap(s, size, CONTENT_W, o.bold)) { this.ensure(lh); this.y -= lh; this.text(MARGIN, this.y, ln, size, o); }
    this.y -= o.gap ?? 0;
  }

  build(footer: string): Buffer {
    const total = this.pages.length;
    const objs: Buffer[] = [];
    const add = (b: Buffer | string) => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1')); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('PAGES');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids: number[] = [];
    this.pages.forEach((ops, i) => {
      const foot = Buffer.concat([
        Buffer.from(`BT /F1 8 Tf ${col(MUTED)} rg 1 0 0 1 ${f(MARGIN)} 24 Tm (`, 'latin1'), pdfString(footer), Buffer.from(`) Tj ET\nBT /F1 8 Tf ${col(MUTED)} rg 1 0 0 1 ${f(W - MARGIN - textWidth(`Page ${i + 1} of ${total}`, 8))} 24 Tm (Page ${i + 1} of ${total}) Tj ET\n`, 'latin1'),
      ]);
      const data = deflateSync(Buffer.concat([...ops, foot]));
      const stream = add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${stream} 0 R >>`));
    });
    objs[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets: number[] = [];
    let pos = parts[0].length;
    objs.forEach((o, i) => {
      offsets.push(pos);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(chunk);
      pos += chunk.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`), `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`].join('');
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}

const clip = (s: string, size: number, width: number, bold = false) => {
  if (textWidth(s, size, bold) <= width) return s;
  let t = s;
  while (t.length > 1 && textWidth(`${t}…`, size, bold) > width) t = t.slice(0, -1);
  return `${t}…`;
};

function renderWidget(doc: PdfDoc, w: SnapshotWidget) {
  doc.ensure(60);
  doc.y -= 6;
  doc.paragraph(w.title, 11, { bold: true, gap: 2 });
  if (w.kind === 'text') { doc.paragraph(w.text ?? '', 10, { color: MUTED, gap: 8 }); return; }
  const r = w.result;
  if (w.error || !r) { doc.paragraph('Could not load this panel.', 9, { color: MUTED, gap: 8 }); return; }
  const metric = r.columns.find((c) => c.role === 'metric');
  const dim = r.columns.find((c) => c.role === 'dimension');
  if ((w.kind === 'kpi' || w.kind === 'gauge') && metric) {
    const row = r.totals ?? r.rows[0];
    doc.ensure(40);
    doc.y -= 24;
    doc.text(MARGIN, doc.y, formatCell(row?.[metric.key], metric.type), 22, { bold: true });
    doc.y -= 12;
    doc.text(MARGIN, doc.y, metric.label, 9, { color: MUTED });
    doc.y -= 10;
    return;
  }
  if (r.rows.length === 0) { doc.paragraph('No data for these dates.', 9, { color: MUTED, gap: 8 }); return; }

  if (w.kind === 'line' && metric && dim && r.rows.length >= 2) {
    const h = 90;
    doc.ensure(h + 30);
    const top = doc.y - 6;
    const bottom = top - h;
    const vals = r.rows.map((x) => (typeof x[metric.key] === 'number' ? (x[metric.key] as number) : 0));
    const min = Math.min(0, ...vals);
    const max = Math.max(...vals, min + 1);
    const left = MARGIN + 46;
    const right = MARGIN + CONTENT_W;
    doc.line(left, bottom, right, bottom);
    doc.line(left, top, left, bottom);
    doc.text(left - 4, top - 6, formatCell(max, metric.type), 7, { color: MUTED, align: 'right' });
    doc.text(left - 4, bottom, formatCell(min, metric.type), 7, { color: MUTED, align: 'right' });
    doc.polyline(vals.map((v, i) => [left + ((right - left) * i) / (vals.length - 1), bottom + ((v - min) / (max - min)) * (h - 6)] as [number, number]));
    doc.text(left, bottom - 10, String(r.rows[0][dim.key] ?? ''), 7, { color: MUTED });
    doc.text(right, bottom - 10, String(r.rows[r.rows.length - 1][dim.key] ?? ''), 7, { color: MUTED, align: 'right' });
    doc.y = bottom - 16;
    return;
  }

  if ((w.kind === 'bar' || w.kind === 'pie') && metric && dim) {
    const rows = r.rows.slice(0, 10);
    const max = Math.max(1, ...rows.map((x) => (typeof x[metric.key] === 'number' ? (x[metric.key] as number) : 0)));
    const labelW = 150;
    const barMax = CONTENT_W - labelW - 70;
    for (const row of rows) {
      doc.ensure(14);
      doc.y -= 13;
      const v = typeof row[metric.key] === 'number' ? (row[metric.key] as number) : 0;
      doc.text(MARGIN, doc.y, clip(String(row[dim.key] ?? ''), 9, labelW - 8), 9);
      doc.rect(MARGIN + labelW, doc.y - 1, Math.max(1, (v / max) * barMax), 9, ACCENT);
      doc.text(MARGIN + labelW + Math.max(1, (v / max) * barMax) + 5, doc.y, formatCell(v, metric.type), 9, { color: MUTED });
    }
    doc.y -= 4;
    return;
  }

  // Tables (also used for charts that do not fit a page well: stacked, heat map).
  const cols = r.columns.slice(0, 6);
  const colW = CONTENT_W / cols.length;
  doc.ensure(28);
  doc.y -= 12;
  cols.forEach((c, i) => doc.text(c.role === 'metric' ? MARGIN + colW * (i + 1) - 6 : MARGIN + colW * i, doc.y, clip(c.label, 8, colW - 10, true), 8, { bold: true, color: MUTED, align: c.role === 'metric' ? 'right' : 'left' }));
  doc.y -= 3;
  doc.line(MARGIN, doc.y, MARGIN + CONTENT_W, doc.y);
  for (const row of r.rows.slice(0, 25)) {
    doc.ensure(14);
    doc.y -= 12;
    cols.forEach((c, i) => doc.text(c.role === 'metric' ? MARGIN + colW * (i + 1) - 6 : MARGIN + colW * i, doc.y, clip(formatCell(row[c.key], c.type), 9, colW - 10), 9, { align: c.role === 'metric' ? 'right' : 'left' }));
  }
  if (r.rows.length > 25) { doc.y -= 11; doc.text(MARGIN, doc.y, `Showing 25 of ${r.rows.length} rows.`, 8, { color: MUTED }); }
  doc.y -= 6;
}

export function snapshotToPdf(snap: Snapshot, projectName?: string): Buffer {
  const doc = new PdfDoc();
  doc.y -= 18;
  doc.text(MARGIN, doc.y, snap.title, 18, { bold: true });
  doc.y -= 8;
  doc.paragraph(`${projectName ? `${projectName} · ` : ''}${snap.range.startDate} to ${snap.range.endDate}`, 9, { color: MUTED });
  if (snap.description) doc.paragraph(snap.description, 10, { color: MUTED });
  doc.y -= 4;
  doc.line(MARGIN, doc.y, MARGIN + CONTENT_W, doc.y);
  const widgets = [...snap.widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  for (const w of widgets) renderWidget(doc, w);
  return doc.build(`AdLens · saved ${snap.generatedAt.slice(0, 10)}`);
}
