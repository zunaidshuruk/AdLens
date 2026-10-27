import { ShieldCheck, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listFactors, removeFactor, startTotpEnrollment, type TotpEnrollment } from '../lib/mfa';
import { mapFirebaseErrorMessage } from '../utils/firebaseErrors';

/** Turn two-step verification (authenticator app) on or off for the signed-in person. */
export const MfaSetup: React.FC<{ onEnrolled?: () => void }> = ({ onEnrolled }) => {
  const { user } = useAuth();
  const [, tick] = useState(0);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const factors = listFactors(user);

  const fail = (e: unknown) => setError(e instanceof Error && !(e as { code?: string }).code ? e.message : mapFirebaseErrorMessage(e));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await startTotpEnrollment(user));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    try {
      await enrollment.finish(code);
      setEnrollment(null);
      setCode('');
      tick((n) => n + 1);
      onEnrolled?.();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (uid: string) => {
    setBusy(true);
    setError(null);
    try {
      await removeFactor(user, uid);
      tick((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="mfa-setup" className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck className="w-4 h-4 text-accent-text" /> Two-step verification</div>
      <p className="text-xs text-fg-muted">Use an authenticator app (such as Google Authenticator, Microsoft Authenticator or 1Password). After your password, you enter a 6-digit code from the app.</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {factors.length > 0 && (
        <ul className="divide-y divide-line">
          {factors.map((f) => (
            <li key={f.uid} className="py-2 flex items-center justify-between gap-3">
              <span className="text-xs text-fg">{f.displayName}{f.enrolledAt ? <span className="text-fg-muted"> · added {new Date(f.enrolledAt).toLocaleDateString()}</span> : null}</span>
              <button type="button" aria-label={`Remove ${f.displayName}`} disabled={busy} onClick={() => void remove(f.uid)} className="rounded-md border border-line p-2 text-fg-muted hover:text-danger min-h-[36px] min-w-[36px]"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {!enrollment && factors.length === 0 && (
        <button type="button" disabled={busy} onClick={() => void start()} className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">Set up two-step verification</button>
      )}
      {enrollment && (
        <div className="space-y-2 rounded-lg border border-line bg-fill-1 p-3">
          <p className="text-xs text-fg">1. In your authenticator app, choose “Add account” and enter this key by hand:</p>
          <code data-testid="mfa-secret" className="block overflow-x-auto rounded-md border border-line bg-surface p-2 text-xs text-fg select-all">{enrollment.secretKey}</code>
          <p className="text-xs text-fg-muted">On a phone, <a className="text-accent-text underline" href={enrollment.otpauthUrl}>tap here to add it automatically</a>.</p>
          <p className="text-xs text-fg">2. Enter the 6-digit code the app shows:</p>
          <div className="flex gap-2">
            <input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-32 text-center tracking-[0.3em] rounded-lg border border-line bg-surface text-fg py-2" />
            <button type="button" disabled={busy || code.length !== 6} onClick={() => void finish()} className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">Turn on</button>
            <button type="button" onClick={() => { setEnrollment(null); setCode(''); }} className="rounded-lg border border-line text-xs text-fg px-3 py-2 min-h-[36px]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};
