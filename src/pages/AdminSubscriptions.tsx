import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type AdminSubscriptionRow } from '../api/client';

const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
const STATUS: Record<string, string> = { none: 'No end date', active: 'Active', grace: 'Grace period', expired: 'Expired' };

/** Which person is on which plan, across every workspace. */
export function Subscriptions({ onOpen }: { onOpen: (workspaceId: string) => void }) {
  const [plan, setPlan] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminSubscriptionRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string, query: string) => {
    setLoading(true);
    try {
      const r = await apiClient.adminSubscriptions(p, query);
      setRows(r.rows); setTruncated(r.truncated); setError(null);
      if (!p && !query) setCounts(r.peopleByPlan);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(plan, q); }, [plan, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (id: string, label: string, n?: number) => (
    <button key={id} type="button" onClick={() => setPlan(id)} aria-pressed={plan === id}
      className={`rounded-full border px-3 py-1 text-xs min-h-[32px] ${plan === id ? 'border-accent bg-accent-soft text-accent-text font-medium' : 'border-line text-fg'}`}>
      {label}{n !== undefined ? `: ${n}` : ''}
    </button>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">Every person and the plan their workspace is on. People in a team share their workspace's plan.</p>
      <div className="flex flex-wrap gap-2">
        {chip('', 'All', Object.values(counts).reduce((a, b) => a + b, 0))}
        {Object.entries(counts).map(([id, n]) => chip(id, id, n))}
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void load(plan, q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email, name or workspace" className={`${field} flex-1 min-w-[220px]`} aria-label="Search subscriptions" />
        <button type="submit" className="rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px]">Search</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {truncated && <p className="text-xs text-warning">Showing the first 300 workspaces only. Use the plan buttons or search to narrow down.</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-fg-muted"><th className="p-3">Person</th><th className="p-3">Workspace</th><th className="p-3">Role</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">Paid until</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.workspaceId}:${r.uid}`} className="border-t border-line">
                <td className="p-3 text-fg"><div className="break-all">{r.email || '(no email)'}</div><div className="text-xs text-fg-muted">{r.displayName}</div></td>
                <td className="p-3"><button type="button" className="underline text-fg text-left" onClick={() => onOpen(r.workspaceId)}>{r.workspaceName}</button></td>
                <td className="p-3 text-fg capitalize">{r.role}</td>
                <td className="p-3 text-fg">{r.label}</td>
                <td className="p-3 text-fg">{STATUS[r.status] ?? r.status}</td>
                <td className="p-3 text-fg">{day(r.planExpiresAt)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-sm text-fg-muted">Nobody found.</td></tr>}
            {loading && <tr><td colSpan={6} className="p-6 text-center text-sm text-fg-muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
