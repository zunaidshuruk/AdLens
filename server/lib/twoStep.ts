/**
 * Two-step verification with an authenticator app (Sprint 22). Our own, so it needs no Firebase upgrade and no card.
 *
 * - The secret is stored encrypted (AES-256-GCM, same key as the token vault) in the server-only Firestore collection `twoStep`.
 * - Turning it on puts a flag (`twoStep: true`) on the person's sign-in token, so the server knows without a database read.
 * - After a correct code the server hands back a signed "proof" (stateless, works across many server copies). The browser
 *   sends it with every request. It is tied to this person AND this sign-in, so a stolen token alone is not enough.
 * - Backup codes (ten, single use) are stored only as hashes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServerConfig } from '../config.js';
import { decryptPayload, encryptPayload } from './crypto.js';
import { getAdminFirestore } from './firestore.js';
import { hashBackupCode, looksLikeBackupCode, verifyTotp } from './totp.js';
import { parsePreviousSecrets } from './tokenVault.js';

export interface TwoStepDoc {
  uid: string;
  /** Encrypted base32 secret (active). Empty until the person confirms their first code. */
  secretEnc: string;
  enabled: boolean;
  enabledAt: string | null;
  /** Last accepted 30-second step, so the same code cannot be used twice. */
  lastStep: number;
  backupHashes: string[];
  /** A secret waiting for the first confirming code (expires after 15 minutes). */
  pendingEnc?: string;
  pendingAt?: number;
}

export interface TwoStepStore {
  get(uid: string): Promise<TwoStepDoc | null>;
  put(doc: TwoStepDoc): Promise<void>;
  delete(uid: string): Promise<void>;
}

export function createInMemoryTwoStepStore(): TwoStepStore {
  const docs = new Map<string, TwoStepDoc>();
  return {
    async get(uid) { const d = docs.get(uid); return d ? JSON.parse(JSON.stringify(d)) : null; },
    async put(doc) { docs.set(doc.uid, JSON.parse(JSON.stringify(doc))); },
    async delete(uid) { docs.delete(uid); },
  };
}

const firestoreStore: TwoStepStore = {
  async get(uid) {
    const d = await getAdminFirestore().collection('twoStep').doc(uid).get();
    return d.exists ? (d.data() as TwoStepDoc) : null;
  },
  async put(doc) { await getAdminFirestore().collection('twoStep').doc(doc.uid).set(JSON.parse(JSON.stringify(doc))); },
  async delete(uid) { await getAdminFirestore().collection('twoStep').doc(uid).delete(); },
};

let override: TwoStepStore | null = null;
export function setTestTwoStepStore(s: TwoStepStore | null): void { override = s; }
export const twoStepStore = (): TwoStepStore => override ?? firestoreStore;

function key(): string {
  const k = getServerConfig().tokenEncryptionKey;
  if (!k || k.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY is not set.');
  return k;
}

export const sealSecret = (secret: string): string => encryptPayload(secret, key());
/** Opens a stored secret with the current key, or an older one kept in TOKEN_ENCRYPTION_KEY_PREVIOUS (so rotating the key never locks anyone out). */
export function openSecret(sealed: string): string {
  const keys = [key(), ...parsePreviousSecrets(process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS ?? '')];
  let last: unknown;
  for (const k of keys) {
    try {
      return decryptPayload(sealed, k);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('Could not open the secret.');
}

// ---------- the proof the browser carries ----------

export const PROOF_HEADER = 'x-adlens-2fa';
const PROOF_DAYS = 30;

const proofKey = () => createHmac('sha256', key()).update('adlens-2fa-proof-v1').digest();

/** A signed note saying "this person passed their second step in this sign-in". */
export function makeProof(uid: string, authTime: number, nowMs = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: uid, a: authTime, e: Math.floor(nowMs / 1000) + PROOF_DAYS * 86400 })).toString('base64url');
  const sig = createHmac('sha256', proofKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function proofIsValid(proof: unknown, uid: string, authTime: number | undefined, nowMs = Date.now()): boolean {
  if (typeof proof !== 'string' || proof.length > 600 || typeof authTime !== 'number') return false;
  const [body, sig] = proof.split('.');
  if (!body || !sig) return false;
  try {
    const expected = createHmac('sha256', proofKey()).update(body).digest('base64url');
    if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u?: string; a?: number; e?: number };
    return data.u === uid && data.a === authTime && typeof data.e === 'number' && data.e * 1000 > nowMs;
  } catch {
    return false;
  }
}

// ---------- checking a code ----------

export type CodeResult = 'ok' | 'backup' | 'wrong' | 'not_enabled';

/** Checks an authenticator code or a backup code against the saved settings. Saves the used step / used backup code. */
export async function checkSecondStep(uid: string, code: string, nowMs = Date.now()): Promise<CodeResult> {
  const store = twoStepStore();
  const doc = await store.get(uid);
  if (!doc || !doc.enabled) return 'not_enabled';
  if (looksLikeBackupCode(code)) {
    const hash = hashBackupCode(code);
    if (!doc.backupHashes.includes(hash)) return 'wrong';
    await store.put({ ...doc, backupHashes: doc.backupHashes.filter((h) => h !== hash) });
    return 'backup';
  }
  const secret = openSecret(doc.secretEnc);
  const step = verifyTotp(secret, code, nowMs, doc.lastStep);
  if (step === null) return 'wrong';
  // Always re-seal with the current key, so an old key can be retired after a few days.
  await store.put({ ...doc, lastStep: step, secretEnc: sealSecret(secret) });
  return 'ok';
}
