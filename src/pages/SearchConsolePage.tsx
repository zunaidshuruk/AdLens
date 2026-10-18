import React, { useMemo } from 'react';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { KpiCard } from '../components/KpiCard';
import { TrendChart } from '../components/TrendChart';
import { TRACKED_SITE } from '../config/app';
import { useDateRange, useReport } from '../hooks';
import type {
  SearchConsoleCountryRow,
  SearchConsoleDeviceRow,
  SearchConsolePageRow,
  SearchConsoleQueryRow,
} from '../types';
import { formatNumber, formatPercent, formatSignedPercent } from '../utils/formatters';

export const SearchConsolePage: React.FC = () => {
  const { compareEnabled } = useDateRange();

  const { data, loading, error, refetch } = useReport(async (registry, range) => {
    const [overview, performance, queries, pages, countries, devices] = await Promise.all([
      registry.searchConsole.getOverview(range),
      registry.searchConsole.getPerformanceOverTime(range),
      registry.searchConsole.getTopQueries(range),
      registry.searchConsole.getTopPages(range),
      registry.searchConsole.getCountries(range),
      registry.searchConsole.getDevices(range),
    ]);

    return {
      overview,
      performance,
      queries,
      pages,
      countries,
      devices,
    };
  });

  const queryColumns = useMemo<DataTableColumn<SearchConsoleQueryRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'query',
        header: 'Query',
        render: (r) => (
          <span className="font-medium text-slate-900 dark:text-slate-100">{r.query}</span>
        ),
      },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (r) => formatNumber(r.clicks),
      },
      {
        key: 'impressions',
        header: 'Impressions',
        align: 'right',
        render: (r) => formatNumber(r.impressions),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (r) => formatPercent(r.ctr),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'avgPosition',
        header: 'Avg. Position',
        align: 'right',
        render: (r) => r.avgPosition.toFixed(1),
      },
      {
        key: 'changePercent',
        header: 'Clicks Δ',
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

  const pageColumns = useMemo<DataTableColumn<SearchConsolePageRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'pageUrl',
        header: 'Indexed URL',
        render: (r) => (
          <span className="font-mono text-slate-900 dark:text-slate-100">{r.pageUrl}</span>
        ),
      },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (r) => formatNumber(r.clicks),
      },
      {
        key: 'impressions',
        header: 'Impressions',
        align: 'right',
        render: (r) => formatNumber(r.impressions),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (r) => formatPercent(r.ctr),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'avgPosition',
        header: 'Avg. Position',
        align: 'right',
        render: (r) => r.avgPosition.toFixed(1),
      },
    ],
    []
  );

  const countryColumns = useMemo<
    DataTableColumn<SearchConsoleCountryRow & Record<string, unknown>>[]
  >(
    () => [
      {
        key: 'country',
        header: 'Country',
        render: (r) => (
          <span>
            {r.country}{' '}
            <span className="font-mono text-[11px] text-slate-400">({r.code})</span>
          </span>
        ),
      },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (r) => formatNumber(r.clicks),
      },
      {
        key: 'impressions',
        header: 'Impressions',
        align: 'right',
        render: (r) => formatNumber(r.impressions),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (r) => formatPercent(r.ctr),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'avgPosition',
        header: 'Avg. Position',
        align: 'right',
        render: (r) => r.avgPosition.toFixed(1),
      },
    ],
    []
  );

  const deviceColumns = useMemo<
    DataTableColumn<SearchConsoleDeviceRow & Record<string, unknown>>[]
  >(
    () => [
      { key: 'device', header: 'Device Category' },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (r) => formatNumber(r.clicks),
      },
      {
        key: 'impressions',
        header: 'Impressions',
        align: 'right',
        render: (r) => formatNumber(r.impressions),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (r) => formatPercent(r.ctr),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'avgPosition',
        header: 'Avg. Position',
        align: 'right',
        render: (r) => r.avgPosition.toFixed(1),
      },
      {
        key: 'sharePercent',
        header: 'Impression Share',
        align: 'right',
        render: (r) => formatPercent(r.sharePercent),
        csvFormat: (v) => formatPercent(Number(v)),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Google Search Console
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Organic search visibility, keyword rankings, CTR, and device breakdown for{' '}
          {TRACKED_SITE.domain}
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={refetch} />}

      {/* 4 GSC KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Organic Clicks"
          source="search_console"
          loading={loading}
          formattedValue={formatNumber(data?.overview.clicks.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.clicks.previousValue ?? 0)}
          changePercent={data?.overview.clicks.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Total Impressions"
          source="search_console"
          loading={loading}
          formattedValue={formatNumber(data?.overview.impressions.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.impressions.previousValue ?? 0)}
          changePercent={data?.overview.impressions.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Average CTR"
          source="search_console"
          loading={loading}
          formattedValue={formatPercent(data?.overview.ctr.value ?? 0)}
          previousFormattedValue={formatPercent(data?.overview.ctr.previousValue ?? 0)}
          changePercent={data?.overview.ctr.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Average Position"
          source="search_console"
          loading={loading}
          formattedValue={(data?.overview.avgPosition.value ?? 0).toFixed(1)}
          previousFormattedValue={(data?.overview.avgPosition.previousValue ?? 0).toFixed(1)}
          changePercent={data?.overview.avgPosition.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
      </div>

      {/* Dual-Axis Clicks & Impressions Over Time */}
      <TrendChart
        title="Clicks & Impressions Over Time (Dual Axis)"
        subtitle="Left axis: Organic Clicks · Right axis: Search Impressions"
        data={(data?.performance ?? []) as unknown as Record<string, unknown>[]}
        xKey="date"
        loading={loading}
        dualAxis
        leftAxisFormatter={(v) => formatNumber(v)}
        rightAxisFormatter={(v) => formatNumber(v)}
        series={[
          {
            key: 'clicks',
            label: 'Clicks',
            color: '#2563eb',
            yAxisId: 'left',
            type: 'area',
            formatter: (v) => formatNumber(v),
          },
          ...(compareEnabled
            ? [
                {
                  key: 'previousClicks',
                  label: 'Prev. Clicks',
                  color: '#94a3b8',
                  yAxisId: 'left' as const,
                  type: 'line' as const,
                  dashed: true,
                  formatter: (v: number) => formatNumber(v),
                },
              ]
            : []),
          {
            key: 'impressions',
            label: 'Impressions',
            color: '#7c3aed',
            yAxisId: 'right',
            type: 'line',
            formatter: (v) => formatNumber(v),
          },
        ]}
      />

      {/* Queries & Pages */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DataTable
          title="Top Search Queries"
          subtitle="Keywords driving organic clicks and impressions"
          tableName="gsc_queries"
          columns={queryColumns}
          data={(data?.queries ?? []) as (SearchConsoleQueryRow & Record<string, unknown>)[]}
          rowKey={(r) => r.query}
          loading={loading}
          defaultSortKey="clicks"
          searchPlaceholder="Search queries..."
        />

        <DataTable
          title="Top Pages in Search"
          subtitle={`Canonical URLs indexed on ${TRACKED_SITE.domain}`}
          tableName="gsc_pages"
          columns={pageColumns}
          data={(data?.pages ?? []) as (SearchConsolePageRow & Record<string, unknown>)[]}
          rowKey={(r) => r.pageUrl}
          loading={loading}
          defaultSortKey="clicks"
          searchPlaceholder="Search URLs..."
        />
      </div>

      {/* Countries & Devices */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DataTable
          title="Search Performance by Country"
          subtitle="Geographic breakdown of organic search demand"
          tableName="gsc_countries"
          columns={countryColumns}
          data={(data?.countries ?? []) as (SearchConsoleCountryRow & Record<string, unknown>)[]}
          rowKey={(r) => r.code}
          loading={loading}
          defaultSortKey="clicks"
          searchPlaceholder="Search countries..."
        />

        <DataTable
          title="Devices Breakdown"
          subtitle="Search clicks, CTR, and rank across Desktop, Mobile, and Tablet"
          tableName="gsc_devices"
          columns={deviceColumns}
          data={(data?.devices ?? []) as (SearchConsoleDeviceRow & Record<string, unknown>)[]}
          rowKey={(r) => r.device}
          loading={loading}
          defaultSortKey="clicks"
          searchPlaceholder="Search devices..."
        />
      </div>
    </div>
  );
};
