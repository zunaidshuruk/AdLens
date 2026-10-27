/** Date helpers for reports that compare two periods. Pure functions, UTC only. */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parse(d: string): number {
  if (!ISO.test(d)) throw new Error(`Invalid date: ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new Error(`Invalid date: ${d}`);
  return t;
}

function format(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

const DAY = 86_400_000;

/** Number of days in the range, inclusive. */
export function dayCount(startDate: string, endDate: string): number {
  return Math.round((parse(endDate) - parse(startDate)) / DAY) + 1;
}

/** The period of equal length that ends the day before `startDate`. */
export function previousPeriod(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const n = dayCount(startDate, endDate);
  const end = parse(startDate) - DAY;
  return { startDate: format(end - (n - 1) * DAY), endDate: format(end) };
}

/** The comparison period the user chose, or the previous period of equal length when none was chosen. */
export function comparisonPeriod(input: {
  startDate: string;
  endDate: string;
  compareStartDate?: string;
  compareEndDate?: string;
}): { startDate: string; endDate: string } {
  if (input.compareStartDate && input.compareEndDate) {
    return { startDate: input.compareStartDate, endDate: input.compareEndDate };
  }
  return previousPeriod(input.startDate, input.endDate);
}
