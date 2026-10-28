import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../api/client';
import type { DashboardWidget } from '../types/dashboard.js';
import type { ExploreResult } from '../types/explore.js';
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

  const subtitle = widget.kind !== 'text' && result && widget.kind === 'kpi' ? result.columns.find((c) => c.role === 'metric')?.label : null;
  return (
    <div className="h-full flex flex-col rounded-xl border border-line bg-surface p-4 overflow-hidden">
      <h3 className={`font-semibold text-fg truncate ${large ? 'text-lg' : 'text-sm'}`}>{widget.title}{widget.kind !== 'text' && widget.days ? <span className="ml-2 text-[11px] font-normal text-fg-subtle">last {widget.days} days</span> : null}</h3>
      {subtitle && <p className="text-[11px] text-fg-subtle">{subtitle}</p>}
      <div className="mt-2 flex-1 min-h-0 flex items-center">{<div className="w-full h-full flex items-center">{body}</div>}</div>
    </div>
  );
};
