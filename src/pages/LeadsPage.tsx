import { Download, Trash2, Upload } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, type LeadCaptureInfo, type LeadInfo, type LeadMember } from '../api/client';
import { dueFollowUps, LEAD_STATUS_LABEL, leadsToCsv, parseCsv, pipelineSummary } from '../utils/leads';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const STATUSES = Object.keys(LEAD_STATUS_LABEL) as LeadInfo['status'][];
const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const Tile = ({ k, v, hint }: { k: string; v: string; hint?: string }) => <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">{k}</p><p className="text-2xl font-bold text-fg">{v}</p>{hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}</div>;

/** A simple lead list for agencies: who you are talking to, where each deal stands, and a quick website check to open the conversation. */
export const LeadsPage: React.FC = () => {
  const [data, setData] = useState<{ leads: LeadInfo[]; limit: number; canEdit: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | LeadInfo['status']>('all');
  const [who, setWho] = useState<string>('all');
  const [members, setMembers] = useState<{ list: LeadMember[]; me: string }>({ list: [], me: '' });
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ name: '', website: '', email: '', value: '', assigneeId: '' });
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { try { setData(await apiClient.leadsList()); setError(null); } catch (e) { setError(errMessage(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { apiClient.leadMembers().then((m) => setMembers({ list: m.members, me: m.me })).catch(() => undefined); }, []);
  const names = useMemo(() => new Map(members.list.map((m) => [m.uid, m.name])), [members]);
  const summary = useMemo(() => pipelineSummary(data?.leads ?? []), [data]);
  const due = useMemo(() => dueFollowUps(data?.leads ?? [], today()), [data]);
  if (!data) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <div aria-busy="true" className="h-24 rounded-xl bg-fill-2 animate-pulse" />;
  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); setError(null); try { await fn(); await load(); } catch (e) { setError(errMessage(e)); } finally { setBusy(null); } };
  const shown = data.leads.filter((l) => (filter === 'all' || l.status === filter) && (who === 'all' || (who === 'mine' ? l.assigneeId === members.me : who === 'none' ? !l.assigneeId : l.assigneeId === who)));
  const valueNum = form.value.trim() === '' ? 0 : Number(form.value);
  const valueBad = !Number.isFinite(valueNum) || valueNum < 0;
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + leadsToCsv(data.leads, names)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'leads.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const importFile = async (file: File) => {
    setError(null); setNote(null);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) { setError('That file has no leads in it. The first line should be column names such as Name, Email and Phone.'); return; }
      if (rows.length > 500) { setError('That file has more than 500 rows. Split it into smaller files and import them one by one.'); return; }
      const r = await apiClient.leadImport(rows);
      setNote(`Added ${r.added} lead${r.added === 1 ? '' : 's'}.${r.duplicates ? ` Skipped ${r.duplicates} already in your list.` : ''}${r.unreadable ? ` ${r.unreadable} row${r.unreadable === 1 ? ' had' : 's had'} no name, email or phone.` : ''}${r.overLimit ? ` ${r.overLimit} did not fit in your plan's ${r.limit}-lead limit.` : ''}`);
      await load();
    } catch (e) { setError(errMessage(e)); } finally { if (fileRef.current) fileRef.current.value = ''; }
  };
  const assignSelect = (value: string, onChange: (v: string) => void, id: string, label: string, disabled = false) => (
    <><label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} className={field} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Unassigned</option>
        {members.list.map((m) => <option key={m.uid} value={m.uid}>{m.uid === members.me ? `${m.name} (me)` : m.name}</option>)}
        {value && !names.has(value) && <option value={value}>Former member</option>}
      </select></>
  );
  return (
    <div className="space-y-5">
      <div className="space-y-1"><h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Leads</h1>
        <p className="text-xs sm:text-sm text-fg-muted">Keep track of people you are talking to, move each one through your pipeline, and run a quick check of their website to give you something useful to say. Reports you share with clients carry your own name when White label is on (Settings, Workspace).</p></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="rounded-lg border border-line bg-fill-2 text-fg text-sm px-3 py-2">{note}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile k="Open leads" v={String(summary.open)} hint={`worth ${money(summary.openValue)}`} />
        <Tile k="Won" v={String(summary.won)} hint={`worth ${money(summary.wonValue)}`} />
        <Tile k="Lost" v={String(summary.lost)} />
        <Tile k="Win rate" v={summary.winRate === null ? 'n/a' : `${summary.winRate}%`} hint="of finished leads" />
      </div>
      {due.length > 0 && <p role="status" className="rounded-lg border border-line bg-warning-soft text-warning text-sm px-3 py-2">Follow up today: {due.slice(0, 5).map((l) => l.name).join(', ')}{due.length > 5 ? ` and ${due.length - 5} more` : ''}.</p>}
      {data.canEdit && (
        <form className="rounded-xl border border-line bg-surface p-3 grid gap-2 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); void act('add', async () => { await apiClient.leadCreate({ name: form.name, website: form.website, email: form.email, value: valueNum, assigneeId: form.assigneeId }); setForm({ name: '', website: '', email: '', value: '', assigneeId: '' }); }); }}>
          <label className="text-xs font-medium text-fg block sm:col-span-2">Name<input className={`${field} block w-full mt-1`} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Bakery" /></label>
          <label className="text-xs font-medium text-fg block">Website<input className={`${field} block w-full mt-1`} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="acme.com" /></label>
          <label className="text-xs font-medium text-fg block">Email<input className={`${field} block w-full mt-1`} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="text-xs font-medium text-fg block">Deal value<input className={`${field} block w-full mt-1`} inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} aria-invalid={valueBad} placeholder="500" /></label>
          <div className="sm:col-span-5 flex flex-wrap items-center gap-3">{assignSelect(form.assigneeId, (v) => setForm({ ...form, assigneeId: v }), 'new-assignee', 'Assign the new lead to')}<button type="submit" className={primary} disabled={busy !== null || !form.name.trim() || valueBad}>Add lead</button><span className="text-xs text-fg-muted">{data.leads.length} of {data.limit} used</span></div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-fg-muted">Show <select className={field} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">All leads</option>{STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="text-xs text-fg-muted">Assigned to <select className={field} value={who} onChange={(e) => setWho(e.target.value)}><option value="all">Everyone</option><option value="mine">My leads</option><option value="none">Unassigned</option>{members.list.filter((m) => m.uid !== members.me).map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}</select></label>
        {data.canEdit && <><input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose a CSV file of leads" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} /><button type="button" className={secondary} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden /> Import CSV</button></>}
        <button type="button" className={secondary} disabled={data.leads.length === 0} onClick={exportCsv}><Download className="h-4 w-4" aria-hidden /> Export CSV</button>
      </div>
      {data.canEdit && <LeadLink members={members.list} />}
      {shown.length === 0 ? <p className="text-sm text-fg-muted">{data.leads.length === 0 ? 'No leads yet. Add your first one above.' : 'No leads match these filters.'}</p> : (
        <ul className="space-y-2">{shown.map((l) => (
          <li key={l.id} className="rounded-xl border border-line bg-surface p-3 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="text-sm font-semibold text-fg">{l.name}{l.source !== 'manual' && <span className="ml-2 align-middle rounded-full bg-fill-2 text-fg-muted text-[10px] font-medium px-2 py-0.5">{l.source === 'capture' ? 'From lead link' : 'Imported'}</span>}</p><p className="text-xs text-fg-muted break-all">{[l.website, l.email, l.phone].filter(Boolean).join(' · ') || 'No contact details'}{l.value ? ` · ${money(l.value)}` : ''}</p></div>
              <div className="flex flex-wrap gap-1 items-center">
                {assignSelect(l.assigneeId, (v) => void act(l.id, () => apiClient.leadUpdate(l.id, { assigneeId: v })), `as-${l.id}`, `Assigned to for ${l.name}`, !data.canEdit || busy !== null)}
                <label className="sr-only" htmlFor={`st-${l.id}`}>Status of {l.name}</label>
                <select id={`st-${l.id}`} className={field} disabled={!data.canEdit || busy !== null} value={l.status} onChange={(e) => void act(l.id, () => apiClient.leadUpdate(l.id, { status: e.target.value as LeadInfo['status'] }))}>{STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}</select>
                {data.canEdit && <button type="button" className={secondary} disabled={busy !== null || !l.website} title={l.website ? '' : 'Add a website first'} onClick={() => void act(l.id, () => apiClient.leadAudit(l.id))}>{busy === l.id ? 'Checking…' : 'Check website'}</button>}
                <button type="button" className={secondary} onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Close' : 'Details'}</button>
                {data.canEdit && <button type="button" aria-label={`Delete lead ${l.name}`} className={secondary} disabled={busy !== null} onClick={() => void act(l.id, () => apiClient.leadDelete(l.id))}><Trash2 className="h-4 w-4" aria-hidden /></button>}
              </div>
            </div>
            {l.audit && (
              <div className="rounded-lg border border-line bg-fill-2 p-2 text-xs space-y-1"><p className="text-fg"><span className="font-semibold">Site check: {l.audit.score}/100</span> <span className="text-fg-muted">for the home page, {new Date(l.audit.at).toLocaleDateString()}</span></p>
                {l.audit.issues.length > 0 && <ul className="list-disc pl-4 text-fg-muted">{l.audit.issues.slice(0, 5).map((i) => <li key={i.title}>{i.title}</li>)}</ul>}</div>
            )}
            {open === l.id && <LeadDetails lead={l} canEdit={data.canEdit} busy={busy !== null} onSave={(patch) => act(l.id, () => apiClient.leadUpdate(l.id, patch))} />}
          </li>))}</ul>
      )}
    </div>
  );
};

function LeadDetails({ lead, canEdit, busy, onSave }: { lead: LeadInfo; canEdit: boolean; busy: boolean; onSave: (p: Parameters<typeof apiClient.leadUpdate>[1]) => Promise<void> }) {
  const [f, setF] = useState({ website: lead.website, email: lead.email, phone: lead.phone, value: String(lead.value || ''), followUp: lead.followUp, notes: lead.notes });
  const v = f.value.trim() === '' ? 0 : Number(f.value);
  const bad = !Number.isFinite(v) || v < 0;
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {([['website', 'Website'], ['email', 'Email'], ['phone', 'Phone']] as const).map(([k, label]) => <label key={k} className="text-xs font-medium text-fg block">{label}<input className={`${field} block w-full mt-1`} disabled={!canEdit} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
      <label className="text-xs font-medium text-fg block">Deal value<input className={`${field} block w-full mt-1`} disabled={!canEdit} inputMode="decimal" value={f.value} aria-invalid={bad} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
      <label className="text-xs font-medium text-fg block">Follow up on<input type="date" className={`${field} block w-full mt-1`} disabled={!canEdit} value={f.followUp} onChange={(e) => setF({ ...f, followUp: e.target.value })} /></label>
      <label className="text-xs font-medium text-fg block sm:col-span-3">Notes<textarea className={`${field} block w-full min-h-[72px] mt-1`} disabled={!canEdit} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      {canEdit && <div className="sm:col-span-3"><button type="button" className={primary} disabled={busy || bad} onClick={() => void onSave({ website: f.website, email: f.email, phone: f.phone, value: v, followUp: f.followUp, notes: f.notes })}>Save details</button></div>}
    </div>
  );
}

/** Where leads from Google Ads forms, Zapier or Make are sent: a private web address and a secret key for this project. */
function LeadLink({ members }: { members: LeadMember[] }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<LeadCaptureInfo | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && !info) apiClient.leadCapture().then(setInfo).catch((e) => setErr(errMessage(e))); }, [open, info]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } };
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).catch(() => undefined); };
  const code = 'rounded bg-fill-2 px-1.5 py-0.5 text-xs break-all';
  return (
    <section className="rounded-xl border border-line bg-surface p-3 space-y-2">
      <button type="button" className="text-sm font-semibold text-fg underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Get leads automatically'} {open ? '' : '(Google Ads, Zapier, Make)'}</button>
      {open && (
        <div className="space-y-3 text-sm text-fg">
          {err && <p role="alert" className="text-danger">{err}</p>}
          <p className="text-fg-muted">Your project has a private web address. When Google Ads, Zapier or Make sends a new lead to it, the lead appears here, with the name and contact details filled in. Repeats are skipped.</p>
          {!info ? <div aria-busy="true" className="h-12 rounded-lg bg-fill-2 animate-pulse" /> : (
            <>
              <p>Web address: <code className={code}>{info.url}</code> <button type="button" className="text-xs underline" onClick={() => copy(info.url)}>Copy</button></p>
              {key ? (
                <p role="status" className="rounded-lg border border-line bg-warning-soft text-warning px-3 py-2">Your secret key (shown only once, so copy it now): <code className={code}>{key}</code> <button type="button" className="text-xs underline" onClick={() => copy(key)}>Copy</button></p>
              ) : <p className="text-fg-muted">{info.enabled ? 'A secret key is set. If you lost it, make a new one (the old one stops working).' : 'Make a secret key to turn this on.'}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={secondary} disabled={busy} onClick={() => void run(async () => { const r = await apiClient.leadCaptureKey(); setKey(r.key); setInfo({ ...info, enabled: true }); })}>{info.enabled ? 'Make a new key' : 'Turn on and make a key'}</button>
                {info.enabled && <button type="button" className={secondary} disabled={busy} onClick={() => void run(async () => { await apiClient.leadCaptureUpdate({ enabled: false }); setInfo({ ...info, enabled: false }); setKey(null); })}>Turn off</button>}
                {info.enabled && <label className="text-xs text-fg-muted">Give new leads to <select className={field} value={info.defaultAssigneeId} disabled={busy} onChange={(e) => void run(async () => { await apiClient.leadCaptureUpdate({ defaultAssigneeId: e.target.value }); setInfo({ ...info, defaultAssigneeId: e.target.value }); })}><option value="">Nobody (unassigned)</option>{members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}</select></label>}
              </div>
              <ol className="list-decimal pl-5 space-y-1 text-fg-muted">
                <li>Google Ads: open your lead form, find the "Lead delivery" section, choose Webhook, paste the web address above and the secret key, then press Send test data.</li>
                <li>Facebook and Instagram lead forms: in Zapier or Make, pick Facebook Lead Ads as the start, then add a step that sends a web request (POST) to the address above. Send fields called name, email, phone, and add a field called key with your secret key.</li>
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
