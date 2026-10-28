import { CheckCircle2, CircleAlert, CircleDashed, HeartPulse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

type Report = Awaited<ReturnType<typeof apiClient.opsDiagnose>>;

/** Owner-only card: one button runs the server check and lists what is set up and what is missing, in plain words. */
export function ServerHealthCard() {
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    let live = true;
    apiClient.billingWhoAmI().then((r) => { if (live) setOwner(Boolean(r.isOperator)); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!owner) return null;

  const run = async () => {
    setBusy(true); setError(null);
    try { setReport(await apiClient.opsDiagnose()); } catch (e) { setError(e instanceof Error ? e.message : 'The check could not run.'); }
    setBusy(false);
  };
  const problems = report ? report.checks.filter((c) => !c.ok && c.required).length + (report.firestore && !report.firestore.ok ? 1 : 0) : 0;

  return (
    <div className="p-5 rounded-xl border border-line bg-surface space-y-3" data-testid="server-health-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5"><HeartPulse className="w-4 h-4 text-accent-text" /><h2 className="text-sm font-semibold text-fg">Server health check</h2></div>
        <button type="button" disabled={busy} onClick={() => void run()} className="rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">{busy ? 'Checking…' : report ? 'Check again' : 'Run check'}</button>
      </div>
      <p className="text-xs text-fg-muted">Only you, the owner, can see this. It tests the database and lists which settings are in place. It never shows any secret values.</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {report && (
        <div className="space-y-2">
          <p className={`text-sm font-medium ${problems === 0 ? 'text-success' : 'text-danger'}`}>{problems === 0 ? 'Everything required is working.' : `${problems} required ${problems === 1 ? 'item needs' : 'items need'} attention.`}</p>
          <ul className="space-y-1.5">
            {report.firestore && (
              <li className="flex gap-2 text-xs">
                {report.firestore.ok ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : <CircleAlert className="w-4 h-4 text-danger shrink-0" />}
                <div><p className="font-medium text-fg">Database read and write test</p>{!report.firestore.ok && <p className="text-fg-muted">{report.firestore.reason ?? 'The database test failed.'}</p>}</div>
              </li>
            )}
            {report.checks.map((c) => (
              <li key={c.id} className="flex gap-2 text-xs">
                {c.ok ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : c.required ? <CircleAlert className="w-4 h-4 text-danger shrink-0" /> : <CircleDashed className="w-4 h-4 text-fg-subtle shrink-0" />}
                <div><p className="font-medium text-fg">{c.label}{!c.ok && !c.required ? ' (optional)' : ''}</p>{!c.ok && <p className="text-fg-muted">{c.fix}</p>}</div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-fg-subtle">Checked {new Date(report.checkedAt).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}
