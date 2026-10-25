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
    colorClass: 'text-warning',
  },
  search_console: {
    name: 'Search Console',
    short: 'GSC',
    colorClass: 'text-accent-text',
  },
  meta_ads: {
    name: 'Meta Ads',
    short: 'Meta Ads',
    colorClass: 'text-accent-text',
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
  const displayModeBadge = showMode ?? true;

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
              ? 'bg-success-soft text-success border border-success-line'
              : 'bg-fill-2 text-fg-muted border border-line'
          }`}
        >
          {isLive ? 'Live' : 'Mock'}
        </span>
      )}
    </span>
  );
};
