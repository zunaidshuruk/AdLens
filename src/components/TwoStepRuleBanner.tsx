import { ShieldAlert } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useApp } from '../context/AppContext';

/** Shown to an owner or admin whose workspace requires two-step verification while they have not turned it on yet. */
export const TwoStepRuleBanner: React.FC = () => {
  const { activeWorkspace } = useApp();
  const asked = activeWorkspace?.requireTwoStep === true && (activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!asked) { setMissing(false); return; }
    let live = true;
    apiClient.twoStepStatus().then((s) => { if (live) setMissing(!s.enabled); }).catch(() => undefined);
    return () => { live = false; };
  }, [asked, activeWorkspace?.id]);

  if (!asked || !missing) return null;
  return (
    <div role="alert" data-testid="two-step-rule-banner" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-fg">
      <ShieldAlert className="w-4 h-4 text-warning shrink-0" />
      <span className="flex-1 min-w-[220px]">"{activeWorkspace?.name}" requires owners and admins to use two-step verification. Turn it on to keep using this workspace's data.</span>
      <Link to="/settings" className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] inline-flex items-center">Open Settings, Security</Link>
    </div>
  );
};
