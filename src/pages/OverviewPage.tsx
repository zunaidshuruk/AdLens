import React, { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { KpiCard } from '../components/KpiCard';
import { TrendChart } from '../components/TrendChart';
import { DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useAdapterStatus, useDateRange, useMetaAccountInfo, useReport } from '../hooks';
import type { MetaCampaignRow, SearchConsoleQueryRow } from '../types';
import { formatFullDateRange } from '../utils/dateUtils';
import {
  convertCurrencyFromUsd,
  formatAccountCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  getCurrencySymbol,
} from '../utils/formatters';

export const OverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { currency, activeProject } = useAppContext();
  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: activeProject?.domain || DEMO_PROJECT.domain,
  };
  const { dateRange, compareEnabled } = useDateRange();
  const { isMetaAdsLive } = useAdapterStatus();
  const { accountInfo } = useMetaAccountInfo();

  const { data, loading, error, errorCode, refetch } = useReport(async (registry, range) => {
    const [
      ga4Overview,
      gscOverview,
      metaOverview,
      ga4Traffic,
      metaSpend,
      metaCampaigns,
      topQueries,
      aiTraffic,
    ] = await Promise.all([
      registry.ga4.getOverview(range),
      registry.searchConsole.getOverview(range),
      registry.metaAds.getOverview(range),
      registry.ga4.getTrafficOverTime(range),
      registry.metaAds.getSpendOverTime(range),
      registry.metaAds.getCampaigns(range),
      registry.searchConsole.getTopQueries(range),
      registry.ga4.getAiTraffic(range),
    ]);

    return {
      ga4Overview,
      gscOverview,
      metaOverview,
      ga4Traffic,
      metaSpend,
      metaCampaigns,
      topQueries,
      aiTraffic,
    };
  });

  const metaCurrencyCode = isMetaAdsLive
    ? accountInfo?.currency || data?.metaOverview.accountCurrency || 'USD'
    : currency;
  const metaCurrencySymbol = getCurrencySymbol(metaCurrencyCode);

  const formatMetaMoney = useCallback(
    (amount: number): string => {
      if (isMetaAdsLive) {
        return formatAccountCurrency(amount, metaCurrencyCode);
      }
      return formatCurrency(amount, currency);
    },
    [isMetaAdsLive, metaCurrencyCode, currency]
  );

  const combinedTrend = useMemo(() => {
    if (!data) return [];
    const spendByDate = new Map(data.metaSpend.map((s) => [s.date, s]));
    return data.ga4Traffic.map((point) => {
      const meta = spendByDate.get(point.date);
      const rawSpend = meta?.spend ?? 0;
      return {
        date: point.date,
        sessions: point.sessions,
        previousSessions: point.previousSessions,
        spendDisplay: isMetaAdsLive ? rawSpend : convertCurrencyFromUsd(rawSpend, currency),
      };
    });
  }, [data, isMetaAdsLive, currency]);

  const campaignColumns = useMemo<DataTableColumn<MetaCampaignRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'name',
        header: 'Campaign',
        render: (row) => (
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100">{row.name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {row.objective} · {row.status}
            </div>
          </div>
        ),
      },
      {
        key: 'spend',
        header: 'Spend',
        align: 'right',
        render: (row) => formatMetaMoney(row.spend),
        csvFormat: (val) => formatMetaMoney(Number(val)),
      },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (row) => formatNumber(row.clicks),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (row) => formatPercent(row.ctr),
        csvFormat: (val) => formatPercent(Number(val)),
      },
      {
        key: 'leads',
        header: 'Leads',
        align: 'right',
        render: (row) => formatNumber(row.leads),
      },
      {
        key: 'cpl',
        header: 'Cost / Lead',
        align: 'right',
        render: (row) => formatMetaMoney(row.cpl),
        csvFormat: (val) => formatMetaMoney(Number(val)),
      },
    ],
    [formatMetaMoney]
  );

  const queryColumns = useMemo<DataTableColumn<SearchConsoleQueryRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'query',
        header: 'Search Query',
        render: (row) => (
          <span className="font-medium text-slate-900 dark:text-slate-100">{row.query}</span>
        ),
      },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (row) => formatNumber(row.clicks),
      },
      {
        key: 'impressions',
        header: 'Impressions',
        align: 'right',
        render: (row) => formatNumber(row.impressions),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (row) => formatPercent(row.ctr),
        csvFormat: (val) => formatPercent(Number(val)),
      },
      {
        key: 'avgPosition',
        header: 'Avg. Position',
        align: 'right',
        render: (row) => row.avgPosition.toFixed(1),
      },
      {
        key: 'changePercent',
        header: 'Clicks Δ',
        align: 'right',
        render: (row) => (
          <span
            className={
              row.changePercent >= 0
                ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                : 'text-red-600 dark:text-red-400 font-semibold'
            }
          >
            {formatSignedPercent(row.changePercent)}
          </span>
        ),
        csvFormat: (val) => formatSignedPercent(Number(val)),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Executive Overview
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Unified funnel telemetry for {TRACKED_SITE.name} ({TRACKED_SITE.domain}) ·{' '}
            {formatFullDateRange(dateRange.startDate, dateRange.endDate)}
            {compareEnabled &&
              ` vs ${formatFullDateRange(dateRange.compareStartDate, dateRange.compareEndDate)}`}
          </p>
        </div>
      </div>

      {error && (
        <ErrorState
          message={error}
          onRetry={refetch}
          actionLabel={
            errorCode === 'GA4_PERMISSION_DENIED' ||
            errorCode === 'SC_PERMISSION_DENIED' ||
            errorCode === 'GOOGLE_REAUTH_REQUIRED' ||
            errorCode === 'GA4_NOT_SELECTED' ||
            errorCode === 'SC_NOT_SELECTED' ||
            errorCode === 'META_TOKEN_INVALID' ||
            errorCode === 'META_PERMISSION_DENIED'
              ? 'Go to Connections'
              : undefined
          }
          onAction={
            errorCode === 'GA4_PERMISSION_DENIED' ||
            errorCode === 'SC_PERMISSION_DENIED' ||
            errorCode === 'GOOGLE_REAUTH_REQUIRED' ||
            errorCode === 'GA4_NOT_SELECTED' ||
            errorCode === 'SC_NOT_SELECTED' ||
            errorCode === 'META_TOKEN_INVALID' ||
            errorCode === 'META_PERMISSION_DENIED'
              ? () => navigate('/connections')
              : undefined
          }
        />
      )}

      {/* Cross-Channel KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Sessions"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.ga4Overview.sessions.value ?? 0)}
          previousFormattedValue={formatNumber(data?.ga4Overview.sessions.previousValue ?? 0)}
          changePercent={data?.ga4Overview.sessions.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Goal Conversions"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.ga4Overview.conversions.value ?? 0)}
          previousFormattedValue={formatNumber(data?.ga4Overview.conversions.previousValue ?? 0)}
          changePercent={data?.ga4Overview.conversions.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Organic Search Clicks"
          source="search_console"
          loading={loading}
          formattedValue={formatNumber(data?.gscOverview.clicks.value ?? 0)}
          previousFormattedValue={formatNumber(data?.gscOverview.clicks.previousValue ?? 0)}
          changePercent={data?.gscOverview.clicks.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Search Impressions"
          source="search_console"
          loading={loading}
          formattedValue={formatNumber(data?.gscOverview.impressions.value ?? 0)}
          previousFormattedValue={formatNumber(data?.gscOverview.impressions.previousValue ?? 0)}
          changePercent={data?.gscOverview.impressions.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Meta Ad Spend"
          source="meta_ads"
          loading={loading}
          formattedValue={formatMetaMoney(data?.metaOverview.spend.value ?? 0)}
          previousFormattedValue={formatMetaMoney(data?.metaOverview.spend.previousValue ?? 0)}
          changePercent={data?.metaOverview.spend.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
        <KpiCard
          label="Meta Qualified Leads"
          source="meta_ads"
          loading={loading}
          formattedValue={formatNumber(data?.metaOverview.leads.value ?? 0)}
          previousFormattedValue={formatNumber(data?.metaOverview.leads.previousValue ?? 0)}
          changePercent={data?.metaOverview.leads.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Cost per Lead (CPL)"
          source="meta_ads"
          loading={loading}
          formattedValue={formatMetaMoney(data?.metaOverview.cpl.value ?? 0)}
          previousFormattedValue={formatMetaMoney(data?.metaOverview.cpl.previousValue ?? 0)}
          changePercent={data?.metaOverview.cpl.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
        <KpiCard
          label="Avg. Search Position"
          source="search_console"
          loading={loading}
          formattedValue={(data?.gscOverview.avgPosition.value ?? 0).toFixed(1)}
          previousFormattedValue={(data?.gscOverview.avgPosition.previousValue ?? 0).toFixed(1)}
          changePercent={data?.gscOverview.avgPosition.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
        <KpiCard
          label="AI assistant sessions"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.aiTraffic.aiSessions ?? 0)}
          previousFormattedValue={formatNumber(data?.aiTraffic.previousAiSessions ?? 0)}
          changePercent={data?.aiTraffic.aiSessionsChangePercent ?? 0}
          compareEnabled={compareEnabled}
          subtitle={`${formatPercent(data?.aiTraffic.aiSharePercent ?? 0, 1)} share`}
          to="/ai-traffic"
        />
      </div>

      {/* Sessions vs Spend Dual-Axis Trend Chart */}
      <TrendChart
        title="Sessions vs. Paid Social Spend"
        subtitle={`Daily GA4 sessions paired with Meta Ads spend (${metaCurrencyCode}) across ${dateRange.dayCount} days`}
        data={combinedTrend}
        xKey="date"
        loading={loading}
        dualAxis
        leftAxisFormatter={(v) => formatNumber(v)}
        rightAxisFormatter={(v) => `${metaCurrencySymbol}${formatNumber(v)}`}
        series={[
          {
            key: 'sessions',
            label: 'GA4 Sessions',
            color: '#2563eb',
            yAxisId: 'left',
            type: 'area',
            formatter: (v) => formatNumber(v),
          },
          ...(compareEnabled
            ? [
                {
                  key: 'previousSessions',
                  label: 'Prev. Period Sessions',
                  color: '#94a3b8',
                  yAxisId: 'left' as const,
                  type: 'line' as const,
                  dashed: true,
                  formatter: (v: number) => formatNumber(v),
                },
              ]
            : []),
          {
            key: 'spendDisplay',
            label: `Meta Spend (${metaCurrencyCode})`,
            color: '#0d9488',
            yAxisId: 'right',
            type: 'line',
            formatter: (v) => `${metaCurrencySymbol}${formatNumber(v)}`,
          },
        ]}
      />

      {/* Side-by-side or stacked tables: Top Campaigns & Top Search Queries */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DataTable
          title="Top Paid Campaigns"
          subtitle="Active & paused Meta campaigns sorted by spend"
          tableName="overview_top_campaigns"
          columns={campaignColumns}
          data={(data?.metaCampaigns ?? []) as (MetaCampaignRow & Record<string, unknown>)[]}
          rowKey={(r) => r.id}
          loading={loading}
          pageSize={5}
          defaultSortKey="spend"
          searchPlaceholder="Filter campaigns..."
        />

        <DataTable
          title="Top Organic Search Queries"
          subtitle={`Google Search Console queries driving clicks to ${TRACKED_SITE.domain}`}
          tableName="overview_top_queries"
          columns={queryColumns}
          data={(data?.topQueries ?? []) as (SearchConsoleQueryRow & Record<string, unknown>)[]}
          rowKey={(r) => r.query}
          loading={loading}
          pageSize={5}
          defaultSortKey="clicks"
          searchPlaceholder="Filter queries..."
        />
      </div>
    </div>
  );
};

