import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { Notes, ReportBoundary } from '../components/ReportBoundary';
import { useRunReport } from '../hooks';
import type { PageFlag, PagesReport } from '../types/intelligence.js';
import { pagesToCsv } from '../utils/pagesCsv.js';
import { formatNumber } from '../utils/formatters';
import { pageDetailLink } from '../utils/intelligenceFormat.js';

const FLAG_TEXT: Record<PageFlag, string> = {
  search_only: 'In search only',
  analytics_only: 'Not in search',
  seen_not_clicked: 'Seen, rarely clicked',
};
const FLAG_HELP: Record<PageFlag, string> = {
  search_only: 'Appears in Google Search but has no recorded visits in analytics',
  analytics_only: 'Gets visits but does not appear in Google Search results',
  seen_not_clicked: 'Shown often in Google Search but rarely clicked',
};

type SortKey = 'views' | 'clicks' | 'impressions' | 'keyEvents';
const th = 'px-3 py-2 text-xs font-semibold text-fg-muted';

export const PagesPage: React.FC = () => {
  const r = useRunReport<PagesReport>('site.pages');
  const [q, setQ] = useState('');
  const [flag, setFlag] = useState<PageFlag | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('views');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (r.data?.rows ?? [])
      .filter((p) => (flag === 'all' ? true : p.flags.includes(flag)))
      .filter((p) => !needle || p.path.toLowerCase().includes(needle) || (p.title ?? '').toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
  }, [r.data, q, flag, sort]);

  const download = () => {
    const csv = pagesToCsv(rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'adlens_pages.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Pages</h1>
        <p className="text-xs sm:text-sm text-fg-muted">Every page with its visits from Google Analytics and its search results from Search Console, side by side. Click a page for the full picture.</p>
      </div>
      <ReportBoundary {...r} onRetry={r.refetch}>
        {r.data && (
          <div className="space-y-4">
            <Notes notes={r.data.notes} />
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Search pages" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by page or title" className="w-full sm:w-64 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg" />
              <select aria-label="Filter pages" value={flag} onChange={(e) => setFlag(e.target.value as PageFlag | 'all')} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg">
                <option value="all">All pages</option>
                {(Object.keys(FLAG_TEXT) as PageFlag[]).map((f) => (
                  <option key={f} value={f}>{FLAG_HELP[f]}</option>
                ))}
              </select>
              <select aria-label="Sort pages" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg">
                <option value="views">Most visited</option>
                <option value="clicks">Most search clicks</option>
                <option value="impressions">Most search impressions</option>
                <option value="keyEvents">Most key events</option>
              </select>
              <button type="button" onClick={download} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-fg hover:bg-fill-1">
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
            {rows.length === 0 ? (
              <EmptyState title="No pages match" description="Try clearing the filter or choosing a longer date range." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="min-w-full divide-y divide-line">
                  <thead className="bg-fill-1">
                    <tr>
                      <th className={`${th} text-left`}>Page</th>
                      <th className={`${th} text-right`}>Views</th>
                      <th className={`${th} text-right`}>Users</th>
                      <th className={`${th} text-right`}>Key events</th>
                      <th className={`${th} text-right`}>Search clicks</th>
                      <th className={`${th} text-right`}>Impressions</th>
                      <th className={`${th} text-right`}>CTR</th>
                      <th className={`${th} text-right`}>Position</th>
                      <th className={`${th} text-left`}>Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.slice(0, 200).map((p) => (
                      <tr key={p.path} className="hover:bg-fill-1">
                        <td className="px-3 py-2 text-sm max-w-xs">
                          <Link to={pageDetailLink(p.path)} className="block truncate font-medium text-accent-text hover:underline" title={p.path}>{p.path}</Link>
                          {p.title && <span className="block truncate text-xs text-fg-muted">{p.title}</span>}
                        </td>
                        {[p.views, p.users, p.keyEvents, p.clicks, p.impressions].map((v, i) => (
                          <td key={i} className="px-3 py-2 text-sm text-right text-fg">{v === null ? <span className="text-fg-subtle">—</span> : formatNumber(v)}</td>
                        ))}
                        <td className="px-3 py-2 text-sm text-right text-fg">{p.ctr === null ? <span className="text-fg-subtle">—</span> : `${p.ctr.toFixed(2)}%`}</td>
                        <td className="px-3 py-2 text-sm text-right text-fg">{p.position === null ? <span className="text-fg-subtle">—</span> : p.position.toFixed(1)}</td>
                        <td className="px-3 py-2 text-xs text-warning">{p.flags.map((f) => <span key={f} title={FLAG_HELP[f]} className="mr-2 whitespace-nowrap">{FLAG_TEXT[f]}</span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </ReportBoundary>
    </div>
  );
};
