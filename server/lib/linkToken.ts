import crypto from 'node:crypto';

export const LINK_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class LinkTokenError extends Error {
  code: 'LINK_TOKEN_INVALID' | 'LINK_TOKEN_EXPIRED';

  constructor(code: 'LINK_TOKEN_INVALID' | 'LINK_TOKEN_EXPIRED', message: string) {
    super(message);
    this.name = 'LinkTokenError';
    this.code = code;
  }
}

export interface LinkTokenPayload {
  uid: string;
  exp: number;
  nonce: string;
}

export function signLinkToken(
  uid: string,
  secret: string,
  nowMs: number = Date.now(),
  ttlMs: number = LINK_TOKEN_TTL_MS
): string {
  if (!uid || !uid.trim()) {
    throw new LinkTokenError('LINK_TOKEN_INVALID', 'uid is required to sign a link token.');
  }
  if (!secret || !secret.trim()) {
    throw new LinkTokenError(
      'LINK_TOKEN_INVALID',
      'TOKEN_ENCRYPTION_KEY is required to sign a link token.'
    );
  }

  const payload: LinkTokenPayload = {
    uid: uid.trim(),
    exp: nowMs + ttlMs,
    nonce: crypto.randomBytes(12).toString('base64url'),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

export function verifyLinkToken(
  token: string,
  secret: string,
  nowMs: number = Date.now()
): LinkTokenPayload {
  if (!token || typeof token !== 'string' || !secret || !secret.trim()) {
    throw new LinkTokenError('LINK_TOKEN_INVALID', 'Link token is missing or invalid.');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new LinkTokenError('LINK_TOKEN_INVALID', 'Malformed link token.');
  }

  const [payloadB64, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new LinkTokenError('LINK_TOKEN_INVALID', 'Link token signature verification failed.');
  }

  let parsed: LinkTokenPayload;
  try {
    const raw = Buffer.from(payloadB64, 'base64url').toString('utf8');
    parsed = JSON.parse(raw) as LinkTokenPayload;
  } catch {
    throw new LinkTokenError('LINK_TOKEN_INVALID', 'Link token payload is invalid.');
  }

  if (
    !parsed ||
    typeof parsed.uid !== 'string' ||
    !parsed.uid.trim() ||
    typeof parsed.exp !== 'number'
  ) {
    throw new LinkTokenError('LINK_TOKEN_INVALID', 'Link token payload is missing required fields.');
  }

  if (nowMs >= parsed.exp) {
    throw new LinkTokenError('LINK_TOKEN_EXPIRED', 'Link token has expired.');
  }

  return parsed;
}
