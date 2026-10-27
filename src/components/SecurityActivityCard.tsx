import { History } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

const LABELS: Record<string, string> = {
  'connection.google.connected': 'Connected Google',
  'connection.google.disconnected': 'Disconnected Google',
  'connection.meta.connected': 'Connected Meta',
  'connection.meta.disconnected': 'Disconnected Meta',
  'project.deleted': 'Deleted a project',
  'mcp.key_created': 'Created an AI-tool access key',
  'mcp.key_revoked': 'Deleted an AI-tool access key',
  'mcp.app_approved': 'Approved an AI app',
  'mcp.app_revoked': 'Disconnected an AI app',
  'sso.configured': 'Set up single sign-on',
  'sso.removed': 'Removed single sign-on',
  'sso.enforcement_changed': 'Changed the single sign-on requirement',
  'sso.signin_blocked': 'A sign-in was blocked by the single sign-on rule',
};

/** The person's own recent security-relevant actions, newest first. */
export const SecurityActivityCard: React.FC = () => {
  const [events, setEvents] = useState<{ id: string; at: string; action: string; detail: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiClient.opsAudit().then((r) => setEvents(r.events)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load activity.'));
  }, []);
  return (
    <div data-testid="security-activity-card" className="p-5 rounded-xl border border-line bg-surface space-y-3">
      <div className="flex items-center gap-2.5">
        <History className="w-4 h-4 text-accent-text" />
        <h2 className="text-sm font-semibold text-fg">Recent security activity</h2>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {events && events.length === 0 && <p className="text-xs text-fg-muted">Nothing recorded yet.</p>}
      <ul className="divide-y divide-line">
        {(events ?? []).slice(0, 25).map((e) => (
          <li key={e.id} className="py-1.5 flex items-baseline justify-between gap-3">
            <span className="text-xs text-fg">{LABELS[e.action] ?? e.action}{e.detail ? <span className="text-fg-muted"> · {e.detail}</span> : null}</span>
            <time dateTime={e.at} className="text-[11px] text-fg-muted whitespace-nowrap">{new Date(e.at).toLocaleString()}</time>
          </li>
        ))}
      </ul>
    </div>
  );
};
