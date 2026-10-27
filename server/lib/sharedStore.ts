/**
 * A small key-value store with expiry, used for caching and rate limits (Sprint 18).
 *
 * - In memory: one copy per server instance (default; fine for one instance).
 * - Upstash Redis over its REST address (no extra package): one shared copy for every instance. Used when
 *   UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
 *
 * The Google and Meta quotas are shared by every AdLens user, so a cache that all instances see matters once there is more than one.
 * If the shared store is unreachable the code falls back to memory instead of failing the request.
 */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Adds 1 and returns the new count. The expiry is set when the counter is created, so a window never extends itself. */
  incr(key: string, ttlMs: number): Promise<number>;
}

export function createMemoryStore(now: () => number = () => Date.now(), maxEntries = 5000): KeyValueStore & { size(): number } {
  const map = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const e = map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= now()) {
      map.delete(key);
      return undefined;
    }
    return e;
  };
  const trim = () => {
    if (map.size <= maxEntries) return;
    for (const [k, e] of map) {
      if (e.expiresAt <= now()) map.delete(k);
    }
    // still too big: drop the oldest inserted
    while (map.size > maxEntries) map.delete(map.keys().next().value as string);
  };
  return {
    size: () => map.size,
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, ttlMs) {
      map.delete(key);
      map.set(key, { value, expiresAt: now() + ttlMs });
      trim();
    },
    async del(key) {
      map.delete(key);
    },
    async incr(key, ttlMs) {
      const e = live(key);
      if (!e) {
        map.set(key, { value: '1', expiresAt: now() + ttlMs });
        trim();
        return 1;
      }
      const n = Number(e.value) + 1;
      e.value = String(n);
      return n;
    },
  };
}

interface UpstashOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createUpstashStore(opts: UpstashOptions): KeyValueStore {
  const base = opts.url.replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const call = async (commands: (string | number)[][]): Promise<unknown[]> => {
    const resp = await doFetch(`${base}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
    });
    if (!resp.ok) throw new Error(`Shared store error ${resp.status}`);
    const body = (await resp.json()) as { result?: unknown; error?: string }[];
    return body.map((r) => {
      if (r.error) throw new Error('Shared store command failed');
      return r.result;
    });
  };
  return {
    async get(key) {
      const [r] = await call([['GET', key]]);
      return typeof r === 'string' ? r : null;
    },
    async set(key, value, ttlMs) {
      await call([['SET', key, value, 'PX', Math.max(1, Math.round(ttlMs))]]);
    },
    async del(key) {
      await call([['DEL', key]]);
    },
    async incr(key, ttlMs) {
      const [n] = await call([['INCR', key], ['PEXPIRE', key, Math.max(1, Math.round(ttlMs)), 'NX']]);
      return Number(n);
    },
  };
}

/** Tries the shared store first and uses memory when it fails, so an outage never breaks a request. */
export function withFallback(primary: KeyValueStore, fallback: KeyValueStore, onError?: (err: unknown) => void): KeyValueStore {
  const guard = async <T>(run: (s: KeyValueStore) => Promise<T>): Promise<T> => {
    try {
      return await run(primary);
    } catch (err) {
      onError?.(err);
      return run(fallback);
    }
  };
  return {
    get: (k) => guard((s) => s.get(k)),
    set: (k, v, t) => guard((s) => s.set(k, v, t)),
    del: (k) => guard((s) => s.del(k)),
    incr: (k, t) => guard((s) => s.incr(k, t)),
  };
}

let current: KeyValueStore | null = null;
let lastEnvKey = '';

function envKeyOf(env: Record<string, string | undefined>): string {
  return `${(env.UPSTASH_REDIS_REST_URL ?? '').trim()}|${(env.UPSTASH_REDIS_REST_TOKEN ?? '').trim() ? 'T' : ''}`;
}

/** The store for this process. Rebuilt if the Upstash settings change. */
export function getSharedStore(env: Record<string, string | undefined> = process.env): KeyValueStore {
  const envKey = envKeyOf(env);
  if (!current || envKey !== lastEnvKey) {
    const url = (env.UPSTASH_REDIS_REST_URL ?? '').trim();
    const token = (env.UPSTASH_REDIS_REST_TOKEN ?? '').trim();
    const memory = createMemoryStore();
    current = url && token ? withFallback(createUpstashStore({ url, token }), memory, () => console.warn('[shared-store] unreachable, using memory')) : memory;
    lastEnvKey = envKey;
  }
  return current;
}

/** Tests install a store here; pass null to go back to the normal choice. */
export function setTestSharedStore(store: KeyValueStore | null): void {
  current = store;
  lastEnvKey = envKeyOf(process.env);
}
