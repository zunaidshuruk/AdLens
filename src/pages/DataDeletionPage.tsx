import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PublicShell } from '../components/PublicShell';
import { usePublicLegal } from '../hooks/usePublicLegal';

type Status = { state: 'loading' } | { state: 'ok'; status: 'completed' | 'nothing_stored'; completedAt: string } | { state: 'missing' } | { state: 'error' };

/** The address Meta requires: instructions for deleting data, and a status check for a data deletion request code. */
export const DataDeletionPage: React.FC = () => {
  const [params] = useSearchParams();
  const code = (params.get('code') ?? '').trim();
  const owner = usePublicLegal();
  const [status, setStatus] = useState<Status>({ state: 'loading' });

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetch(`/api/platform/data-deletion/status?code=${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404 || r.status === 400) return setStatus({ state: 'missing' });
        if (!r.ok) return setStatus({ state: 'error' });
        const b = (await r.json()) as { status: 'completed' | 'nothing_stored'; completedAt: string };
        setStatus({ state: 'ok', status: b.status, completedAt: b.completedAt });
      })
      .catch(() => !cancelled && setStatus({ state: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <PublicShell>
      <article className="max-w-2xl space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">Data deletion</h1>
        {code && (
          <section className="rounded-xl border border-line bg-surface p-4" aria-live="polite">
            <h2 className="text-sm font-semibold text-fg">Your request <span className="font-mono text-xs text-fg-muted">{code}</span></h2>
            <p className="mt-2 text-sm text-fg">
              {status.state === 'loading' && 'Checking…'}
              {status.state === 'missing' && 'We could not find a request with that code. Check that the link was copied completely.'}
              {status.state === 'error' && 'The status could not be checked right now. Please try again in a few minutes.'}
              {status.state === 'ok' && status.status === 'completed' && `Done. The Facebook connection and the data linked to it were deleted on ${status.completedAt.slice(0, 10)}.`}
              {status.state === 'ok' && status.status === 'nothing_stored' && `Done on ${status.completedAt.slice(0, 10)}. We did not hold any Facebook data linked to this account.`}
            </p>
          </section>
        )}
        <section className="space-y-2 text-sm text-fg leading-6">
          <h2 className="text-lg font-semibold">How to delete your data</h2>
          <p><strong>In AdLens:</strong> sign in, open Connections and choose Disconnect on Facebook (or Google). This removes the stored access and asks the provider to revoke it. To remove everything, open Settings and choose Delete account.</p>
          <p><strong>From Facebook:</strong> open Facebook Settings → Business integrations (or Apps and websites), choose AdLens and press Remove. You can also ask Facebook to delete the data AdLens holds. AdLens then receives a signed notice and deletes your Facebook connection automatically, and you can check the result on this page with your confirmation code.</p>
          <p><strong>By email:</strong> {owner.supportEmail ? <>write to <a className="text-accent-text underline" href={`mailto:${owner.supportEmail}`}>{owner.supportEmail}</a> from the address you signed up with.</> : 'use the Help link inside AdLens.'}</p>
          <p>AdLens reads your analytics data only when you open a screen and does not save it in its database, so deleting your connection and account removes what AdLens holds. See the <Link to="/privacy" className="text-accent-text underline">Privacy Policy</Link> for details.</p>
        </section>
      </article>
    </PublicShell>
  );
};
