/**
 * Meta platform callbacks (Sprint 10): "Deauthorize" and "Data deletion request".
 * Meta posts a `signed_request` (base64url signature + "." + base64url JSON), signed with HMAC-SHA256 using the app secret.
 * Anything that does not verify is rejected, so nobody can delete another person's connection by guessing.
 *
 * Storage (server only; Firestore rules deny all browser access):
 *   metaUserLinks/{facebookUserId}        { uid }              written when a person connects Facebook
 *   dataDeletionRequests/{code}           { status, ... }      one per request, readable by code on the status page
 */
import crypto from 'node:crypto';
import { getAdminFirestore } from './firestore.js';

export interface SignedRequestPayload {
  user_id: string;
  algorithm?: string;
  issued_at?: number;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Returns the verified payload, or null when the signature, format or algorithm is wrong. */
export function parseSignedRequest(signedRequest: unknown, appSecret: string, now: () => number = () => Date.now()): SignedRequestPayload | null {
  if (typeof signedRequest !== 'string' || !appSecret || signedRequest.length > 4096) return null;
  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [sigPart, payloadPart] = parts;
  let payload: unknown;
  try {
    payload = JSON.parse(b64urlToBuffer(payloadPart).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.algorithm !== 'string' || p.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
  const expected = crypto.createHmac('sha256', appSecret).update(payloadPart).digest();
  const given = b64urlToBuffer(sigPart);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  if (typeof p.user_id !== 'string' || !/^\d{1,30}$/.test(p.user_id)) return null;
  if (typeof p.issued_at === 'number' && Math.abs(now() / 1000 - p.issued_at) > 7 * 24 * 3600) return null; // very old requests are replays
  return { user_id: p.user_id, algorithm: p.algorithm, ...(typeof p.issued_at === 'number' ? { issued_at: p.issued_at } : {}) };
}

/** Builds a signed request exactly like Meta does. Used by tests. */
export function signRequestForTest(payload: Record<string, unknown>, appSecret: string): string {
  const body = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', ...payload })).toString('base64url');
  const sig = crypto.createHmac('sha256', appSecret).update(body).digest('base64url');
  return `${sig}.${body}`;
}

export type DeletionStatus = 'completed' | 'nothing_stored';

export interface DeletionRequestRecord {
  code: string;
  kind: 'deauthorize' | 'data_deletion';
  status: DeletionStatus;
  requestedAt: string;
  completedAt: string;
}

export interface MetaDeletionStore {
  link(facebookUserId: string, uid: string): Promise<void>;
  findUid(facebookUserId: string): Promise<string | null>;
  unlinkFacebookUser(facebookUserId: string): Promise<void>;
  unlinkUid(uid: string): Promise<void>;
  saveRequest(rec: DeletionRequestRecord): Promise<void>;
  getRequest(code: string): Promise<DeletionRequestRecord | null>;
}

const firestoreStore: MetaDeletionStore = {
  async link(fb, uid) {
    await getAdminFirestore().collection('metaUserLinks').doc(fb).set({ uid, linkedAt: new Date().toISOString() });
  },
  async findUid(fb) {
    const snap = await getAdminFirestore().collection('metaUserLinks').doc(fb).get();
    const uid = snap.exists ? (snap.data() as { uid?: string }).uid : undefined;
    return typeof uid === 'string' ? uid : null;
  },
  async unlinkFacebookUser(fb) {
    await getAdminFirestore().collection('metaUserLinks').doc(fb).delete();
  },
  async unlinkUid(uid) {
    const snap = await getAdminFirestore().collection('metaUserLinks').where('uid', '==', uid).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  },
  async saveRequest(rec) {
    await getAdminFirestore().collection('dataDeletionRequests').doc(rec.code).set(rec);
  },
  async getRequest(code) {
    const snap = await getAdminFirestore().collection('dataDeletionRequests').doc(code).get();
    return snap.exists ? (snap.data() as DeletionRequestRecord) : null;
  },
};

export function createInMemoryMetaDeletionStore(): MetaDeletionStore {
  const links = new Map<string, string>();
  const requests = new Map<string, DeletionRequestRecord>();
  return {
    async link(fb, uid) { links.set(fb, uid); },
    async findUid(fb) { return links.get(fb) ?? null; },
    async unlinkFacebookUser(fb) { links.delete(fb); },
    async unlinkUid(uid) { for (const [k, v] of links) if (v === uid) links.delete(k); },
    async saveRequest(rec) { requests.set(rec.code, structuredClone(rec)); },
    async getRequest(code) { const r = requests.get(code); return r ? structuredClone(r) : null; },
  };
}

let override: MetaDeletionStore | null = null;
export function setTestMetaDeletionStore(store: MetaDeletionStore | null): void {
  override = store;
}
export function getMetaDeletionStore(): MetaDeletionStore {
  return override ?? firestoreStore;
}

export function newConfirmationCode(): string {
  return crypto.randomBytes(12).toString('hex');
}
