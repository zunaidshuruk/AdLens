import { Copy, Download, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { setProof } from '../lib/twoStep';

type Status = { enabled: boolean; backupCodesLeft: number; enabledAt: string | null };
const btn = 'rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50';
const btn2 = 'rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px] disabled:opacity-50';
const input = 'rounded-lg border border-line bg-fill-1 text-fg text-sm px-3 py-2 min-h-[40px] tracking-widest';

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`AdLens backup codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'adlens-backup-codes.txt'; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3" data-testid="backup-codes">
      <p className="text-sm text-fg"><strong>Save these backup codes now.</strong> They are shown only once. If you lose your phone, each code lets you sign in one time.</p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-fill-1 p-3 font-mono text-sm text-fg">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn2} onClick={() => void navigator.clipboard?.writeText(text)}><Copy className="inline w-3.5 h-3.5 mr-1" />Copy</button>
        <button type="button" className={btn2} onClick={download}><Download className="inline w-3.5 h-3.5 mr-1" />Download</button>
        <button type="button" className={btn} onClick={onDone}>I have saved them</button>
      </div>
    </div>
  );
}

/** Settings → Security: turn authenticator-app two-step verification on or off, and make new backup codes. */
export const TwoStepCard: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [action, setAction] = useState<'disable' | 'codes' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { apiClient.twoStepStatus().then(setStatus).catch(() => setStatus({ enabled: false, backupCodesLeft: 0, enabledAt: null })); }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  };

  const start = () => run(async () => {
    const r = await apiClient.twoStepStart();
    setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 192 }) });
    setCode('');
  });
  const confirm = () => run(async () => {
    const r = await apiClient.twoStepConfirm(code);
    setProof(r.proof);
    setSetup(null); setCode(''); setCodes(r.backupCodes);
    load();
  });
  const finishAction = () => run(async () => {
    if (action === 'disable') {
      await apiClient.twoStepDisable(code);
      setAction(null); setCode(''); load();
    } else if (action === 'codes') {
      const r = await apiClient.twoStepNewBackupCodes(code);
      setAction(null); setCode(''); setCodes(r.backupCodes); load();
    }
  });

  if (!status) return <div className="text-xs text-fg-muted">Loading…</div>;

  return (
    <div data-testid="two-step-card" className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck className="w-4 h-4 text-accent-text" /> Two-step verification (authenticator app)</div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}

      {codes && <BackupCodes codes={codes} onDone={() => setCodes(null)} />}

      {!codes && !status.enabled && !setup && (
        <>
          <p className="text-xs text-fg-muted">After your password, AdLens asks for a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy). It is free and works offline.</p>
          <button type="button" disabled={busy} className={btn} onClick={() => void start()}>Turn on two-step verification</button>
        </>
      )}

      {!codes && setup && (
        <div className="space-y-3">
          <ol className="list-decimal pl-5 text-xs text-fg-muted space-y-1">
            <li>Open your authenticator app and choose "add account" or the + button.</li>
            <li>Scan this picture (or type the key under it).</li>
            <li>Type the 6-digit code the app shows, then press Confirm.</li>
          </ol>
          <img src={setup.qr} alt="QR code for your authenticator app" width={192} height={192} className="rounded-lg border border-line p-1" style={{ background: "#ffffff" }} />
          <p className="text-xs text-fg-muted">Can't scan? Type this key: <code className="font-mono text-fg break-all select-all">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
          <div className="flex flex-wrap gap-2">
            <input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} className={`${input} w-32 text-center`} />
            <button type="button" disabled={busy || code.replace(/\s/g, '').length !== 6} className={btn} onClick={() => void confirm()}>Confirm</button>
            <button type="button" disabled={busy} className={btn2} onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {!codes && status.enabled && (
        <div className="space-y-3">
          <p className="text-xs text-fg">On{status.enabledAt ? <span className="text-fg-muted"> · since {new Date(status.enabledAt).toLocaleDateString()}</span> : null}. You have <strong>{status.backupCodesLeft}</strong> backup {status.backupCodesLeft === 1 ? 'code' : 'codes'} left.</p>
          {!action && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn2} onClick={() => { setAction('codes'); setCode(''); setError(null); }}>Make new backup codes</button>
              <button type="button" className={btn2} onClick={() => { setAction('disable'); setCode(''); setError(null); }}>Turn off</button>
            </div>
          )}
          {action && (
            <div className="space-y-2">
              <p className="text-xs text-fg-muted">To {action === 'disable' ? 'turn it off' : 'make new codes'}, enter a fresh code from your app (wait for it to change if you just used one) or a backup code.</p>
              <div className="flex flex-wrap gap-2">
                <input aria-label="Code" autoComplete="one-time-code" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} className={`${input} w-40 text-center`} />
                <button type="button" disabled={busy || code.replace(/\s/g, '').length < 6} className={btn} onClick={() => void finishAction()}>{action === 'disable' ? 'Turn off' : 'Make new codes'}</button>
                <button type="button" disabled={busy} className={btn2} onClick={() => { setAction(null); setCode(''); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
