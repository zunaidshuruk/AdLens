/**
 * Response cache for the Google and Meta data routes (Sprint 18), kept in the shared store so
 * every server instance sees the same entries (one copy in memory by default, Upstash when configured).
 * "Clearing" a namespace bumps its epoch, so old entries are simply never read again and expire on their own.
 */
import { getSharedStore } from './sharedStore.js';

const epochs = new Map<string, number>();
const epochOf = (ns: string) => epochs.get(ns) ?? 0;

const fullKey = (ns: string, key: string) => `cache:${ns}:${epochOf(ns)}:${key}`;

export async function cacheGet<T>(ns: string, key: string): Promise<T | null> {
  try {
    const raw = await getSharedStore().get(fullKey(ns, key));
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export async function cacheSet(ns: string, key: string, data: unknown, ttlMs: number): Promise<void> {
  try {
    await getSharedStore().set(fullKey(ns, key), JSON.stringify(data), ttlMs);
  } catch {
    // A cache that cannot be written is not worth failing the request for.
  }
}

export function cacheClear(ns: string): void {
  epochs.set(ns, epochOf(ns) + 1);
}
