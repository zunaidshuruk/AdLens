import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Globe, Info } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { KpiCard } from '../components/KpiCard';
import { SourceBadge } from '../components/SourceBadge';
import { TrendChart } from '../components/TrendChart';
import { DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import {
  useAdapterStatus,
  useConnections,
  useDateRange,
  useReport,
  useSearchConsoleSiteInfo,
} from '../hooks';
import type {
  SearchConsoleCountryRow,
  SearchConsoleDeviceRow,
  SearchConsolePageRow,
  SearchConsoleQueryRow,
} from '../types';
import { addDays, getTodayInTimezone } from '../utils/dateUtils';
import { formatNumber, formatPercent, formatSignedPercent } from '../utils/formatters';

export const SearchConsolePage: React.FC = () => {
  const navigate = useNavigate();
  const { activeProject } = useAppContext();
  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: activeProject?.domain || DEMO_PROJECT.domain,
  };
  const { dateRange, compareEnabled, timezone } = useDateRange();
  const { isSearchConsoleLive } = useAdapterStatus();
  const { siteInfo } = useSearchConsoleSiteInfo();
  const { connections } = useConnections();

  const selectedSiteUrl =
    siteInfo?.siteUrl || connections?.google.searchConsoleSite?.url || null;

  const { data, loading, error, errorCode, refetch } = useReport(async (registry, range) => {
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

  // Check if selected date range ends within the last 3 days
  const endsWithinLast3Days = useMemo(() => {
    const effectiveTz = timezone || 'Asia/Dhaka';
    const todayStr = getTodayInTimezone(effectiveTz);
    const cutoffStr = addDays(todayStr, -3);
    return dateRange.endDate >= cutoffStr;
  }, [dateRange.endDate, timezone]);

  const isEmptySiteData = useMemo(() => {
    if (!data) return false;
    return (
      data.overview.clicks.value === 0 &&
      data.overview.impressions.value === 0 &&
      data.queries.length === 0 &&
      data.pages.length === 0 &&
      data.countries.length === 0 &&
      data.devices.length === 0
    );
  }, [data]);

  const queryColumns = useMemo<DataTableColumn<SearchConsoleQueryRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'query',
        header: 'Query',
        render: (r) => (
          <span className="font-medium text-fg">{r.query}</span>
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
                ? 'text-success font-semibold'
                : 'text-danger font-semibold'
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
          <span className="font-mono text-fg">{r.pageUrl}</span>
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
            <span className="font-mono text-[11px] text-fg-subtle">({r.code})</span>
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

  const needsConnectionAction =
    errorCode === 'SC_PERMISSION_DENIED' ||
    errorCode === 'GOOGLE_REAUTH_REQUIRED' ||
    errorCode === 'SC_NOT_SELECTED';

  const errorTitle =
    errorCode === 'SC_PERMISSION_DENIED'
      ? 'Search Console Site Access Denied'
      : errorCode === 'SC_QUOTA_EXCEEDED'
        ? 'Search Console API Quota Exceeded'
        : errorCode === 'GOOGLE_REAUTH_REQUIRED'
          ? 'Google Re-authentication Required'
          : 'Unable to load Google Search Console data';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
            Google Search Console
          </h1>
          <SourceBadge source="search_console" showMode />
        </div>
        <p className="text-xs sm:text-sm text-fg-muted">
          Organic search visibility, keyword rankings, CTR, and device breakdown for{' '}
          {isSearchConsoleLive && selectedSiteUrl ? selectedSiteUrl : TRACKED_SITE.domain}
        </p>

        {/* Selected Site URL & 2-3 Day Freshness Lag Note */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-fg-muted">
          {isSearchConsoleLive && selectedSiteUrl && (
            <span
              data-testid="gsc-site-header-info"
              className="inline-flex items-center gap-1.5 font-medium text-fg"
            >
              <Globe className="w-3.5 h-3.5 text-accent-text shrink-0" />
              <span>Site:</span>
              <span className="font-mono">{selectedSiteUrl}</span>
            </span>
          )}

          {endsWithinLast3Days && (
            <span
              data-testid="gsc-recent-data-note"
              className="inline-flex items-center gap-1 text-fg-muted"
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                Search Console data usually lags 2–3 days; recent days may show low or no data.
              </span>
            </span>
          )}
        </div>
      </div>

      {error && (
        <ErrorState
          title={errorTitle}
          message={error}
          onRetry={refetch}
          actionLabel={needsConnectionAction ? 'Go to Connections' : undefined}
          onAction={needsConnectionAction ? () => navigate('/connections') : undefined}
        />
      )}

      {!loading && !error && isEmptySiteData ? (
        <EmptyState
          title="No Google Search Console data recorded for this period"
          description="This verified Search Console property returned zero organic clicks and impressions for the selected date range. Try selecting an earlier date window or verify your property in Connections."
          actionLabel="Manage Site in Connections"
          onAction={() => navigate('/connections')}
        />
      ) : (
        <>
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
            <div className="space-y-2">
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
              <p
                data-testid="gsc-queries-privacy-note"
                className="flex items-center gap-1.5 text-xs text-fg-muted px-1"
              >
                <Info className="w-3.5 h-3.5 shrink-0 text-fg-subtle" />
                <span>
                  Google hides some low-volume queries for privacy, so table totals can be lower than the overview totals.
                </span>
              </p>
            </div>

            <div>
              <DataTable
                title="Top Pages in Search"
                subtitle={`Canonical URLs indexed on ${selectedSiteUrl || TRACKED_SITE.domain}`}
                tableName="gsc_pages"
                columns={pageColumns}
                data={(data?.pages ?? []) as (SearchConsolePageRow & Record<string, unknown>)[]}
                rowKey={(r) => r.pageUrl}
                loading={loading}
                defaultSortKey="clicks"
                searchPlaceholder="Search URLs..."
              />
            </div>
          </div>

          {/* Countries & Devices */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <DataTable
              title="Search Performance by Country"
              subtitle="Geographic breakdown of organic search demand"
              tableName="gsc_countries"
              columns={countryColumns}
              data={(data?.countries ?? []) as (SearchConsoleCountryRow & Record<string, unknown>)[]}
              rowKey={(r) => `${r.country}_${r.code}`}
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
        </>
      )}
    </div>
  );
};
