/** Tables that come from a connector: create them (secrets sealed) and refresh them. */
import { connectorById, fetchConnectorTable, splitConnectorInput } from './connectors.js';
import { DatasetError, type Dataset } from './datasets.js';
import { newDocId, type ProjectDocsStore, type StoredDoc } from './projectDocs.js';
import type { RequestFn } from './ssrfGuard.js';
import { openAgentSecret, sealAgentSecret, type Keyring } from './tokenVault.js';

/** The keyring may be given lazily, so it is only built when a secret is actually sealed or opened. */
export interface ConnectDeps { keyring: Keyring | (() => Keyring); request?: RequestFn; now?: Date }

const ringOf = (k: Keyring | (() => Keyring)): Keyring => (typeof k === 'function' ? k() : k);
const seal = (secrets: Record<string, string>, uid: string, id: string, ring: Keyring | (() => Keyring)): string | undefined =>
  Object.keys(secrets).length > 0 ? sealAgentSecret(JSON.stringify(secrets), uid, id, ringOf(ring)) : undefined;

export async function createConnectedDataset(
  store: ProjectDocsStore, ws: string, project: string, uid: string,
  input: { name: string; connector: string; values: unknown }, maxDatasets: number, deps: ConnectDeps,
): Promise<Dataset> {
  const info = connectorById(input.connector);
  if (!info || info.status !== 'live') throw new DatasetError('CONNECTOR_FAILED', 'That connector is not available yet. Export a CSV from it and upload the file instead.', 400);
  const existing = await store.list(ws, project, 'datasets');
  if (existing.length >= maxDatasets) {
    throw new DatasetError('LIMIT_REACHED', `Your plan allows ${maxDatasets} uploaded ${maxDatasets === 1 ? 'table' : 'tables'} per project. Delete one or upgrade to add more.`, 409);
  }
  const { params, secrets } = splitConnectorInput(info, input.values);
  const table = await fetchConnectorTable(info.id, params, secrets, deps.request, deps.now);
  const id = newDocId();
  const iso = (deps.now ?? new Date()).toISOString();
  const sealed = seal(secrets, uid, id, deps.keyring);
  const doc: Dataset = {
    id, name: input.name, columns: table.columns, rows: table.rows, rowCount: table.rows.length,
    createdBy: uid, createdAt: iso, updatedAt: iso, syncedAt: iso,
    connector: { id: info.id, label: info.label, params },
    ...(sealed ? { sealedSecret: sealed } : {}),
    ...(table.note ? { note: table.note } : {}),
  };
  await store.put(ws, project, 'datasets', doc as unknown as StoredDoc);
  return doc;
}

/** Fetches the table again and replaces its rows. Column keys may change, so reports are re-checked when they run. */
export async function refreshConnectedDataset(store: ProjectDocsStore, ws: string, project: string, id: string, deps: ConnectDeps): Promise<Dataset> {
  const current = (await store.get(ws, project, 'datasets', id)) as unknown as Dataset | null;
  if (!current) throw new DatasetError('NOT_FOUND', 'That table was not found.', 404);
  if (!current.connector) throw new DatasetError('CONNECTOR_FAILED', 'This table was uploaded as a file, so there is nothing to refresh. Upload the new file instead.', 400);
  let secrets: Record<string, string> = {};
  if (current.sealedSecret) {
    try { secrets = JSON.parse(openAgentSecret(current.sealedSecret, current.createdBy, id, ringOf(deps.keyring))) as Record<string, string>; }
    catch { throw new DatasetError('CONNECTOR_FAILED', 'The saved connection details could not be read. Delete this table and connect again.', 400); }
  }
  const table = await fetchConnectorTable(current.connector.id, current.connector.params, secrets, deps.request, deps.now);
  const iso = (deps.now ?? new Date()).toISOString();
  const next: Dataset = { ...current, columns: table.columns, rows: table.rows, rowCount: table.rows.length, updatedAt: iso, syncedAt: iso };
  if (table.note) next.note = table.note; else delete next.note;
  await store.put(ws, project, 'datasets', next as unknown as StoredDoc);
  return next;
}
