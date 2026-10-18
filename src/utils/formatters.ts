import type { CurrencyCode } from '../types/index.ts';

export const USD_TO_BDT_RATE = 120;

export function convertCurrencyFromUsd(amountUsd: number, currency: CurrencyCode): number {
  return currency === 'BDT' ? amountUsd * USD_TO_BDT_RATE : amountUsd;
}

export function getCurrencySymbol(currency: CurrencyCode): string {
  return currency === 'BDT' ? '৳' : '$';
}

export function formatNumber(value: number, decimals: number = 0): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatCurrency(
  amountUsd: number,
  currency: CurrencyCode = 'BDT',
  decimals?: number
): string {
  const converted = convertCurrencyFromUsd(amountUsd, currency);
  const symbol = getCurrencySymbol(currency);
  // For BDT, whole numbers for large figures (>= 100), 2 decimals for small unit costs like CPC
  const resolvedDecimals =
    decimals !== undefined
      ? decimals
      : currency === 'BDT'
        ? Math.abs(converted) < 100 && converted !== 0
          ? 1
          : 0
        : Math.abs(converted) < 100 && converted !== 0
          ? 2
          : 0;
  return `${symbol}${formatNumber(converted, resolvedDecimals)}`;
}

export function formatPercent(value: number, decimals: number = 1): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(decimals)}%`;
}

export function formatSignedPercent(value: number, decimals: number = 1): string {
  if (!Number.isFinite(value)) return '0.0%';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatDurationSeconds(seconds: number): string {
  const totalSec = Math.max(0, Math.round(seconds));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function calculatePercentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

/**
 * Determines whether a metric delta is positive ("good"), negative ("bad"), or neutral.
 * When invertPolarity is true (for cost metrics like CPC, CPM, CPL, or rank position),
 * a decrease (< 0) is an improvement (green) and an increase (> 0) is a decline (red).
 */
export function evaluateChangeSentiment(
  changePercent: number,
  invertPolarity: boolean = false
): 'positive' | 'negative' | 'neutral' {
  if (Math.abs(changePercent) < 0.05) return 'neutral';
  if (invertPolarity) {
    return changePercent < 0 ? 'positive' : 'negative';
  }
  return changePercent > 0 ? 'positive' : 'negative';
}

export function exportRowsToCsv<T extends Record<string, unknown>>(
  tableName: string,
  columns: { key: keyof T; header: string; format?: (val: unknown, row: T) => string }[],
  rows: T[],
  prefix: string = 'adlens_'
): string {
  const sanitizedName = tableName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const filename = `${prefix}${sanitizedName}.csv`;

  const escapeCsvCell = (cell: string): string => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };

  const headerLine = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns
      .map((col) => {
        const raw = row[col.key];
        const formatted = col.format ? col.format(raw, row) : String(raw ?? '');
        return escapeCsvCell(formatted);
      })
      .join(',')
  );

  const csvContent = [headerLine, ...dataLines].join('\n');

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return filename;
}
