import { Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, type AlertRuleInfo, type AlertRuleInput } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import type { DatasetInfo, ExploreCatalog, ExploreFieldInfo } from '../types/explore.js';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const SOURCES: { key: AlertRuleInfo['source']; label: string }[] = [
  { key: 'ga4', label: 'Google Analytics 4' },
  { key: 'search_console', label: 'Search Console' },
  { key: 'meta', label: 'Meta Ads' },
  { key: 'data', label: 'Uploaded or connected table' },
];
const CONDITIONS: { key: AlertRuleInfo['condition']; label: string; pct: boolean }[] = [
  { key: 'above', label: 'goes above', pct: false },
  { key: 'below', label: 'drops below', pct: false },
  { key: 'rises_pct', label: 'rises by (%) compared with the period before', pct: true },
  { key: 'falls_pct', label: 'falls by (%) compared with the period before', pct: true },
];
const WINDOWS: { key: 1 | 7 | 28; label: string }[] = [
  { key: 1, label: 'Yesterday' },
  { key: 7, label: 'Last 7 days' },
  { key: 28, label: 'Last 28 days' },
];
const AGGREGATES: { key: NonNullable<AlertRuleInfo['aggregate']>; label: string }[] = [
  { key: 'sum', label: 'Add up' },
  { key: 'avg', label: 'Average' },
  { key: 'min', label: 'Smallest' },
  { key: 'max', label: 'Largest' },
  { key: 'count', label: 'Count' },
];
const STATUS: Record<AlertRuleInfo['status'], { label: string; cls: string }> = {
  new: { label: 'Not checked yet', cls: 'text-fg-muted' },
  ok: { label: 'All good', cls: 'text-success' },
  triggered: { label: 'Triggered', cls: 'text-danger' },
  nodata: { label: 'No data', cls: 'text-warning' },
  error: { label: 'Could not check', cls: 'text-warning' },
};

interface FormState {
  name: string;
  source: AlertRuleInfo['source'];
  datasetId: string;
  aggregate: NonNullable<AlertRuleInfo['aggregate']>;
  metric: string;
  filterField: string;
  filterValue: string;
  condition: AlertRuleInfo['condition'];
  threshold: string;
  windowDays: 1 | 7 | 28;
  emails: string;
  webhookUrl: string;
  enabled: boolean;
}

const field = 'rounded-lg border border-line bg-surface text-fg text-xs px-2 py-2 min-h-[36px] w-full';

function AlertForm(props: {
  initial: AlertRuleInfo | null;
  catalog: ExploreCatalog | null;
  datasets: DatasetInfo[];
  emailAllowed: boolean;
  userEmail: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { initial, catalog, datasets, emailAllowed, userEmail, onSaved, onCancel } = props;
  const [f, setF] = useState<FormState>(() => ({
    name: initial?.name ?? '',
    source: initial?.source ?? 'ga4',
    datasetId: initial?.datasetId ?? datasets[0]?.id ?? '',
    aggregate: initial?.aggregate ?? 'sum',
    metric: initial?.metric ?? '',
    filterField: initial?.filter?.field ?? '',
    filterValue: initial?.filter?.value ?? '',
    condition: initial?.condition ?? 'below',
    threshold: initial ? String(initial.threshold) : '',
    windowDays: initial?.windowDays ?? 7,
    emails: initial ? initial.emails.join(', ') : emailAllowed && userEmail ? userEmail : '',
    webhookUrl: '',
    enabled: initial?.enabled ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<FormState>) => setF((s) => ({ ...s, ...p }));

  const dataset = datasets.find((d) => d.id === f.datasetId);
  const metrics: ExploreFieldInfo[] = useMemo(() => {
    if (f.source === 'data') return dataset?.catalog.metrics ?? [];
    return catalog?.[f.source]?.metrics ?? [];
  }, [f.source, dataset, catalog]);
  const dimensions: ExploreFieldInfo[] = useMemo(() => {
    if (f.source === 'data') return dataset?.catalog.dimensions ?? [];
    return catalog?.[f.source]?.dimensions ?? [];
  }, [f.source, dataset, catalog]);
  const metric = metrics.some((m) => m.key === f.metric) ? f.metric : metrics[0]?.key ?? '';
  const isPct = CONDITIONS.find((c) => c.key === f.condition)?.pct ?? false;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const threshold = Number(f.threshold);
    if (f.threshold.trim() === '' || !Number.isFinite(threshold)) { setError('Enter a number for the limit.'); return; }
    const input: AlertRuleInput = {
      name: f.name.trim(),
      source: f.source,
      metric,
      condition: f.condition,
      threshold,
      windowDays: f.windowDays,
      emails: f.emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
      enabled: f.enabled,
      ...(f.source === 'data' ? { datasetId: f.datasetId, aggregate: f.aggregate } : {}),
      ...(f.filterField && f.filterValue.trim() ? { filter: { field: f.filterField, op: 'equals' as const, value: f.filterValue.trim() } } : {}),
      // Left out when editing and empty so the saved webhook is kept.
      ...(f.webhookUrl.trim() || !initial ? { webhookUrl: f.webhookUrl.trim() } : {}),
    };
    setBusy(true);
    try {
      if (initial) await apiClient.updateAlert(initial.id, input);
      else await apiClient.createAlert(input);
      onSaved();
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  };

  const label = 'block text-xs font-medium text-fg space-y-1';
  return (
    <form onSubmit={(e) => void save(e)} className="rounded-xl border border-line bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">{initial ? 'Edit alert' : 'New alert'}</h2>
        <button type="button" aria-label="Close" onClick={onCancel} className="p-1 text-fg-muted hover:text-fg"><X className="w-4 h-4" /></button>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <label className={label}>Name
        <input className={field} value={f.name} maxLength={80} placeholder="For example: Sessions dropped" onChange={(e) => set({ name: e.target.value })} required />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Where does the number come from?
          <select className={field} value={f.source} onChange={(e) => set({ source: e.target.value as FormState['source'], metric: '', filterField: '' })}>
            {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {f.source === 'data' && (
          <label className={label}>Table
            <select className={field} value={f.datasetId} onChange={(e) => set({ datasetId: e.target.value, metric: '', filterField: '' })}>
              {datasets.length === 0 && <option value="">No tables yet (add one in Explore)</option>}
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        <label className={label}>Number to watch
          <select className={field} value={metric} onChange={(e) => set({ metric: e.target.value })}>
            {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        {f.source === 'data' && (
          <label className={label}>How to combine the rows
            <select className={field} value={f.aggregate} onChange={(e) => set({ aggregate: e.target.value as FormState['aggregate'] })}>
              {AGGREGATES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
        )}
        <label className={label}>Period to look at
          <select className={field} value={f.windowDays} onChange={(e) => set({ windowDays: Number(e.target.value) as FormState['windowDays'] })}>
            {WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Only count rows where (optional)
          <select className={field} value={f.filterField} onChange={(e) => set({ filterField: e.target.value })}>
            <option value="">Everything</option>
            {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        {f.filterField && (
          <label className={label}>…is exactly
            <input className={field} value={f.filterValue} maxLength={200} placeholder="For example: United States" onChange={(e) => set({ filterValue: e.target.value })} />
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Tell me when the number
          <select className={field} value={f.condition} onChange={(e) => set({ condition: e.target.value as FormState['condition'] })}>
            {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className={label}>{isPct ? 'Percent (for example 20)' : 'Limit'}
          <input className={field} inputMode="decimal" value={f.threshold} onChange={(e) => set({ threshold: e.target.value })} required />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Email addresses (up to 3, separated by commas)
          <input className={field} value={f.emails} disabled={!emailAllowed} placeholder={emailAllowed ? 'you@company.com' : 'Email alerts are not part of your plan'} onChange={(e) => set({ emails: e.target.value })} />
        </label>
        <label className={label}>Webhook address (Slack, Discord, Zapier…)
          <input className={field} value={f.webhookUrl} placeholder={initial?.webhookHost ? `Saved: ${initial.webhookHost} (leave empty to keep)` : 'https://hooks.slack.com/…'} onChange={(e) => set({ webhookUrl: e.target.value })} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-fg">
        <input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Alert is on
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !metric} className="rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-xs px-3 py-2 min-h-[36px] disabled:opacity-50">{busy ? 'Saving…' : 'Save alert'}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2">Cancel</button>
      </div>
    </form>
  );
}

export const AlertsPage: React.FC = () => {
  const [rules, setRules] = useState<AlertRuleInfo[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [emailAllowed, setEmailAllowed] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ExploreCatalog | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AlertRuleInfo | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await apiClient.listAlerts();
      setRules(r.rules); setLimit(r.limit); setEmailAllowed(r.emailAllowed); setUserEmail(r.userEmail);
    } catch (e) { setError(errMessage(e)); setRules([]); }
  }, []);
  useEffect(() => {
    void load();
    apiClient.getExploreCatalog().then(setCatalog).catch(() => undefined);
    apiClient.listDatasets().then((d) => setDatasets(d.datasets)).catch(() => undefined);
  }, [load]);

  const remove = async (r: AlertRuleInfo) => {
    if (!window.confirm(`Delete "${r.name}"?`)) return;
    try { await apiClient.deleteAlert(r.id); await load(); } catch (e) { setError(errMessage(e)); }
  };
  const test = async (r: AlertRuleInfo) => {
    setBusy(r.id); setNotice(null); setError(null);
    try {
      const t = await apiClient.testAlert(r.id);
      setNotice(`${t.message} ${t.wouldTrigger ? 'This would trigger the alert.' : 'This would not trigger the alert.'} A test message was sent to the places you chose.`);
    } catch (e) { setError(errMessage(e)); }
    setBusy(null);
  };

  const atLimit = rules !== null && rules.length >= limit;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Alerts</h1>
        <p className="text-xs sm:text-sm text-fg-muted">Get told when a number crosses a line. Alerts are checked once a day and sent by email or to a webhook such as Slack.</p>
      </div>
      {error && <ErrorState title="Alerts" message={error} onRetry={() => void load()} />}
      {notice && <p role="status" className="text-xs text-fg rounded-lg border border-line bg-fill-2 p-3">{notice}</p>}

      {editing ? (
        <AlertForm
          initial={editing === 'new' ? null : editing}
          catalog={catalog}
          datasets={datasets}
          emailAllowed={emailAllowed}
          userEmail={userEmail}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" disabled={atLimit} onClick={() => { setNotice(null); setEditing('new'); }} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-xs px-3 py-2 min-h-[36px] disabled:opacity-50">
            <Plus className="w-4 h-4" /> New alert
          </button>
          {rules !== null && <span className="text-xs text-fg-muted">{rules.length} of {limit} used</span>}
        </div>
      )}
      {atLimit && !editing && <p className="text-xs text-fg-muted">Your plan allows {limit} {limit === 1 ? 'alert' : 'alerts'} per project. Delete one or upgrade to add more.</p>}

      {rules !== null && rules.length === 0 && !error && !editing && (
        <EmptyState title="No alerts yet" description="Create one, for example: tell me if yesterday's sessions drop below 500." />
      )}
      <ul className="space-y-3">
        {(rules ?? []).map((r) => {
          const st = STATUS[r.status];
          return (
            <li key={r.id} className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">{r.name}{!r.enabled && <span className="ml-2 text-xs font-normal text-fg-muted">(off)</span>}</p>
                  <p className={`text-xs ${st.cls}`}>{st.label}{r.lastCheckedAt ? ` · checked ${new Date(r.lastCheckedAt).toLocaleDateString()}` : ''}</p>
                </div>
                <div className="flex items-center">
                  <button type="button" aria-label={`Send a test for ${r.name}`} disabled={busy === r.id} onClick={() => void test(r)} className="p-2 text-fg-muted hover:text-fg disabled:opacity-50"><Send className="w-4 h-4" /></button>
                  <button type="button" aria-label={`Edit ${r.name}`} onClick={() => { setNotice(null); setEditing(r); }} className="p-2 text-fg-muted hover:text-fg"><Pencil className="w-4 h-4" /></button>
                  <button type="button" aria-label={`Delete ${r.name}`} onClick={() => void remove(r)} className="p-2 text-fg-muted hover:text-danger"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              {r.lastMessage && <p className="text-xs text-fg-muted">{r.lastMessage}</p>}
              {r.lastError && <p className="text-xs text-warning">{r.lastError}</p>}
              <p className="text-xs text-fg-muted">
                Sends to: {[...r.emails, r.webhookHost].filter(Boolean).join(', ') || 'nowhere yet'}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
