/**
 * Storage for users' own AI agents (Sprint 16), written by the server only.
 *   workspaces/{ws}/agents/{id}         public settings (no secrets)
 *   workspaces/{ws}/agentSecrets/{id}   sealed API key / webhook secret
 * Firestore rules deny every browser read and write to both (catch-all rule), so nothing here can leak through the app.
 * An in-memory version is used by tests.
 */
import type { AgentInput } from './agentConfig.js';
import { getAdminFirestore } from './firestore.js';

export interface AgentRecord {
  id: string;
  /** The person who created it. Their id seals the secrets, so it must never change. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** When the owner confirmed their numbers may be sent to this provider (null = not yet). */
  consentedAt: string | null;
  settings: AgentInput;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  hasWebhookSecret: boolean;
}

export interface AgentSecretsRecord {
  apiKey?: string;
  webhookSecret?: string;
}

export interface AgentStore {
  list(ws: string): Promise<AgentRecord[]>;
  get(ws: string, id: string): Promise<AgentRecord | null>;
  put(ws: string, rec: AgentRecord): Promise<void>;
  /** Removes the agent and its secrets. */
  delete(ws: string, id: string): Promise<boolean>;
  getSecrets(ws: string, id: string): Promise<AgentSecretsRecord>;
  putSecrets(ws: string, id: string, secrets: AgentSecretsRecord): Promise<void>;
}

const firestoreStore: AgentStore = {
  async list(ws) {
    const snap = await getAdminFirestore().collection(`workspaces/${ws}/agents`).get();
    return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as AgentRecord);
  },
  async get(ws, id) {
    const snap = await getAdminFirestore().collection(`workspaces/${ws}/agents`).doc(id).get();
    return snap.exists ? ({ ...(snap.data() as object), id: snap.id } as AgentRecord) : null;
  },
  async put(ws, rec) {
    const { id, ...rest } = rec;
    await getAdminFirestore().collection(`workspaces/${ws}/agents`).doc(id).set(rest);
  },
  async delete(ws, id) {
    const db = getAdminFirestore();
    const ref = db.collection(`workspaces/${ws}/agents`).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    await db.collection(`workspaces/${ws}/agentSecrets`).doc(id).delete();
    return true;
  },
  async getSecrets(ws, id) {
    const snap = await getAdminFirestore().collection(`workspaces/${ws}/agentSecrets`).doc(id).get();
    return snap.exists ? (snap.data() as AgentSecretsRecord) : {};
  },
  async putSecrets(ws, id, secrets) {
    await getAdminFirestore().collection(`workspaces/${ws}/agentSecrets`).doc(id).set(secrets);
  },
};

export function createInMemoryAgentStore(): AgentStore & { dumpSecrets(): Record<string, AgentSecretsRecord> } {
  const agents = new Map<string, AgentRecord>();
  const secrets = new Map<string, AgentSecretsRecord>();
  const k = (ws: string, id: string) => `${ws}/${id}`;
  return {
    async list(ws) { return [...agents.entries()].filter(([key]) => key.startsWith(`${ws}/`)).map(([, v]) => structuredClone(v)); },
    async get(ws, id) { const v = agents.get(k(ws, id)); return v ? structuredClone(v) : null; },
    async put(ws, rec) { agents.set(k(ws, rec.id), structuredClone(rec)); },
    async delete(ws, id) { secrets.delete(k(ws, id)); return agents.delete(k(ws, id)); },
    async getSecrets(ws, id) { return structuredClone(secrets.get(k(ws, id)) ?? {}); },
    async putSecrets(ws, id, s) { secrets.set(k(ws, id), structuredClone(s)); },
    dumpSecrets() { return Object.fromEntries(secrets); },
  };
}

let testOverride: AgentStore | null = null;
export function setTestAgentStore(store: AgentStore | null): void {
  testOverride = store;
}
export function getAgentStore(): AgentStore {
  return testOverride ?? firestoreStore;
}
