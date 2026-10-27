import { getSharedStore, type KeyValueStore } from './sharedStore.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

/** Fixed-window counter. `windowMs` windows are aligned to the clock so every instance agrees on where a window ends. */
export async function checkRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
  opts: { store?: KeyValueStore; now?: () => number } = {},
): Promise<RateLimitResult> {
  const store = opts.store ?? getSharedStore();
  const now = (opts.now ?? Date.now)();
  const windowIndex = Math.floor(now / windowMs);
  const used = await store.incr(`rl:${scope}:${key}:${windowIndex}`, windowMs + 1000);
  const resetMs = (windowIndex + 1) * windowMs - now;
  return { allowed: used <= limit, limit, remaining: Math.max(0, limit - used), retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)) };
}
