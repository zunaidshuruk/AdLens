/** Browser-side check of an AdLens webhook signature (for the developer page). Uses Web Crypto only. */

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function computeSignature(secret: string, timestamp: number, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`)));
}

export type SignatureCheck = { ok: true } | { ok: false; reason: 'format' | 'stale' | 'mismatch' };

export async function checkSignature(secret: string, header: string, rawBody: string, nowSeconds: number, toleranceSeconds = 300): Promise<SignatureCheck> {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return { ok: false, reason: 'format' };
  const t = Number(m[1]);
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return { ok: false, reason: 'stale' };
  const expected = await computeSignature(secret, t, rawBody);
  // constant-time style compare
  let diff = expected.length ^ m[2].length;
  for (let i = 0; i < expected.length && i < m[2].length; i += 1) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: 'mismatch' };
}

export const SIGNATURE_PROBLEM: Record<'format' | 'stale' | 'mismatch', string> = {
  format: 'The header should look like t=1700000000,v1=<64 hex characters>.',
  stale: 'The timestamp is more than 5 minutes away from now, so a real service would reject it (this stops replay attacks).',
  mismatch: 'The signature does not match. Check the secret, and make sure the body is the exact text AdLens sent, byte for byte.',
};
