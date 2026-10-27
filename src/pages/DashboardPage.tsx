import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsLeftRight, ChevronsUpDown, Maximize2, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { DashboardWidgetView } from '../components/DashboardWidgetView';
import { ErrorState } from '../components/ErrorState';
import { useDateRange } from '../hooks';
import type { Dashboard, DashboardWidget, WidgetKind } from '../types/dashboard.js';
import type { SavedReport } from '../types/explore.js';
import { addWidget, DEFAULT_SIZE, mobileOrder, placeWidget, removeWidget, resizeWidget } from '../utils/dashboardLayout.js';

const ROW_PX = 72;
const KIND_LABEL: Record<WidgetKind | 'text', string> = { kpi: 'Big number', bar: 'Bar chart', line: 'Line chart', table: 'Table', text: 'Note' };
const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

function useIsDesktop(): boolean {
  const query = '(min-width: 768px)';
  const [match, setMatch] = useState(() => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches));
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return match;
}

function Grid(props: {
  widgets: DashboardWidget[];
  range: { startDate: string; endDate: string };
  refreshKey: number;
  large?: boolean;
  editing?: boolean;
  onChange?: (next: DashboardWidget[]) => void;
}) {
  const { widgets, range, refreshKey, large, editing, onChange } = props;
  const desktop = useIsDesktop();
  const rowPx = large ? 96 : ROW_PX;
  const list = desktop ? widgets : mobileOrder(widgets);
  const btn = 'p-1.5 rounded-md bg-surface border border-line text-fg-muted hover:text-fg hover:bg-fill-2';

  return (
    <div className={desktop ? 'grid gap-3' : 'flex flex-col gap-3'} style={desktop ? { gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridAutoRows: `${rowPx}px` } : undefined}>
      {list.map((w) => (
        <div
          key={w.id}
          className="relative"
          style={desktop ? { gridColumn: `${w.layout.x + 1} / span ${w.layout.w}`, gridRow: `${w.layout.y + 1} / span ${w.layout.h}` } : { minHeight: Math.max(1, w.layout.h) * 56 }}
        >
          <DashboardWidgetView widget={w} range={range} refreshKey={refreshKey} large={large} />
          {editing && onChange && (
            <div className="absolute top-1 right-1 flex flex-wrap justify-end gap-1 max-w-[90%]" role="group" aria-label={`Edit ${w.title}`}>
              {desktop && (
                <>
                  <button type="button" className={btn} aria-label="Move left" onClick={() => onChange(placeWidget(widgets, w.id, { x: w.layout.x - 1 }))}><ArrowLeft className="w-3.5 h-3.5" /></button>
                  <button type="button" className={btn} aria-label="Move right" onClick={() => onChange(placeWidget(widgets, w.id, { x: w.layout.x + 1 }))}><ArrowRight className="w-3.5 h-3.5" /></button>
                </>
              )}
              <button type="button" className={btn} aria-label="Move up" onClick={() => onChange(placeWidget(widgets, w.id, { y: w.layout.y - 1 }))}><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" className={btn} aria-label="Move down" onClick={() => onChange(placeWidget(widgets, w.id, { y: w.layout.y + 1 }))}><ArrowDown className="w-3.5 h-3.5" /></button>
              {desktop && (
                <>
                  <button type="button" className={btn} aria-label="Make wider" onClick={() => onChange(resizeWidget(widgets, w.id, 1, 0))}><ChevronsLeftRight className="w-3.5 h-3.5" /></button>
                  <button type="button" className={btn} aria-label="Make narrower" onClick={() => onChange(resizeWidget(widgets, w.id, -1, 0))}><ChevronsLeftRight className="w-3.5 h-3.5 opacity-50" /></button>
                </>
              )}
              <button type="button" className={btn} aria-label="Make taller" onClick={() => onChange(resizeWidget(widgets, w.id, 0, 1))}><ChevronsUpDown className="w-3.5 h-3.5" /></button>
              <button type="button" className={btn} aria-label="Make shorter" onClick={() => onChange(resizeWidget(widgets, w.id, 0, -1))}><ChevronsUpDown className="w-3.5 h-3.5 opacity-50" /></button>
              <button type="button" className={btn} aria-label="Rename" onClick={() => {
                const t = window.prompt('Widget title', w.title);
                if (t && t.trim()) onChange(widgets.map((x) => (x.id === w.id ? { ...x, title: t.trim().slice(0, 80) } : x)));
              }}><Pencil className="w-3.5 h-3.5" /></button>
              <button type="button" className={`${btn} hover:text-danger`} aria-label="Remove widget" onClick={() => onChange(removeWidget(widgets, w.id))}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AddWidgetPanel({ saved, count, onAdd, onClose }: { saved: SavedReport[]; count: number; onAdd: (w: Omit<DashboardWidget, 'layout'> & { kind: WidgetKind | 'text' }) => void; onClose: () => void }) {
  const [kind, setKind] = useState<WidgetKind | 'text'>('kpi');
  const [reportId, setReportId] = useState(saved[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const report = saved.find((s) => s.id === reportId);
  const canAdd = kind === 'text' ? text.trim().length > 0 : Boolean(report);
  const submit = () => {
    const id = `w${Date.now().toString(36)}${count}`;
    if (kind === 'text') {
      onAdd({ id, title: title.trim() || 'Note', kind: 'text', text: text.trim() } as never);
    } else if (report) {
      onAdd({ id, title: title.trim() || report.name, kind, source: report.source, spec: JSON.parse(JSON.stringify(report.spec)) } as never);
    }
    onClose();
  };
  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Add a widget</h3>
        <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-fg-muted hover:text-fg"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(KIND_LABEL) as (WidgetKind | 'text')[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`text-xs rounded-lg border px-3 py-2 min-h-[36px] ${kind === k ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted hover:bg-fill-2'}`}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      {kind === 'text' ? (
        <textarea aria-label="Note text" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Write a note for the dashboard" className="w-full rounded-lg border border-line bg-surface text-fg text-sm p-3" />
      ) : saved.length === 0 ? (
        <p className="text-xs text-fg-muted">Widgets are built from saved reports. Build and save one in <Link to="/explore" className="text-accent-text underline">Explore</Link> first, then come back.</p>
      ) : (
        <label className="block text-xs text-fg-muted space-y-1">
          <span>Data (a saved report)</span>
          <select value={reportId} onChange={(e) => setReportId(e.target.value)} className="block w-full rounded-lg border border-line bg-surface text-fg text-sm px-2 py-2 min-h-[36px]">
            {saved.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.source === 'ga4' ? 'GA4' : 'Search Console'})</option>)}
          </select>
        </label>
      )}
      <label className="block text-xs text-fg-muted space-y-1">
        <span>Title (optional)</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="block w-full rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[36px]" />
      </label>
      <button type="button" disabled={!canAdd} onClick={submit} className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">Add to dashboard</button>
    </div>
  );
}

export const DashboardPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { dateRange } = useDateRange();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await apiClient.getDashboard(id);
      setDash(d);
      setWidgets(d.widgets);
      setName(d.name);
    } catch (e) {
      setError(errMessage(e));
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void apiClient.listSavedReports().then(setSaved).catch(() => setSaved([])); }, []);

  const dirty = useMemo(() => dash !== null && (name !== dash.name || JSON.stringify(widgets) !== JSON.stringify(dash.widgets)), [dash, name, widgets]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPresenting(false); };
    window.addEventListener('keydown', onKey);
    const timer = window.setInterval(() => setRefreshKey((k) => k + 1), 5 * 60 * 1000);
    return () => { window.removeEventListener('keydown', onKey); window.clearInterval(timer); };
  }, [presenting]);

  const save = async () => {
    if (!dash) return;
    setNote(null);
    try {
      const d = await apiClient.updateDashboard(dash.id, { name: name.trim() || dash.name, description: dash.description, widgets });
      setDash(d);
      setNote('Saved.');
    } catch (e) {
      setNote(errMessage(e));
    }
  };

  const remove = async () => {
    if (!dash || !window.confirm(`Delete "${dash.name}"? This cannot be undone.`)) return;
    try {
      await apiClient.deleteDashboard(dash.id);
      navigate('/dashboards');
    } catch (e) {
      setNote(errMessage(e));
    }
  };

  if (error) return <ErrorState title="Dashboard" message={error} onRetry={() => void load()} actionLabel="Back to dashboards" onAction={() => navigate('/dashboards')} />;
  if (!dash) return <p className="text-sm text-fg-muted">Loading…</p>;

  if (presenting) {
    return (
      <div className="fixed inset-0 z-50 bg-page overflow-auto p-6" role="dialog" aria-label={`${dash.name} — presentation`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-fg">{dash.name}</h1>
            <p className="text-sm text-fg-muted">{dateRange.startDate} to {dateRange.endDate} · refreshes every 5 minutes</p>
          </div>
          <button type="button" onClick={() => setPresenting(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-sm px-4 py-2 min-h-[40px] text-fg hover:bg-fill-2"><X className="w-4 h-4" /> Exit (Esc)</button>
        </div>
        <Grid widgets={dash.widgets} range={dateRange} refreshKey={refreshKey} large />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link to="/dashboards" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"><ArrowLeft className="w-3.5 h-3.5" /> All dashboards</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editing ? (
          <input aria-label="Dashboard name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="text-xl font-bold text-fg bg-surface border border-line rounded-lg px-3 py-1.5 min-w-0 flex-1" />
        ) : (
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">{dash.name}</h1>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setRefreshKey((k) => k + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          <button type="button" onClick={() => setPresenting(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2"><Maximize2 className="w-3.5 h-3.5" /> Present</button>
          <button type="button" aria-pressed={editing} onClick={() => { setEditing((v) => !v); setAdding(false); }} className={`inline-flex items-center gap-1.5 rounded-lg border text-xs px-3 py-2 min-h-[36px] ${editing ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg hover:bg-fill-2'}`}><Pencil className="w-3.5 h-3.5" /> {editing ? 'Editing' : 'Edit'}</button>
        </div>
      </div>
      <p className="text-xs text-fg-muted">Showing {dateRange.startDate} to {dateRange.endDate}. Change the dates at the top of the page.</p>

      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2"><Plus className="w-3.5 h-3.5" /> Add widget</button>
          <button type="button" disabled={!dirty} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save changes</button>
          {dirty && <button type="button" onClick={() => { setWidgets(dash.widgets); setName(dash.name); }} className="text-xs text-fg-muted hover:text-fg underline">Discard changes</button>}
          <button type="button" onClick={() => void remove()} className="ml-auto inline-flex items-center gap-1.5 text-xs text-danger hover:underline"><Trash2 className="w-3.5 h-3.5" /> Delete dashboard</button>
          {note && <span role="status" className="text-xs text-fg-muted">{note}</span>}
        </div>
      )}
      {editing && adding && (
        <AddWidgetPanel saved={saved} count={widgets.length} onClose={() => setAdding(false)} onAdd={(w) => setWidgets((cur) => addWidget(cur, w as never, DEFAULT_SIZE[w.kind] ?? DEFAULT_SIZE.kpi))} />
      )}

      {widgets.length === 0 ? (
        <p className="text-sm text-fg-muted">This dashboard is empty. {editing ? 'Use “Add widget” to put something on it.' : 'Press Edit to add widgets.'}</p>
      ) : (
        <Grid widgets={widgets} range={dateRange} refreshKey={refreshKey} editing={editing} onChange={setWidgets} />
      )}
    </div>
  );
};
