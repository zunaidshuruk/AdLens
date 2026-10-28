/**
 * A tiny, generic store for per-project documents (saved reports, dashboards).
 * Everything is read and written by the server only; the browser never touches these collections directly.
 * The Firestore version and an in-memory version (used by tests) share one interface.
 */
import { getAdminFirestore } from './firestore.js';

export type ProjectDocKind = 'savedReports' | 'dashboards' | 'datasets' | 'keywordLists' | 'rankDays' | 'linkProspects';

export interface StoredDoc {
  id: string;
  [key: string]: unknown;
}

export interface ProjectDocsStore {
  list(wsId: string, projectId: string, kind: ProjectDocKind): Promise<StoredDoc[]>;
  get(wsId: string, projectId: string, kind: ProjectDocKind, id: string): Promise<StoredDoc | null>;
  put(wsId: string, projectId: string, kind: ProjectDocKind, doc: StoredDoc): Promise<void>;
  delete(wsId: string, projectId: string, kind: ProjectDocKind, id: string): Promise<boolean>;
  deleteAll(wsId: string, projectId: string): Promise<void>;
}

const KINDS: ProjectDocKind[] = ['savedReports', 'dashboards', 'datasets', 'keywordLists', 'rankDays', 'linkProspects'];

function collectionPath(wsId: string, projectId: string, kind: ProjectDocKind): string {
  return `workspaces/${wsId}/projects/${projectId}/${kind}`;
}

const firestoreStore: ProjectDocsStore = {
  async list(wsId, projectId, kind) {
    const snap = await getAdminFirestore().collection(collectionPath(wsId, projectId, kind)).get();
    return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as StoredDoc);
  },
  async get(wsId, projectId, kind, id) {
    const snap = await getAdminFirestore().collection(collectionPath(wsId, projectId, kind)).doc(id).get();
    return snap.exists ? ({ ...(snap.data() as object), id: snap.id } as StoredDoc) : null;
  },
  async put(wsId, projectId, kind, doc) {
    const { id, ...rest } = doc;
    await getAdminFirestore().collection(collectionPath(wsId, projectId, kind)).doc(id).set(rest);
  },
  async delete(wsId, projectId, kind, id) {
    const ref = getAdminFirestore().collection(collectionPath(wsId, projectId, kind)).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  },
  async deleteAll(wsId, projectId) {
    const db = getAdminFirestore();
    for (const kind of KINDS) await db.recursiveDelete(db.collection(collectionPath(wsId, projectId, kind)));
  },
};

export function createInMemoryProjectDocsStore(): ProjectDocsStore {
  const data = new Map<string, Map<string, StoredDoc>>();
  const bucket = (ws: string, p: string, k: ProjectDocKind) => {
    const key = collectionPath(ws, p, k);
    if (!data.has(key)) data.set(key, new Map());
    return data.get(key)!;
  };
  return {
    async list(ws, p, k) { return [...bucket(ws, p, k).values()].map((d) => structuredClone(d)); },
    async get(ws, p, k, id) { const d = bucket(ws, p, k).get(id); return d ? structuredClone(d) : null; },
    async put(ws, p, k, doc) { bucket(ws, p, k).set(doc.id, structuredClone(doc)); },
    async delete(ws, p, k, id) { return bucket(ws, p, k).delete(id); },
    async deleteAll(ws, p) { for (const k of KINDS) bucket(ws, p, k).clear(); },
  };
}

let testOverride: ProjectDocsStore | null = null;
export function setTestProjectDocsStore(store: ProjectDocsStore | null): void {
  testOverride = store;
}
export function getProjectDocsStore(): ProjectDocsStore {
  return testOverride ?? firestoreStore;
}

/** A short, unguessable-enough id for a new document (not a secret; access is checked by membership). */
export function newDocId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}
