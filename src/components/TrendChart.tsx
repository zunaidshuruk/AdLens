import React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatShortDate } from '../utils/dateUtils';
import { EmptyState } from './EmptyState';

export interface ChartSeriesConfig {
  key: string;
  label: string;
  color: string;
  yAxisId?: 'left' | 'right';
  type?: 'area' | 'line';
  dashed?: boolean;
  formatter?: (val: number) => string;
}

interface TrendChartProps<T extends Record<string, unknown>> {
  title: string;
  subtitle?: string;
  data: T[];
  xKey: keyof T & string;
  series: ChartSeriesConfig[];
  dualAxis?: boolean;
  leftAxisFormatter?: (val: number) => string;
  rightAxisFormatter?: (val: number) => string;
  loading?: boolean;
  height?: number;
  headerRight?: React.ReactNode;
}

export function TrendChart<T extends Record<string, unknown>>({
  title,
  subtitle,
  data,
  xKey,
  series,
  dualAxis = false,
  leftAxisFormatter = (v) => v.toLocaleString(),
  rightAxisFormatter = (v) => v.toLocaleString(),
  loading = false,
  height = 300,
  headerRight,
}: TrendChartProps<T>) {
  if (loading) {
    return (
      <div className="p-5 rounded-xl border border-line bg-surface animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="h-4 w-44 bg-fill-3 rounded mb-2" />
            <div className="h-3 w-64 bg-fill-2 rounded" />
          </div>
          <div className="h-4 w-28 bg-fill-3 rounded" />
        </div>
        <div
          style={{ height }}
          className="w-full bg-fill-2 rounded-lg"
        />
      </div>
    );
  }

  return (
    <div className="p-5 rounded-xl border border-line bg-surface">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {subtitle && (
            <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span
                className="w-3 h-0.5 inline-block rounded-full"
                style={{
                  backgroundColor: s.color,
                  borderBottom: s.dashed ? `2px dashed ${s.color}` : undefined,
                }}
              />
              <span>{s.label}</span>
            </div>
          ))}
          {headerRight}
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyState title="No trend data available" description="Select a valid date range to view time-series performance." />
      ) : (
        <div style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: dualAxis ? 8 : 4, left: 0, bottom: 0 }}>
              <defs>
                {series
                  .filter((s) => s.type !== 'line')
                  .map((s) => (
                    <linearGradient key={`grad_${s.key}`} id={`grad_${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={s.color} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={s.color} stopOpacity={0.0} />
                    </linearGradient>
                  ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} vertical={false} />
              <XAxis
                dataKey={String(xKey)}
                tickFormatter={(val) => formatShortDate(String(val))}
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={leftAxisFormatter}
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              {dualAxis && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={rightAxisFormatter}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
              )}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  return (
                    <div className="rounded-lg border border-line bg-surface p-3 shadow-lg text-xs">
                      <div className="font-semibold text-fg mb-1.5 font-mono">
                        {formatShortDate(String(label))} ({String(label)})
                      </div>
                      <div className="space-y-1">
                        {payload.map((entry) => {
                          const cfg = series.find((s) => s.key === entry.dataKey);
                          const rawVal = Number(entry.value ?? 0);
                          const formatted = cfg?.formatter ? cfg.formatter(rawVal) : rawVal.toLocaleString();
                          return (
                            <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
                              <span className="text-fg-muted">{cfg?.label ?? String(entry.name)}:</span>
                              <span className="font-mono font-semibold text-fg tabular-nums">
                                {formatted}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }}
              />
              {series.map((s) => {
                const axisId = s.yAxisId ?? 'left';
                if (s.type === 'line' || s.dashed) {
                  return (
                    <Line
                      key={s.key}
                      yAxisId={axisId}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={s.dashed ? 1.75 : 2.25}
                      strokeDasharray={s.dashed ? '4 4' : undefined}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  );
                }
                return (
                  <Area
                    key={s.key}
                    yAxisId={axisId}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2.25}
                    fillOpacity={1}
                    fill={`url(#grad_${s.key})`}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
