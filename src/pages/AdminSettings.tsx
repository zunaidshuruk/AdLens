import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, type AdminFlags, type AdminPlan, type AdminSettingsView } from '../api/client';

const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const btn = 'rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px] disabled:opacity-50';
const primary = 'rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50';
const card = 'rounded-xl border border-line bg-surface p-4 space-y-3';
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function useSettings() {
  const [view, setView] = useState<AdminSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setView(await apiClient.adminSettings()); setError(null); } catch (e) { setError(errText(e, 'Could not load the settings.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { view, setView, error, setError, load };
}

function Num({ label, value, onChange, nullable, hint }: { label: string; value: number | null; onChange: (v: number | null) => void; nullable?: boolean; hint?: string }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs text-fg-muted">{label}</span>
      <input
        type="number" min={0} inputMode="numeric" value={value === null ? '' : value} placeholder={nullable ? 'No limit' : undefined}
        onChange={(e) => onChange(e.target.value === '' ? (nullable ? null : 0) : Math.max(0, Math.round(Number(e.target.value))))}
        className={`${field} w-full`}
      />
      {hint && <span className="block text-[11px] text-fg-muted">{hint}</span>}
    </label>
  );
}

const toSetting = (p: AdminPlan) => ({
  label: p.label, priceUsd: p.priceUsd, priceBdt: p.priceBdt, limits: p.limits, content: p.content, features: p.features,
  ...(p.custom ? { custom: true } : {}),
});

// ---------------------------------------------------------------------------
// Plans and prices
// ---------------------------------------------------------------------------

export function PlansEditor() {
  const { view, setView, error, setError, load } = useSettings();
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [resets, setResets] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fresh, setFresh] = useState({ id: '', label: '', from: 'pro' });

  useEffect(() => { if (view) { setPlans(view.plans.map((p) => ({ ...p, limits: { ...p.limits }, content: { ...p.content }, features: { ...p.features } }))); setResets(new Set()); } }, [view]);

  const original = useMemo(() => new Map((view?.plans ?? []).map((p) => [p.id, JSON.stringify(p)])), [view]);
  const dirty = plans.some((p) => original.get(p.id) !== JSON.stringify(p)) || resets.size > 0 || plans.length !== (view?.plans.length ?? 0);

  const patch = (id: string, fn: (p: AdminPlan) => AdminPlan) => setPlans((all) => all.map((p) => (p.id === id ? fn(p) : p)));

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload: Record<string, unknown> = { ...(view?.saved ?? {}) };
      for (const id of Object.keys(payload)) if (!plans.some((p) => p.id === id) || resets.has(id)) delete payload[id];
      for (const p of plans) if (!resets.has(p.id) && original.get(p.id) !== JSON.stringify(p)) payload[p.id] = toSetting(p);
      setView(await apiClient.adminSavePlans(payload));
      setNotice('Saved. It reaches every customer within about 30 seconds.');
    } catch (e) { setError(errText(e, 'Could not save.')); } finally { setBusy(false); }
  };

  const addCustom = () => {
    const id = fresh.id.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(id)) { setError('The plan id must be 2 to 24 lower-case letters, numbers or dashes, starting with a letter.'); return; }
    if (plans.some((p) => p.id === id)) { setError('A plan with that id already exists.'); return; }
    const base = plans.find((p) => p.id === fresh.from) ?? plans[0];
    setError(null);
    setPlans((all) => [...all, { ...base, id, custom: true, label: fresh.label.trim() || id, limits: { ...base.limits }, content: { ...base.content }, features: { ...base.features } }]);
    setFresh({ id: '', label: '', from: fresh.from });
  };

  if (!view) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-sm text-fg-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">Change what each plan allows and what it costs. Changes apply to every workspace on that plan within about 30 seconds. Nothing is deleted from anyone's account: lowering a limit only stops them adding more.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}

      {plans.map((p) => (
        <details key={p.id} className={card} open={p.id === 'pro'}>
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            {p.label} <span className="text-xs font-normal text-fg-muted">({p.id}{p.custom ? ', private plan for one customer' : ''}) · USD {p.priceUsd} / BDT {p.priceBdt} a month{original.get(p.id) !== JSON.stringify(p) ? ' · edited' : ''}</span>
          </summary>
          <div className="space-y-4 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="space-y-1 block"><span className="text-xs text-fg-muted">Name shown to customers</span><input value={p.label} maxLength={40} onChange={(e) => patch(p.id, (x) => ({ ...x, label: e.target.value }))} className={`${field} w-full`} /></label>
              <Num label="Price per month (USD)" value={p.priceUsd} onChange={(v) => patch(p.id, (x) => ({ ...x, priceUsd: v ?? 0 }))} />
              <Num label="Price per month (BDT)" value={p.priceBdt} onChange={(v) => patch(p.id, (x) => ({ ...x, priceBdt: v ?? 0 }))} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Num label="Projects (sites)" value={p.limits.maxProjects} onChange={(v) => patch(p.id, (x) => ({ ...x, limits: { ...x.limits, maxProjects: v ?? 0 } }))} />
              <Num label="AI questions per month" value={p.limits.aiQuestionsPerMonth} onChange={(v) => patch(p.id, (x) => ({ ...x, limits: { ...x.limits, aiQuestionsPerMonth: v ?? 0 } }))} />
              <Num label="Team members" value={p.features.maxMembers} onChange={(v) => patch(p.id, (x) => ({ ...x, features: { ...x.features, maxMembers: v ?? 0 } }))} />
              <Num label="AI-tool keys per person" value={p.features.maxMcpKeys} onChange={(v) => patch(p.id, (x) => ({ ...x, features: { ...x.features, maxMcpKeys: v ?? 0 } }))} />
              <Num label="Dashboards" value={p.content.maxDashboards} onChange={(v) => patch(p.id, (x) => ({ ...x, content: { ...x.content, maxDashboards: v ?? 0 } }))} />
              <Num label="Widgets per dashboard" value={p.content.maxWidgetsPerDashboard} onChange={(v) => patch(p.id, (x) => ({ ...x, content: { ...x.content, maxWidgetsPerDashboard: v ?? 0 } }))} />
              <Num label="Saved reports per project" value={p.content.maxSavedReports} onChange={(v) => patch(p.id, (x) => ({ ...x, content: { ...x.content, maxSavedReports: v ?? 0 } }))} />
              <Num label="Uploaded data tables per project" value={p.content.maxDatasets} onChange={(v) => patch(p.id, (x) => ({ ...x, content: { ...x.content, maxDatasets: v ?? 0 } }))} />
              <Num label="Alert rules per project" value={p.content.maxAlertRules} onChange={(v) => patch(p.id, (x) => ({ ...x, content: { ...x.content, maxAlertRules: v ?? 0 } }))} />
              <Num label="Share links per project" value={p.content.maxShareLinks} onChange={(v) => patch(p.id, (x) => ({ ...x, content: { ...x.content, maxShareLinks: v ?? 0 } }))} />
              <Num label="AI agents (0 = none)" value={p.content.maxAgents} onChange={(v) => patch(p.id, (x) => ({ ...x, content: { ...x.content, maxAgents: v ?? 0 } }))} />
              <Num label="Report history (days back)" nullable value={p.features.historyDays} hint="Leave empty for no limit" onChange={(v) => patch(p.id, (x) => ({ ...x, features: { ...x.features, historyDays: v } }))} />
              <label className="flex items-center gap-2 text-sm text-fg pt-6"><input type="checkbox" checked={p.features.emailSummaries} onChange={(e) => patch(p.id, (x) => ({ ...x, features: { ...x.features, emailSummaries: e.target.checked } }))} />Email summaries and alerts</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {!p.custom && <button type="button" className={btn} onClick={() => setResets((r) => new Set(r).add(p.id))} disabled={!view.saved[p.id] || resets.has(p.id)}>{resets.has(p.id) ? 'Will go back to the shipped numbers when you save' : 'Put back the shipped numbers'}</button>}
              {p.custom && <button type="button" className={btn} onClick={() => setPlans((all) => all.filter((x) => x.id !== p.id))}>Delete this plan</button>}
            </div>
          </div>
        </details>
      ))}

      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Make a private plan for one customer</h3>
        <p className="text-xs text-fg-muted">For example "Convay team" with 12 members. It is hidden from the pricing list. Give it to a workspace from Workspaces → Plan. It starts as a copy of the plan you choose.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1"><span className="text-xs text-fg-muted">Plan id (letters, numbers, dashes)</span><input value={fresh.id} onChange={(e) => setFresh({ ...fresh, id: e.target.value })} placeholder="convay-team" className={`${field} block`} /></label>
          <label className="space-y-1"><span className="text-xs text-fg-muted">Name</span><input value={fresh.label} maxLength={40} onChange={(e) => setFresh({ ...fresh, label: e.target.value })} placeholder="Convay team" className={`${field} block`} /></label>
          <label className="space-y-1"><span className="text-xs text-fg-muted">Start from</span>
            <select value={fresh.from} onChange={(e) => setFresh({ ...fresh, from: e.target.value })} className={`${field} block`}>{plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          </label>
          <button type="button" className={btn} onClick={addCustom}>Add plan</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sticky bottom-2">
        <button type="button" className={primary} disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save plan changes'}</button>
        <button type="button" className={btn} disabled={busy || !dirty} onClick={() => void load()}>Discard edits</button>
        {view.updatedAt && <span className="text-xs text-fg-muted">Last saved {new Date(view.updatedAt).toLocaleString()} by {view.updatedBy}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature switches
// ---------------------------------------------------------------------------

const FEATURE_ROWS: { key: keyof AdminFlags; label: string; help: string }[] = [
  { key: 'explore', label: 'Report builder (Explore)', help: 'Saved reports and CSV export.' },
  { key: 'dashboards', label: 'Dashboards', help: 'Dashboards and presentation mode.' },
  { key: 'agents', label: 'AI agents', help: 'People connecting their own agents.' },
  { key: 'mcp', label: 'Connect AI tools (MCP)', help: 'Access keys for outside AI tools.' },
  { key: 'aiAnalyst', label: 'AI Analyst', help: 'The ask-a-question assistant.' },
  { key: 'team', label: 'Teams', help: 'Adding people to a workspace.' },
];

export function SwitchesEditor() {
  const { view, setView, error, setError } = useSettings();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (view) setMsg(view.flags.maintenanceMessage); }, [view]);

  const set = async (flags: Partial<AdminFlags>) => {
    setBusy(true); setError(null); setNotice(null);
    try { setView(await apiClient.adminSaveFlags(flags)); setNotice('Saved. It reaches everyone within about 30 seconds.'); } catch (e) { setError(errText(e, 'Could not save.')); } finally { setBusy(false); }
  };

  if (!view) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-sm text-fg-muted">Loading…</p>;
  const f = view.flags;
  const toggle = (checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <label className="inline-flex items-center gap-2 text-sm text-fg"><input type="checkbox" role="switch" checked={checked} disabled={busy} onChange={(e) => onChange(e.target.checked)} />{label}</label>
  );
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Sign-ups</h3>
        {toggle(f.signupsOpen, (v) => void set({ signupsOpen: v }), 'New people can create an account')}
        <p className="text-xs text-fg-muted">When off, people who already have an account, people with a team invitation and operators can still sign in.</p>
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Maintenance mode</h3>
        {toggle(f.maintenanceMode, (v) => void set({ maintenanceMode: v }), 'Pause AdLens for everyone')}
        <p className="text-xs text-fg-muted">Customers see your message instead of their data. This admin panel keeps working.</p>
        <div className="flex flex-wrap gap-2">
          <input value={msg} maxLength={200} onChange={(e) => setMsg(e.target.value)} placeholder="AdLens is being updated. Back at 6pm." className={`${field} flex-1 min-w-[220px]`} aria-label="Maintenance message" />
          <button type="button" className={btn} disabled={busy || msg === f.maintenanceMessage} onClick={() => void set({ maintenanceMessage: msg })}>Save message</button>
        </div>
      </div>
      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Parts of the app</h3>
        <p className="text-xs text-fg-muted">Switch a part off for everyone, for example while you fix a problem.</p>
        <ul className="divide-y divide-line">
          {FEATURE_ROWS.map((r) => (
            <li key={r.key} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div><div className="text-sm text-fg">{r.label}</div><div className="text-xs text-fg-muted">{r.help}</div></div>
              {toggle(Boolean(f[r.key]), (v) => void set({ [r.key]: v } as Partial<AdminFlags>), Boolean(f[r.key]) ? 'On' : 'Off')}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff (operators with roles)
// ---------------------------------------------------------------------------

export function OperatorsEditor() {
  const { view, setView, error, setError } = useSettings();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('support');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (list: { email: string; role: string }[], done: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { setView(await apiClient.adminSaveOperators(list)); setNotice(done); setEmail(''); } catch (e) { setError(errText(e, 'Could not save.')); } finally { setBusy(false); }
  };

  if (!view) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-sm text-fg-muted">Loading…</p>;
  const extra = view.operators.filter((o) => !o.locked).map((o) => ({ email: o.email, role: o.role }));
  const roleName = (id: string) => view.staffRoles.find((r) => r.id === id)?.name ?? id;
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">AdLens staff sign in on the admin login page. Each person has one staff role that decides which tabs and actions they get. Only add people you trust. Each admin session lasts one hour, then asks for a fresh sign-in.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}

      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Staff roles</h3>
        <ul className="divide-y divide-line">
          {view.staffRoles.map((r) => (
            <li key={r.id} className="py-2 space-y-1">
              <div className="text-sm text-fg font-medium">{r.name} <span className="text-xs font-normal text-fg-muted">{r.description}</span></div>
              <div className="flex flex-wrap gap-1.5">{r.permissions.map((p) => <span key={p} className="rounded-full bg-fill-2 text-fg-muted text-[11px] px-2 py-0.5">{view.staffPermissions.find((x) => x.id === p)?.label ?? p}</span>)}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-fg">Staff</h3>
        <ul className="divide-y divide-line">
          {view.operators.map((o) => (
            <li key={o.email} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div><div className="text-sm text-fg break-all">{o.email}</div><div className="text-xs text-fg-muted">{o.locked ? 'Owner: set in the OPERATOR_EMAILS secret, always Super admin, cannot be changed here' : 'Added in this panel'}</div></div>
              {o.locked ? <span className="text-xs text-fg-muted">{roleName(o.role)}</span> : (
                <div className="flex items-center gap-2">
                  <select aria-label={`Role for ${o.email}`} value={o.role} disabled={busy} className={`${field} py-1 text-xs`}
                    onChange={(e) => void save(extra.map((x) => (x.email === o.email ? { ...x, role: e.target.value } : x)), 'Role changed.')}>
                    {view.staffRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <button type="button" className={btn} disabled={busy} onClick={() => void save(extra.filter((x) => x.email !== o.email), 'Removed.')}>Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void save([...extra, { email: email.trim(), role }], 'Added. They can use the admin login page now.'); }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={`${field} flex-1 min-w-[220px]`} aria-label="Staff email" />
          <select aria-label="Staff role" value={role} onChange={(e) => setRole(e.target.value)} className={field}>
            {view.staffRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button type="submit" className={primary} disabled={busy || !email.trim()}>Add staff</button>
        </form>
      </div>
    </div>
  );
}
