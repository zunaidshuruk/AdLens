import React from 'react';
import { Link } from 'react-router-dom';
import { KpiCard } from '../components/KpiCard';
import { ReportBoundary } from '../components/ReportBoundary';
import { useRunReport } from '../hooks';
import type { SnapshotReport } from '../types/intelligence.js';
import { formatNumber } from '../utils/formatters';
import { pageDetailLink, shortUrl } from '../utils/intelligenceFormat.js';

const pct = (cur: number, prev: number): number => (prev > 0 ? ((cur - prev) / prev) * 100 : 0);

export const SnapshotPage: React.FC = () => {
  const r = useRunReport<SnapshotReport>('site.snapshot');
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Site snapshot</h1>
        <p className="text-xs sm:text-sm text-fg-muted">The whole site on one page: visits, search, and the first things worth looking at.</p>
      </div>
      <ReportBoundary {...r} onRetry={r.refetch}>
        {r.data && (
          <div className="space-y-6">
            {r.data.unavailable.length > 0 && (
              <ul className="rounded-xl border border-warning-line bg-warning-soft p-3 text-xs text-fg space-y-1">
                {r.data.unavailable.map((u) => (
                  <li key={u.source}>
                    <strong>{u.source}:</strong> {u.reason} <Link to="/connections" className="text-accent-text underline">Open Connections</Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-fg-muted">
              {r.data.period.startDate} to {r.data.period.endDate}, compared with {r.data.comparedWith.startDate} to {r.data.comparedWith.endDate}.
            </p>
            {r.data.analytics && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-fg">Website visits</h2>
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                  <KpiCard label="Sessions" formattedValue={formatNumber(r.data.analytics.sessions.value)} changePercent={r.data.analytics.sessions.changePercent ?? 0} source="ga4" to="/ga4" />
                  <KpiCard label="Users" formattedValue={formatNumber(r.data.analytics.users.value)} changePercent={r.data.analytics.users.changePercent ?? 0} source="ga4" to="/ga4" />
                  <KpiCard label="Engagement rate" formattedValue={`${r.data.analytics.engagementRate.value.toFixed(1)}%`} changePercent={r.data.analytics.engagementRate.changePercent ?? 0} source="ga4" to="/ga4" />
                  <KpiCard label="Key events" formattedValue={formatNumber(r.data.analytics.conversions.value)} changePercent={r.data.analytics.conversions.changePercent ?? 0} source="ga4" to="/ga4" />
                </div>
              </section>
            )}
            {r.data.search && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-fg">Google Search</h2>
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                  <KpiCard label="Clicks" formattedValue={formatNumber(r.data.search.clicks)} changePercent={pct(r.data.search.clicks, r.data.search.previous.clicks)} source="search_console" to="/search-console" />
                  <KpiCard label="Impressions" formattedValue={formatNumber(r.data.search.impressions)} changePercent={pct(r.data.search.impressions, r.data.search.previous.impressions)} source="search_console" to="/search-console" />
                  <KpiCard label="CTR" formattedValue={`${r.data.search.ctr.toFixed(2)}%`} changePercent={pct(r.data.search.ctr, r.data.search.previous.ctr)} source="search_console" to="/search-console" />
                  <KpiCard label="Avg. position" formattedValue={r.data.search.position === null ? '—' : r.data.search.position.toFixed(1)} compareEnabled={false} source="search_console" to="/search-console" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-xl border border-line bg-surface p-4">
                    <h3 className="text-sm font-semibold text-fg">Top search queries</h3>
                    <ul className="mt-2 divide-y divide-line">
                      {r.data.search.topQueries.map((q) => (
                        <li key={q.query} className="py-2 flex justify-between gap-3 text-sm">
                          <span className="truncate text-fg">{q.query}</span>
                          <span className="shrink-0 text-xs text-fg-muted">{formatNumber(q.clicks)} clicks</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="rounded-xl border border-line bg-surface p-4">
                    <h3 className="text-sm font-semibold text-fg">Top pages in search</h3>
                    <ul className="mt-2 divide-y divide-line">
                      {r.data.search.topPages.map((p) => (
                        <li key={p.page} className="py-2 flex justify-between gap-3 text-sm">
                          <Link className="truncate text-accent-text hover:underline" to={pageDetailLink(new URL(p.page ?? '/', 'http://x').pathname)}>{shortUrl(p.page ?? '')}</Link>
                          <span className="shrink-0 text-xs text-fg-muted">{formatNumber(p.clicks)} clicks</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </section>
            )}
            {r.data.insights && (
              <section className="rounded-xl border border-line bg-surface p-4 space-y-2">
                <h2 className="text-sm font-semibold text-fg">Worth a look</h2>
                <ul className="text-sm text-fg space-y-1">
                  <li>
                    <Link to="/search-intelligence" className="text-accent-text hover:underline">{r.data.insights.opportunityCount} search opportunities</Link>
                    {r.data.insights.opportunityCount > 0 && <> could bring about {formatNumber(r.data.insights.estimatedExtraClicks)} more clicks.</>}
                  </li>
                  <li>
                    <Link to="/search-intelligence" className="text-accent-text hover:underline">{r.data.insights.cannibalisedQueryCount} searches</Link> where two of your pages compete.
                  </li>
                </ul>
              </section>
            )}
          </div>
        )}
      </ReportBoundary>
    </div>
  );
};
