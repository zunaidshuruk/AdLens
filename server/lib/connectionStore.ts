import { getFirestore } from 'firebase-admin/firestore';
import { getServerConfig } from '../config.js';
import { getFirebaseAdminApp } from './firebaseAdmin.js';
import type { ConnectionRecord, VaultStore } from './tokenVault.js';

const CONNECTIONS_COLLECTION = 'connections';

export const firestoreConnectionStore: VaultStore = {
  async get(id: string): Promise<ConnectionRecord | null> {
    const snap = await getFirestore(getFirebaseAdminApp())
      .collection(CONNECTIONS_COLLECTION)
      .doc(id)
      .get();
    if (!snap.exists) return null;
    return (snap.data() as ConnectionRecord) ?? null;
  },
  async set(id: string, record: ConnectionRecord): Promise<void> {
    await getFirestore(getFirebaseAdminApp()).collection(CONNECTIONS_COLLECTION).doc(id).set(record);
  },
  async delete(id: string): Promise<void> {
    await getFirestore(getFirebaseAdminApp()).collection(CONNECTIONS_COLLECTION).doc(id).delete();
  },
};

export function createInMemoryVaultStore(): VaultStore & { map: Map<string, ConnectionRecord> } {
  const map = new Map<string, ConnectionRecord>();
  return {
    map,
    async get(id: string): Promise<ConnectionRecord | null> {
      const rec = map.get(id);
      return rec ? structuredClone(rec) : null;
    },
    async set(id: string, record: ConnectionRecord): Promise<void> {
      map.set(id, structuredClone(record));
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
  };
}

let testStoreOverride: VaultStore | null = null;
const defaultMemoryStore = createInMemoryVaultStore();

export function setTestConnectionStore(store: VaultStore | null): void {
  testStoreOverride = store;
}

export const connectionStore: VaultStore = {
  get(id: string): Promise<ConnectionRecord | null> {
    const target =
      testStoreOverride ??
      (getServerConfig().firebaseConfigured ? firestoreConnectionStore : defaultMemoryStore);
    return target.get(id);
  },
  set(id: string, record: ConnectionRecord): Promise<void> {
    const target =
      testStoreOverride ??
      (getServerConfig().firebaseConfigured ? firestoreConnectionStore : defaultMemoryStore);
    return target.set(id, record);
  },
  delete(id: string): Promise<void> {
    const target =
      testStoreOverride ??
      (getServerConfig().firebaseConfigured ? firestoreConnectionStore : defaultMemoryStore);
    return target.delete(id);
  },
};
