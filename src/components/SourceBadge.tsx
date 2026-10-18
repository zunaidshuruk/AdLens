import React from 'react';
import { useAdapterStatus } from '../hooks/useReport';
import type { DataSourceId } from '../types';

interface SourceBadgeProps {
  source: DataSourceId;
  showMode?: boolean;
  className?: string;
}

const SOURCE_LABELS: Record<DataSourceId, { name: string; short: string; colorClass: string }> = {
  ga4: {
    name: 'Google Analytics 4',
    short: 'GA4',
    colorClass: 'text-amber-700 dark:text-amber-400',
  },
  search_console: {
    name: 'Search Console',
    short: 'GSC',
    colorClass: 'text-blue-700 dark:text-blue-400',
  },
  meta_ads: {
    name: 'Meta Ads',
    short: 'Meta Ads',
    colorClass: 'text-indigo-700 dark:text-indigo-400',
  },
};

export const SourceBadge: React.FC<SourceBadgeProps> = ({
  source,
  showMode,
  className = '',
}) => {
  const { isSourceLive } = useAdapterStatus();
  const info = SOURCE_LABELS[source];
  const isLive = isSourceLive(source);
  const displayModeBadge = showMode ?? source === 'ga4';

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium tracking-tight ${info.colorClass} ${className}`}
      title={info.name}
    >
      <span>{info.short}</span>
      {displayModeBadge && (
        <span
          data-testid={`source-mode-badge-${source}`}
          className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded ${
            isLive
              ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/70 dark:border-emerald-800'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
          }`}
        >
          {isLive ? 'Live' : 'Mock'}
        </span>
      )}
    </span>
  );
};
