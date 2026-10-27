/**
 * Security audit log (Sprint 18). Records who connected or disconnected a data source, who deleted what,
 * and which AI tools were given access. Server-only (the Firestore rules deny every client read and write).
 *
 * Rules:
 * - Never throws. A failing log must not break the action it describes.
 * - Never stores tokens, emails or report data. Only the user id, an action name and a short plain-text detail.
 * - When an account is deleted, that person's entries are removed and one anonymous entry (hashed id) remains.
 */
import { createHash, randomUUID } from 'node:crypto';
import { getAdminFirestore } from './firestore.js';

export type AuditAction =
  | 'connection.google.connected'
  | 'connection.google.disconnected'
  | 'connection.meta.connected'
  | 'connection.meta.disconnected'
  | 'project.deleted'
  | 'account.deleted'
  | 'mcp.key_created'
  | 'mcp.key_revoked'
  | 'mcp.app_approved'
  | 'mcp.app_revoked'
  | 'sso.configured'
  | 'sso.removed'
  | 'sso.enforcement_changed'
  | 'sso.signin_blocked'
  | 'plan.changed'
  | 'plan.requested'
  | 'invoice.recorded'
  | 'member.added'
  | 'member.invited'
  | 'member.removed'
  | 'member.role_changed'
  | 'admin.settings_changed';

export interface AuditEvent {
  id: string;
  at: string;
  uid: string;
  workspaceId?: string;
  action: AuditAction;
  detail?: string;
}

export interface AuditStore {
  put(event: AuditEvent): Promise<void>;
  listForUid(uid: string): Promise<AuditEvent[]>;
  listForWorkspace(workspaceId: string): Promise<AuditEvent[]>;
  listRecent(limit: number): Promise<AuditEvent[]>;
  deleteForUid(uid: string): Promise<void>;
}

export function createInMemoryAuditStore(): AuditStore & { all(): AuditEvent[] } {
  let events: AuditEvent[] = [];
  return {
    all: () => events,
    async put(e) { events.push(e); },
    async listForUid(uid) { return events.filter((e) => e.uid === uid); },
    async listForWorkspace(ws) { return events.filter((e) => e.workspaceId === ws); },
    async listRecent(limit) { return [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit); },
    async deleteForUid(uid) { events = events.filter((e) => e.uid !== uid); },
  };
}

const firestoreAuditStore: AuditStore = {
  async put(e) { await getAdminFirestore().collection('auditLog').doc(e.id).set(e); },
  async listForUid(uid) {
    const s = await getAdminFirestore().collection('auditLog').where('uid', '==', uid).get();
    return s.docs.map((d) => d.data() as AuditEvent);
  },
  async listForWorkspace(ws) {
    const s = await getAdminFirestore().collection('auditLog').where('workspaceId', '==', ws).get();
    return s.docs.map((d) => d.data() as AuditEvent);
  },
  async listRecent(limit) {
    const s = await getAdminFirestore().collection('auditLog').orderBy('at', 'desc').limit(limit).get();
    return s.docs.map((d) => d.data() as AuditEvent);
  },
  async deleteForUid(uid) {
    const s = await getAdminFirestore().collection('auditLog').where('uid', '==', uid).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  },
};

let override: AuditStore | null = null;
export function setTestAuditStore(store: AuditStore | null): void { override = store; }
export function getAuditStore(): AuditStore { return override ?? firestoreAuditStore; }

const clean = (v: string | undefined, max: number) => (v ? v.replace(/[\r\n\t]+/g, ' ').slice(0, max) : undefined);

export async function recordAudit(input: { uid: string; action: AuditAction; workspaceId?: string; detail?: string }, store: AuditStore = getAuditStore(), now: Date = new Date()): Promise<void> {
  try {
    const event: AuditEvent = { id: randomUUID(), at: now.toISOString(), uid: input.uid, action: input.action };
    if (input.workspaceId) event.workspaceId = input.workspaceId;
    const detail = clean(input.detail, 200);
    if (detail) event.detail = detail;
    await store.put(event);
  } catch {
    // by design
  }
}

const newestFirst = (a: AuditEvent, b: AuditEvent) => b.at.localeCompare(a.at);

export async function listAuditForUid(uid: string, limit = 100, store: AuditStore = getAuditStore()): Promise<AuditEvent[]> {
  return (await store.listForUid(uid)).sort(newestFirst).slice(0, limit);
}

export async function listAuditForWorkspace(workspaceId: string, limit = 200, store: AuditStore = getAuditStore()): Promise<AuditEvent[]> {
  return (await store.listForWorkspace(workspaceId)).sort(newestFirst).slice(0, limit);
}

/** Called once an account is deleted. Leaves a single entry that cannot be traced back to the person. */
export async function recordAccountDeletion(uid: string, store: AuditStore = getAuditStore(), now: Date = new Date()): Promise<void> {
  try {
    await store.deleteForUid(uid);
    const anon = createHash('sha256').update(`audit:${uid}`).digest('hex').slice(0, 16);
    await store.put({ id: randomUUID(), at: now.toISOString(), uid: `deleted:${anon}`, action: 'account.deleted' });
  } catch {
    // by design
  }
}

export async function listRecentAudit(limit = 100, store: AuditStore = getAuditStore()): Promise<AuditEvent[]> {
  return (await store.listRecent(Math.min(Math.max(limit, 1), 300))).sort(newestFirst);
}
