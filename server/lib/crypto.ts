import crypto from 'node:crypto';

const IV_LENGTH = 12; // 96-bit nonce recommended for AES-GCM
const TAG_LENGTH = 16; // 128-bit authentication tag

function deriveKey(secret: string): Buffer {
  if (!secret || secret.trim() === '') {
    throw new Error('TOKEN_ENCRYPTION_KEY must not be empty');
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Encrypts plaintext with AES-256-GCM using SHA-256(secret) and a random 12-byte IV.
 * Returns base64url(iv | tag | ciphertext).
 */
export function encryptPayload(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/**
 * Decrypts base64url(iv | tag | ciphertext) encrypted with AES-256-GCM.
 * Throws if tampered, malformed, or decrypted with the wrong key.
 */
export function decryptPayload(token: string, secret: string): string {
  const key = deriveKey(secret);
  if (!token || typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Invalid base64url token format');
  }

  const raw = Buffer.from(token, 'base64url');
  if (raw.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Encrypted payload is too short');
  }

  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
