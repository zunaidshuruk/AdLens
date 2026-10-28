import { Download, Play, Plus, Save, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { useDateRange } from '../hooks';
import type {
  ExploreCatalog,
  ExploreCatalogSource,
  ExploreFilter,
  ExploreFilterOp,
  ExploreResult,
  ExploreSource,
  ExploreSpec,
  SavedReport,
} from '../types/explore.js';
import { csvFileName, exploreToCsv } from '../utils/exploreCsv.js';
import { formatExploreCell } from '../utils/exploreFormat.js';
import {
  buildRunRequest,
  defaultSpec,
  moveField,
  normaliseSpec,
  sameSpec,
  sanitiseSavedSpec,
  toggleField,
  validateSpec,
} from '../utils/exploreState.js';

const SOURCE_LABEL: Record<ExploreSource, string> = { ga4: 'Google Analytics 4', search_console: 'Search Console', meta: 'Meta Ads' };
const OP_LABEL: Record<ExploreFilterOp, string> = {
  equals: 'is',
  notEquals: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function FieldPicker(props: {
  title: string;
  hint: string;
  fields: ExploreCatalogSource['dimensions'];
  selected: string[];
  max: number;
  onChange: (next: string[]) => void;
}) {
  const { title, hint, fields, selected, max, onChange } = props;
  const groups = useMemo(() => {
    const map = new Map<string, typeof fields>();
    for (const f of fields) map.set(f.group, [...(map.get(f.group) ?? []), f]);
    return [...map.entries()];
  }, [fields]);
  const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="text-xs text-fg-muted">{hint} (up to {max})</p>
      </div>
      {selected.length > 0 && (
        <ol className="flex flex-wrap gap-2">
          {selected.map((key) => (
            <li key={key} className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-text text-xs pl-3 pr-1 py-1">
              <span>{label(key)}</span>
              <button type="button" aria-label={`Move ${label(key)} earlier`} className="px-1 hover:text-fg" onClick={() => onChange(moveField(selected, key, -1))}>←</button>
              <button type="button" aria-label={`Move ${label(key)} later`} className="px-1 hover:text-fg" onClick={() => onChange(moveField(selected, key, 1))}>→</button>
              <button type="button" aria-label={`Remove ${label(key)}`} className="p-1 hover:text-fg" onClick={() => onChange(selected.filter((k) => k !== key))}>
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="max-h-56 overflow-y-auto space-y-3 pr-1">
        {groups.map(([group, items]) => (
          <div key={group}>
            <p className="text-[11px] uppercase tracking-wide text-fg-subtle mb-1">{group}</p>
            <div className="flex flex-wrap gap-1.5">
              {items.map((f) => {
                const on = selected.includes(f.key);
                const full = !on && selected.length >= max;
                return (
                  <button
                    key={f.key}
                    type="button"
                    disabled={full}
                    aria-pressed={on}
                    onClick={() => onChange(toggleField(selected, f.key, max))}
                    className={`text-xs rounded-lg border px-2.5 py-1.5 min-h-[32px] transition-colors disabled:opacity-40 ${
                      on ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted hover:bg-fill-2 hover:text-fg'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterEditor(props: {
  filters: ExploreFilter[];
  dimensions: ExploreCatalogSource['dimensions'];
  allowStartsWith: boolean;
  onChange: (next: ExploreFilter[]) => void;
}) {
  const { filters, dimensions, allowStartsWith, onChange } = props;
  const ops = (Object.keys(OP_LABEL) as ExploreFilterOp[]).filter((o) => allowStartsWith || o !== 'startsWith');
  const update = (i: number, patch: Partial<ExploreFilter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Filters</h3>
          <p className="text-xs text-fg-muted">Only keep rows that match (up to 5)</p>
        </div>
        <button
          type="button"
          disabled={filters.length >= 5}
          onClick={() => onChange([...filters, { field: dimensions[0]?.key ?? '', op: 'contains', value: '' }])}
          className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-line px-2.5 py-1.5 min-h-[32px] text-fg-muted hover:bg-fill-2 hover:text-fg disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Add filter
        </button>
      </div>
      {filters.map((f, i) => (
        <div key={i} className="flex flex-col sm:flex-row gap-2">
          <select aria-label="Filter column" value={f.field} onChange={(e) => update(i, { field: e.target.value })} className="rounded-lg border border-line bg-surface text-fg text-xs px-2 py-2 min-h-[36px]">
            {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <select aria-label="Filter rule" value={f.op} onChange={(e) => update(i, { op: e.target.value as ExploreFilterOp })} className="rounded-lg border border-line bg-surface text-fg text-xs px-2 py-2 min-h-[36px]">
            {ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
          </select>
          <input aria-label="Filter value" value={f.value} maxLength={200} onChange={(e) => update(i, { value: e.target.value })} placeholder="Value" className="flex-1 rounded-lg border border-line bg-surface text-fg text-xs px-3 py-2 min-h-[36px]" />
          <button type="button" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))} className="self-start p-2 text-fg-muted hover:text-danger">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ResultTable({ result }: { result: ExploreResult }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return result.rows;
    const dir = sort.desc ? -1 : 1;
    return [...result.rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [result.rows, sort]);

  if (result.rows.length === 0) {
    return <EmptyState title="No rows for this report" description="Try a wider date range or remove a filter." />;
  }
  return (
    <div className="rounded-xl border border-line bg-surface overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-fill-1 text-fg-muted text-xs">
          <tr>
            {result.columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.role === 'metric' ? 'text-right' : 'text-left'}`} aria-sort={sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                <button type="button" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: c.role === 'metric' }))} className="hover:text-fg">
                  {c.label}{sort?.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-fill-1">
              {result.columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 text-fg ${c.role === 'metric' ? 'text-right tabular-nums' : ''}`}>{formatExploreCell(r[c.key], c.type)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {result.totals && (
          <tfoot className="bg-fill-1 font-semibold">
            <tr>
              {result.columns.map((c, i) => (
                <td key={c.key} className={`px-3 py-2 text-fg ${c.role === 'metric' ? 'text-right tabular-nums' : ''}`}>
                  {i === 0 && c.role === 'dimension' ? 'Total' : c.role === 'metric' ? formatExploreCell(result.totals?.[c.key], c.type) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export const ExplorePage: React.FC = () => {
  const { dateRange } = useDateRange();
  const [catalog, setCatalog] = useState<ExploreCatalog | null>(null);
  const [source, setSource] = useState<ExploreSource>('ga4');
  const [spec, setSpec] = useState<ExploreSpec>(defaultSpec('ga4'));
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [resultLabel, setResultLabel] = useState('report');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const cat = catalog ? catalog[source] : null;

  const loadSaved = useCallback(async () => {
    try {
      setSaved(await apiClient.listSavedReports());
    } catch {
      setSaved([]);
    }
  }, []);

  useEffect(() => {
    let live = true;
    apiClient.getExploreCatalog().then((c) => live && setCatalog(c)).catch((e) => live && setError({ message: errMessage(e) }));
    void loadSaved();
    return () => { live = false; };
  }, [loadSaved]);

  const problems = cat ? validateSpec(spec, cat) : [];
  const active = saved.find((s) => s.id === activeId) ?? null;
  const dirty = active ? !sameSpec(active.spec, spec) || active.source !== source : false;

  const switchSource = (next: ExploreSource) => {
    setSource(next);
    setSpec(defaultSpec(next));
    setResult(null);
    setActiveId(null);
    setName('');
    setError(null);
  };

  const run = async () => {
    if (!cat || problems.length > 0) return;
    setRunning(true);
    setError(null);
    try {
      const res = await apiClient.runExplore(source, buildRunRequest(spec, dateRange));
      setResult(res);
      setResultLabel(active?.name ?? 'report');
    } catch (e) {
      setResult(null);
      setError({ code: (e as { code?: string }).code, message: errMessage(e) });
    } finally {
      setRunning(false);
    }
  };

  const open = (r: SavedReport) => {
    if (!catalog) return;
    setSource(r.source);
    setSpec(sanitiseSavedSpec(r.spec, catalog[r.source]));
    setActiveId(r.id);
    setName(r.name);
    setResult(null);
    setError(null);
  };

  const save = async (asNew: boolean) => {
    setNotice(null);
    const input = { name: name.trim(), source, spec: normaliseSpec(spec) };
    try {
      if (!asNew && active) {
        const r = await apiClient.updateSavedReport(active.id, input);
        setActiveId(r.id);
      } else {
        const r = await apiClient.createSavedReport(input);
        setActiveId(r.id);
      }
      setNotice('Saved.');
      await loadSaved();
    } catch (e) {
      setNotice(errMessage(e));
    }
  };

  const remove = async (r: SavedReport) => {
    try {
      await apiClient.deleteSavedReport(r.id);
      if (activeId === r.id) { setActiveId(null); setName(''); }
      await loadSaved();
    } catch (e) {
      setNotice(errMessage(e));
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([exploreToCsv(result)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFileName(source, resultLabel);
    a.click();
    URL.revokeObjectURL(url);
  };

  const needsSelection = error?.code === 'GA4_NOT_SELECTED' || error?.code === 'SC_NOT_SELECTED';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Explore</h1>
        <p className="text-xs sm:text-sm text-fg-muted">
          Build your own report: choose how to break the data down, which numbers to show, and run it for {dateRange.startDate} to {dateRange.endDate}.
        </p>
      </div>

      <div role="tablist" aria-label="Data source" className="inline-flex rounded-lg border border-line p-0.5 bg-fill-1">
        {(['ga4', 'search_console', 'meta'] as ExploreSource[]).map((s) => (
          <button key={s} role="tab" aria-selected={source === s} onClick={() => switchSource(s)} className={`px-3 py-2 min-h-[36px] text-xs font-medium rounded-md ${source === s ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}>
            {SOURCE_LABEL[s]}
          </button>
        ))}
      </div>

      {saved.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold text-fg mb-2">Saved reports</h3>
          <ul className="flex flex-wrap gap-2">
            {saved.map((r) => (
              <li key={r.id} className={`inline-flex items-center rounded-lg border text-xs ${r.id === activeId ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted'}`}>
                <button type="button" onClick={() => open(r)} className="px-3 py-2 min-h-[36px] hover:text-fg">{r.name} <span className="text-fg-subtle">· {r.source === 'ga4' ? 'GA4' : r.source === 'meta' ? 'Meta' : 'Search'}</span></button>
                <button type="button" aria-label={`Delete ${r.name}`} onClick={() => void remove(r)} className="px-2 py-2 hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cat ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <FieldPicker title="Break down by" hint="Rows — for example channel, page or country" fields={cat.dimensions} selected={spec.dimensions} max={cat.maxDimensions} onChange={(dimensions) => setSpec((s) => normaliseSpec({ ...s, dimensions }))} />
            <FieldPicker title="Numbers to show" hint="Columns — for example sessions or clicks" fields={cat.metrics} selected={spec.metrics} max={cat.maxMetrics} onChange={(metrics) => setSpec((s) => normaliseSpec({ ...s, metrics }))} />
          </div>
          <FilterEditor filters={spec.filters} dimensions={source === 'meta' ? cat.dimensions.filter((d) => ['campaign', 'adset', 'ad'].includes(d.key)) : cat.dimensions} allowStartsWith={source === 'ga4'} onChange={(filters) => setSpec((s) => ({ ...s, filters }))} />

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-fg-muted space-y-1">
              <span className="block">Sort by</span>
              <select value={spec.orderBy ? `${spec.orderBy.field}|${spec.orderBy.desc ? 'd' : 'a'}` : ''} onChange={(e) => {
                const v = e.target.value;
                setSpec((s) => ({ ...s, orderBy: v ? { field: v.split('|')[0], desc: v.endsWith('|d') } : undefined }));
              }} className="block rounded-lg border border-line bg-surface text-fg text-xs px-2 py-2 min-h-[36px]">
                <option value="">Default order</option>
                {[...spec.metrics, ...spec.dimensions].flatMap((k) => {
                  const f = [...cat.metrics, ...cat.dimensions].find((x) => x.key === k);
                  return [<option key={`${k}d`} value={`${k}|d`}>{f?.label ?? k} (high to low)</option>, <option key={`${k}a`} value={`${k}|a`}>{f?.label ?? k} (low to high)</option>];
                })}
              </select>
            </label>
            <label className="text-xs text-fg-muted space-y-1">
              <span className="block">Rows</span>
              <select value={spec.limit} onChange={(e) => setSpec((s) => ({ ...s, limit: Number(e.target.value) }))} className="block rounded-lg border border-line bg-surface text-fg text-xs px-2 py-2 min-h-[36px]">
                {[10, 25, 50, 100, 250, 500, catalog?.maxRows ?? 1000].filter((v, i, a) => a.indexOf(v) === i).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void run()} disabled={running || problems.length > 0} className="inline-flex items-center gap-2 rounded-lg bg-accent text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50">
              <Play className="w-4 h-4" /> {running ? 'Running…' : 'Run report'}
            </button>
          </div>
          {problems.length > 0 && <p role="status" className="text-xs text-warning">{problems[0]}</p>}

          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-4">
            <label className="text-xs text-fg-muted space-y-1 flex-1 min-w-[180px]">
              <span className="block">Report name</span>
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Top pages by channel" className="block w-full rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[36px]" />
            </label>
            <button type="button" disabled={!name.trim() || problems.length > 0 || (!!active && !dirty && name.trim() === active.name)} onClick={() => void save(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2 disabled:opacity-40">
              <Save className="w-3.5 h-3.5" /> {active ? 'Save changes' : 'Save report'}
            </button>
            {active && (
              <button type="button" disabled={!name.trim() || name.trim() === active.name} onClick={() => void save(true)} className="rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2 disabled:opacity-40">Save as new</button>
            )}
            {notice && <span role="status" className="text-xs text-fg-muted">{notice}</span>}
          </div>
        </div>
      ) : !error ? (
        <p className="text-sm text-fg-muted">Loading the report builder…</p>
      ) : null}

      {error && (
        <ErrorState
          title={needsSelection ? 'Choose a data source first' : 'Unable to run this report'}
          message={needsSelection ? 'Pick your Google Analytics property or Search Console site in Connections, then run the report again.' : error.message}
          onRetry={needsSelection ? undefined : () => void run()}
        />
      )}

      {result && (
        <section aria-live="polite" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-muted">{result.rowCount.toLocaleString()} rows{result.truncated ? ' — more rows exist than are shown; narrow the dates or add a filter.' : ''}</p>
            <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2">
              <Download className="w-3.5 h-3.5" /> Download CSV
            </button>
          </div>
          <ResultTable result={result} />
        </section>
      )}
    </div>
  );
};
