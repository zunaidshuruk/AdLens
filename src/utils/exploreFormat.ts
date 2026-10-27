import type { ExploreCell, ExploreColumnType } from '../types/explore.js';

/** How a table cell is shown on screen. */
export function formatExploreCell(value: ExploreCell | undefined, type: ExploreColumnType): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';
  switch (type) {
    case 'percent': return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'seconds': return formatDuration(value);
    case 'decimal':
    case 'position': return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    default: return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}
