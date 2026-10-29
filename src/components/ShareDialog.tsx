import { Copy, Download, Link2, Mail, RefreshCw, Send, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { FrequencyPicker, DEFAULT_FREQUENCY, frequencyProblem, toFrequencyValue, type FrequencyValue } from './FrequencyPicker';
import { frequencyLabel } from '../utils/scheduleFrequency';
import { apiClient, type EmailScheduleInfo, type ShareInfo } from '../api/client';

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-xs px-2 py-2 min-h-[36px] w-full';

/** Make, copy, refresh and turn off read-only links for one dashboard or saved report. */
export const ShareDialog: React.FC<{ kind: 'dashboard' | 'report'; targetId: string; title: string; onClose: () => void }> = ({ kind, targetId, title, onClose }) => {
  const [shares, setShares] = useState<ShareInfo[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<7 | 28 | 90>(28);
  const [password, setPassword] = useState('');
  const [expires, setExpires] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sched, setSched] = useState<EmailScheduleInfo[]>([]);
  const [emailAllowed, setEmailAllowed] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [schedLimit, setSchedLimit] = useState(0);
  const [freq, setFreq] = useState<FrequencyValue>(DEFAULT_FREQUENCY);
  const [editing, setEditing] = useState<{ id: string; value: FrequencyValue } | null>(null);
  const [mailRange, setMailRange] = useState<7 | 28 | 90>(7);
  const [mailTo, setMailTo] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.listShares();
      setShares(r.shares.filter((s) => s.kind === kind && s.targetId === targetId));
      setLimit(r.limit);
    } catch (e) { setError(errMessage(e)); setShares([]); }
  }, [kind, targetId]);
  const loadSched = useCallback(async () => {
    try {
      const r = await apiClient.listEmailSchedules();
      setSched(r.schedules.filter((x) => x.kind === kind && x.targetId === targetId));
      setEmailAllowed(r.emailAllowed); setSchedLimit(r.limit); setUserEmail(r.userEmail);
      setMailTo((cur) => cur || r.userEmail || '');
    } catch { /* the share part still works */ }
  }, [kind, targetId]);
  useEffect(() => { void load(); void loadSched(); }, [load, loadSched]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('new'); setError(null); setNote(null);
    try {
      const s = await apiClient.createShare({ kind, targetId, rangeDays, autoRefresh, ...(password ? { password } : {}), ...(expires ? { expiresInDays: Number(expires) } : {}) });
      setPassword(''); setExpires('');
      if (s.url) { try { await navigator.clipboard.writeText(s.url); setNote('Link made and copied.'); } catch { setNote('Link made. Copy it below.'); } }
      await load();
    } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };
  const addSched = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = frequencyProblem(freq);
    if (problem) { setError(problem); return; }
    setBusy('mail'); setError(null); setNote(null);
    try {
      await apiClient.createEmailSchedule({ kind, targetId, frequency: freq.frequency, weekdays: freq.weekdays, monthDay: freq.monthDay, intervalDays: freq.intervalDays, rangeDays: mailRange, enabled: true, attachPdf, emails: mailTo.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) });
      setNote(`Scheduled. It goes out ${frequencyLabel(freq)}.`);
      await loadSched();
    } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };
  const saveWhen = async () => {
    if (!editing) return;
    const problem = frequencyProblem(editing.value);
    if (problem) { setError(problem); return; }
    setBusy(editing.id); setError(null); setNote(null);
    try {
      const v = editing.value;
      await apiClient.updateEmailSchedule(editing.id, { frequency: v.frequency, weekdays: v.weekdays, monthDay: v.monthDay, intervalDays: v.intervalDays });
      setNote(`Changed. It now goes out ${frequencyLabel(v)}.`); setEditing(null); await loadSched();
    } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };
  const toggleSched = async (x: EmailScheduleInfo) => {
    setBusy(x.id); setError(null);
    try { await apiClient.updateEmailSchedule(x.id, { enabled: !x.enabled }); await loadSched(); } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };
  const testSched = async (x: EmailScheduleInfo) => {
    setBusy(x.id); setError(null); setNote(null);
    try { const r = await apiClient.testEmailSchedule(x.id); setNote(r.sent ? `Test email sent to ${r.to}.` : r.reason || 'The test email could not be sent.'); } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };
  const delSched = async (x: EmailScheduleInfo) => {
    if (!window.confirm('Delete this scheduled email?')) return;
    setBusy(x.id); setError(null);
    try { await apiClient.deleteEmailSchedule(x.id); await loadSched(); } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };
  const pdf = async () => {
    setBusy('pdf'); setError(null); setNote(null);
    try { await apiClient.downloadPdf(kind, targetId, rangeDays); setNote('PDF downloaded.'); } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };
  const copy = async (s: ShareInfo) => {
    if (!s.url) return;
    try { await navigator.clipboard.writeText(s.url); setNote('Copied.'); } catch { setNote('Select the link and copy it.'); }
  };
  const refresh = async (s: ShareInfo) => {
    setBusy(s.id); setError(null);
    try { await apiClient.refreshShare(s.id); setNote('Snapshot updated.'); await load(); } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };
  const off = async (s: ShareInfo) => {
    if (!window.confirm('Turn this link off? Anyone who has it will lose access straight away.')) return;
    setBusy(s.id); setError(null);
    try { await apiClient.deleteShare(s.id); setNote('Link turned off.'); await load(); } catch (err) { setError(errMessage(err)); }
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-fg/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Share and email ${title}`}>
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-auto rounded-t-2xl sm:rounded-2xl bg-page border border-line p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">Share and email “{title}”</h2>
            <p className="text-xs text-fg-muted">Anyone with the link can see a read-only copy of the numbers as they were when the link was made (refreshed daily if you leave that on). They cannot sign in to anything or see your connections.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-fg-muted hover:text-fg"><X className="w-4 h-4" /></button>
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        {note && <p role="status" className="text-xs text-success">{note}</p>}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
          <p className="text-xs text-fg-muted flex-1 min-w-[180px]">Need a file? Download a PDF of the numbers as of now (uses the “Show the last” setting below).</p>
          <button type="button" disabled={busy === 'pdf'} onClick={() => void pdf()} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> {busy === 'pdf' ? 'Making the PDF…' : 'Download PDF'}</button>
        </div>
        <form onSubmit={(e) => void create(e)} className="rounded-xl border border-line bg-surface p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-fg space-y-1">Show the last
              <select className={field} value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value) as 7 | 28 | 90)}>
                <option value={7}>7 days</option><option value={28}>28 days</option><option value={90}>90 days</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-fg space-y-1">Link stops working
              <select className={field} value={expires} onChange={(e) => setExpires(e.target.value)}>
                <option value="">Never</option><option value="1">After 1 day</option><option value="7">After 7 days</option><option value="30">After 30 days</option><option value="90">After 90 days</option>
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium text-fg space-y-1">Password (optional)
            <input className={field} type="password" autoComplete="new-password" value={password} maxLength={72} placeholder="Leave empty for no password" onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-fg"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Update the numbers every day</label>
          <p className="text-[11px] text-fg-subtle">Anyone with the link sees these numbers, including tables you uploaded. Only share what you are happy for them to see.</p>
          <button type="submit" disabled={busy === 'new' || (limit > 0 && (shares?.length ?? 0) >= limit)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">
            <Link2 className="w-3.5 h-3.5" /> {busy === 'new' ? 'Making the link…' : 'Make a link'}
          </button>
        </form>

        {shares && shares.length > 0 && (
          <ul className="space-y-2">
            {shares.map((s) => (
              <li key={s.id} className="rounded-xl border border-line bg-surface p-3 space-y-2">
                <input readOnly aria-label="Share link" value={s.url ?? 'Link unavailable'} onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono`} />
                <p className="text-[11px] text-fg-muted">
                  Last {s.rangeDays} days · {s.hasPassword ? 'password protected' : 'no password'} · {s.expiresAt ? `ends ${new Date(s.expiresAt).toLocaleDateString()}` : 'never ends'} · opened {s.views} {s.views === 1 ? 'time' : 'times'} · updated {new Date(s.refreshedAt).toLocaleString()}
                </p>
                {s.refreshError && <p className="text-[11px] text-warning">{s.refreshError}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => void copy(s)} className="inline-flex items-center gap-1 rounded-lg border border-line text-xs px-2.5 py-1.5 text-fg hover:bg-fill-2"><Copy className="w-3.5 h-3.5" /> Copy</button>
                  <button type="button" disabled={busy === s.id} onClick={() => void refresh(s)} className="inline-flex items-center gap-1 rounded-lg border border-line text-xs px-2.5 py-1.5 text-fg hover:bg-fill-2 disabled:opacity-50"><RefreshCw className="w-3.5 h-3.5" /> Update now</button>
                  <button type="button" disabled={busy === s.id} onClick={() => void off(s)} className="inline-flex items-center gap-1 rounded-lg border border-line text-xs px-2.5 py-1.5 text-danger hover:bg-danger-soft disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Turn off</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line pt-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-fg inline-flex items-center gap-1.5"><Mail className="w-4 h-4" /> Email this on a schedule</h3>
            <p className="text-xs text-fg-muted">A snapshot of the numbers lands in the inbox as often as you choose: every day, on days of the week, on a day of the month, or every few days. Charts stay in the app; the email shows the numbers and short tables.</p>
          </div>
          {!emailAllowed ? (
            <p className="text-xs text-fg-muted">Scheduled emails are not part of your plan.</p>
          ) : (
            <form onSubmit={(e) => void addSched(e)} className="rounded-xl border border-line bg-surface p-3 space-y-3">
              <FrequencyPicker id="new-mail" value={freq} onChange={setFreq} />
              <label className="block text-xs font-medium text-fg space-y-1">Numbers cover the last
                <select className={field} value={mailRange} onChange={(e) => setMailRange(Number(e.target.value) as 7 | 28 | 90)}>
                  <option value={7}>7 days</option><option value={28}>28 days</option><option value={90}>90 days</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-fg space-y-1">Send to (up to 3 addresses, separated by commas)
                <input className={field} value={mailTo} placeholder={userEmail ?? 'you@company.com'} onChange={(e) => setMailTo(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-fg"><input type="checkbox" checked={attachPdf} onChange={(e) => setAttachPdf(e.target.checked)} /> Attach the snapshot as a PDF</label>
              <button type="submit" disabled={busy === 'mail' || (schedLimit > 0 && sched.length >= schedLimit)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">
                <Mail className="w-3.5 h-3.5" /> {busy === 'mail' ? 'Saving…' : 'Schedule the email'}
              </button>
            </form>
          )}
          {sched.length > 0 && (
            <ul className="space-y-2">
              {sched.map((x) => (
                <li key={x.id} className="rounded-xl border border-line bg-surface p-3 space-y-2">
                  <p className="text-xs text-fg">{capitalise(frequencyLabel(toFrequencyValue(x)))} · last {x.rangeDays} days{x.attachPdf ? ' · PDF attached' : ''} · {x.emails.join(', ')}{x.enabled ? '' : ' (paused)'}</p>
                  <p className="text-[11px] text-fg-muted">{x.lastSentAt ? `Last sent ${new Date(x.lastSentAt).toLocaleDateString()}` : 'Not sent yet'}</p>
                  {x.lastError && <p className="text-[11px] text-warning">{x.lastError}</p>}
                  <div className="flex gap-2">
                    <button type="button" disabled={busy === x.id} onClick={() => void testSched(x)} className="inline-flex items-center gap-1 rounded-lg border border-line text-xs px-2.5 py-1.5 text-fg hover:bg-fill-2 disabled:opacity-50"><Send className="w-3.5 h-3.5" /> Send me a test</button>
                    <button type="button" disabled={busy === x.id} onClick={() => setEditing(editing?.id === x.id ? null : { id: x.id, value: toFrequencyValue(x) })} className="rounded-lg border border-line text-xs px-2.5 py-1.5 text-fg hover:bg-fill-2 disabled:opacity-50">{editing?.id === x.id ? 'Cancel' : 'Change when'}</button>
                    <button type="button" disabled={busy === x.id} onClick={() => void toggleSched(x)} className="rounded-lg border border-line text-xs px-2.5 py-1.5 text-fg hover:bg-fill-2 disabled:opacity-50">{x.enabled ? 'Pause' : 'Resume'}</button>
                    <button type="button" disabled={busy === x.id} onClick={() => void delSched(x)} className="inline-flex items-center gap-1 rounded-lg border border-line text-xs px-2.5 py-1.5 text-danger hover:bg-danger-soft disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                  </div>
                  {editing?.id === x.id && (
                    <div className="rounded-lg border border-line bg-fill-1 p-3 space-y-2">
                      <FrequencyPicker id={`edit-${x.id}`} value={editing.value} onChange={(v) => setEditing({ id: x.id, value: v })} />
                      <button type="button" disabled={busy === x.id} onClick={() => void saveWhen()} className="rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">Save</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {limit > 0 && <p className="text-[11px] text-fg-subtle">Your plan allows {limit} share {limit === 1 ? 'link' : 'links'} per project.</p>}
      </div>
    </div>
  );
};
