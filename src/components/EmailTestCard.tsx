import { Mail } from 'lucide-react';
import React, { useState } from 'react';
import { apiClient } from '../api/client';

/** Settings: send yourself a test email and see, in plain words, why mail is not arriving. */
export const EmailTestCard: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true); setResult(null);
    try { const r = await apiClient.testEmailDelivery(); setResult({ ok: r.sent, text: r.message }); }
    catch (e) { setResult({ ok: false, text: e instanceof Error ? e.message : 'The test could not be run.' }); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div className="space-y-1"><h2 className="text-sm font-semibold text-fg inline-flex items-center gap-1.5"><Mail className="w-4 h-4" aria-hidden /> Email delivery check</h2>
        <p className="text-xs text-fg-muted">Not getting emails from AdLens (sign-up confirmation, password reset, alerts, scheduled reports)? Send yourself a test. If it fails, the message says what the server needs. Check your spam folder too.</p></div>
      <button type="button" onClick={() => void run()} disabled={busy} className="inline-flex items-center justify-center rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50">{busy ? 'Sending…' : 'Send me a test email'}</button>
      {result && <p role={result.ok ? 'status' : 'alert'} className={`text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>{result.text}</p>}
    </section>
  );
};
