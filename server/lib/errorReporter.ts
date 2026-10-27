/**
 * Error alerts (Sprint 18). When ERROR_WEBHOOK_URL is set (a Slack, Discord or Teams "incoming webhook"),
 * unexpected server errors are posted there so the owner hears about them before users complain.
 *
 * - No new package: a plain fetch.
 * - The same error is sent at most once every 5 minutes (counted in the shared store), so a loop cannot flood the channel.
 * - Tokens, keys and long secrets are masked before anything leaves the server. Request bodies are never included.
 * - Never throws.
 */
import { createHash } from 'node:crypto';
import { getSharedStore, type KeyValueStore } from './sharedStore.js';

const DEDUPE_MS = 5 * 60 * 1000;

export function scrubMessage(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [hidden]')
    .replace(/\b(access_token|refresh_token|client_secret|appsecret_proof|code|key|token|secret)=([^&\s"']+)/gi, '$1=[hidden]')
    .replace(/\b(adl|adlo|adlr)_[A-Za-z0-9_-]{8,}/g, '$1_[hidden]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hidden]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[hidden]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
}

export interface ErrorContext {
  method?: string;
  /** The route pattern or path without the query string. */
  path?: string;
}

export interface ReportOptions {
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  store?: KeyValueStore;
}

export async function reportError(error: unknown, ctx: ErrorContext = {}, opts: ReportOptions = {}): Promise<boolean> {
  try {
    const env = opts.env ?? process.env;
    const url = env.ERROR_WEBHOOK_URL?.trim();
    if (!url || !/^https:\/\//i.test(url)) return false;
    const name = error instanceof Error ? error.name : 'Error';
    const message = scrubMessage(error instanceof Error ? error.message : String(error)).slice(0, 300);
    const where = ctx.path ? `${(ctx.method ?? '').toUpperCase()} ${ctx.path.split('?')[0].slice(0, 120)}`.trim() : 'server';
    const fingerprint = createHash('sha256').update(`${name}|${message}|${where}`).digest('hex').slice(0, 24);
    const seen = await (opts.store ?? getSharedStore()).incr(`errrep:${fingerprint}`, DEDUPE_MS);
    if (seen > 1) return false;
    const text = `AdLens error on ${where}\n${name}: ${message}`;
    const res = await (opts.fetchFn ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
