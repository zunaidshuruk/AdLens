/**
 * Protection against floods and slow attacks (DDoS hardening, 27 Oct 2026).
 *
 * Layers, all inside each server copy (so no external service is needed and a flood on one copy cannot starve the others):
 *  1. Per-address request budget (API and static files separately), IPv6 grouped by /64 so rotating addresses inside one network does not help.
 *  2. Address-level brake for repeated bad sign-in tokens (stops token guessing and the CPU spent on checking junk tokens).
 *  3. Per-person budget once signed in (see checkUserBudget, called from requireUser).
 *  4. Cap on requests being handled at once, and a deadline for each, so slow or hung requests cannot pile up.
 * Health checks are never refused. The numbers can be changed with environment variables (see docs/OPERATIONS.md).
 */
import type { NextFunction, Request, Response } from 'express';

interface Counter { n: number; resetAt: number }

export interface Limiter {
  /** Adds one and tells whether the key is within `limit`. */
  hit(key: string, limit: number, windowMs: number, now?: number): { allowed: boolean; retryAfterSeconds: number };
  peek(key: string, now?: number): number;
  size(): number;
  clear(): void;
}

/** Fixed-window counters in memory, bounded so that a flood of different keys cannot grow it without limit. */
export function createLimiter(maxKeys = 100_000): Limiter {
  const map = new Map<string, Counter>();
  const sweep = (now: number) => { for (const [k, c] of map) if (c.resetAt <= now) map.delete(k); };
  return {
    hit(key, limit, windowMs, now = Date.now()) {
      let c = map.get(key);
      if (!c || c.resetAt <= now) {
        if (map.size >= maxKeys) { sweep(now); if (map.size >= maxKeys) map.clear(); }
        c = { n: 0, resetAt: now + windowMs };
        map.set(key, c);
      }
      c.n += 1;
      return { allowed: c.n <= limit, retryAfterSeconds: Math.max(1, Math.ceil((c.resetAt - now) / 1000)) };
    },
    peek(key, now = Date.now()) { const c = map.get(key); return c && c.resetAt > now ? c.n : 0; },
    size: () => map.size,
    clear: () => map.clear(),
  };
}

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };

export const LIMITS = () => ({
  apiPerIpPerMin: num(process.env.RATE_LIMIT_IP_PER_MIN, 1200),
  staticPerIpPerMin: num(process.env.RATE_LIMIT_STATIC_PER_MIN, 3000),
  userPerMin: num(process.env.RATE_LIMIT_USER_PER_MIN, 300),
  badTokensPerIpPerMin: num(process.env.RATE_LIMIT_BAD_TOKEN_PER_MIN, 40),
  maxInFlight: num(process.env.MAX_IN_FLIGHT_REQUESTS, 500),
  deadlineSeconds: num(process.env.REQUEST_DEADLINE_SECONDS, 55),
  longDeadlineSeconds: num(process.env.REQUEST_LONG_DEADLINE_SECONDS, 120),
});

const ipLimiter = createLimiter();
const userLimiter = createLimiter();
const badTokenLimiter = createLimiter();

export function resetProtectionState(): void {
  ipLimiter.clear(); userLimiter.clear(); badTokenLimiter.clear(); inFlight = 0;
}

/** The address a request counts against. IPv6 is grouped by its first 64 bits. */
export function ipKey(ip: string | undefined): string {
  const raw = (ip ?? 'unknown').replace(/^::ffff:/, '');
  if (!raw.includes(':')) return raw;
  const groups = raw.split(':');
  return groups.slice(0, 4).join(':');
}

const isApiPath = (p: string) => p === '/mcp' || p.startsWith('/mcp/') || p.startsWith('/api/') || p === '/api' || p.startsWith('/oauth/') || p.startsWith('/.well-known/');
const isHealth = (p: string) => p === '/api/health' || p === '/api/ops/ready';

function tooMany(res: Response, retryAfterSeconds: number, message = 'Too many requests. Please slow down and try again in a moment.'): void {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message } });
}

/** 1 + 2: per-address budget and the brake for repeated bad tokens. */
export function ipProtection(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;
  const lim = LIMITS();
  const ip = ipKey(req.ip);
  const api = isApiPath(path);

  if (!isHealth(path)) {
    const r = ipLimiter.hit(`${api ? 'a' : 's'}:${ip}`, api ? lim.apiPerIpPerMin : lim.staticPerIpPerMin, 60_000);
    if (!r.allowed) return tooMany(res, r.retryAfterSeconds);
  }

  if (api) {
    if (badTokenLimiter.peek(ip) >= lim.badTokensPerIpPerMin) {
      return tooMany(res, 60, 'Too many failed sign-in attempts from this address. Please wait a minute.');
    }
    res.on('finish', () => {
      if (res.statusCode === 401 && req.headers.authorization) badTokenLimiter.hit(ip, lim.badTokensPerIpPerMin, 60_000);
    });
  }
  next();
}

/** 3: called by requireUser once the person is known. Returns false (and answers 429) when they are over budget. */
export function checkUserBudget(uid: string, res: Response): boolean {
  const r = userLimiter.hit(uid, LIMITS().userPerMin, 60_000);
  if (r.allowed) return true;
  tooMany(res, r.retryAfterSeconds);
  return false;
}

let inFlight = 0;
export const inFlightNow = () => inFlight;

/** 4: cap on simultaneous API requests, and a deadline for each. Answers 503/504 instead of letting work pile up. */
export function loadProtection(req: Request, res: Response, next: NextFunction): void {
  if (!isApiPath(req.path) || isHealth(req.path)) return next();
  const lim = LIMITS();
  if (inFlight >= lim.maxInFlight) {
    res.setHeader('Retry-After', '5');
    res.status(503).json({ error: { code: 'SERVER_BUSY', message: 'AdLens is very busy right now. Please try again in a few seconds.' } });
    return;
  }
  inFlight += 1;
  const long = req.path.startsWith('/api/ai') || req.path.startsWith('/api/agents') || req.path.startsWith('/mcp');
  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: { code: 'REQUEST_TIMEOUT', message: 'This took too long. Please try again.' } });
  }, (long ? lim.longDeadlineSeconds : lim.deadlineSeconds) * 1000);
  timer.unref();
  let done = false;
  const release = () => { if (done) return; done = true; clearTimeout(timer); inFlight = Math.max(0, inFlight - 1); };
  res.on('finish', release);
  res.on('close', release);
  next();
}

/** 5: slow-attack limits on the connection itself (slowloris: opening many connections and sending a few bytes at a time). */
export function hardenServer(server: import('http').Server): void {
  server.headersTimeout = 15_000;      // the whole header block must arrive within 15 s
  server.requestTimeout = 130_000;     // the whole request (incl. body) within ~2 min
  server.keepAliveTimeout = 65_000;    // longer than common load balancers (60 s) so they never reuse a closed socket
  server.maxHeadersCount = 100;
  server.maxRequestsPerSocket = 1000;
}

/** Options for http.createServer: how often Node checks the timeouts above (its default, 30 s, is too slow to cut off slow attackers). */
export const SERVER_OPTIONS = { connectionsCheckingInterval: 5_000 } as const;
