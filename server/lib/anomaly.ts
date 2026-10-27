/**
 * Spots an unusual day in a daily series (Sprint 18 alerts).
 *
 * The newest day is compared with the typical level of the days before it, using the median and the
 * median absolute deviation, which a single earlier spike cannot distort. To avoid noisy alerts a day is flagged only if:
 *  - there are at least `minBaselineDays` earlier days,
 *  - the typical daily volume is at least `minBaseline` (tiny numbers swing wildly),
 *  - the change is at least `minChangePercent`, and
 *  - the robust z-score is at least `zThreshold`.
 * When the same weekday appears in the baseline at least three times, that weekday's median is used (weekends differ from weekdays).
 */
export interface DailyPoint { date: string; value: number }

export interface Anomaly {
  date: string;
  value: number;
  baseline: number;
  changePercent: number;
  direction: 'up' | 'down';
}

export interface AnomalyOptions {
  minBaselineDays?: number;
  minBaseline?: number;
  minChangePercent?: number;
  zThreshold?: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export function detectLatestAnomaly(series: DailyPoint[], opts: AnomalyOptions = {}): Anomaly | null {
  const { minBaselineDays = 10, minBaseline = 20, minChangePercent = 30, zThreshold = 3.5 } = opts;
  const clean = series.filter((p) => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length < minBaselineDays + 1) return null;
  const latest = clean[clean.length - 1];
  const history = clean.slice(0, -1).slice(-28);
  if (history.length < minBaselineDays) return null;

  const sameDay = history.filter((p) => weekday(p.date) === weekday(latest.date)).map((p) => p.value);
  const pool = sameDay.length >= 3 ? sameDay : history.map((p) => p.value);
  const base = median(pool);
  if (base < minBaseline) return null;

  const mad = median(pool.map((v) => Math.abs(v - base)));
  // 1.4826 makes the MAD comparable to a standard deviation. The floor stops a perfectly flat history from flagging tiny moves.
  const spread = Math.max(1.4826 * mad, base * 0.05, 1);
  const z = Math.abs(latest.value - base) / spread;
  const changePercent = ((latest.value - base) / base) * 100;
  if (Math.abs(changePercent) < minChangePercent || z < zThreshold) return null;
  return { date: latest.date, value: latest.value, baseline: Math.round(base * 10) / 10, changePercent: Math.round(changePercent * 10) / 10, direction: latest.value > base ? 'up' : 'down' };
}
