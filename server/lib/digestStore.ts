import { getAdminFirestore } from './firestore.js';

export interface DigestSubscription {
  id: string;
  uid: string;
  /** Always the person's own verified sign-in email at the time they turned it on. */
  email: string;
  workspaceId: string;
  projectId: string;
  weekly: boolean;
  alerts: boolean;
  createdAt: string;
  lastWeeklyAt?: string;
  lastAlertDate?: string;
}

export interface DigestStore {
  listForUid(uid: string): Promise<DigestSubscription[]>;
  listAll(): Promise<DigestSubscription[]>;
  put(sub: DigestSubscription): Promise<void>;
  delete(id: string): Promise<void>;
  deleteForUid(uid: string): Promise<void>;
}

export const subscriptionId = (uid: string, workspaceId: string, projectId: string) => `${uid}__${workspaceId}__${projectId}`;

export function createInMemoryDigestStore(): DigestStore {
  const map = new Map<string, DigestSubscription>();
  return {
    async listForUid(uid) { return [...map.values()].filter((s) => s.uid === uid); },
    async listAll() { return [...map.values()]; },
    async put(s) { map.set(s.id, { ...s }); },
    async delete(id) { map.delete(id); },
    async deleteForUid(uid) { for (const [k, v] of map) if (v.uid === uid) map.delete(k); },
  };
}

const col = () => getAdminFirestore().collection('digestSubscriptions');
const firestoreDigestStore: DigestStore = {
  async listForUid(uid) { return (await col().where('uid', '==', uid).get()).docs.map((d) => d.data() as DigestSubscription); },
  async listAll() { return (await col().get()).docs.map((d) => d.data() as DigestSubscription); },
  async put(s) { await col().doc(s.id).set(s); },
  async delete(id) { await col().doc(id).delete(); },
  async deleteForUid(uid) { await Promise.all((await col().where('uid', '==', uid).get()).docs.map((d) => d.ref.delete())); },
};

let override: DigestStore | null = null;
export function setTestDigestStore(s: DigestStore | null): void { override = s; }
export function getDigestStore(): DigestStore { return override ?? firestoreDigestStore; }
