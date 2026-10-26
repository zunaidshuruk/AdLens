import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react';
import type { DataSourceId } from '../types';
import { evaluateChangeSentiment, formatSignedPercent } from '../utils/formatters';
import { resolveMetricTip } from '../utils/metricTip.js';
import { MetricInfoTip } from './MetricInfoTip';
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
  to?: string;
  /** Glossary key to explain, when the label alone is not enough. */
  metricKey?: string;
  /** Set to hide the "i" explanation button. */
  hideInfo?: boolean;
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
  to,
  metricKey,
  hideInfo = false,
}) => {
  if (loading) {
    return (
      <div className="p-5 rounded-xl border border-line bg-surface animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-3.5 w-24 bg-fill-3 rounded" />
          {source && <div className="h-3.5 w-10 bg-fill-3 rounded" />}
        </div>
        <div className="h-7 w-28 bg-fill-3 rounded mb-2.5" />
        <div className="h-3 w-36 bg-fill-2 rounded" />
      </div>
    );
  }

  const tip = hideInfo ? null : resolveMetricTip(label, source, metricKey);
  const sentiment = evaluateChangeSentiment(changePercent, invertPolarity);
  const isRising = changePercent > 0.05;
  const isFalling = changePercent < -0.05;

  const sentimentColor =
    sentiment === 'positive'
      ? 'text-success'
      : sentiment === 'negative'
        ? 'text-danger'
        : 'text-fg-muted';

  const cardContent = (
    <>
      <div className={`flex items-center justify-between gap-2 ${tip ? 'pr-6' : ''}`}>
        <span className="text-xs font-medium text-fg-muted truncate">
          {label}
        </span>
        {source && <SourceBadge source={source} />}
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tracking-tight text-fg font-mono tabular-nums">
          {formattedValue}
        </span>
        {subtitle && compareEnabled && (
          <span className="text-xs font-medium text-fg-muted font-mono">
            {subtitle}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 min-h-[18px] text-xs">
        {compareEnabled ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`inline-flex items-center gap-0.5 font-semibold font-mono tabular-nums ${sentimentColor}`}
            >
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
              <span className="text-fg-subtle font-mono tabular-nums">
                vs {previousFormattedValue}
              </span>
            )}
          </div>
        ) : (
          <span className="text-fg-subtle">
            {subtitle || 'Period comparison off'}
          </span>
        )}
        {to && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-accent-text shrink-0">
            <span>View</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </>
  );

  // The "i" button sits outside the link (a button inside a link is not valid and would also navigate).
  const infoButton = tip ? <MetricInfoTip tip={tip} className="absolute top-3.5 right-3.5 z-10" /> : null;

  if (to) {
    return (
      <div className="relative flex flex-col">
        <Link
          to={to}
          className="p-5 rounded-xl border border-line bg-surface hover:border-accent flex flex-col justify-between flex-1 transition-colors group"
        >
          {cardContent}
        </Link>
        {infoButton}
      </div>
    );
  }

  return (
    <div className="relative p-5 rounded-xl border border-line bg-surface flex flex-col justify-between transition-colors">
      {cardContent}
      {infoButton}
    </div>
  );
};
