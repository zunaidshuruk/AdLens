/**
 * One-click unsubscribe for summary emails. The link carries the subscription id and a signature made with a key only the server has,
 * so nobody can switch off (or guess) another person's subscription. No sign-in needed: it works from the email alone.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServerConfig } from '../config.js';

function key(): Buffer {
  const k = getServerConfig().tokenEncryptionKey;
  if (!k || k.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY is not set.');
  return createHmac('sha256', k).update('adlens-unsubscribe-v1').digest();
}

const sign = (subId: string) => createHmac('sha256', key()).update(subId).digest('base64url');

export function unsubscribeUrl(baseUrl: string, subId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/unsubscribe?s=${encodeURIComponent(Buffer.from(subId).toString('base64url'))}&t=${sign(subId)}`;
}

/** Returns the subscription id when the link is genuine, otherwise null. */
export function readUnsubscribe(s: unknown, t: unknown): string | null {
  if (typeof s !== 'string' || typeof t !== 'string' || s.length > 400 || t.length > 100) return null;
  try {
    const subId = Buffer.from(s, 'base64url').toString('utf8');
    const expected = sign(subId);
    if (expected.length !== t.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return null;
    return subId;
  } catch { return null; }
}
