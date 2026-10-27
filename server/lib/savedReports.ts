import { z } from 'zod';
import { ga4SpecSchema, scSpecSchema } from './exploreSpec.js';
import { newDocId, type ProjectDocsStore, type StoredDoc } from './projectDocs.js';

export const MAX_SAVED_REPORTS_PER_PROJECT = 50;

export const savedReportInputSchema = z.discriminatedUnion('source', [
  z.object({ name: z.string().trim().min(1, 'Give the report a name').max(80), source: z.literal('ga4'), spec: ga4SpecSchema }),
  z.object({ name: z.string().trim().min(1, 'Give the report a name').max(80), source: z.literal('search_console'), spec: scSpecSchema }),
]);
export type SavedReportInput = z.infer<typeof savedReportInputSchema>;

export interface SavedReport {
  id: string;
  name: string;
  source: 'ga4' | 'search_console';
  spec: SavedReportInput['spec'];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class SavedReportError extends Error {
  constructor(readonly code: 'LIMIT_REACHED' | 'NOT_FOUND', message: string, readonly status: number) {
    super(message);
  }
}

const toSaved = (d: StoredDoc): SavedReport => d as unknown as SavedReport;

export async function listSavedReports(store: ProjectDocsStore, ws: string, project: string): Promise<SavedReport[]> {
  const docs = await store.list(ws, project, 'savedReports');
  return docs.map(toSaved).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createSavedReport(store: ProjectDocsStore, ws: string, project: string, uid: string, input: SavedReportInput, now = new Date(), maxReports = MAX_SAVED_REPORTS_PER_PROJECT): Promise<SavedReport> {
  const existing = await store.list(ws, project, 'savedReports');
  if (existing.length >= maxReports) {
    throw new SavedReportError('LIMIT_REACHED', `Your plan allows ${maxReports} saved ${maxReports === 1 ? 'report' : 'reports'} per project. Delete one or upgrade to save more.`, 409);
  }
  const iso = now.toISOString();
  const doc: SavedReport = { id: newDocId(), name: input.name, source: input.source, spec: input.spec, createdBy: uid, createdAt: iso, updatedAt: iso };
  await store.put(ws, project, 'savedReports', doc as unknown as StoredDoc);
  return doc;
}

export async function updateSavedReport(store: ProjectDocsStore, ws: string, project: string, id: string, input: SavedReportInput, now = new Date()): Promise<SavedReport> {
  const current = await store.get(ws, project, 'savedReports', id);
  if (!current) throw new SavedReportError('NOT_FOUND', 'Saved report not found.', 404);
  const next: SavedReport = { ...toSaved(current), name: input.name, source: input.source, spec: input.spec, updatedAt: now.toISOString() };
  await store.put(ws, project, 'savedReports', next as unknown as StoredDoc);
  return next;
}

export async function deleteSavedReport(store: ProjectDocsStore, ws: string, project: string, id: string): Promise<void> {
  const ok = await store.delete(ws, project, 'savedReports', id);
  if (!ok) throw new SavedReportError('NOT_FOUND', 'Saved report not found.', 404);
}
