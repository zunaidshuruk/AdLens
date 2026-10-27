import { Mail } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useApp } from '../context/AppContext';

type Sub = { weekly: boolean; alerts: boolean };

/** Weekly summary and traffic spike/drop alerts, per project. Mail goes to the person's own sign-in address. */
export const EmailSummariesCard: React.FC = () => {
  const { activeWorkspace, projects } = useApp();
  const [subs, setSubs] = useState<Record<string, Sub>>({});
  const [info, setInfo] = useState<{ emailConfigured: boolean; email: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.digestGet();
      setInfo({ emailConfigured: r.emailConfigured, email: r.email });
      setSubs(Object.fromEntries(r.subscriptions.map((s) => [`${s.workspaceId}/${s.projectId}`, { weekly: s.weekly, alerts: s.alerts }])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load email settings.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const real = projects.filter((p) => !p.isDemo);
  if (!activeWorkspace) return null;

  const change = async (projectId: string, next: Sub) => {
    const key = `${activeWorkspace.id}/${projectId}`;
    setBusy(key);
    try {
      await apiClient.digestSet({ workspaceId: activeWorkspace.id, projectId, ...next });
      setSubs((prev) => ({ ...prev, [key]: next }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="email-summaries-card" className="p-5 rounded-xl border border-line bg-surface space-y-3">
      <div className="flex items-center gap-2.5">
        <Mail className="w-4 h-4 text-accent-text" />
        <h2 className="text-sm font-semibold text-fg">Email summaries</h2>
      </div>
      <p className="text-xs text-fg-muted">A short weekly summary, and a note when traffic suddenly jumps or drops. Sent to {info?.email ?? 'your sign-in email'}.</p>
      {info && !info.emailConfigured && <p className="text-xs text-fg-muted">Email sending is not set up on this AdLens yet, so nothing will be sent until the owner adds it.</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {real.length === 0 && <p className="text-xs text-fg-muted">Add a project first.</p>}
      <ul className="divide-y divide-line">
        {real.map((p) => {
          const key = `${activeWorkspace.id}/${p.id}`;
          const cur = subs[key] ?? { weekly: false, alerts: false };
          return (
            <li key={p.id} className="py-2 space-y-1">
              <p className="text-sm text-fg">{p.name} <span className="text-xs text-fg-muted">{p.domain}</span></p>
              <label className="flex items-center gap-2 text-xs text-fg min-h-[32px]"><input type="checkbox" disabled={busy === key} checked={cur.weekly} onChange={(e) => void change(p.id, { ...cur, weekly: e.target.checked })} /> Weekly summary</label>
              <label className="flex items-center gap-2 text-xs text-fg min-h-[32px]"><input type="checkbox" disabled={busy === key} checked={cur.alerts} onChange={(e) => void change(p.id, { ...cur, alerts: e.target.checked })} /> Alert me about traffic spikes and drops</label>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
