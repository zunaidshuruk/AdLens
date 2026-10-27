import { AlertTriangle, CheckCircle2, LogOut, ShieldCheck, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Subscriptions } from './AdminSubscriptions';
import { OperatorsEditor, PlansEditor, SwitchesEditor } from './AdminSettings';
import {
  apiClient, type AdminSession, type AdminAuditEvent, type AdminOverview, type AdminRequest, type AdminUser, type AdminWorkspaceDetail, type AdminWorkspaceRow,
} from '../api/client';

type Tab = 'overview' | 'workspaces' | 'requests' | 'subs' | 'plans' | 'switches' | 'users' | 'operators' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'requests', label: 'Upgrade requests' },
  { id: 'subs', label: 'Subscriptions' },
  { id: 'plans', label: 'Plans and prices' },
  { id: 'switches', label: 'Switches' },
  { id: 'users', label: 'Users' },
  { id: 'operators', label: 'Operators' },
  { id: 'audit', label: 'Activity' },
];

const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const btn = 'rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px] disabled:opacity-50';
const primary = 'rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50';
const card = 'rounded-xl border border-line bg-surface p-4 space-y-3';
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
const statusText: Record<string, string> = { none: 'No end date', active: 'Active', grace: 'Grace period', expired: 'Expired' };
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function Overview({ onOpenWorkspaces }: { onOpenWorkspaces: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiClient.adminOverview().then(setData).catch((e) => setError(errText(e, 'Could not load.'))); }, []);
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-fg-muted">Loading…</p>;
  const stat = (label: string, value: number) => (
    <div className="rounded-xl border border-line bg-surface p-4"><div className="text-2xl font-semibold text-fg">{value}</div><div className="text-xs text-fg-muted">{label}</div></div>
  );
  const provs = Object.keys(data.usage[0]?.counts ?? {});
  const flag = (ok: boolean, yes: string, no: string) => (
    <li className="flex items-center gap-2 text-sm text-fg">{ok ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-warning" />}{ok ? yes : no}</li>
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stat('Workspaces', data.counts.workspaces)}
        {stat('Open upgrade requests', data.counts.openRequests)}
        {stat('Plans ending within 7 days (or in grace)', data.counts.endingSoon)}
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Workspaces by plan</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.byPlan).map(([plan, n]) => <span key={plan} className="rounded-full border border-line px-3 py-1 text-xs text-fg">{plan}: {n}</span>)}
          {Object.keys(data.byPlan).length === 0 && <span className="text-xs text-fg-muted">None yet.</span>}
        </div>
        <button type="button" className={btn} onClick={onOpenWorkspaces}>Manage workspaces</button>
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Calls to Google and Meta (shared by all users)</h3>
        {data.usage.length === 0 ? <p className="text-xs text-fg-muted">No counts yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-fg-muted"><th className="py-1 pr-4">Day (UTC)</th>{provs.map((p) => <th key={p} className="py-1 pr-4">{p}</th>)}</tr></thead>
              <tbody>{data.usage.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1.5 pr-4 text-fg">{d.date}</td>{provs.map((p) => <td key={p} className="py-1.5 pr-4 text-fg">{d.counts[p] ?? 0}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Health</h3>
        <ul className="space-y-1.5">
          {flag(data.health.sharedStore === 'upstash', 'Shared cache is on (Upstash).', 'Shared cache is off: each server keeps its own memory. Fine for one server.')}
          {flag(data.health.errorAlertsConfigured, 'Error alerts are on.', 'Error alerts are off (set ERROR_WEBHOOK_URL).')}
          {flag(data.health.emailConfigured, 'Email sending is set up.', 'Email sending is not set up (RESEND_API_KEY and MAIL_FROM).')}
          {flag(data.health.summariesJobConfigured, 'The daily summaries job has its secret.', 'The daily summaries job has no CRON_SECRET yet.')}
        </ul>
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Launch checklist</h3>
        <ul className="space-y-2">
          {data.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              {c.status === 'pass' ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-success shrink-0" /> : c.status === 'warn' ? <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 text-danger shrink-0" />}
              <span><span className="text-fg">{c.title}</span><span className="block text-xs text-fg-muted">{c.detail}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function WorkspaceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<AdminWorkspaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState('pro');
  const [planList, setPlanList] = useState<{ id: string; label: string; custom: boolean }[]>([
    { id: 'free', label: 'Free', custom: false }, { id: 'pro', label: 'Pro', custom: false }, { id: 'business', label: 'Business', custom: false }, { id: 'beta', label: 'Beta (old test plan)', custom: false },
  ]);
  useEffect(() => { apiClient.adminSettings().then((v) => setPlanList(v.plans.map((p) => ({ id: p.id, label: p.id === 'beta' ? 'Beta (old test plan)' : p.label, custom: p.custom })))).catch(() => undefined); }, []);
  const [endsOn, setEndsOn] = useState(ymd(30));
  const [note, setNote] = useState('');
  const [inv, setInv] = useState({ number: '', amount: '', currency: 'BDT' as 'USD' | 'BDT', plan: 'pro', periodStart: ymd(0), periodEnd: ymd(30), note: '' });

  const load = useCallback(async () => {
    try {
      const r = await apiClient.adminWorkspace(id);
      setD(r);
      setPlan(r.openRequest?.plan ?? (r.current.storedPlan === 'business' ? 'business' : 'pro'));
      setError(null);
    } catch (e) { setError(errText(e, 'Could not load this workspace.')); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); setNotice(done); await load(); } catch (e) { setError(errText(e, 'That did not work.')); } finally { setBusy(false); }
  };

  if (!d) return <div className="space-y-3"><button className={btn} onClick={onBack}>← Back</button>{error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-sm text-fg-muted">Loading…</p>}</div>;
  const paid = plan !== 'free' && plan !== 'beta';
  const endRequired = plan === 'pro' || plan === 'business';

  return (
    <div className="space-y-4">
      <button className={btn} onClick={onBack}>← Back to workspaces</button>
      <div>
        <h2 className="text-lg font-semibold text-fg">{d.workspace.name}</h2>
        <p className="text-xs text-fg-muted break-all">ID {d.workspace.id} · created {day(d.workspace.createdAt)}</p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}

      {d.openRequest && (
        <div className="rounded-xl border border-accent-line bg-accent-soft p-4 text-sm text-fg">
          <strong>Upgrade requested:</strong> {d.openRequest.plan} by {d.openRequest.email} on {day(d.openRequest.createdAt)}.{d.openRequest.message ? ` “${d.openRequest.message}”` : ''}
        </div>
      )}

      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Plan</h3>
        <p className="text-sm text-fg">
          Now on <strong>{d.current.label}</strong> ({statusText[d.current.status] ?? d.current.status}){d.current.expiresAt ? `, paid until ${day(d.current.expiresAt)}` : ''}.
          {d.current.storedPlan !== d.current.plan ? ` Stored plan is ${d.current.storedPlan}, but it has run out, so Free limits apply.` : ''}
        </p>
        <p className="text-xs text-fg-muted">Used this month: {d.usage.aiQuestions} AI questions · {d.usage.projects} projects.</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); void run(() => apiClient.adminSetPlan({ workspaceId: id, plan, endsOn: paid && endsOn ? endsOn : null, note }), 'Plan saved.'); }}
        >
          <label className="space-y-1"><span className="text-xs text-fg-muted">Plan</span>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className={`${field} block`}>
              {planList.map((p) => <option key={p.id} value={p.id}>{p.label}{p.custom ? ' (private)' : ''}</option>)}
            </select>
          </label>
          {paid && <label className="space-y-1"><span className="text-xs text-fg-muted">Last paid day{endRequired ? '' : ' (optional)'}</span><input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={`${field} block`} /></label>}
          <label className="flex-1 min-w-[160px] space-y-1"><span className="text-xs text-fg-muted">Note for the activity log (optional)</span><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Paid by bKash" className={`${field} w-full`} /></label>
          <button type="submit" disabled={busy || (endRequired && !endsOn)} className={primary}>Save plan</button>
        </form>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Record a payment</h3>
        <form
          className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => apiClient.adminRecordInvoice({ workspaceId: id, number: inv.number, amount: Number(inv.amount), currency: inv.currency, plan: inv.plan, periodStart: inv.periodStart, periodEnd: inv.periodEnd, note: inv.note }), 'Payment recorded.')
              .then(() => setInv((p) => ({ ...p, number: '', amount: '', note: '' })));
          }}
        >
          <label className="space-y-1"><span className="text-xs text-fg-muted">Invoice number</span><input required value={inv.number} onChange={(e) => setInv({ ...inv, number: e.target.value })} placeholder="AL-2026-001" className={`${field} w-full`} /></label>
          <label className="space-y-1"><span className="text-xs text-fg-muted">Amount</span><input required type="number" min="1" step="any" value={inv.amount} onChange={(e) => setInv({ ...inv, amount: e.target.value })} className={`${field} w-full`} /></label>
          <label className="space-y-1"><span className="text-xs text-fg-muted">Currency</span><select value={inv.currency} onChange={(e) => setInv({ ...inv, currency: e.target.value as 'USD' | 'BDT' })} className={`${field} w-full`}><option>BDT</option><option>USD</option></select></label>
          <label className="space-y-1"><span className="text-xs text-fg-muted">Plan</span><select value={inv.plan} onChange={(e) => setInv({ ...inv, plan: e.target.value })} className={`${field} w-full`}>{planList.filter((p) => p.id !== 'free' && p.id !== 'beta').map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label className="space-y-1"><span className="text-xs text-fg-muted">Period starts</span><input required type="date" value={inv.periodStart} onChange={(e) => setInv({ ...inv, periodStart: e.target.value })} className={`${field} w-full`} /></label>
          <label className="space-y-1"><span className="text-xs text-fg-muted">Period ends</span><input required type="date" value={inv.periodEnd} onChange={(e) => setInv({ ...inv, periodEnd: e.target.value })} className={`${field} w-full`} /></label>
          <label className="space-y-1 col-span-2"><span className="text-xs text-fg-muted">Note (optional)</span><input value={inv.note} maxLength={200} onChange={(e) => setInv({ ...inv, note: e.target.value })} className={`${field} w-full`} /></label>
          <button type="submit" disabled={busy} className={primary}>Record payment</button>
        </form>
        <p className="text-xs text-fg-muted">Recording a payment does not change the plan. Use “Save plan” above for that.</p>
        {d.invoices.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {d.invoices.map((i) => (
              <li key={i.id} className="px-3 py-2 text-sm text-fg flex flex-wrap justify-between gap-2"><span>{i.number} · {i.plan}</span><span className="text-fg-muted">{i.currency} {i.amount} · {i.periodStart} to {i.periodEnd}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">People</h3>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {d.members.map((m) => (
            <li key={m.uid} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0"><div className="text-sm text-fg truncate">{m.displayName}</div><div className="text-xs text-fg-muted truncate">{m.email}</div></div>
              <div className="flex items-center gap-2">
                {m.role === 'owner' ? <span className="text-xs text-fg-muted">Owner</span> : (
                  <>
                    <select aria-label={`Role for ${m.displayName}`} value={m.role} disabled={busy} className={`${field} py-1 text-xs`} onChange={(e) => void run(() => apiClient.adminSetMemberRole(id, m.uid, e.target.value as 'admin' | 'member'), 'Role changed.')}>
                      <option value="member">Member</option><option value="admin">Admin</option>
                    </select>
                    <button type="button" disabled={busy} className={btn} onClick={() => { if (window.confirm(`Remove ${m.displayName} from ${d.workspace.name}?`)) void run(() => apiClient.adminRemoveMember(id, m.uid), 'Removed.'); }}>Remove</button>
                  </>
                )}
              </div>
            </li>
          ))}
          {d.invites.map((i) => <li key={i.id} className="px-3 py-2 text-sm text-fg-muted">{i.email} · invited as {i.role}, not signed in yet</li>)}
        </ul>
        {d.workspace.joinDomain && <p className="text-xs text-fg-muted">Colleagues with @{d.workspace.joinDomain} emails are offered the chance to join.</p>}
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Projects</h3>
        {d.projects.length === 0 ? <p className="text-xs text-fg-muted">No projects.</p> : (
          <ul className="text-sm text-fg space-y-1">{d.projects.map((p) => <li key={p.id}>{p.name}{p.domain ? ` · ${p.domain}` : ''}{p.isDemo ? ' (demo)' : ''}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

function Workspaces({ initialId }: { initialId?: string | null }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminWorkspaceRow[]>([]);
  const [open, setOpen] = useState<string | null>(initialId ?? null);
  const [error, setError] = useState<string | null>(null);
  const search = useCallback(async (text: string) => {
    try { setRows((await apiClient.adminWorkspaces(text)).workspaces); setError(null); } catch (e) { setError(errText(e, 'Could not search.')); }
  }, []);
  useEffect(() => { void search(''); }, [search]);
  if (open) return <WorkspaceDetail id={open} onBack={() => { setOpen(null); void search(q); }} />;
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by workspace name or ID" className={`${field} flex-1`} />
        <button type="submit" className={btn}>Search</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {rows.map((w) => (
          <li key={w.id}>
            <button type="button" onClick={() => setOpen(w.id)} className="w-full text-left flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-fill-2">
              <span className="min-w-0"><span className="block text-sm text-fg truncate">{w.name}</span><span className="block text-xs text-fg-muted truncate">{w.id}</span></span>
              <span className="text-xs text-fg-muted text-right">{w.plan}{w.plan !== w.storedPlan ? ` (was ${w.storedPlan})` : ''} · {statusText[w.status]}{w.planExpiresAt ? ` · ${day(w.planExpiresAt)}` : ''} · {w.members} {w.members === 1 ? 'person' : 'people'}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-sm text-fg-muted">No workspaces found.</li>}
      </ul>
    </div>
  );
}

function Requests({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<AdminRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { apiClient.adminRequests().then((r) => setList(r.requests)).catch((e) => setError(errText(e, 'Could not load.'))); }, []);
  useEffect(() => { load(); }, [load]);
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!list) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (list.length === 0) return <p className="text-sm text-fg-muted">No open upgrade requests.</p>;
  return (
    <ul className="space-y-3">
      {list.map((r) => (
        <li key={r.id} className={card}>
          <div className="text-sm text-fg"><strong>{r.plan}</strong> requested by {r.email} · {day(r.createdAt)}</div>
          {r.message && <p className="text-sm text-fg-muted">“{r.message}”</p>}
          <div className="flex gap-2">
            <button type="button" className={primary} onClick={() => onOpen(r.workspaceId)}>Open workspace</button>
            <button type="button" className={btn} onClick={() => void apiClient.adminCloseRequest(r.id).then(load).catch((e) => setError(errText(e, 'Could not dismiss.')))}>Dismiss</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Users({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const search = useCallback((text: string) => { apiClient.adminUsers(text).then((r) => { setUsers(r.users); setError(null); }).catch((e) => setError(errText(e, 'Could not search.'))); }, []);
  useEffect(() => { search(''); }, [search]);
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email, name or user ID" className={`${field} flex-1`} />
        <button type="submit" className={btn}>Search</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {users.map((u) => (
          <li key={u.uid} className="px-4 py-3 space-y-1">
            <div className="text-sm text-fg">{u.displayName} <span className="text-fg-muted">· {u.email}</span></div>
            <div className="flex flex-wrap gap-2">
              {u.workspaces.map((w) => <button key={w.id} type="button" onClick={() => onOpen(w.id)} className="rounded-full border border-line px-3 py-1 text-xs text-fg hover:bg-fill-2">{w.name} · {w.role} · {w.plan}</button>)}
            </div>
          </li>
        ))}
        {users.length === 0 && <li className="px-4 py-6 text-sm text-fg-muted">No users found.</li>}
      </ul>
    </div>
  );
}

const ACTION_TEXT: Record<string, string> = {
  'plan.changed': 'Plan changed', 'plan.requested': 'Upgrade requested', 'invoice.recorded': 'Payment recorded',
  'member.added': 'Person added', 'member.invited': 'Person invited', 'member.removed': 'Person removed', 'member.role_changed': 'Role changed',
  'connection.google.connected': 'Google connected', 'connection.google.disconnected': 'Google disconnected',
  'connection.meta.connected': 'Meta connected', 'connection.meta.disconnected': 'Meta disconnected',
  'project.deleted': 'Project deleted', 'account.deleted': 'Account deleted',
  'mcp.key_created': 'AI-tool key created', 'mcp.key_revoked': 'AI-tool key revoked', 'mcp.app_approved': 'AI app approved', 'mcp.app_revoked': 'AI app revoked',
};

function Audit() {
  const [ws, setWs] = useState('');
  const [events, setEvents] = useState<AdminAuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((id: string) => { apiClient.adminAudit(id.trim() || undefined).then((r) => { setEvents(r.events); setError(null); }).catch((e) => setError(errText(e, 'Could not load.'))); }, []);
  useEffect(() => { load(''); }, [load]);
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(ws); }}>
        <input value={ws} onChange={(e) => setWs(e.target.value)} placeholder="Only one workspace? Paste its ID (optional)" className={`${field} flex-1`} />
        <button type="submit" className={btn}>Show</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!events ? <p className="text-sm text-fg-muted">Loading…</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {events.map((e) => (
            <li key={e.id} className="px-4 py-2.5 flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-fg">{ACTION_TEXT[e.action] ?? e.action}{e.detail ? <span className="text-fg-muted"> · {e.detail}</span> : null}<span className="block text-xs text-fg-muted">{e.who}{e.workspaceId ? ` · ${e.workspaceId}` : ''}</span></span>
              <span className="text-xs text-fg-muted">{new Date(e.at).toLocaleString()}</span>
            </li>
          ))}
          {events.length === 0 && <li className="px-4 py-6 text-sm text-fg-muted">Nothing recorded yet.</li>}
        </ul>
      )}
    </div>
  );
}

const fmtLeft = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** The admin panel. Its own page (no customer sidebar), reached only through /admin-login. */
export const AdminPage: React.FC = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [left, setLeft] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate('/admin-login', { replace: true }); return; }
    apiClient.adminSession().then((s) => {
      if (!s.operator || s.secondsLeft <= 0) { navigate(`/admin-login${s.operator ? '?expired=1' : ''}`, { replace: true }); return; }
      setSession(s); setLeft(s.secondsLeft);
    }).catch(() => navigate('/admin-login', { replace: true }));
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!session) return undefined;
    const t = window.setInterval(() => setLeft((n) => { if (n <= 1) { navigate('/admin-login?expired=1', { replace: true }); return 0; } return n - 1; }), 1000);
    return () => window.clearInterval(t);
  }, [session, navigate]);

  const openWorkspace = (id: string) => { setFocus(id); setTab('workspaces'); };

  if (!session) return <div className="min-h-screen bg-page text-fg p-8 text-sm text-fg-muted" role="status">Checking your admin session…</div>;
  return (
    <div className="min-h-screen bg-page text-fg">
      <header className="border-b border-line bg-surface">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-accent-text" />
            <div><h1 className="text-base font-semibold text-fg">AdLens Admin</h1><p className="text-xs text-fg-muted">Everything you change here is written to the activity log.</p></div>
          </div>
          <div className="flex items-center gap-3 text-xs text-fg-muted">
            <span className="break-all">{session.email}</span>
            <span aria-label="Admin session time left" className={left < 300 ? 'text-warning font-medium' : ''}>Session {fmtLeft(left)}</span>
            <Link to="/" className="underline">Open AdLens</Link>
            <button type="button" onClick={() => void signOut().then(() => navigate('/admin-login', { replace: true }))} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-fg min-h-[36px]"><LogOut className="w-3.5 h-3.5" />Sign out</button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-5 space-y-5">
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} type="button"
              onClick={() => { setTab(t.id); if (t.id !== 'workspaces') setFocus(null); }}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted hover:text-fg'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'overview' && <Overview onOpenWorkspaces={() => setTab('workspaces')} />}
        {tab === 'workspaces' && <Workspaces key={focus ?? 'list'} initialId={focus} />}
        {tab === 'requests' && <Requests onOpen={openWorkspace} />}
        {tab === 'subs' && <Subscriptions onOpen={openWorkspace} />}
        {tab === 'plans' && <PlansEditor />}
        {tab === 'switches' && <SwitchesEditor />}
        {tab === 'users' && <Users onOpen={openWorkspace} />}
        {tab === 'operators' && <OperatorsEditor />}
        {tab === 'audit' && <Audit />}
      </main>
    </div>
  );
};
