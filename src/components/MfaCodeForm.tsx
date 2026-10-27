import { ShieldCheck } from 'lucide-react';
import React, { useState } from 'react';
import type { MultiFactorResolver } from 'firebase/auth';
import { completeMfaSignIn } from '../lib/mfa';
import { mapFirebaseErrorMessage } from '../utils/firebaseErrors';

/** Asks for the 6-digit authenticator code to finish a sign-in. */
export const MfaCodeForm: React.FC<{ resolver: MultiFactorResolver; onCancel: () => void }> = ({ resolver, onCancel }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await completeMfaSignIn(resolver, code);
    } catch (err) {
      setError(err instanceof Error && !(err as { code?: string }).code ? err.message : mapFirebaseErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} data-testid="mfa-code-form" className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck className="w-4 h-4" /> Two-step verification</div>
      <p className="text-xs text-fg-muted">Open your authenticator app and enter the 6-digit code for AdLens.</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <input
        aria-label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        className="w-full text-center tracking-[0.4em] text-lg rounded-xl border border-line bg-fill-1 text-fg py-2.5 focus:outline-none focus:ring-2 focus:ring-focus"
      />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || code.length !== 6} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-on-accent bg-accent disabled:opacity-50">{busy ? 'Checking…' : 'Verify'}</button>
        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl text-sm border border-line text-fg">Cancel</button>
      </div>
    </form>
  );
};
