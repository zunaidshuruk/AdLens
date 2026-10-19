import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Filter, Globe, Info, X } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { KpiCard } from '../components/KpiCard';
import { SourceBadge } from '../components/SourceBadge';
import { TrendChart } from '../components/TrendChart';
import { DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useAdapterStatus, useDateRange, useGA4PropertyInfo, useReport } from '../hooks';
import type {
  GA4CampaignRow,
  GA4ChannelRow,
  GA4ConversionEventRow,
  GA4CountryRow,
  GA4PageRow,
  GA4SourceGroupRow,
  GA4TrafficBreakdownDimension,
  GA4TrafficBreakdownRow,
} from '../types';
import { addDays, getTodayInTimezone } from '../utils/dateUtils';
import {
  formatDurationSeconds,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from '../utils/formatters';

const BREAKDOWN_DIMENSIONS: { id: GA4TrafficBreakdownDimension; label: string }[] = [
  { id: 'channel', label: 'Channel' },
  { id: 'sourceMedium', label: 'Source / medium' },
  { id: 'referrer', label: 'Referrer' },
  { id: 'landingPage', label: 'Landing page' },
  { id: 'country', label: 'Country' },
  { id: 'device', label: 'Device' },
  { id: 'browser', label: 'Browser' },
];

const SOURCE_GROUP_COLORS: Record<string, string> = {
  Search: '#2563eb',
  Paid: '#0d9488',
  'Direct / unknown': '#64748b',
  Referral: '#7c3aed',
  Social: '#ea580c',
  Email: '#d97706',
  'AI assistants': '#0284c7',
  Other: '#94a3b8',
};

const COUNTRY_FILTER_OPTIONS = [
  'Bangladesh',
  'Singapore',
  'United Arab Emirates',
  'United States',
  'United Kingdom',
  'Malaysia',
];

const DEVICE_FILTER_OPTIONS = ['desktop', 'mobile', 'tablet'];

const BROWSER_FILTER_OPTIONS = ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet'];

export const GA4Page: React.FC = () => {
  const navigate = useNavigate();
  const { activeProject } = useAppContext();
  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: activeProject?.domain || DEMO_PROJECT.domain,
  };
  const { dateRange, compareEnabled, timezone } = useDateRange();
  const { isGA4Live } = useAdapterStatus();
  const { propertyInfo } = useGA4PropertyInfo();

  const [breakdownDimension, setBreakdownDimension] =
    useState<GA4TrafficBreakdownDimension>('channel');
  const [countryFilter, setCountryFilter] = useState<string>('');
  const [deviceFilter, setDeviceFilter] = useState<string>('');
  const [browserFilter, setBrowserFilter] = useState<string>('');
  const [showSourceGroupRules, setShowSourceGroupRules] = useState<boolean>(false);

  const { data, loading, error, errorCode, refetch } = useReport(async (registry, range) => {
    const [overview, traffic, acquisition, campaigns, topPages, conversions, sourceGroups] =
      await Promise.all([
        registry.ga4.getOverview(range),
        registry.ga4.getTrafficOverTime(range),
        registry.ga4.getAcquisition(range),
        registry.ga4.getCampaigns(range),
        registry.ga4.getTopPages(range),
        registry.ga4.getConversions(range),
        registry.ga4.getSourceGroups(range),
      ]);

    return {
      overview,
      traffic,
      acquisition,
      campaigns,
      topPages,
      conversions,
      sourceGroups,
    };
  });

  const {
    data: breakdownRows,
    loading: breakdownLoading,
  } = useReport(
    async (registry, range) => {
      return registry.ga4.getTrafficBreakdown(range, breakdownDimension, {
        ...(countryFilter ? { country: countryFilter } : {}),
        ...(deviceFilter ? { deviceCategory: deviceFilter } : {}),
        ...(browserFilter ? { browser: browserFilter } : {}),
      });
    },
    [breakdownDimension, countryFilter, deviceFilter, browserFilter]
  );

  // Check if selected date range includes today or yesterday
  const includesRecent48h = useMemo(() => {
    const effectiveTz = propertyInfo?.timeZone || timezone || 'Asia/Dhaka';
    const todayStr = getTodayInTimezone(effectiveTz);
    const yesterdayStr = addDays(todayStr, -1);
    const includesToday =
      dateRange.startDate <= todayStr && dateRange.endDate >= todayStr;
    const includesYesterday =
      dateRange.startDate <= yesterdayStr && dateRange.endDate >= yesterdayStr;
    return includesToday || includesYesterday;
  }, [dateRange.startDate, dateRange.endDate, propertyInfo?.timeZone, timezone]);

  const timezoneMismatch = Boolean(
    isGA4Live && propertyInfo?.timeZone && propertyInfo.timeZone !== timezone
  );

  const isEmptyPropertyData = useMemo(() => {
    if (!data) return false;
    return (
      data.overview.sessions.value === 0 &&
      data.overview.users.value === 0 &&
      data.overview.engagedSessions.value === 0 &&
      data.acquisition.channels.length === 0 &&
      data.topPages.length === 0 &&
      data.conversions.length === 0
    );
  }, [data]);

  const activeDimensionLabel = useMemo(() => {
    return (
      BREAKDOWN_DIMENSIONS.find((d) => d.id === breakdownDimension)?.label ?? 'Dimension'
    );
  }, [breakdownDimension]);

  const breakdownColumns = useMemo<
    DataTableColumn<GA4TrafficBreakdownRow & Record<string, unknown>>[]
  >(
    () => [
      {
        key: 'dimensionValue',
        header: activeDimensionLabel,
        render: (r) => (
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {r.dimensionValue}
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
        key: 'activeUsers',
        header: 'Users',
        align: 'right',
        render: (r) => formatNumber(r.activeUsers),
      },
      {
        key: 'newUsers',
        header: 'New Users',
        align: 'right',
        render: (r) => formatNumber(r.newUsers),
      },
      {
        key: 'engagedSessions',
        header: 'Engaged Sessions',
        align: 'right',
        render: (r) => formatNumber(r.engagedSessions),
      },
      {
        key: 'engagementRate',
        header: 'Engagement Rate',
        align: 'right',
        render: (r) => formatPercent(r.engagementRate, 1),
        csvFormat: (v) => formatPercent(Number(v), 1),
      },
      {
        key: 'keyEvents',
        header: 'Key Events',
        align: 'right',
        render: (r) => formatNumber(r.keyEvents),
      },
      {
        key: 'avgEngagementTimeSec',
        header: 'Avg. Engagement Time',
        align: 'right',
        render: (r) => formatDurationSeconds(r.avgEngagementTimeSec),
        csvFormat: (v) => formatDurationSeconds(Number(v)),
      },
      {
        key: 'changePercent',
        header: '% Change',
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
    [activeDimensionLabel]
  );

  const sourceGroupColumns = useMemo<
    DataTableColumn<GA4SourceGroupRow & Record<string, unknown>>[]
  >(
    () => [
      {
        key: 'group',
        header: 'Source Group',
        render: (r) => (
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: SOURCE_GROUP_COLORS[r.group] || '#64748b' }}
            />
            <span className="font-medium text-slate-900 dark:text-slate-100">{r.group}</span>
          </div>
        ),
      },
      {
        key: 'sessions',
        header: 'Sessions',
        align: 'right',
        render: (r) => formatNumber(r.sessions),
      },
      {
        key: 'sharePercent',
        header: 'Share',
        align: 'right',
        render: (r) => formatPercent(r.sharePercent, 1),
        csvFormat: (v) => formatPercent(Number(v), 1),
      },
      {
        key: 'keyEventRate',
        header: 'Key Event Rate',
        align: 'right',
        render: (r) => formatPercent(r.keyEventRate, 1),
        csvFormat: (v) => formatPercent(Number(v), 1),
      },
      {
        key: 'changePercent',
        header: 'Change',
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
            {r.code && <span className="text-slate-400 font-mono text-[11px]">({r.code})</span>}
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
        render: (r) => (
          <span className="font-mono text-slate-600 dark:text-slate-400">{r.sourceMedium}</span>
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

  const availableCountryOptions = useMemo(() => {
    const dynamic = (data?.acquisition.countries ?? [])
      .map((c) => c.country)
      .filter((c) => c && c !== '(not set)');
    return Array.from(new Set([...dynamic, ...COUNTRY_FILTER_OPTIONS]));
  }, [data?.acquisition.countries]);

  const hasActiveFilters = Boolean(countryFilter || deviceFilter || browserFilter);

  const needsConnectionAction =
    errorCode === 'GA4_PERMISSION_DENIED' ||
    errorCode === 'GOOGLE_REAUTH_REQUIRED' ||
    errorCode === 'GA4_NOT_SELECTED';

  const errorTitle =
    errorCode === 'GA4_PERMISSION_DENIED'
      ? 'GA4 Property Access Denied'
      : errorCode === 'GA4_QUOTA_EXCEEDED'
        ? 'GA4 API Quota Exceeded'
        : errorCode === 'GOOGLE_REAUTH_REQUIRED'
          ? 'Google Re-authentication Required'
          : 'Unable to load Google Analytics 4 data';

  return (
    <div className="space-y-6">
      {/* Page Header + Source Mode Badge + Property Metadata */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Google Analytics 4
            </h1>
            <SourceBadge source="ga4" showMode />
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Session engagement, acquisition channels, UTM attribution, and key conversion events on{' '}
            {isGA4Live && propertyInfo ? propertyInfo.displayName : TRACKED_SITE.domain}
          </p>

          {/* Live Property Info & Timezone / 24-48h Freshness Notes */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-slate-500 dark:text-slate-400">
            {isGA4Live && propertyInfo && (
              <span
                data-testid="ga4-property-header-info"
                className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300"
              >
                <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Property: {propertyInfo.displayName}</span>
                {propertyInfo.timeZone && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{propertyInfo.timeZone}</span>
                  </>
                )}
              </span>
            )}

            {timezoneMismatch && propertyInfo?.timeZone && (
              <span
                data-testid="ga4-timezone-mismatch-note"
                className="text-amber-700 dark:text-amber-400"
              >
                GA4 reports use the property time zone ({propertyInfo.timeZone})
              </span>
            )}

            {includesRecent48h && (
              <span
                data-testid="ga4-recent-data-note"
                className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400"
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>GA4 data for the last 24–48 hours may be incomplete.</span>
              </span>
            )}
          </div>
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

      {!loading && !error && isEmptyPropertyData ? (
        <EmptyState
          title="No Google Analytics 4 traffic recorded for this period"
          description="This GA4 property returned zero sessions and events for the selected date range. Try selecting a broader date window or verify your GA4 measurement tag."
          actionLabel="Manage Property in Connections"
          onAction={() => navigate('/connections')}
        />
      ) : (
        <>
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
              previousFormattedValue={formatNumber(
                data?.overview.engagedSessions.previousValue ?? 0
              )}
              changePercent={data?.overview.engagedSessions.changePercent}
              compareEnabled={compareEnabled}
            />
            <KpiCard
              label="Engagement Rate"
              source="ga4"
              loading={loading}
              formattedValue={formatPercent(data?.overview.engagementRate.value ?? 0)}
              previousFormattedValue={formatPercent(
                data?.overview.engagementRate.previousValue ?? 0
              )}
              changePercent={data?.overview.engagementRate.changePercent}
              compareEnabled={compareEnabled}
            />
            <KpiCard
              label="Avg. Engagement Time"
              source="ga4"
              loading={loading}
              formattedValue={formatDurationSeconds(
                data?.overview.avgEngagementTimeSec.value ?? 0
              )}
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

          {/* Source Groups Card (Donut Chart + Table + Info Icon for SOURCE_GROUP_RULES) */}
          <div
            data-testid="ga4-source-groups-card"
            className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Source groups
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  All GA4 sessions classified into AdLens source groups (total:{' '}
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {formatNumber(data?.sourceGroups.totalSessions ?? 0)}
                  </span>{' '}
                  sessions)
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowSourceGroupRules((prev) => !prev)}
                aria-expanded={showSourceGroupRules}
                aria-label="Toggle source group classification rules"
                data-testid="source-group-rules-toggle"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Classification rules</span>
              </button>
            </div>

            {showSourceGroupRules && (
              <div
                data-testid="source-group-rules-panel"
                className="p-3.5 rounded-lg border border-blue-200/80 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30 text-xs text-slate-700 dark:text-slate-300 space-y-1.5"
              >
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Source Group Classification Rules (evaluated in order)
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-300">
                  {(data?.sourceGroups.rules ?? []).map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
              {/* Donut Chart */}
              <div className="h-60 w-full flex flex-col items-center justify-center">
                {loading ? (
                  <div className="w-44 h-44 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={(data?.sourceGroups.groups ?? []).filter((g) => g.sessions > 0)}
                        dataKey="sessions"
                        nameKey="group"
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={88}
                        paddingAngle={2}
                      >
                        {(data?.sourceGroups.groups ?? [])
                          .filter((g) => g.sessions > 0)
                          .map((entry) => (
                            <Cell
                              key={entry.group}
                              fill={SOURCE_GROUP_COLORS[entry.group] || '#64748b'}
                            />
                          ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: unknown, name: unknown) => [
                          formatNumber(Number(value)),
                          String(name),
                        ]}
                        contentStyle={{
                          borderRadius: '0.5rem',
                          border: '1px solid #e2e8f0',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Source Groups Table */}
              <div className="lg:col-span-2">
                <DataTable
                  title="Sessions by Source Group"
                  subtitle="Share of total sessions, key event conversion rate, and period change"
                  tableName="ga4_source_groups"
                  columns={sourceGroupColumns}
                  data={
                    (data?.sourceGroups.groups ?? []) as (GA4SourceGroupRow &
                      Record<string, unknown>)[]
                  }
                  rowKey={(r) => r.group}
                  loading={loading}
                  pageSize={8}
                  defaultSortKey="sessions"
                  searchPlaceholder="Filter source groups..."
                />
              </div>
            </div>
          </div>

          {/* Traffic Breakdown Section (Dimension Tabs + Country/Device/Browser Filters + Sortable Table) */}
          <div
            data-testid="ga4-traffic-breakdown-section"
            className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Traffic breakdown
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Explore sessions, users, engagement, and key events across dimensions with
                  country, device, and browser filters
                </p>
              </div>

              {/* Country, Device, Browser Filter Dropdowns */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">
                  <Filter className="w-3.5 h-3.5" />
                  <span>Filters:</span>
                </span>

                <select
                  aria-label="Filter by country"
                  value={countryFilter}
                  onChange={(e) => setCountryFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value="">All countries</option>
                  {availableCountryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by device"
                  value={deviceFilter}
                  onChange={(e) => setDeviceFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value="">All devices</option>
                  {DEVICE_FILTER_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by browser"
                  value={browserFilter}
                  onChange={(e) => setBrowserFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value="">All browsers</option>
                  {BROWSER_FILTER_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setCountryFilter('');
                      setDeviceFilter('');
                      setBrowserFilter('');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>

            {/* Dimension Tabs */}
            <div
              role="tablist"
              aria-label="Traffic breakdown dimensions"
              className="flex items-center gap-1.5 flex-wrap border-b border-slate-200 dark:border-slate-800 pb-3"
            >
              {BREAKDOWN_DIMENSIONS.map((dim) => {
                const isActive = breakdownDimension === dim.id;
                return (
                  <button
                    key={dim.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setBreakdownDimension(dim.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {dim.label}
                  </button>
                );
              })}
            </div>

            {/* Breakdown Table */}
            <DataTable
              title={`Traffic by ${activeDimensionLabel}`}
              subtitle="Sessions, active users, new users, engaged sessions, engagement rate, key events, avg engagement time, and % change"
              tableName={`ga4_traffic_breakdown_${breakdownDimension}`}
              columns={breakdownColumns}
              data={
                (breakdownRows ?? []) as (GA4TrafficBreakdownRow & Record<string, unknown>)[]
              }
              rowKey={(r, i) => `${r.dimensionValue}_${i}`}
              loading={breakdownLoading}
              defaultSortKey="sessions"
              searchPlaceholder={`Search ${activeDimensionLabel.toLowerCase()}...`}
            />
          </div>

          {/* Acquisition Breakdown: Channels & Countries */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <DataTable
                title="Channel Breakdown"
                subtitle="Acquisition performance by GA4 default channel group"
                tableName="ga4_channels"
                columns={channelColumns}
                data={
                  (data?.acquisition.channels ?? []) as (GA4ChannelRow & Record<string, unknown>)[]
                }
                rowKey={(r) => r.channel}
                loading={loading}
                defaultSortKey="sessions"
                searchPlaceholder="Search channels..."
              />
            </div>
            <div>
              <DataTable
                title="Top Geographies"
                subtitle="Sessions by country"
                tableName="ga4_countries"
                columns={countryColumns}
                data={
                  (data?.acquisition.countries ?? []) as (GA4CountryRow & Record<string, unknown>)[]
                }
                rowKey={(r, i) => `${r.country}_${r.code ?? i}`}
                loading={loading}
                defaultSortKey="sessions"
                searchPlaceholder="Search countries..."
              />
            </div>
          </div>

          {/* UTM Campaigns Table */}
          <DataTable
            title="UTM Campaign Attribution"
            subtitle="Tracked campaign sessions, engagement rate, and key events"
            tableName="ga4_utm_campaigns"
            columns={campaignColumns}
            data={(data?.campaigns ?? []) as (GA4CampaignRow & Record<string, unknown>)[]}
            rowKey={(r, i) => `${r.campaign}_${r.sourceMedium}_${i}`}
            loading={loading}
            defaultSortKey="sessions"
            searchPlaceholder="Search UTM campaigns..."
          />

          {/* Top Pages & Conversions */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <DataTable
              title="Top Landing & Product Pages"
              subtitle={`Most viewed pages on ${propertyInfo?.displayName || TRACKED_SITE.domain}`}
              tableName="ga4_top_pages"
              columns={pageColumns}
              data={(data?.topPages ?? []) as (GA4PageRow & Record<string, unknown>)[]}
              rowKey={(r, i) => `${r.pagePath}_${i}`}
              loading={loading}
              defaultSortKey="views"
              searchPlaceholder="Search pages..."
            />

            <DataTable
              title="Conversion Events"
              subtitle="Key events with keyEvents > 0"
              tableName="ga4_conversions"
              columns={conversionColumns}
              data={
                (data?.conversions ?? []) as (GA4ConversionEventRow & Record<string, unknown>)[]
              }
              rowKey={(r) => r.eventName}
              loading={loading}
              defaultSortKey="count"
              searchPlaceholder="Search events..."
            />
          </div>
        </>
      )}
    </div>
  );
};
