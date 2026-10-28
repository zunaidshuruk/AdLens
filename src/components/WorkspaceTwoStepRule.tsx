import { ShieldAlert } from 'lucide-react';
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

/** Settings → Security: owners and admins can require two-step verification of every owner and admin in the workspace. */
export const WorkspaceTwoStepRule: React.FC = () => {
  const { activeWorkspace, updateWorkspaceSettings } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!activeWorkspace || !activeWorkspace.permissions?.includes('workspace.settings')) return null;
  const on = activeWorkspace.requireTwoStep === true;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try { await updateWorkspaceSettings({ requireTwoStep: !on }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not change this setting.'); } finally { setBusy(false); }
  };

  return (
    <div data-testid="workspace-two-step-rule" className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldAlert className="w-4 h-4 text-accent-text" /> Require two-step for owners and admins</div>
      <p className="text-xs text-fg-muted">
        {on
          ? `On for "${activeWorkspace.name}". Owners and admins must have two-step verification turned on to open this workspace's data or change anything in it. People who have not set it up are asked to do so first.`
          : 'Off. When you turn it on, every owner and admin of this workspace must use an authenticator app. You need to turn on your own two-step first, so you are not locked out.'}
      </p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void toggle()} className="rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px] disabled:opacity-50">
        {on ? 'Stop requiring two-step' : 'Require two-step for owners and admins'}
      </button>
    </div>
  );
};
