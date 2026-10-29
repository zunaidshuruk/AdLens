/** How often a scheduled email goes out: every day, on chosen weekdays, on a day of the month, or every few days. Pure, so it is easy to test. */
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'interval';
export interface FrequencyFields { frequency: Frequency; weekdays?: number[]; monthDay?: number; intervalDays?: number }

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number): string => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`; };
const list = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** Weekdays in Monday-first order, without repeats or invalid numbers. Empty falls back to Monday (old schedules had no choice). */
export const cleanWeekdays = (w: number[] | undefined): number[] => { const s = [...new Set((w ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]; return (s.length ? s : [1]).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); };

/** A plain-words description, for example "every Monday and Thursday", "on the 15th of every month", "every 3 days". */
export function frequencyLabel(f: FrequencyFields): string {
  if (f.frequency === 'daily') return 'every day';
  if (f.frequency === 'interval') { const n = f.intervalDays ?? 7; return n === 1 ? 'every day' : `every ${n} days`; }
  if (f.frequency === 'monthly') { const d = f.monthDay ?? 1; return d >= 31 ? 'on the last day of every month' : `on the ${ordinal(d)} of every month`; }
  const days = cleanWeekdays(f.weekdays);
  if (days.length === 7) return 'every day';
  return `every ${list(days.map((d) => DAY_NAMES[d]!))}`;
}
/** One word for the email subject: "daily", "weekly", "monthly" or "every 3 days". */
export const frequencyShort = (f: FrequencyFields): string => (f.frequency === 'daily' ? 'daily' : f.frequency === 'weekly' ? (cleanWeekdays(f.weekdays).length === 7 ? 'daily' : 'weekly') : f.frequency === 'monthly' ? 'monthly' : (f.intervalDays ?? 7) === 1 ? 'daily' : `every ${f.intervalDays ?? 7} days`);

const dayNumber = (d: Date): number => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
const lastDayOf = (d: Date): number => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

/** Is an email due on this day (UTC)? At most one email a day. A month shorter than the chosen day uses its last day. */
export function dueToday(f: FrequencyFields & { lastSentAt?: string | undefined }, now: Date): boolean {
  const today = now.toISOString().slice(0, 10);
  if (f.lastSentAt?.slice(0, 10) === today) return false;
  switch (f.frequency) {
    case 'daily': return true;
    case 'weekly': return cleanWeekdays(f.weekdays).includes(now.getUTCDay());
    case 'monthly': return now.getUTCDate() === Math.min(f.monthDay ?? 1, lastDayOf(now)) && f.lastSentAt?.slice(0, 7) !== today.slice(0, 7);
    case 'interval': {
      const n = Math.max(1, f.intervalDays ?? 7);
      if (!f.lastSentAt) return true;
      const last = new Date(f.lastSentAt);
      return Number.isNaN(last.getTime()) ? true : dayNumber(now) - dayNumber(last) >= n;
    }
  }
}
