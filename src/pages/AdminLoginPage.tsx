import { ShieldCheck } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient, type AdminSession } from '../api/client';
import { AdLensLogo } from '../components/AdLensLogo';
import { useAuth } from '../context/AuthContext';

/** Separate sign-in for the admin panel. A fresh sign-in here opens a one-hour admin session. */
export const AdminLoginPage: React.FC = () => {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const expired = params.get('expired') === '1';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<AdminSession | null>(null);

  // Already signed in with time left? Offer to carry on.
  useEffect(() => {
    if (!user || expired) return;
    apiClient.adminSession().then(setSession).catch(() => setSession(null));
  }, [user, expired]);

  const enter = async () => {
    const s = await apiClient.adminSession();
    if (!s.operator) { setSession(s); setError('This Google account is not an admin of AdLens.'); return; }
    if (!s.viaGoogle) { setSession(s); setError('The admin panel only opens with "Continue with Google". Sign out and use Google.'); return; }
    if (s.secondsLeft <= 0) { setError('Please sign in again to open the admin panel.'); return; }
    navigate('/admin', { replace: true });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); await enter(); } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in did not work.'); } finally { setBusy(false); }
  };

  const canContinue = Boolean(user && session?.operator && session.viaGoogle && session.secondsLeft > 0 && !expired);

  return (
    <div className="min-h-screen bg-page text-fg flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 space-y-5">
        <div className="flex items-center gap-3">
          <AdLensLogo className="w-9 h-9" />
          <div>
            <div className="flex items-center gap-1.5 text-base font-semibold text-fg"><ShieldCheck className="w-4 h-4 text-accent-text" />AdLens Admin</div>
            <p className="text-xs text-fg-muted">For operators only</p>
          </div>
        </div>

        {expired && <p role="status" className="text-sm text-warning">Your admin session ended. Please sign in again.</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        {canContinue && (
          <div className="space-y-2">
            <p className="text-sm text-fg">Signed in as <strong className="break-all">{session!.email}</strong>. About {Math.max(1, Math.ceil(session!.secondsLeft / 60))} minutes left.</p>
            <button type="button" className="w-full rounded-lg bg-accent text-on-accent text-sm font-medium px-3 py-2.5 min-h-[44px]" onClick={() => navigate('/admin', { replace: true })}>Continue to the admin panel</button>
            <p className="text-xs text-fg-muted text-center">or sign in again with Google below</p>
          </div>
        )}

        <p className="text-xs text-fg-muted">Admins sign in with Google only, so Google's own 2-Step Verification protects this panel. Use the Google account of an AdLens admin, with 2-Step Verification turned on in that account.</p>
        <button type="button" disabled={busy || loading} onClick={() => void run(() => signInWithGoogle())} className="w-full rounded-lg bg-accent text-on-accent text-sm font-medium px-3 py-2.5 min-h-[44px] disabled:opacity-50">{busy ? 'Signing in…' : 'Continue with Google'}</button>

        <div className="flex items-center justify-between text-xs text-fg-muted">
          <Link to="/" className="underline">Back to AdLens</Link>
          {user && <button type="button" className="underline" onClick={() => void signOut()}>Sign out</button>}
        </div>
      </div>
    </div>
  );
};
