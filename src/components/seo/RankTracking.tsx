import { ArrowDown, ArrowUp, Minus, RefreshCw, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type RankKeywordList, type RankKeywordRow, type RankPageTraffic, type RankSummaryInfo, type RankTrackingState } from '../../api/client';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const num = (v: number) => v.toLocaleString();

function Spark({ values, invert = false, label }: { values: (number | null)[]; invert?: boolean; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <span className="text-fg-subtle text-xs">not enough data</span>;
  const lo = Math.min(...pts.map((p) => p.v)); const hi = Math.max(...pts.map((p) => p.v)); const span = hi - lo || 1;
  const W = 80; const H = 24;
  const d = pts.map((p, k) => { const x = (p.i / Math.max(values.length - 1, 1)) * W; const t = (p.v - lo) / span; const y = (invert ? t : 1 - t) * (H - 4) + 2; return `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
  return <svg role="img" aria-label={label} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-accent"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function BigChart({ points, invert, label, fmt }: { points: { date: string; v: number | null }[]; invert?: boolean; label: string; fmt: (n: number) => string }) {
  const vals = points.filter((p): p is { date: string; v: number } => p.v !== null);
  if (vals.length < 2) return <p className="text-xs text-fg-subtle">Not enough days saved yet to draw {label.toLowerCase()}.</p>;
  const lo = Math.min(...vals.map((p) => p.v)); const hi = Math.max(...vals.map((p) => p.v)); const span = hi - lo || 1;
  const W = 600; const H = 140; const pad = 6;
  const d = points.map((p, i) => ({ p, i })).filter((x) => x.p.v !== null).map((x, k) => {
    const px = (x.i / Math.max(points.length - 1, 1)) * (W - 2 * pad) + pad; const t = (x.p.v! - lo) / span; const py = (invert ? t : 1 - t) * (H - 2 * pad) + pad;
    return `${k ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
  }).join(' ');
  return (
    <div>
      <svg role="img" aria-label={`${label}: from ${fmt(vals[0]!.v)} to ${fmt(vals[vals.length - 1]!.v)}`} viewBox={`0 0 ${W} ${H}`} className="w-full h-36 text-accent"><path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" /></svg>
      <div className="flex justify-between text-[11px] text-fg-subtle"><span>{points[0]!.date}</span><span>{fmt(lo)} to {fmt(hi)}</span><span>{points[points.length - 1]!.date}</span></div>
    </div>
  );
}

function Change({ change }: { change: number | null }) {
  if (change === null) return <span className="text-fg-subtle text-xs">new</span>;
  if (Math.abs(change) < 0.2) return <span className="inline-flex items-center gap-0.5 text-fg-muted text-xs"><Minus className="w-3 h-3" aria-hidden /> steady</span>;
  return change > 0
    ? <span className="inline-flex items-center gap-0.5 text-success text-xs font-medium"><ArrowUp className="w-3 h-3" aria-hidden /> up {change.toFixed(1)}</span>
    : <span className="inline-flex items-center gap-0.5 text-danger text-xs font-medium"><ArrowDown className="w-3 h-3" aria-hidden /> down {Math.abs(change).toFixed(1)}</span>;
}

const VOL: Record<RankSummaryInfo['volatility']['label'], { text: string; cls: string }> = {
  unknown: { text: 'Not enough data', cls: 'bg-fill-2 text-fg-muted' },
  calm: { text: 'Calm', cls: 'bg-success-soft text-success' },
  normal: { text: 'Normal', cls: 'bg-success-soft text-success' },
  bumpy: { text: 'Bumpy', cls: 'bg-warning-soft text-warning' },
  stormy: { text: 'Stormy', cls: 'bg-danger-soft text-danger' },
};

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">{label}</p><p className="text-2xl font-bold text-fg">{value}</p>{hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}</div>;
}

export function RankTracking({ goToLists }: { goToLists: () => void }) {
  const [days, setDays] = useState<28 | 90>(28);
  const [data, setData] = useState<Awaited<ReturnType<typeof apiClient.rankHistory>> | null>(null);
  const [meta, setMeta] = useState<{ tracking: RankTrackingState | null; canEdit: boolean; trackedCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    try {
      const [h, l] = await Promise.all([apiClient.rankHistory(days), apiClient.rankLists()]);
      setData(h); setMeta({ tracking: l.tracking, canEdit: l.canEdit, trackedCount: l.trackedCount }); setError(null);
    } catch (e) { setError(errMessage(e)); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(errMessage(e)); } setBusy(false); };

  if (!data || !meta) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <div aria-busy="true" className="h-24 rounded-xl bg-fill-2 animate-pulse" />;
  const s = data.summary;
  const tr = meta.tracking;
  const rows = s.keywords.filter((k) => k.keyword.includes(filter.trim().toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px] space-y-0.5">
          <p className="text-sm font-semibold text-fg">{tr?.enabled ? 'Tracking every day' : 'Daily tracking is off'}</p>
          <p className="text-xs text-fg-muted">
            {tr?.enabled ? `Last saved ${tr.refreshedAt ? new Date(tr.refreshedAt).toLocaleString() : 'never'}. ` : ''}
            {tr?.pausedReason ?? `We copy the position of ${meta.trackedCount} keyword${meta.trackedCount === 1 ? '' : 's'} from Google Search Console each day, so you keep the history. Positions are Google's averages for your own site.`}
          </p>
        </div>
        {meta.canEdit && (tr?.enabled
          ? <><button type="button" className={secondary} disabled={busy} onClick={() => void act(() => apiClient.rankRefresh())}><RefreshCw className="w-4 h-4" /> Refresh now</button><button type="button" className={secondary} disabled={busy} onClick={() => void act(() => apiClient.rankStop())}>Stop tracking</button></>
          : <button type="button" className={primary} disabled={busy || meta.trackedCount === 0} onClick={() => void act(() => apiClient.rankStart())}>{busy ? 'Collecting 90 days…' : 'Start tracking'}</button>)}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {meta.trackedCount === 0 ? (
        <p className="text-sm text-fg-muted">You are not tracking any keywords yet. <button type="button" onClick={goToLists} className="text-accent-text underline">Add a keyword list</button> and tick "track daily".</p>
      ) : s.series.length === 0 ? (
        <p className="text-sm text-fg-muted">No positions saved yet. {meta.canEdit ? 'Press Start tracking to pull the last 90 days.' : 'Ask an editor to start tracking.'} Keywords your site does not yet appear for in Google will show as "not ranking".</p>
      ) : (
        <>
          <div className="flex gap-2 items-center"><span className="text-xs text-fg-muted">Show</span><select aria-label="Period" className={field} value={days} onChange={(e) => setDays(Number(e.target.value) as 28 | 90)}><option value={28}>Last 28 days</option><option value={90}>Last 90 days</option></select></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Visibility" value={`${s.visibility}%`} hint={s.visibilityPrevious === null ? 'Share of the clicks a #1 spot everywhere would bring' : `Last week: ${s.visibilityPrevious}%`} />
            <Stat label="Average position" value={s.averagePosition ?? 'n/a'} hint={`${s.rankingCount} of ${s.trackedCount} keywords rank`} />
            <Stat label="In the top 10" value={s.buckets.top3 + s.buckets.top10} hint={`${s.buckets.top3} of them in the top 3`} />
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Ranking weather</p><p className="pt-1"><span className={`text-sm font-medium rounded-full px-2.5 py-1 ${VOL[s.volatility.label].cls}`}>{VOL[s.volatility.label].text}</span></p><p className="text-[11px] text-fg-subtle pt-1">How much your positions jumped around in the last 2 weeks</p></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-3 space-y-1"><p className="text-sm font-semibold text-fg">Visibility over time</p><BigChart label="Visibility" fmt={(v) => `${v}%`} points={s.series.map((p) => ({ date: p.date, v: p.visibility }))} /></div>
            <div className="rounded-xl border border-line bg-surface p-3 space-y-1"><p className="text-sm font-semibold text-fg">Average position (higher on the chart is better)</p><BigChart label="Average position" invert fmt={(v) => v.toFixed(1)} points={s.series.map((p) => ({ date: p.date, v: p.averagePosition }))} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['Biggest winners this week', s.winners], ['Biggest losers this week', s.losers]] as const).map(([title, list]) => (
              <div key={title} className="rounded-xl border border-line bg-surface p-3 space-y-2"><p className="text-sm font-semibold text-fg">{title}</p>
                {list.length === 0 ? <p className="text-xs text-fg-muted">None yet.</p> : <ul className="space-y-1">{list.slice(0, 5).map((k: RankKeywordRow) => <li key={k.keyword} className="flex justify-between gap-2 text-sm"><span className="text-fg truncate">{k.keyword}</span><span className="shrink-0 flex gap-2 items-center"><span className="text-fg-muted text-xs">#{k.position}</span><Change change={k.change} /></span></li>)}</ul>}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <input aria-label="Filter keywords" className={`${field} w-full sm:w-72`} placeholder="Filter keywords" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm"><thead className="bg-fill-2 text-fg-muted text-xs"><tr><th className="text-left p-2">Keyword</th><th className="text-right p-2">Position</th><th className="text-left p-2">Change</th><th className="text-right p-2">Best</th><th className="text-right p-2">Clicks</th><th className="text-right p-2">Views</th><th className="text-left p-2">Trend</th></tr></thead>
                <tbody>{rows.map((k) => (
                  <tr key={k.keyword} className="border-t border-line"><td className="p-2 text-fg">{k.keyword}<span className="ml-2 text-[10px] text-fg-subtle">{k.intent}</span></td><td className="p-2 text-right tabular-nums">{k.position ?? <span className="text-fg-subtle">not ranking</span>}</td><td className="p-2"><Change change={k.change} /></td><td className="p-2 text-right tabular-nums text-fg-muted">{k.best ?? '–'}</td><td className="p-2 text-right tabular-nums">{num(k.clicks)}</td><td className="p-2 text-right tabular-nums">{num(k.impressions)}</td><td className="p-2"><Spark invert label={`Trend for ${k.keyword}`} values={k.trend} /></td></tr>
                ))}</tbody></table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function KeywordLists() {
  const [state, setState] = useState<Awaited<ReturnType<typeof apiClient.rankLists>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: string; name: string; text: string; tracked: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [clusters, setClusters] = useState<{ name: string; keywords: string[] }[] | null>(null);
  const load = useCallback(async () => { try { setState(await apiClient.rankLists()); setError(null); } catch (e) { setError(errMessage(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!state) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <div aria-busy="true" className="h-24 rounded-xl bg-fill-2 animate-pulse" />;
  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try { await apiClient.rankSaveList(editing); setEditing(null); await load(); } catch (e) { setError(errMessage(e)); }
    setBusy(false);
  };
  const remove = async (l: RankKeywordList) => {
    if (!window.confirm(`Delete the list "${l.name}"? Saved positions for its keywords stay until they are no longer tracked.`)) return;
    try { await apiClient.rankDeleteList(l.id); await load(); } catch (e) { setError(errMessage(e)); }
  };
  const group = async (l: RankKeywordList) => { try { setClusters((await apiClient.rankCluster(l.keywords.join('\n'))).clusters); } catch (e) { setError(errMessage(e)); } };
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Save the phrases you care about. Lists with "track daily" ticked are checked every day on the Rank tracking tab. Your plan: {state.limits.lists} list{state.limits.lists === 1 ? '' : 's'}, {state.limits.tracked} tracked keywords ({state.trackedCount} used).</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {state.canEdit && !editing && <button type="button" className={primary} onClick={() => setEditing({ name: '', text: '', tracked: true })}>New keyword list</button>}
      {editing && (
        <div className="rounded-xl border border-line bg-surface p-3 space-y-2">
          <input aria-label="List name" className={`${field} w-full`} placeholder="List name, for example Core services" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <textarea aria-label="Keywords" className={`${field} w-full min-h-[140px]`} placeholder="One keyword per line, or separated by commas" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={editing.tracked} onChange={(e) => setEditing({ ...editing, tracked: e.target.checked })} /> Track daily</label>
          <div className="flex gap-2"><button type="button" className={primary} disabled={busy || editing.name.trim() === ''} onClick={() => void save()}>{busy ? 'Saving…' : 'Save list'}</button><button type="button" className={secondary} onClick={() => setEditing(null)}>Cancel</button></div>
        </div>
      )}
      {state.lists.length === 0 && !editing && <p className="text-sm text-fg-muted">No lists yet.</p>}
      <ul className="space-y-2">
        {state.lists.map((l) => (
          <li key={l.id} className="rounded-xl border border-line bg-surface p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-fg">{l.name}</span><span className="text-xs text-fg-muted">{l.keywords.length} keywords</span><span className={`text-[11px] rounded-full px-2 py-0.5 ${l.tracked ? 'bg-success-soft text-success' : 'bg-fill-2 text-fg-muted'}`}>{l.tracked ? 'Tracked daily' : 'Not tracked'}</span>
              <span className="flex-1" />
              <button type="button" className={secondary} onClick={() => void group(l)}>Group them</button>
              {state.canEdit && <><button type="button" className={secondary} onClick={() => setEditing({ id: l.id, name: l.name, text: l.keywords.join('\n'), tracked: l.tracked })}>Edit</button><button type="button" aria-label={`Delete ${l.name}`} className={secondary} onClick={() => void remove(l)}><Trash2 className="w-4 h-4" /></button></>}
            </div>
            <p className="text-xs text-fg-muted line-clamp-2">{l.keywords.slice(0, 12).join(', ')}{l.keywords.length > 12 ? '…' : ''}</p>
          </li>
        ))}
      </ul>
      {clusters && (
        <div className="rounded-xl border border-line bg-surface p-3 space-y-2">
          <div className="flex justify-between"><p className="text-sm font-semibold text-fg">Groups by shared word</p><button type="button" className="text-xs text-fg-muted underline" onClick={() => setClusters(null)}>Close</button></div>
          {clusters.map((c) => <div key={c.name}><p className="text-sm font-medium text-fg">{c.name} <span className="text-xs text-fg-muted">({c.keywords.length})</span></p><p className="text-xs text-fg-muted">{c.keywords.join(', ')}</p></div>)}
        </div>
      )}
    </div>
  );
}

export function TrafficInsights() {
  const [data, setData] = useState<Awaited<ReturnType<typeof apiClient.rankTraffic>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => { setBusy(true); setError(null); try { setData(await apiClient.rankTraffic()); } catch (e) { setError(errMessage(e)); } setBusy(false); };
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Joins Google Analytics visits from Google search with Search Console, page by page, for the last 28 days. Google hides the search phrase for a share of clicks (the old "not provided"); we show how much.</p>
      <button type="button" className={primary} disabled={busy} onClick={() => void run()}>{busy ? 'Reading…' : 'Load organic traffic'}</button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Visits from Google (Analytics)" value={num(data.totals.sessions)} />
            <Stat label="Clicks (Search Console)" value={num(data.totals.clicks)} />
            <Stat label="Clicks with hidden phrase" value={num(data.totals.hiddenClicks)} hint={`${data.totals.hiddenShare}% of clicks`} />
            <Stat label="Period" value={<span className="text-sm">{data.startDate} to {data.endDate}</span>} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm"><thead className="bg-fill-2 text-fg-muted text-xs"><tr><th className="text-left p-2">Page</th><th className="text-right p-2">Visits</th><th className="text-right p-2">Clicks</th><th className="text-right p-2">Views</th><th className="text-right p-2">Position</th><th className="text-left p-2">Top phrase</th><th className="text-right p-2">Hidden</th></tr></thead>
              <tbody>{data.rows.map((r: RankPageTraffic) => (
                <tr key={r.page} className="border-t border-line"><td className="p-2 text-fg break-all">{r.page}</td><td className="p-2 text-right tabular-nums">{num(r.sessions)}</td><td className="p-2 text-right tabular-nums">{num(r.clicks)}</td><td className="p-2 text-right tabular-nums">{num(r.impressions)}</td><td className="p-2 text-right tabular-nums">{r.position ?? '–'}</td><td className="p-2 text-fg-muted">{r.topQuery ?? '–'}</td><td className="p-2 text-right tabular-nums text-fg-muted">{num(r.hiddenClicks)}</td></tr>
              ))}</tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}
