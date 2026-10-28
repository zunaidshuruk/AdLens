import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../api/client';
import type { DashboardWidget } from '../types/dashboard.js';
import type { ExploreResult } from '../types/explore.js';
import { gaugeFraction, heatGrid, pieSlices, pivotTwoDimensions } from '../utils/chartShapes.js';
import { panelRange } from '../utils/dashboardLayout.js';
import { formatShortDate } from '../utils/dateUtils';
import { formatExploreCell } from '../utils/exploreFormat.js';
import { buildRunRequest } from '../utils/exploreState.js';

interface Props {
  widget: DashboardWidget;
  range: { startDate: string; endDate: string };
  refreshKey: number;
  /** Bigger text for presentation mode. */
  large?: boolean;
}

const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)'];
const TIP = { background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 8, fontSize: 12 } as const;
const AXIS = { fontSize: 11, fill: 'var(--color-fg-muted)' } as const;

function useWidgetData(widget: DashboardWidget, range: Props['range'], refreshKey: number) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; result: ExploreResult | null }>({ loading: widget.kind !== 'text', error: null, result: null });
  const key = widget.kind === 'text' ? '' : JSON.stringify([widget.source, widget.spec, range.startDate, range.endDate, refreshKey]);
  useEffect(() => {
    if (widget.kind === 'text') return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    apiClient
      .runExplore(widget.source, buildRunRequest(widget.spec, range))
      .then((result) => live && setState({ loading: false, error: null, result }))
      .catch((e) => live && setState({ loading: false, error: e instanceof Error ? e.message : 'Could not load this widget.', result: null }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export const DashboardWidgetView: React.FC<Props> = ({ widget, range: pageRange, refreshKey, large }) => {
  const range = useMemo(() => panelRange(widget.kind === 'text' ? undefined : widget.days, pageRange), [widget, pageRange]);
  const { loading, error, result } = useWidgetData(widget, range, refreshKey);

  const body = useMemo(() => {
    if (widget.kind === 'text') {
      return <p className={`whitespace-pre-wrap text-fg ${large ? 'text-xl' : 'text-sm'}`}>{widget.text}</p>;
    }
    if (loading) return <div aria-busy="true" className="h-full min-h-[48px] w-full rounded-lg bg-fill-2 animate-pulse" />;
    if (error) return <p role="alert" className="text-xs text-danger">{error}</p>;
    if (!result || (result.rows.length === 0 && !result.totals)) return <p className="text-xs text-fg-muted">No data for these dates.</p>;

    const metric = result.columns.find((c) => c.role === 'metric');
    const dim = result.columns.find((c) => c.role === 'dimension');

    if (widget.kind === 'kpi') {
      const row = result.totals ?? result.rows[0];
      return metric ? (
        <p className={`font-bold tabular-nums text-fg ${large ? 'text-6xl' : 'text-3xl'}`}>{formatExploreCell(row?.[metric.key], metric.type)}</p>
      ) : null;
    }

    if (widget.kind === 'table') {
      return (
        <div className="overflow-auto max-h-full">
          <table className={`min-w-full ${large ? 'text-base' : 'text-xs'}`}>
            <thead className="text-fg-muted">
              <tr>{result.columns.map((c) => <th key={c.key} scope="col" className={`py-1 pr-3 font-medium ${c.role === 'metric' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.rows.map((r, i) => (
                <tr key={i}>{result.columns.map((c) => <td key={c.key} className={`py-1 pr-3 text-fg ${c.role === 'metric' ? 'text-right tabular-nums' : 'max-w-[16rem] truncate'}`}>{formatExploreCell(r[c.key], c.type)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    const dims = result.columns.filter((c) => c.role === 'dimension');

    if (widget.kind === 'gauge') {
      const row = result.totals ?? result.rows[0];
      const raw = metric ? row?.[metric.key] : undefined;
      if (!metric || typeof raw !== 'number') return <p className="text-xs text-fg-muted">Pick one number to show a gauge.</p>;
      const frac = gaugeFraction(raw, metric.type === 'percent', widget.target);
      if (frac === null) {
        return (
          <div>
            <p className={`font-bold tabular-nums text-fg ${large ? 'text-5xl' : 'text-3xl'}`}>{formatExploreCell(raw, metric.type)}</p>
            <p className="text-[11px] text-fg-subtle">Set a target (in edit mode) to draw the dial.</p>
          </div>
        );
      }
      const len = Math.PI * 40;
      return (
        <div role="img" aria-label={`${metric.label}: ${formatExploreCell(raw, metric.type)}, ${Math.round(frac * 100)}% of target`} className="w-full flex flex-col items-center">
          <svg viewBox="0 0 100 58" className="w-full max-w-[220px]">
            <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--color-fill-2)" strokeWidth="9" strokeLinecap="round" />
            <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--chart-1)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${len * frac} ${len}`} />
          </svg>
          <p className={`-mt-4 font-bold tabular-nums text-fg ${large ? 'text-4xl' : 'text-xl'}`}>{formatExploreCell(raw, metric.type)}</p>
          <p className="text-[11px] text-fg-subtle">{Math.round(frac * 100)}% of {widget.target ? formatExploreCell(widget.target, metric.type) : '100%'}</p>
        </div>
      );
    }

    if (widget.kind === 'pie') {
      if (!metric || !dim) return <p className="text-xs text-fg-muted">Pick one breakdown and one number to draw a pie.</p>;
      const slices = pieSlices(result.rows.map((r) => ({ label: String(r[dim.key] ?? ''), value: typeof r[metric.key] === 'number' ? (r[metric.key] as number) : 0 })));
      if (slices.length === 0) return <p className="text-xs text-fg-muted">No data for these dates.</p>;
      return (
        <div role="img" aria-label={`Pie chart of ${metric.label} by ${dim.label}`} className="h-full min-h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="label" innerRadius="45%" outerRadius="80%" isAnimationActive={false} stroke="var(--color-surface)">
                {slices.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => formatExploreCell(Number(v), metric.type)} contentStyle={TIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (widget.kind === 'stacked' || widget.kind === 'heatmap') {
      if (!metric || dims.length < 2) return <p className="text-xs text-fg-muted">Pick two breakdowns and one number for this chart.</p>;
      const [d1, d2] = dims;
      const fmt = (v: number) => formatExploreCell(v, metric.type);
      if (widget.kind === 'stacked') {
        const { data, series } = pivotTwoDimensions(result.rows, d1.key, d2.key, metric.key);
        const isDate = d1.type === 'date';
        return (
          <div role="img" aria-label={`Stacked bar chart of ${metric.label} by ${d1.label} and ${d2.label}`} className="h-full min-h-[120px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" strokeOpacity={0.2} vertical={false} />
                <XAxis dataKey="label" tickFormatter={(v: string) => (isDate ? formatShortDate(v) : v.length > 12 ? `${v.slice(0, 11)}…` : v)} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tickFormatter={fmt} tick={AXIS} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(v) => (isDate ? formatShortDate(String(v)) : String(v))} contentStyle={TIP} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {series.map((sName, i) => <Bar key={sName} dataKey={sName} stackId="a" fill={SERIES[i % SERIES.length]} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }
      const grid = heatGrid(result.rows, d1.key, d2.key, metric.key);
      return (
        <div role="img" aria-label={`Heat map of ${metric.label} by ${d1.label} and ${d2.label}`} className="overflow-auto max-h-full w-full">
          <table className={`border-separate border-spacing-0.5 ${large ? 'text-sm' : 'text-[11px]'}`}>
            <thead>
              <tr><th scope="col" className="sr-only">{d1.label}</th>{grid.colLabels.map((c) => <th key={c} scope="col" className="px-1 font-medium text-fg-muted max-w-[6rem] truncate">{c}</th>)}</tr>
            </thead>
            <tbody>
              {grid.rowLabels.map((rl, ri) => (
                <tr key={rl}>
                  <th scope="row" className="pr-2 text-left font-medium text-fg-muted max-w-[8rem] truncate">{rl}</th>
                  {grid.cells[ri].map((c, ci) => (
                    <td key={ci} title={c.value === null ? '' : fmt(c.value)} className="relative h-6 min-w-[2.25rem] rounded text-center tabular-nums text-fg bg-fill-1">
                      <span aria-hidden="true" className="absolute inset-0 rounded" style={{ background: 'var(--chart-1)', opacity: c.value === null ? 0 : 0.12 + 0.88 * c.intensity }} />
                      <span className="relative">{c.value === null ? '' : fmt(c.value)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (!metric || !dim) return <p className="text-xs text-fg-muted">Pick one breakdown and one number to draw a chart.</p>;
    const data = result.rows.map((r) => ({ label: String(r[dim.key] ?? ''), value: typeof r[metric.key] === 'number' ? (r[metric.key] as number) : 0 }));
    const fmt = (v: number) => formatExploreCell(v, metric.type);
    const isDate = dim.type === 'date';
    return (
      <div role="img" aria-label={`${widget.kind === 'bar' ? 'Bar' : 'Line'} chart of ${metric.label} by ${dim.label}`} className="h-full min-h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {widget.kind === 'bar' ? (
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" strokeOpacity={0.2} horizontal={false} />
              <XAxis type="number" tickFormatter={fmt} tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={110} tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
              <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" name={metric.label} fill="var(--chart-1)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" strokeOpacity={0.2} vertical={false} />
              <XAxis dataKey="label" tickFormatter={(v: string) => (isDate ? formatShortDate(v) : v)} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={fmt} tick={AXIS} axisLine={false} tickLine={false} width={52} />
              <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(v) => (isDate ? formatShortDate(String(v)) : String(v))} contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="value" name={metric.label} stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }, [widget, loading, error, result, large]);

  const subtitle = widget.kind !== 'text' && result && (widget.kind === 'kpi' || widget.kind === 'gauge') ? result.columns.find((c) => c.role === 'metric')?.label : null;
  return (
    <div className="h-full flex flex-col rounded-xl border border-line bg-surface p-4 overflow-hidden">
      <h3 className={`font-semibold text-fg truncate ${large ? 'text-lg' : 'text-sm'}`}>{widget.title}{widget.kind !== 'text' && widget.days ? <span className="ml-2 text-[11px] font-normal text-fg-subtle">last {widget.days} days</span> : null}</h3>
      {subtitle && <p className="text-[11px] text-fg-subtle">{subtitle}</p>}
      <div className="mt-2 flex-1 min-h-0 flex items-center">{<div className="w-full h-full flex items-center">{body}</div>}</div>
    </div>
  );
};
