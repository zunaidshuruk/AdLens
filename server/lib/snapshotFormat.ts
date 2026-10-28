import type { ExploreCell } from './exploreSpec.js';

/** Plain-text form of one table cell, shared by emails and PDFs. */
export function formatCell(v: ExploreCell | undefined, type: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '—';
  if (type === 'percent') return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  if (type === 'seconds') { const s = Math.round(v); return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; }
  if (type === 'decimal' || type === 'position') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
