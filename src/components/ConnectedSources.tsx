import { RefreshCw, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { DatasetInfo } from '../types/explore.js';
import { ConnectPanel } from './ConnectPanel';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-xs px-3 py-2 min-h-[36px] disabled:opacity-50';
const when = (iso?: string) => { try { return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; } catch { return ''; } };

/** Connections page: add any platform (LinkedIn, TikTok, X, Pinterest, YouTube, Mailchimp, a shop, a sheet, or any web address) and manage what is already connected. */
export const ConnectedSources: React.FC = () => {
  const [list, setList] = useState<DatasetInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => { try { setList((await apiClient.listDatasets()).datasets); } catch (e) { setError(errMessage(e)); setList([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  const connected = (list ?? []).filter((d) => d.connector);
  const act = async (id: string, fn: () => Promise<unknown>, done: string) => { setBusy(id); setError(null); setNote(null); try { await fn(); setNote(done); await load(); } catch (e) { setError(errMessage(e)); } finally { setBusy(null); } };
  return (
    <section id="sources" className="p-6 rounded-xl border border-line bg-surface space-y-4">
      <div className="space-y-1"><h2 className="text-base font-bold text-fg">Other platforms and data sources</h2>
        <p className="text-xs text-fg-muted">Add LinkedIn, TikTok, X, Pinterest, YouTube, Mailchimp, HubSpot, a shop, a Google Sheet or any other tool. Each one becomes a table you can use in Explore, dashboards and reports. Connections only read data. Tools that do not have a one-click login yet work with a report link or your own access token, or you can upload a CSV export in Explore.</p></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-success">{note}</p>}
      <ConnectPanel onConnected={(d) => { setNote(`Connected “${d.name}” with ${d.rowCount} rows.`); setList((cur) => [d, ...(cur ?? [])]); }} />
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">Connected now</h3>
        {list === null ? <div aria-busy="true" className="h-12 rounded-lg bg-fill-2 animate-pulse" /> : connected.length === 0 ? <p className="text-sm text-fg-muted">Nothing connected yet. Pick a platform above.</p> : (
          <ul className="space-y-2">{connected.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
              <div className="min-w-0"><p className="text-sm font-medium text-fg">{d.name}</p><p className="text-xs text-fg-muted">{d.connector?.label} · {d.rowCount} rows{d.syncedAt ? ` · updated ${when(d.syncedAt)}` : ''}</p></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secondary} disabled={busy !== null} onClick={() => void act(d.id, () => apiClient.refreshDataset(d.id), `Refreshed “${d.name}”.`)}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> {busy === d.id ? 'Working…' : 'Refresh'}</button>
                <button type="button" aria-label={`Disconnect ${d.name}`} className={secondary} disabled={busy !== null} onClick={() => { if (window.confirm(`Disconnect “${d.name}” and delete its table?`)) void act(d.id, () => apiClient.deleteDataset(d.id), `Disconnected “${d.name}”.`); }}><Trash2 className="h-3.5 w-3.5" aria-hidden /> Disconnect</button>
              </div>
            </li>))}</ul>
        )}
        <p className="text-xs text-fg-muted">Tables you upload as CSV files live in <Link to="/explore" className="underline">Explore</Link>.</p>
      </div>
    </section>
  );
};
