import React from 'react';
import { EmptyState } from '../components/EmptyState';
import { ReportBoundary, RulesBox } from '../components/ReportBoundary';
import { SourceBadge } from '../components/SourceBadge';
import { useAppContext } from '../context/AppContext';
import { useRunReport } from '../hooks';
import type { CampaignJoinRow, CrossChannelReport } from '../types/intelligence.js';
import { formatAccountCurrency, formatNumber } from '../utils/formatters';

const FLAG_TEXT: Record<CampaignJoinRow['flags'][number], string> = {
  no_utm_traffic: 'Spend but no tracked visits. Check the link tags (UTM).',
  low_landing_rate: 'Few clicks became visits. Check page speed and the link.',
  source_not_meta: 'Visits are tagged with a source other than Meta.',
  likely_match_only: 'Matched by similar name only. Check the tag.',
};
const MATCH_TEXT: Record<CampaignJoinRow['matchType'], string> = { id: 'Campaign ID', exact: 'Same name', likely: 'Similar name', none: 'No match' };
const th = 'px-3 py-2 text-xs font-semibold text-fg-muted';

export const CrossChannelPage: React.FC = () => {
  const { activeProject } = useAppContext();
  const r = useRunReport<CrossChannelReport>('site.crossChannel');
  const money = (v: number | null) => (v === null ? '—' : formatAccountCurrency(v, r.data?.currency ?? activeProject?.currency ?? 'USD'));
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Ads vs website visits</h1>
          <SourceBadge source="meta_ads" showMode />
        </div>
        <p className="text-xs sm:text-sm text-fg-muted">What each Meta campaign cost, and what it actually brought to your website, matched through the link tags (UTM).</p>
      </div>
      <ReportBoundary {...r} onRetry={r.refetch}>
        {r.data &&
          (r.data.rows.length === 0 ? (
            <EmptyState title="No campaigns with spend" description="There are no Meta campaigns with results in this period." />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                {[
                  ['Spend', money(r.data.totals.spend)],
                  ['Tracked sessions', formatNumber(r.data.totals.sessions)],
                  ['Cost per engaged visit', money(r.data.totals.costPerEngagedSession)],
                  ['Spend with no tracked visits', money(r.data.totals.spendWithoutTracking)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-line bg-surface p-4">
                    <p className="text-xs text-fg-muted">{label}</p>
                    <p className="mt-1 text-lg font-semibold text-fg">{value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="min-w-full divide-y divide-line">
                  <thead className="bg-fill-1">
                    <tr>
                      <th className={`${th} text-left`}>Campaign</th>
                      <th className={`${th} text-right`}>Spend</th>
                      <th className={`${th} text-right`}>Link clicks</th>
                      <th className={`${th} text-right`}>Sessions</th>
                      <th className={`${th} text-right`}>Landing rate</th>
                      <th className={`${th} text-right`}>Cost / engaged visit</th>
                      <th className={`${th} text-right`}>Cost / key event</th>
                      <th className={`${th} text-left`}>Match</th>
                      <th className={`${th} text-left`}>Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.data.rows.map((c) => (
                      <tr key={c.metaCampaignId}>
                        <td className="px-3 py-2 text-sm font-medium text-fg max-w-xs truncate" title={c.metaCampaignName}>{c.metaCampaignName}</td>
                        <td className="px-3 py-2 text-sm text-right text-fg">{money(c.spend)}</td>
                        <td className="px-3 py-2 text-sm text-right text-fg">{formatNumber(c.clicks)}</td>
                        <td className="px-3 py-2 text-sm text-right text-fg">{formatNumber(c.sessions)}</td>
                        <td className="px-3 py-2 text-sm text-right text-fg">{c.landingRate === null ? '—' : `${c.landingRate.toFixed(0)}%`}</td>
                        <td className="px-3 py-2 text-sm text-right text-fg">{money(c.costPerEngagedSession)}</td>
                        <td className="px-3 py-2 text-sm text-right text-fg">{money(c.costPerKeyEvent)}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{MATCH_TEXT[c.matchType]}</td>
                        <td className="px-3 py-2 text-xs text-warning">{c.flags.map((f) => <span key={f} className="block">{FLAG_TEXT[f]}</span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.data.unmatchedGa4MetaCampaigns.length > 0 && (
                <section className="rounded-xl border border-warning-line bg-warning-soft p-4">
                  <h2 className="text-sm font-semibold text-fg">Visits tagged as Meta that match no campaign</h2>
                  <p className="text-xs text-fg-muted mt-1">These usually mean a renamed campaign or a typo in the link tag.</p>
                  <ul className="mt-2 text-sm text-fg space-y-1">
                    {r.data.unmatchedGa4MetaCampaigns.map((u) => (
                      <li key={u.campaign}>{u.campaign} <span className="text-xs text-fg-muted">· {formatNumber(u.sessions)} sessions</span></li>
                    ))}
                  </ul>
                </section>
              )}
              <RulesBox rules={r.data.rules} />
            </div>
          ))}
      </ReportBoundary>
    </div>
  );
};
