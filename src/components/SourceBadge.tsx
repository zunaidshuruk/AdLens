import React from 'react';
import type { DataSourceId } from '../types';

interface SourceBadgeProps {
  source: DataSourceId;
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

export const SourceBadge: React.FC<SourceBadgeProps> = ({ source, className = '' }) => {
  const info = SOURCE_LABELS[source];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium tracking-tight ${info.colorClass} ${className}`}
      title={info.name}
    >
      <span>{info.short}</span>
    </span>
  );
};
