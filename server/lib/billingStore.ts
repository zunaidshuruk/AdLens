/**
 * Invoices and upgrade requests (Sprint 20). Server-only Firestore collections `billingInvoices` and `planRequests`
 * (the rules deny every client read and write). There is no payment provider yet: the operator records a payment
 * by hand after it arrives, and sets the plan and its end date.
 */
import { randomUUID } from 'node:crypto';
import { getAdminFirestore } from './firestore.js';

export type Currency = 'USD' | 'BDT';

export interface InvoiceRecord {
  id: string;
  workspaceId: string;
  /** Your own invoice number, for example "AL-2026-001". */
  number: string;
  amount: number;
  currency: Currency;
  plan: string;
  periodStart: string;
  periodEnd: string;
  note: string;
  createdAt: string;
}

export interface PlanRequest {
  id: string;
  workspaceId: string;
  uid: string;
  email: string;
  plan: string;
  message: string;
  status: 'open' | 'done';
  createdAt: string;
}

export interface BillingStore {
  addInvoice(i: InvoiceRecord): Promise<void>;
  listInvoices(workspaceId: string): Promise<InvoiceRecord[]>;
  putRequest(r: PlanRequest): Promise<void>;
  getRequest(id: string): Promise<PlanRequest | null>;
  listRequests(opts: { workspaceId?: string; status?: 'open' | 'done' }): Promise<PlanRequest[]>;
  deleteRequestsForUid(uid: string): Promise<void>;
}

export const newBillingId = () => randomUUID().replace(/-/g, '').slice(0, 20);
const byNewest = <T extends { createdAt: string }>(a: T, b: T) => (a.createdAt < b.createdAt ? 1 : -1);

export function createInMemoryBillingStore(): BillingStore {
  const invoices = new Map<string, InvoiceRecord>();
  const requests = new Map<string, PlanRequest>();
  return {
    async addInvoice(i) { invoices.set(i.id, { ...i }); },
    async listInvoices(ws) { return [...invoices.values()].filter((i) => i.workspaceId === ws).sort(byNewest); },
    async putRequest(r) { requests.set(r.id, { ...r }); },
    async getRequest(id) { const r = requests.get(id); return r ? { ...r } : null; },
    async listRequests({ workspaceId, status }) {
      return [...requests.values()].filter((r) => (!workspaceId || r.workspaceId === workspaceId) && (!status || r.status === status)).sort(byNewest);
    },
    async deleteRequestsForUid(uid) { for (const [k, v] of requests) if (v.uid === uid) requests.delete(k); },
  };
}

const invCol = () => getAdminFirestore().collection('billingInvoices');
const reqCol = () => getAdminFirestore().collection('planRequests');
const firestoreBillingStore: BillingStore = {
  async addInvoice(i) { await invCol().doc(i.id).set(i); },
  async listInvoices(ws) { return (await invCol().where('workspaceId', '==', ws).get()).docs.map((d) => d.data() as InvoiceRecord).sort(byNewest); },
  async putRequest(r) { await reqCol().doc(r.id).set(r); },
  async getRequest(id) { const d = await reqCol().doc(id).get(); return d.exists ? (d.data() as PlanRequest) : null; },
  async listRequests({ workspaceId, status }) {
    let q: FirebaseFirestore.Query = reqCol();
    if (workspaceId) q = q.where('workspaceId', '==', workspaceId);
    return (await q.get()).docs.map((d) => d.data() as PlanRequest).filter((r) => !status || r.status === status).sort(byNewest).slice(0, 200);
  },
  async deleteRequestsForUid(uid) { await Promise.all((await reqCol().where('uid', '==', uid).get()).docs.map((d) => d.ref.delete())); },
};

let override: BillingStore | null = null;
export function setTestBillingStore(s: BillingStore | null): void { override = s; }
export function getBillingStore(): BillingStore { return override ?? firestoreBillingStore; }
