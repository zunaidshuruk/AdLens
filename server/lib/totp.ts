/**
 * Authenticator-app codes (RFC 6238 TOTP, RFC 4226 HOTP), written with Node's own crypto so no extra package is needed.
 * Works with Google Authenticator, Microsoft Authenticator, 1Password, Authy and any other standard app.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Not a valid secret.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits, as base32 text — the form authenticator apps expect). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpAt(secretBase32: string, timeMs: number): string {
  return hotp(base32Decode(secretBase32), Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS));
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks a 6-digit code. Accepts the current 30-second step and one step either side (clock drift).
 * `lastUsedStep` blocks replay: a step that was already accepted (or an older one) is refused.
 * Returns the step that matched, or null.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, lastUsedStep = -1): number | null {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretBase32);
  const current = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    // Compare every candidate (no early exit) so timing does not reveal which step was close.
    if (safeEqual(hotp(secret, step), clean) && step > lastUsedStep) matched = matched === null || step > matched ? step : matched;
  }
  return matched;
}

/** The address a QR code carries. Authenticator apps read it and add the account. */
export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ---------- backup codes ----------

const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)

/** Ten single-use codes like "k3m9x-p2q7a". Shown once; only their hashes are stored. */
export function generateBackupCodes(count = 10): string[] {
  const pick = (n: number) => Array.from(randomBytes(n), (b) => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join('');
  return Array.from({ length: count }, () => `${pick(5)}-${pick(5)}`);
}

export function normaliseBackupCode(code: string): string {
  return String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function looksLikeBackupCode(code: string): boolean {
  return normaliseBackupCode(code).length === 10 && !/^\d{6}$/.test(String(code ?? '').replace(/\s/g, ''));
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(`adlens-backup:${normaliseBackupCode(code)}`).digest('hex');
}
