import { MonitorOff } from 'lucide-react';
import React, { useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { TwoStepCard } from './TwoStepCard';
import { WorkspaceTwoStepRule } from './WorkspaceTwoStepRule';

/** Security tab: two-step verification and "sign out everywhere". */
export const SessionsCard: React.FC = () => {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const out = async () => {
    if (!window.confirm('Sign out of AdLens on every device, including this one?')) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.signOutEverywhere();
      await signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign you out everywhere.');
      setBusy(false);
    }
  };

  return (
    <div data-testid="sessions-card" className="p-5 rounded-xl border border-line bg-surface space-y-5">
      <TwoStepCard />
      <div className="border-t border-line pt-4"><WorkspaceTwoStepRule /></div>
      <div className="border-t border-line pt-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg"><MonitorOff className="w-4 h-4 text-accent-text" /> Sign out everywhere</div>
        <p className="text-xs text-fg-muted">Lost a laptop or phone, or signed in on a shared computer? This ends every AdLens session. You will sign in again here.</p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void out()} className="rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px] disabled:opacity-50">Sign out on all devices</button>
      </div>
    </div>
  );
};
