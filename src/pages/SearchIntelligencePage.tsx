import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Notes, ReportBoundary, RulesBox } from '../components/ReportBoundary';
import { SourceBadge } from '../components/SourceBadge';
import { useRunReport } from '../hooks';
import type {
  CannibalisationReport,
  HostBreakdownReport,
  OpportunitiesReport,
  SitemapsReport,
  TopicsReport,
  TrendItem,
  TrendResult,
  TrendsReport,
} from '../types/intelligence.js';
import { formatNumber } from '../utils/formatters';
import { pageDetailLink, shortUrl, trendPercentLabel } from '../utils/intelligenceFormat.js';

type Tab = 'trends' | 'opportunities' | 'cannibalisation' | 'topics' | 'hosts';
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'trends', label: 'Trending', hint: 'What is rising, falling, new or lost in search' },
  { id: 'opportunities', label: 'Opportunities', hint: 'Searches where a better title could win more clicks' },
  { id: 'cannibalisation', label: 'Cannibalisation', hint: 'Searches where your own pages compete' },
  { id: 'topics', label: 'Topics', hint: 'Your searches grouped by subject' },
  { id: 'hosts', label: 'Hosts & sitemaps', hint: 'Domains and subdomains, with their sitemaps' },
];

const th = 'px-3 py-2 text-left text-xs font-semibold text-fg-muted';
const td = 'px-3 py-2 text-sm text-fg';

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="min-w-full divide-y divide-line">{children}</table>
    </div>
  );
}

function TrendList({ title, items, kind, isPage }: { title: string; items: TrendItem[]; kind: 'good' | 'bad' | 'neutral'; isPage: boolean }) {
  const colour = kind === 'good' ? 'text-success' : kind === 'bad' ? 'text-danger' : 'text-accent-text';
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-fg-muted">Nothing here for this period.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.slice(0, 10).map((i) => (
            <li key={i.key} className="py-2 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-fg" title={i.key}>
                {isPage ? <Link className="hover:underline" to={pageDetailLink(new URL(i.key, 'http://x').pathname)}>{shortUrl(i.key)}</Link> : i.key}
              </span>
              <span className="shrink-0 text-xs text-fg-muted">
                {formatNumber(i.previous)} → {formatNumber(i.current)} <span className={`ml-2 font-semibold ${colour}`}>{trendPercentLabel(i)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TrendsTab() {
  const r = useRunReport<TrendsReport>('searchConsole.trends');
  const [what, setWhat] = useState<'queries' | 'pages'>('queries');
  return (
    <ReportBoundary {...r} onRetry={r.refetch}>
      {r.data && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div role="tablist" className="inline-flex rounded-lg border border-line overflow-hidden">
              {(['queries', 'pages'] as const).map((k) => (
                <button key={k} role="tab" aria-selected={what === k} onClick={() => setWhat(k)} className={`px-3 py-1.5 text-xs font-medium ${what === k ? 'bg-accent text-on-accent' : 'bg-surface text-fg-muted hover:bg-fill-1'}`}>
                  {k === 'queries' ? 'Search queries' : 'Pages'}
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-muted">
              Clicks in {r.data.period.startDate} to {r.data.period.endDate} compared with {r.data.comparedWith.startDate} to {r.data.comparedWith.endDate}.
            </p>
          </div>
          {(() => {
            const t: TrendResult = r.data[what];
            const isPage = what === 'pages';
            return (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <TrendList title="Rising" items={t.rising} kind="good" isPage={isPage} />
                  <TrendList title="Falling" items={t.falling} kind="bad" isPage={isPage} />
                  <TrendList title="New" items={t.new} kind="neutral" isPage={isPage} />
                  <TrendList title="Lost" items={t.lost} kind="bad" isPage={isPage} />
                </div>
                <RulesBox rules={t.rules} />
              </>
            );
          })()}
        </div>
      )}
    </ReportBoundary>
  );
}

function OpportunitiesTab() {
  const r = useRunReport<OpportunitiesReport>('searchConsole.opportunities');
  return (
    <ReportBoundary {...r} onRetry={r.refetch}>
      {r.data &&
        (r.data.opportunities.length === 0 ? (
          <EmptyState title="No clear opportunities" description="No searches matched the rules for this period. Try a longer date range." />
        ) : (
          <div className="space-y-4">
            <TableShell>
              <thead className="bg-fill-1">
                <tr>
                  <th className={th}>Search query</th>
                  <th className={`${th} text-right`}>Position</th>
                  <th className={`${th} text-right`}>Impressions</th>
                  <th className={`${th} text-right`}>CTR</th>
                  <th className={`${th} text-right`}>Typical CTR</th>
                  <th className={`${th} text-right`}>Possible extra clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.data.opportunities.map((o) => (
                  <tr key={o.query}>
                    <td className={`${td} font-medium`}>{o.query}</td>
                    <td className={`${td} text-right`}>{o.position.toFixed(1)}</td>
                    <td className={`${td} text-right`}>{formatNumber(o.impressions)}</td>
                    <td className={`${td} text-right`}>{o.ctr.toFixed(2)}%</td>
                    <td className={`${td} text-right`}>{o.typicalCtr.toFixed(1)}%</td>
                    <td className={`${td} text-right font-semibold text-success`}>+{formatNumber(o.estimatedExtraClicks)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <RulesBox rules={r.data.rules} />
          </div>
        ))}
    </ReportBoundary>
  );
}

function CannibalisationTab() {
  const r = useRunReport<CannibalisationReport>('searchConsole.cannibalisation');
  return (
    <ReportBoundary {...r} onRetry={r.refetch}>
      {r.data &&
        (r.data.queries.length === 0 ? (
          <EmptyState title="No competing pages found" description="No search query is split between two of your pages in this period." />
        ) : (
          <div className="space-y-4">
            {r.data.queries.map((q) => (
              <section key={q.query} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-fg">{q.query}</h3>
                  <span className="text-xs text-fg-muted">{formatNumber(q.totalImpressions)} impressions · {formatNumber(q.totalClicks)} clicks</span>
                </div>
                <ul className="mt-2 divide-y divide-line">
                  {q.pages.map((p) => (
                    <li key={p.page} className="py-2 flex justify-between gap-3 text-sm">
                      <Link className="min-w-0 truncate text-accent-text hover:underline" to={pageDetailLink(new URL(p.page, 'http://x').pathname)} title={p.page}>{shortUrl(p.page, 70)}</Link>
                      <span className="shrink-0 text-xs text-fg-muted">{p.sharePercent}% of impressions · position {p.position}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <RulesBox rules={r.data.rules} />
          </div>
        ))}
    </ReportBoundary>
  );
}

function TopicsTab() {
  const r = useRunReport<TopicsReport>('searchConsole.topics');
  return (
    <ReportBoundary {...r} onRetry={r.refetch}>
      {r.data &&
        (r.data.topics.length === 0 ? (
          <EmptyState title="No topics yet" description="There were not enough search queries in this period." />
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">Your brand name ({r.data.ignoredBrandWords.slice(0, 4).join(', ') || 'none set'}) is ignored when grouping.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {r.data.topics.map((t) => (
                <section key={t.topic} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-fg capitalize">{t.topic}</h3>
                    <span className="text-xs text-fg-muted">{formatNumber(t.clicks)} clicks · {formatNumber(t.impressions)} impressions</span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{t.queries.join(' · ')}</p>
                </section>
              ))}
            </div>
          </div>
        ))}
    </ReportBoundary>
  );
}

const FLAG_TEXT: Record<string, string> = {
  traffic_without_sitemap: 'Gets traffic but has no submitted sitemap',
  sitemap_without_traffic: 'Has a sitemap but no traffic in this period',
  sitemap_errors: 'Sitemap has errors in Search Console',
};

function HostsTab() {
  const hosts = useRunReport<HostBreakdownReport>('site.hostBreakdown');
  const maps = useRunReport<SitemapsReport>('searchConsole.sitemaps');
  return (
    <div className="space-y-6">
      <ReportBoundary {...hosts} onRetry={hosts.refetch}>
        {hosts.data && (
          <div className="space-y-3">
            <Notes notes={hosts.data.notes} />
            <TableShell>
              <thead className="bg-fill-1">
                <tr>
                  <th className={th}>Host</th>
                  <th className={`${th} text-right`}>Sessions</th>
                  <th className={`${th} text-right`}>Key events</th>
                  <th className={`${th} text-right`}>Search clicks</th>
                  <th className={`${th} text-right`}>Impressions</th>
                  <th className={th}>Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {hosts.data.hosts.map((h) => (
                  <tr key={h.host}>
                    <td className={`${td} font-medium`}>{h.host}</td>
                    <td className={`${td} text-right`}>{formatNumber(h.sessions)}</td>
                    <td className={`${td} text-right`}>{formatNumber(h.keyEvents)}</td>
                    <td className={`${td} text-right`}>{formatNumber(h.clicks)}</td>
                    <td className={`${td} text-right`}>{formatNumber(h.impressions)}</td>
                    <td className={`${td} text-xs text-warning`}>{h.flags.map((f) => FLAG_TEXT[f]).join('; ') || <span className="text-fg-muted">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            {hosts.data.excludedHosts.length > 0 && <p className="text-xs text-fg-muted">Left out as test or local hosts: {hosts.data.excludedHosts.join(', ')}</p>}
          </div>
        )}
      </ReportBoundary>
      <section>
        <h3 className="text-sm font-semibold text-fg mb-2">Submitted sitemaps</h3>
        <ReportBoundary {...maps} onRetry={maps.refetch}>
          {maps.data &&
            (maps.data.sitemaps.length === 0 ? (
              <EmptyState title="No sitemaps submitted" description="Submit a sitemap in Google Search Console so Google finds all your pages." />
            ) : (
              <TableShell>
                <thead className="bg-fill-1">
                  <tr>
                    <th className={th}>Sitemap</th>
                    <th className={`${th} text-right`}>URLs</th>
                    <th className={`${th} text-right`}>Warnings</th>
                    <th className={`${th} text-right`}>Errors</th>
                    <th className={th}>Last submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {maps.data.sitemaps.map((s) => (
                    <tr key={s.path}>
                      <td className={`${td} break-all`}>{s.path}</td>
                      <td className={`${td} text-right`}>{formatNumber(s.submittedUrls ?? 0)}</td>
                      <td className={`${td} text-right`}>{s.warnings ?? 0}</td>
                      <td className={`${td} text-right ${(s.errors ?? 0) > 0 ? 'text-danger font-semibold' : ''}`}>{s.errors ?? 0}</td>
                      <td className={td}>{s.lastSubmitted ? s.lastSubmitted.slice(0, 10) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            ))}
        </ReportBoundary>
      </section>
    </div>
  );
}

export const SearchIntelligencePage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('trends');
  const active = TABS.find((t) => t.id === tab)!;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Search intelligence</h1>
          <SourceBadge source="search_console" showMode />
        </div>
        <p className="text-xs sm:text-sm text-fg-muted">What is changing in Google Search, and where the easy wins are. Every list shows the rules behind it.</p>
      </div>
      <div role="tablist" aria-label="Search intelligence sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === t.id ? 'border-accent text-fg font-semibold' : 'border-transparent text-fg-muted hover:text-fg'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-fg-muted">{active.hint}</p>
      {tab === 'trends' && <TrendsTab />}
      {tab === 'opportunities' && <OpportunitiesTab />}
      {tab === 'cannibalisation' && <CannibalisationTab />}
      {tab === 'topics' && <TopicsTab />}
      {tab === 'hosts' && <HostsTab />}
    </div>
  );
};
