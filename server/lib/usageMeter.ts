/**
 * Counts calls AdLens makes to the Google and Meta APIs, per day (Sprint 18).
 * Those quotas are shared by every user, so the owner needs to see how close the day is to the limit.
 * Best effort: a failing counter never breaks a request.
 */
import { getSharedStore, type KeyValueStore } from './sharedStore.js';

export type UsageProvider = 'ga4' | 'searchConsole' | 'meta' | 'google_other';
export const USAGE_PROVIDERS: UsageProvider[] = ['ga4', 'searchConsole', 'meta', 'google_other'];

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (provider: UsageProvider, now: Date) => `usage:${provider}:${now.toISOString().slice(0, 10)}`;

export async function countUpstream(provider: UsageProvider, opts: { store?: KeyValueStore; now?: Date } = {}): Promise<void> {
  try {
    await (opts.store ?? getSharedStore()).incr(dayKey(provider, opts.now ?? new Date()), 3 * DAY_MS);
  } catch {
    // by design
  }
}

export interface UsageDay { date: string; counts: Record<UsageProvider, number> }

/** Today and the previous days (newest first). */
export async function readUsage(days = 3, opts: { store?: KeyValueStore; now?: Date } = {}): Promise<UsageDay[]> {
  const store = opts.store ?? getSharedStore();
  const now = opts.now ?? new Date();
  const out: UsageDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const counts = {} as Record<UsageProvider, number>;
    for (const p of USAGE_PROVIDERS) {
      try {
        counts[p] = Number((await store.get(dayKey(p, d))) ?? 0) || 0;
      } catch {
        counts[p] = 0;
      }
    }
    out.push({ date: d.toISOString().slice(0, 10), counts });
  }
  return out;
}
