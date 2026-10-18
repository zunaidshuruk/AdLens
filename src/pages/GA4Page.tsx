import React, { useMemo } from 'react';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { KpiCard } from '../components/KpiCard';
import { TrendChart } from '../components/TrendChart';
import { TRACKED_SITE } from '../config/app';
import { useDateRange, useReport } from '../hooks';
import type {
  GA4CampaignRow,
  GA4ChannelRow,
  GA4ConversionEventRow,
  GA4CountryRow,
  GA4PageRow,
} from '../types';
import {
  formatDurationSeconds,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from '../utils/formatters';

export const GA4Page: React.FC = () => {
  const { compareEnabled } = useDateRange();

  const { data, loading, error, refetch } = useReport(async (registry, range) => {
    const [overview, traffic, acquisition, campaigns, topPages, conversions] = await Promise.all([
      registry.ga4.getOverview(range),
      registry.ga4.getTrafficOverTime(range),
      registry.ga4.getAcquisition(range),
      registry.ga4.getCampaigns(range),
      registry.ga4.getTopPages(range),
      registry.ga4.getConversions(range),
    ]);

    return {
      overview,
      traffic,
      acquisition,
      campaigns,
      topPages,
      conversions,
    };
  });

  const channelColumns = useMemo<DataTableColumn<GA4ChannelRow & Record<string, unknown>>[]>(
    () => [
      { key: 'channel', header: 'Default Channel Group' },
      {
        key: 'sessions',
        header: 'Sessions',
        align: 'right',
        render: (r) => formatNumber(r.sessions),
      },
      {
        key: 'users',
        header: 'Users',
        align: 'right',
        render: (r) => formatNumber(r.users),
      },
      {
        key: 'engagementRate',
        header: 'Engagement Rate',
        align: 'right',
        render: (r) => formatPercent(r.engagementRate),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'conversions',
        header: 'Conversions',
        align: 'right',
        render: (r) => formatNumber(r.conversions),
      },
      {
        key: 'sharePercent',
        header: 'Traffic Share',
        align: 'right',
        render: (r) => formatPercent(r.sharePercent),
        csvFormat: (v) => formatPercent(Number(v)),
      },
    ],
    []
  );

  const countryColumns = useMemo<DataTableColumn<GA4CountryRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'country',
        header: 'Country',
        render: (r) => (
          <span>
            {r.country}{' '}
            <span className="text-slate-400 font-mono text-[11px]">({r.code})</span>
          </span>
        ),
      },
      {
        key: 'sessions',
        header: 'Sessions',
        align: 'right',
        render: (r) => formatNumber(r.sessions),
      },
      {
        key: 'users',
        header: 'Users',
        align: 'right',
        render: (r) => formatNumber(r.users),
      },
      {
        key: 'sharePercent',
        header: 'Share',
        align: 'right',
        render: (r) => formatPercent(r.sharePercent),
        csvFormat: (v) => formatPercent(Number(v)),
      },
    ],
    []
  );

  const campaignColumns = useMemo<DataTableColumn<GA4CampaignRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'campaign',
        header: 'UTM Campaign Name',
        render: (r) => (
          <span className="font-medium text-slate-900 dark:text-slate-100">{r.campaign}</span>
        ),
      },
      {
        key: 'sourceMedium',
        header: 'Source / Medium',
        render: (r) => <span className="font-mono text-slate-600 dark:text-slate-400">{r.sourceMedium}</span>,
      },
      {
        key: 'sessions',
        header: 'Sessions',
        align: 'right',
        render: (r) => formatNumber(r.sessions),
      },
      {
        key: 'users',
        header: 'Users',
        align: 'right',
        render: (r) => formatNumber(r.users),
      },
      {
        key: 'engagementRate',
        header: 'Engagement Rate',
        align: 'right',
        render: (r) => formatPercent(r.engagementRate),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'conversions',
        header: 'Conversions',
        align: 'right',
        render: (r) => formatNumber(r.conversions),
      },
      {
        key: 'conversionRate',
        header: 'Conv. Rate',
        align: 'right',
        render: (r) => formatPercent(r.conversionRate),
        csvFormat: (v) => formatPercent(Number(v)),
      },
    ],
    []
  );

  const pageColumns = useMemo<DataTableColumn<GA4PageRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'pagePath',
        header: 'Page Path',
        render: (r) => (
          <div>
            <div className="font-mono font-medium text-slate-900 dark:text-slate-100">
              {r.pagePath}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">
              {r.pageTitle}
            </div>
          </div>
        ),
      },
      {
        key: 'views',
        header: 'Views',
        align: 'right',
        render: (r) => formatNumber(r.views),
      },
      {
        key: 'users',
        header: 'Users',
        align: 'right',
        render: (r) => formatNumber(r.users),
      },
      {
        key: 'avgEngagementTimeSec',
        header: 'Avg. Engagement Time',
        align: 'right',
        render: (r) => formatDurationSeconds(r.avgEngagementTimeSec),
        csvFormat: (v) => formatDurationSeconds(Number(v)),
      },
      {
        key: 'bounceRate',
        header: 'Bounce Rate',
        align: 'right',
        render: (r) => formatPercent(r.bounceRate),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'conversions',
        header: 'Conversions',
        align: 'right',
        render: (r) => formatNumber(r.conversions),
      },
    ],
    []
  );

  const conversionColumns = useMemo<
    DataTableColumn<GA4ConversionEventRow & Record<string, unknown>>[]
  >(
    () => [
      {
        key: 'eventName',
        header: 'Conversion Event',
        render: (r) => (
          <div>
            <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
              {r.eventName}
            </span>
            <span aria-hidden="true" className="mx-1.5 text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span className="text-slate-700 dark:text-slate-300">{r.label}</span>
          </div>
        ),
      },
      {
        key: 'count',
        header: 'Event Count',
        align: 'right',
        render: (r) => formatNumber(r.count),
      },
      {
        key: 'users',
        header: 'Converting Users',
        align: 'right',
        render: (r) => formatNumber(r.users),
      },
      {
        key: 'conversionRate',
        header: 'Session Conv. Rate',
        align: 'right',
        render: (r) => formatPercent(r.conversionRate, 2),
        csvFormat: (v) => formatPercent(Number(v), 2),
      },
      {
        key: 'changePercent',
        header: 'Period Δ',
        align: 'right',
        render: (r) => (
          <span
            className={
              r.changePercent >= 0
                ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                : 'text-red-600 dark:text-red-400 font-semibold'
            }
          >
            {formatSignedPercent(r.changePercent)}
          </span>
        ),
        csvFormat: (v) => formatSignedPercent(Number(v)),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Google Analytics 4
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Session engagement, acquisition channels, UTM attribution, and key conversion events on{' '}
          {TRACKED_SITE.domain}
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={refetch} />}

      {/* 6 GA4 KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label="Sessions"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.overview.sessions.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.sessions.previousValue ?? 0)}
          changePercent={data?.overview.sessions.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Total Users"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.overview.users.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.users.previousValue ?? 0)}
          changePercent={data?.overview.users.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Engaged Sessions"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.overview.engagedSessions.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.engagedSessions.previousValue ?? 0)}
          changePercent={data?.overview.engagedSessions.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Engagement Rate"
          source="ga4"
          loading={loading}
          formattedValue={formatPercent(data?.overview.engagementRate.value ?? 0)}
          previousFormattedValue={formatPercent(data?.overview.engagementRate.previousValue ?? 0)}
          changePercent={data?.overview.engagementRate.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Avg. Engagement Time"
          source="ga4"
          loading={loading}
          formattedValue={formatDurationSeconds(data?.overview.avgEngagementTimeSec.value ?? 0)}
          previousFormattedValue={formatDurationSeconds(
            data?.overview.avgEngagementTimeSec.previousValue ?? 0
          )}
          changePercent={data?.overview.avgEngagementTimeSec.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Conversions"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.overview.conversions.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.conversions.previousValue ?? 0)}
          changePercent={data?.overview.conversions.changePercent}
          compareEnabled={compareEnabled}
        />
      </div>

      {/* Traffic Over Time Chart */}
      <TrendChart
        title="Traffic Over Time"
        subtitle="Daily sessions and active users across the selected reporting window"
        data={(data?.traffic ?? []) as unknown as Record<string, unknown>[]}
        xKey="date"
        loading={loading}
        series={[
          {
            key: 'sessions',
            label: 'Sessions',
            color: '#2563eb',
            type: 'area',
            formatter: (v) => formatNumber(v),
          },
          {
            key: 'users',
            label: 'Users',
            color: '#0d9488',
            type: 'line',
            formatter: (v) => formatNumber(v),
          },
          ...(compareEnabled
            ? [
                {
                  key: 'previousSessions',
                  label: 'Prev. Sessions',
                  color: '#94a3b8',
                  type: 'line' as const,
                  dashed: true,
                  formatter: (v: number) => formatNumber(v),
                },
              ]
            : []),
        ]}
      />

      {/* Acquisition Breakdown: Channels & Countries */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <DataTable
            title="Channel Breakdown"
            subtitle="Acquisition performance by GA4 default channel group"
            tableName="ga4_channels"
            columns={channelColumns}
            data={(data?.acquisition.channels ?? []) as (GA4ChannelRow & Record<string, unknown>)[]}
            rowKey={(r) => r.channel}
            loading={loading}
            defaultSortKey="sessions"
            searchPlaceholder="Search channels..."
          />
        </div>
        <div>
          <DataTable
            title="Top Geographies"
            subtitle={`Sessions by country (led by Bangladesh)`}
            tableName="ga4_countries"
            columns={countryColumns}
            data={(data?.acquisition.countries ?? []) as (GA4CountryRow & Record<string, unknown>)[]}
            rowKey={(r) => r.code}
            loading={loading}
            defaultSortKey="sessions"
            searchPlaceholder="Search countries..."
          />
        </div>
      </div>

      {/* UTM Campaigns Table */}
      <DataTable
        title="UTM Campaign Attribution"
        subtitle="Tracked paid social campaigns matching Meta Ads campaign taxonomy"
        tableName="ga4_utm_campaigns"
        columns={campaignColumns}
        data={(data?.campaigns ?? []) as (GA4CampaignRow & Record<string, unknown>)[]}
        rowKey={(r) => r.campaign}
        loading={loading}
        defaultSortKey="sessions"
        searchPlaceholder="Search UTM campaigns..."
      />

      {/* Top Pages & Conversions */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DataTable
          title="Top Landing & Product Pages"
          subtitle={`Most viewed pages on ${TRACKED_SITE.domain}`}
          tableName="ga4_top_pages"
          columns={pageColumns}
          data={(data?.topPages ?? []) as (GA4PageRow & Record<string, unknown>)[]}
          rowKey={(r) => r.pagePath}
          loading={loading}
          defaultSortKey="views"
          searchPlaceholder="Search pages..."
        />

        <DataTable
          title="Conversion Events"
          subtitle="High-intent B2B conversion actions (demo_request, signup, contact_form)"
          tableName="ga4_conversions"
          columns={conversionColumns}
          data={(data?.conversions ?? []) as (GA4ConversionEventRow & Record<string, unknown>)[]}
          rowKey={(r) => r.eventName}
          loading={loading}
          defaultSortKey="count"
          searchPlaceholder="Search events..."
        />
      </div>
    </div>
  );
};
