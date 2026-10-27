/**
 * Pending team invitations (Sprint 20). When an owner adds an email that has no AdLens account yet, the invitation waits
 * here. It is accepted when that person signs in with a VERIFIED email that matches. Server-only collection `workspaceInvites`.
 */
import { randomUUID } from 'node:crypto';
import { getAdminFirestore } from './firestore.js';

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  /** Lower case. */
  email: string;
  /** A role id (built-in or custom). Never 'owner'. */
  role: string;
  invitedBy: string;
  createdAt: string;
}

export interface InviteStore {
  put(i: WorkspaceInvite): Promise<void>;
  get(id: string): Promise<WorkspaceInvite | null>;
  listForWorkspace(workspaceId: string): Promise<WorkspaceInvite[]>;
  listForEmail(email: string): Promise<WorkspaceInvite[]>;
  delete(id: string): Promise<void>;
}

export const newInviteId = () => randomUUID().replace(/-/g, '').slice(0, 20);

export function createInMemoryInviteStore(): InviteStore {
  const map = new Map<string, WorkspaceInvite>();
  return {
    async put(i) { map.set(i.id, { ...i }); },
    async get(id) { const i = map.get(id); return i ? { ...i } : null; },
    async listForWorkspace(ws) { return [...map.values()].filter((i) => i.workspaceId === ws); },
    async listForEmail(email) { return [...map.values()].filter((i) => i.email === email.trim().toLowerCase()); },
    async delete(id) { map.delete(id); },
  };
}

const col = () => getAdminFirestore().collection('workspaceInvites');
const firestoreInviteStore: InviteStore = {
  async put(i) { await col().doc(i.id).set(i); },
  async get(id) { const d = await col().doc(id).get(); return d.exists ? (d.data() as WorkspaceInvite) : null; },
  async listForWorkspace(ws) { return (await col().where('workspaceId', '==', ws).get()).docs.map((d) => d.data() as WorkspaceInvite); },
  async listForEmail(email) { return (await col().where('email', '==', email.trim().toLowerCase()).get()).docs.map((d) => d.data() as WorkspaceInvite); },
  async delete(id) { await col().doc(id).delete(); },
};

let override: InviteStore | null = null;
export function setTestInviteStore(s: InviteStore | null): void { override = s; }
export function getInviteStore(): InviteStore { return override ?? firestoreInviteStore; }
