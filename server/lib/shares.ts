/**
 * Share links (Sprint 34): a read-only page for a dashboard or a saved report, opened with a secret link.
 * The page shows a frozen snapshot of the numbers, taken on the server when the link is made (and refreshed daily by the
 * daily job). Visitors never touch the owner's Google or Meta sign-in: they only ever receive the saved snapshot.
 * Optional password and expiry. Links can be turned off at any time.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DashboardWidget, QueryWidget } from '../../src/types/dashboard.js';
import type { ExploreResult } from './exploreSpec.js';
import { getAdminFirestore } from './firestore.js';

export const shareInputSchema = z.object({
  kind: z.enum(['dashboard', 'report']),
  targetId: z.string().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/),
  rangeDays: z.union([z.literal(7), z.literal(28), z.literal(90)]).default(28),
  password: z.string().min(4, 'A password needs at least 4 characters').max(72).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  autoRefresh: z.boolean().default(true),
});
export type ShareInput = z.infer<typeof shareInputSchema>;

export interface SnapshotWidget {
  id: string;
  title: string;
  layout: { x: number; y: number; w: number; h: number };
  kind: DashboardWidget['kind'];
  days?: number;
  target?: number;
  text?: string;
  result?: ExploreResult;
  error?: string;
}
export interface Snapshot {
  title: string;
  description: string;
  kind: 'dashboard' | 'report';
  range: { startDate: string; endDate: string };
  generatedAt: string;
  widgets: SnapshotWidget[];
}

export interface StoredShare {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  createdAt: string;
  kind: 'dashboard' | 'report';
  targetId: string;
  title: string;
  rangeDays: 7 | 28 | 90;
  autoRefresh: boolean;
  /** sha256 of the secret token, used to find the share. The token itself is only stored sealed. */
  tokenHash: string;
  sealedToken: string;
  passwordSalt?: string;
  passwordHash?: string;
  expiresAt?: string;
  revokedAt?: string;
  views: number;
  lastViewedAt?: string;
  refreshedAt: string;
  refreshError?: string;
  snapshot: Snapshot;
}

export type PublicShare = Omit<StoredShare, 'tokenHash' | 'sealedToken' | 'passwordSalt' | 'passwordHash' | 'snapshot'> & { hasPassword: boolean };
export const publicShare = (s: StoredShare): PublicShare => {
  const { tokenHash: _a, sealedToken: _b, passwordSalt, passwordHash, snapshot: _c, ...rest } = s;
  return { ...rest, hasPassword: Boolean(passwordHash && passwordSalt) };
};

export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}
export function checkPassword(share: Pick<StoredShare, 'passwordSalt' | 'passwordHash'>, password: string | undefined): boolean {
  if (!share.passwordHash || !share.passwordSalt) return true;
  if (!password) return false;
  const a = Buffer.from(scryptSync(password.slice(0, 200), share.passwordSalt, 32).toString('hex'));
  const b = Buffer.from(share.passwordHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const isExpired = (s: Pick<StoredShare, 'expiresAt'>, now = new Date()) => Boolean(s.expiresAt && new Date(s.expiresAt).getTime() <= now.getTime());
export const isLive = (s: StoredShare, now = new Date()) => !s.revokedAt && !isExpired(s, now);

/** The window every snapshot covers: the last N complete days, ending yesterday (UTC). */
export function snapshotRange(days: number, now = new Date()): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
function panelWindow(days: number | undefined, page: { startDate: string; endDate: string }) {
  if (!days || ![7, 14, 28, 90].includes(days)) return page;
  const end = new Date(`${page.endDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - (days - 1));
  return { startDate: end.toISOString().slice(0, 10), endDate: page.endDate };
}

export type RunQuery = (widget: QueryWidget, range: { startDate: string; endDate: string }) => Promise<ExploreResult>;

const MAX_SNAPSHOT_BYTES = 700_000;
function shrink(widgets: SnapshotWidget[], rowCap: number): SnapshotWidget[] {
  return widgets.map((w) => (w.result && w.result.rows.length > rowCap ? { ...w, result: { ...w.result, rows: w.result.rows.slice(0, rowCap), truncated: true } } : w));
}

/** Runs every panel (a few at a time) and returns the snapshot. A panel that fails shows a short message; it never leaks the reason. */
export async function buildSnapshot(
  src: { kind: 'dashboard' | 'report'; title: string; description: string; widgets: DashboardWidget[] },
  rangeDays: number, runQuery: RunQuery, now = new Date(),
): Promise<Snapshot> {
  const range = snapshotRange(rangeDays, now);
  const out: SnapshotWidget[] = new Array(src.widgets.length);
  let next = 0;
  const worker = async () => {
    while (next < src.widgets.length) {
      const i = next++;
      const w = src.widgets[i];
      const base = { id: w.id, title: w.title, layout: w.layout, kind: w.kind } as SnapshotWidget;
      if (w.kind === 'text') { out[i] = { ...base, text: w.text }; continue; }
      if (w.days) base.days = w.days;
      if (w.target !== undefined) base.target = w.target;
      try { out[i] = { ...base, result: await runQuery(w, panelWindow(w.days, range)) }; }
      catch { out[i] = { ...base, error: 'Could not load this panel.' }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, src.widgets.length) }, worker));
  let widgets: SnapshotWidget[] = shrink(out, 400);
  for (const cap of [200, 100, 40, 15]) {
    if (JSON.stringify(widgets).length <= MAX_SNAPSHOT_BYTES) break;
    widgets = shrink(widgets, cap);
  }
  return { title: src.title, description: src.description, kind: src.kind, range, generatedAt: now.toISOString(), widgets };
}

export interface ShareStore {
  listAll(): Promise<StoredShare[]>;
  listForProject(ws: string, project: string): Promise<StoredShare[]>;
  get(id: string): Promise<StoredShare | null>;
  getByTokenHash(hash: string): Promise<StoredShare | null>;
  put(s: StoredShare): Promise<void>;
  delete(id: string): Promise<boolean>;
}
export function createInMemoryShareStore(): ShareStore {
  const map = new Map<string, StoredShare>();
  return {
    async listAll() { return [...map.values()].map((r) => structuredClone(r)); },
    async listForProject(ws, p) { return [...map.values()].filter((r) => r.workspaceId === ws && r.projectId === p).map((r) => structuredClone(r)); },
    async get(id) { const r = map.get(id); return r ? structuredClone(r) : null; },
    async getByTokenHash(h) { const r = [...map.values()].find((x) => x.tokenHash === h); return r ? structuredClone(r) : null; },
    async put(r) { map.set(r.id, structuredClone(r)); },
    async delete(id) { return map.delete(id); },
  };
}
const col = () => getAdminFirestore().collection('shares');
const firestoreShareStore: ShareStore = {
  async listAll() { return (await col().get()).docs.map((d) => d.data() as StoredShare); },
  async listForProject(ws, p) { return (await col().where('workspaceId', '==', ws).where('projectId', '==', p).get()).docs.map((d) => d.data() as StoredShare); },
  async get(id) { const s = await col().doc(id).get(); return s.exists ? (s.data() as StoredShare) : null; },
  async getByTokenHash(h) { const q = await col().where('tokenHash', '==', h).limit(1).get(); return q.empty ? null : (q.docs[0].data() as StoredShare); },
  async put(r) { await col().doc(r.id).set(r); },
  async delete(id) { const ref = col().doc(id); const s = await ref.get(); if (!s.exists) return false; await ref.delete(); return true; },
};
let override: ShareStore | null = null;
export function setTestShareStore(s: ShareStore | null): void { override = s; }
export function getShareStore(): ShareStore { return override ?? firestoreShareStore; }
