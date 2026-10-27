import { Users } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiClient, type JoinOffer } from '../api/client';
import { useAppContext } from '../context/AppContext';

const KEY = 'adlens_join_offers_dismissed_v1';

function readDismissed(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function remember(id: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...new Set([...readDismissed(), id])].slice(-50)));
  } catch { /* a browser that blocks storage simply asks again next time */ }
}

/** "Join your colleagues' team?" Shown when the owner of a workspace on the same company email has switched joining on. */
export const JoinOfferPrompt: React.FC = () => {
  const { refreshMe } = useAppContext();
  const [offer, setOffer] = useState<JoinOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.teamOffers()
      .then((r) => {
        const dismissed = readDismissed();
        const next = r.offers.find((o) => !dismissed.includes(o.workspaceId)) ?? null;
        if (!cancelled) setOffer(next);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!offer) return null;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.teamAcceptOffer(offer.workspaceId);
      await refreshMe();
      setOffer(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="join-offer-title" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim">
      <div className="w-full max-w-md rounded-xl border border-line bg-raised p-6 space-y-4 shadow-lg">
        <div className="flex items-center gap-2 text-fg">
          <Users className="w-5 h-5 text-accent-text" />
          <h2 id="join-offer-title" className="text-base font-semibold">Join {offer.ownerName}&apos;s team?</h2>
        </div>
        <p className="text-sm text-fg-muted">
          {offer.ownerName} uses AdLens with an @{offer.domain} address, like you. Join <strong className="text-fg">{offer.workspaceName}</strong> to see its projects, dashboards and saved reports. You keep your own workspace and your own Google and Meta connections.
        </p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => { remember(offer.workspaceId); setOffer(null); }} className="rounded-lg border border-line text-sm text-fg px-4 py-2 min-h-[40px]">Not now</button>
          <button type="button" disabled={busy} onClick={() => void join()} className="rounded-lg bg-accent text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50">Join team</button>
        </div>
      </div>
    </div>
  );
};
