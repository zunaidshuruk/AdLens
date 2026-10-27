import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { KpiCard } from '../components/KpiCard';
import { Notes, ReportBoundary } from '../components/ReportBoundary';
import { TrendChart } from '../components/TrendChart';
import { useRunReport } from '../hooks';
import type { PageDetailReport } from '../types/intelligence.js';
import { formatDurationSeconds, formatNumber } from '../utils/formatters';
import { readPathParam } from '../utils/intelligenceFormat.js';

const th = 'px-3 py-2 text-xs font-semibold text-fg-muted';

export const PageDetailPage: React.FC = () => {
  const [params] = useSearchParams();
  const path = readPathParam(params.get('path'));
  const r = useRunReport<PageDetailReport>('site.pageDetail', path ? { path } : undefined, Boolean(path));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link to="/pages" className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline">
          <ArrowLeft className="w-3 h-3" /> All pages
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg break-all">{path ?? 'Page detail'}</h1>
        <p className="text-xs sm:text-sm text-fg-muted">Visits, where they come from, and the searches that lead here.</p>
      </div>
      {!path ? (
        <EmptyState title="No page chosen" description="Open a page from the Pages list to see its details." />
      ) : (
        <ReportBoundary {...r} onRetry={r.refetch}>
          {r.data && (
            <div className="space-y-6">
              <Notes notes={r.data.notes} />
              {r.data.analytics && (
                <>
                  <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                    <KpiCard label="Views" formattedValue={formatNumber(r.data.analytics.views)} compareEnabled={false} source="ga4" />
                    <KpiCard label="Users" formattedValue={formatNumber(r.data.analytics.users)} compareEnabled={false} source="ga4" />
                    <KpiCard label="Avg. engagement time" formattedValue={formatDurationSeconds(r.data.analytics.avgEngagementSeconds)} compareEnabled={false} source="ga4" />
                    <KpiCard label="Key events" formattedValue={formatNumber(r.data.analytics.keyEvents)} compareEnabled={false} source="ga4" />
                  </div>
                  <TrendChart
                    title="Daily views"
                    data={r.data.analytics.daily as unknown as Record<string, unknown>[]}
                    xKey="date"
                    series={[{ key: 'views', label: 'Views', color: 'var(--chart-1)' }, { key: 'users', label: 'Users', color: 'var(--chart-2)', type: 'line' }]}
                    height={240}
                  />
                  <section className="rounded-xl border border-line bg-surface p-4">
                    <h2 className="text-sm font-semibold text-fg">How people reach this page</h2>
                    {r.data.analytics.sources.length === 0 ? (
                      <p className="mt-2 text-xs text-fg-muted">No visits in this period.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-line">
                        {r.data.analytics.sources.map((s) => (
                          <li key={s.sourceMedium} className="py-2 flex justify-between text-sm">
                            <span className="text-fg">{s.sourceMedium}</span>
                            <span className="text-xs text-fg-muted">{formatNumber(s.sessions)} sessions · {formatNumber(s.keyEvents)} key events</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}
              {r.data.search && (
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold text-fg">In Google Search</h2>
                  <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                    <KpiCard label="Clicks" formattedValue={formatNumber(r.data.search.clicks)} compareEnabled={false} source="search_console" />
                    <KpiCard label="Impressions" formattedValue={formatNumber(r.data.search.impressions)} compareEnabled={false} source="search_console" />
                    <KpiCard label="CTR" formattedValue={`${r.data.search.ctr.toFixed(2)}%`} compareEnabled={false} source="search_console" />
                    <KpiCard label="Avg. position" formattedValue={r.data.search.position === null ? '—' : r.data.search.position.toFixed(1)} compareEnabled={false} source="search_console" />
                  </div>
                  {r.data.search.queries.length === 0 ? (
                    <p className="text-xs text-fg-muted">No search queries brought people here in this period.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                      <table className="min-w-full divide-y divide-line">
                        <thead className="bg-fill-1">
                          <tr>
                            <th className={`${th} text-left`}>Search query</th>
                            <th className={`${th} text-right`}>Clicks</th>
                            <th className={`${th} text-right`}>Impressions</th>
                            <th className={`${th} text-right`}>Position</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {r.data.search.queries.map((q) => (
                            <tr key={q.query}>
                              <td className="px-3 py-2 text-sm font-medium text-fg">{q.query}</td>
                              <td className="px-3 py-2 text-sm text-right text-fg">{formatNumber(q.clicks)}</td>
                              <td className="px-3 py-2 text-sm text-right text-fg">{formatNumber(q.impressions)}</td>
                              <td className="px-3 py-2 text-sm text-right text-fg">{q.position.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </ReportBoundary>
      )}
    </div>
  );
};
