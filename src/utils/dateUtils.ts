import type { ComputedDateRange, CustomDateInput, DatePreset } from '../types/index.js';

export const DATE_PRESETS: DatePreset[] = [
  'Today',
  'Last 7 days',
  'Last 28 days',
  'Last 90 days',
  'This month',
  'Last month',
  'Custom',
];

export const SUPPORTED_TIMEZONES = [
  { value: 'Asia/Dhaka', label: 'Asia/Dhaka (BST, UTC+6)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'America/New_York (ET)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, UTC+8)' },
] as const;

/**
 * Returns YYYY-MM-DD in the given IANA timezone using Intl.DateTimeFormat.
 */
export function getTodayInTimezone(timezone: string = 'Asia/Dhaka', referenceDate: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(referenceDate);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function parseIsoDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function formatIsoDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, offsetDays: number): string {
  const dt = parseIsoDateUTC(dateStr);
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return formatIsoDateUTC(dt);
}

export function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = parseIsoDateUTC(startDate).getTime();
  const end = parseIsoDateUTC(endDate).getTime();
  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays + 1);
}

export function enumerateDates(startDate: string, endDate: string): string[] {
  const count = daysBetweenInclusive(startDate, endDate);
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(addDays(startDate, i));
  }
  return dates;
}

/**
 * Computes startDate, endDate, compareStartDate, and compareEndDate in the given timezone.
 * Every preset (including Custom) returns compareStartDate and compareEndDate with the exact
 * same number of days immediately preceding startDate.
 */
export function computeDateRange(
  preset: DatePreset,
  timezone: string = 'Asia/Dhaka',
  custom?: CustomDateInput,
  referenceDate: Date = new Date(),
  compareEnabled: boolean = true
): ComputedDateRange {
  const today = getTodayInTimezone(timezone, referenceDate);
  let startDate = today;
  let endDate = today;

  switch (preset) {
    case 'Today': {
      startDate = today;
      endDate = today;
      break;
    }
    case 'Last 7 days': {
      endDate = today;
      startDate = addDays(today, -6);
      break;
    }
    case 'Last 28 days': {
      endDate = today;
      startDate = addDays(today, -27);
      break;
    }
    case 'Last 90 days': {
      endDate = today;
      startDate = addDays(today, -89);
      break;
    }
    case 'This month': {
      const [y, m] = today.split('-');
      startDate = `${y}-${m}-01`;
      endDate = today;
      break;
    }
    case 'Last month': {
      const [y, m] = today.split('-').map(Number);
      const firstOfThisMonth = new Date(Date.UTC(y, m - 1, 1));
      const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
      const firstOfPrevMonth = new Date(
        Date.UTC(lastOfPrevMonth.getUTCFullYear(), lastOfPrevMonth.getUTCMonth(), 1)
      );
      startDate = formatIsoDateUTC(firstOfPrevMonth);
      endDate = formatIsoDateUTC(lastOfPrevMonth);
      break;
    }
    case 'Custom': {
      if (custom?.startDate && custom?.endDate) {
        if (custom.startDate <= custom.endDate) {
          startDate = custom.startDate;
          endDate = custom.endDate;
        } else {
          startDate = custom.endDate;
          endDate = custom.startDate;
        }
      } else {
        endDate = today;
        startDate = addDays(today, -6);
      }
      break;
    }
  }

  const dayCount = daysBetweenInclusive(startDate, endDate);
  const compareEndDate = addDays(startDate, -1);
  const compareStartDate = addDays(compareEndDate, -(dayCount - 1));

  return {
    preset,
    timezone,
    startDate,
    endDate,
    compareStartDate,
    compareEndDate,
    dayCount,
    compareEnabled,
  };
}

export function formatShortDate(dateStr: string): string {
  const dt = parseIsoDateUTC(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatFullDateRange(startDate: string, endDate: string): string {
  const s = parseIsoDateUTC(startDate);
  const e = parseIsoDateUTC(endDate);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const fmtStart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(s);
  const fmtEnd = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(e);
  return startDate === endDate ? fmtEnd : `${fmtStart} – ${fmtEnd}`;
}
