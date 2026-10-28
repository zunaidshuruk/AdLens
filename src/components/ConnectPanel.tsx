import { Plug } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { ConnectorInfo, DatasetInfo } from '../types/explore.js';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** Pick a service, fill in a few details and its data becomes a table you can explore. Platforms that are not ready show as "coming soon". */
export const ConnectPanel: React.FC<{ onConnected: (d: DatasetInfo) => void }> = ({ onConnected }) => {
  const [list, setList] = useState<ConnectorInfo[] | null>(null);
  const [open, setOpen] = useState<ConnectorInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiClient.listConnectors().then((c) => live && setList(c)).catch(() => live && setList([]));
    return () => { live = false; };
  }, []);

  const pick = (c: ConnectorInfo) => { setOpen(c); setValues({}); setName(c.label); setError(null); };
  const submit = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiClient.connectDataset(name.trim() || open.label, open.id, values);
      setValues({});
      setOpen(null);
      onConnected(d);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!list || list.length === 0) return null;
  const groups = [...new Set(list.map((c) => c.group))];
  const field = 'block w-full rounded-lg border border-line bg-surface text-fg text-xs px-2 py-2 min-h-[36px]';
  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-fg inline-flex items-center gap-1.5"><Plug className="w-4 h-4" /> Connect a data source</h3>
      <p className="text-xs text-fg-muted">Pick a platform to pull its data in as a table. Connections are read-only. Platforms marked “soon” will connect directly later; until then export a CSV from them and upload it below.</p>
      {groups.map((g) => (
        <div key={g} className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{g}</p>
          <ul className="flex flex-wrap gap-2">
            {list.filter((c) => c.group === g).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={c.status === 'soon'}
                  aria-pressed={open?.id === c.id}
                  title={c.status === 'soon' ? 'Coming soon. Export a CSV and upload it for now.' : c.blurb}
                  onClick={() => pick(c)}
                  className={`text-xs rounded-lg border px-3 py-2 min-h-[36px] ${open?.id === c.id ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg hover:bg-fill-2'} disabled:opacity-60 disabled:hover:bg-transparent`}
                >
                  {c.label}{c.status === 'soon' && <span className="ml-1.5 text-[10px] text-fg-subtle">soon</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {open && (
        <form className="rounded-lg border border-line bg-fill-1 p-3 space-y-3" aria-label={`Connect ${open.label}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <p className="text-xs text-fg-muted">{open.blurb}</p>
          {open.steps && (
            <ol className="list-decimal pl-5 text-xs text-fg-muted space-y-0.5">
              {open.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-fg-muted space-y-1"><span>Table name</span>
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={field} />
            </label>
            {open.fields.map((f) => (
              <label key={f.key} className="text-xs text-fg-muted space-y-1"><span>{f.label}</span>
                <input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  value={values[f.key] ?? ''}
                  maxLength={400}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className={field}
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || open.fields.some((f) => !(values[f.key] ?? '').trim())} className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">{busy ? 'Connecting…' : 'Connect and fetch data'}</button>
            <button type="button" onClick={() => setOpen(null)} className="text-xs text-fg-muted hover:text-fg underline">Cancel</button>
            {error && <span role="alert" className="text-xs text-danger">{error}</span>}
          </div>
        </form>
      )}
    </div>
  );
};
