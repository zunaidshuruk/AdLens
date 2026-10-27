import { History } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useApp } from '../context/AppContext';

const LABELS: Record<string, string> = {
  'sso.configured': 'Single sign-on set up or verified',
  'sso.removed': 'Single sign-on removed',
  'sso.enforcement_changed': 'Sign-in requirements changed',
  'project.deleted': 'A project was deleted',
};

/** Owners and admins: what happened in this workspace. */
export const WorkspaceActivityCard: React.FC = () => {
  const { activeWorkspace } = useApp();
  const wsId = activeWorkspace?.id ?? '';
  const allowed = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const [events, setEvents] = useState<{ id: string; at: string; action: string; detail: string | null; by: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!wsId || !allowed) return;
    apiClient.workspaceAudit(wsId).then((r) => setEvents(r.events)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load activity.'));
  }, [wsId, allowed]);
  if (!activeWorkspace || !allowed) return null;
  return (
    <div data-testid="workspace-activity-card" className="p-5 rounded-xl border border-line bg-surface space-y-3">
      <div className="flex items-center gap-2.5"><History className="w-4 h-4 text-accent-text" /><h2 className="text-sm font-semibold text-fg">Workspace activity</h2></div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {events && events.length === 0 && <p className="text-xs text-fg-muted">Nothing recorded yet.</p>}
      <ul className="divide-y divide-line">
        {(events ?? []).slice(0, 50).map((e) => (
          <li key={e.id} className="py-1.5 flex items-baseline justify-between gap-3">
            <span className="text-xs text-fg">{LABELS[e.action] ?? e.action}{e.detail ? <span className="text-fg-muted"> · {e.detail}</span> : null} <span className="text-fg-muted">· {e.by}</span></span>
            <time dateTime={e.at} className="text-[11px] text-fg-muted whitespace-nowrap">{new Date(e.at).toLocaleString()}</time>
          </li>
        ))}
      </ul>
    </div>
  );
};
