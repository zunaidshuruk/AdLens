import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { DataSourceId } from '../types';
import { evaluateChangeSentiment, formatSignedPercent } from '../utils/formatters';
import { SourceBadge } from './SourceBadge';

interface KpiCardProps {
  label: string;
  formattedValue: string;
  previousFormattedValue?: string;
  changePercent?: number;
  compareEnabled?: boolean;
  invertPolarity?: boolean;
  source?: DataSourceId;
  subtitle?: string;
  loading?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  formattedValue,
  previousFormattedValue,
  changePercent = 0,
  compareEnabled = true,
  invertPolarity = false,
  source,
  subtitle,
  loading = false,
}) => {
  if (loading) {
    return (
      <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-3.5 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
          {source && <div className="h-3.5 w-10 bg-slate-200 dark:bg-slate-800 rounded" />}
        </div>
        <div className="h-7 w-28 bg-slate-200 dark:bg-slate-800 rounded mb-2.5" />
        <div className="h-3 w-36 bg-slate-100 dark:bg-slate-800/70 rounded" />
      </div>
    );
  }

  const sentiment = evaluateChangeSentiment(changePercent, invertPolarity);
  const isRising = changePercent > 0.05;
  const isFalling = changePercent < -0.05;

  const sentimentColor =
    sentiment === 'positive'
      ? 'text-emerald-700 dark:text-emerald-400'
      : sentiment === 'negative'
        ? 'text-red-600 dark:text-red-400'
        : 'text-slate-500 dark:text-slate-400';

  return (
    <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
          {label}
        </span>
        {source && <SourceBadge source={source} />}
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 font-mono tabular-nums">
          {formattedValue}
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 min-h-[18px] text-xs">
        {compareEnabled ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-0.5 font-semibold font-mono tabular-nums ${sentimentColor}`}>
              {isRising ? (
                <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
              ) : isFalling ? (
                <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Minus className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{formatSignedPercent(changePercent)}</span>
            </span>
            {previousFormattedValue && (
              <span className="text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                vs {previousFormattedValue}
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">
            {subtitle || 'Period comparison off'}
          </span>
        )}
      </div>
    </div>
  );
};
