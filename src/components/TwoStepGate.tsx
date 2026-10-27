import { ShieldCheck } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { TWO_STEP_EVENT, setProof } from '../lib/twoStep';
import { AdLensLogo } from './AdLensLogo';

/** The code screen shown after sign-in when the person turned on two-step verification. */
const Prompt: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { signOut } = useAuth();
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiClient.twoStepVerify(code);
      setProof(r.proof);
      if (r.usedBackupCode && r.backupCodesLeft <= 3) {
        setLeft(r.backupCodesLeft);
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the code.');
      setBusy(false);
    }
  };

  if (left !== null) {
    return (
      <Shell>
        <p role="status" className="text-sm text-fg">That backup code is now used. You have <strong>{left}</strong> left. Make new ones in Settings → Security.</p>
        <button type="button" onClick={onDone} className="w-full rounded-xl bg-accent text-on-accent text-sm font-semibold py-2.5 min-h-[44px]">Continue</button>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit} data-testid="two-step-prompt" className="space-y-4">
        <p className="text-sm text-fg-muted">
          {useBackup ? 'Enter one of your backup codes (like abcde-fghij). Each works once.' : 'Open your authenticator app and type the 6-digit code for AdLens.'}
        </p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <input
          aria-label={useBackup ? 'Backup code' : '6-digit code'}
          autoFocus
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          maxLength={useBackup ? 12 : 7}
          value={code}
          onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/[^\d ]/g, ''))}
          className="w-full text-center tracking-[0.3em] text-lg rounded-xl border border-line bg-fill-1 text-fg py-2.5 focus:outline-none focus:ring-2 focus:ring-focus"
        />
        <button type="submit" disabled={busy || code.replace(/\s/g, '').length < (useBackup ? 10 : 6)} className="w-full rounded-xl bg-accent text-on-accent text-sm font-semibold py-2.5 min-h-[44px] disabled:opacity-50">{busy ? 'Checking…' : 'Continue'}</button>
        <div className="flex items-center justify-between text-xs">
          <button type="button" className="underline text-fg-muted" onClick={() => { setUseBackup((v) => !v); setCode(''); setError(null); }}>{useBackup ? 'Use my authenticator app' : 'Lost my phone? Use a backup code'}</button>
          <button type="button" className="underline text-fg-muted" onClick={() => void signOut()}>Sign out</button>
        </div>
      </form>
    </Shell>
  );
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-page text-fg flex items-center justify-center p-4">
    <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 space-y-5">
      <div className="flex items-center gap-3">
        <AdLensLogo className="w-9 h-9" />
        <div className="flex items-center gap-1.5 text-base font-semibold text-fg"><ShieldCheck className="w-4 h-4 text-accent-text" />Two-step verification</div>
      </div>
      {children}
    </div>
  </div>
);

/**
 * Wraps the signed-in app. If the person has two-step verification on and this sign-in has not given its code yet,
 * shows the code screen instead of the app. The server enforces this too; this only makes it pleasant.
 */
export const TwoStepGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [state, setState] = useState<'checking' | 'ask' | 'ok'>('checking');

  const check = useCallback(async () => {
    try {
      const s = await apiClient.twoStepStatus();
      setState(s.enabled && !s.proven ? 'ask' : 'ok');
    } catch {
      setState('ok'); // the server still protects every call; a failed check must not lock people out of a working app
    }
  }, []);

  useEffect(() => {
    if (!uid) return;
    setState('checking');
    void check();
  }, [uid, check]);

  useEffect(() => {
    const onNeed = () => setState('ask');
    window.addEventListener(TWO_STEP_EVENT, onNeed);
    return () => window.removeEventListener(TWO_STEP_EVENT, onNeed);
  }, []);

  if (!uid) return <>{children}</>;
  if (state === 'checking') {
    return <div className="min-h-screen flex items-center justify-center bg-page"><AdLensLogo className="w-12 h-12 animate-pulse" /></div>;
  }
  if (state === 'ask') return <Prompt onDone={() => setState('ok')} />;
  return <>{children}</>;
};
