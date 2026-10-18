import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Globe, Layers } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { KpiCard } from '../components/KpiCard';
import { SourceBadge } from '../components/SourceBadge';
import { TrendChart } from '../components/TrendChart';
import { TRACKED_SITE } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useAdapterStatus, useDateRange, useMetaAccountInfo, useReport } from '../hooks';
import type { MetaAdRow, MetaAdSetRow, MetaCampaignRow, MetaStatusLabel } from '../types';
import {
  convertCurrencyFromUsd,
  formatAccountCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  getCurrencySymbol,
} from '../utils/formatters';

interface SelectedCampaign {
  id: string;
  name: string;
}

interface SelectedAdSet {
  id: string;
  name: string;
}

function renderStatusBadge(status: MetaStatusLabel): React.ReactNode {
  if (status === 'Active') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/70">
        {status}
      </span>
    );
  }
  if (status === 'Paused') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/70">
        {status}
      </span>
    );
  }
  // Neutral styling for statuses beyond Active/Paused (In Review, Rejected, With Issues, Archived, Deleted)
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
      {status}
    </span>
  );
}

const FRIENDLY_META_ERRORS: Record<string, { title: string; message: string }> = {
  META_TOKEN_INVALID: {
    title: 'Meta System User Token Invalid',
    message:
      'The Meta access token is invalid or was revoked — generate a new system user token',
  },
  META_PERMISSION_DENIED: {
    title: 'Meta Ad Account Permission Denied',
    message:
      'The Meta system user does not have permission to access this ad account — grant View performance access in Business Settings.',
  },
  META_RATE_LIMITED: {
    title: 'Meta Rate Limit Reached',
    message: 'Meta is limiting requests — try again in a few minutes',
  },
};

export const MetaAdsPage: React.FC = () => {
  const navigate = useNavigate();
  const { currency } = useAppContext();
  const { compareEnabled, timezone } = useDateRange();
  const { isMetaAdsLive } = useAdapterStatus();
  const { accountInfo } = useMetaAccountInfo();

  const [selectedCampaign, setSelectedCampaign] = useState<SelectedCampaign | null>(null);
  const [selectedAdSet, setSelectedAdSet] = useState<SelectedAdSet | null>(null);

  const { data, loading, error, errorCode, refetch } = useReport(
    async (registry, range) => {
      const [overview, spendOverTime, campaigns, adSets, ads] = await Promise.all([
        registry.metaAds.getOverview(range),
        registry.metaAds.getSpendOverTime(range),
        registry.metaAds.getCampaigns(range),
        registry.metaAds.getAdSets(range, selectedCampaign?.id),
        registry.metaAds.getAds(range, selectedAdSet?.id),
      ]);

      return {
        overview,
        spendOverTime,
        campaigns,
        adSets,
        ads,
      };
    },
    [selectedCampaign?.id, selectedAdSet?.id]
  );

  // In live mode, Meta money values are already in the ad account's currency (never convert).
  // In mock mode, use the Settings currency as before.
  const activeCurrencyCode = isMetaAdsLive
    ? accountInfo?.currency || data?.overview.accountCurrency || 'USD'
    : currency;
  const activeCurrencySymbol = getCurrencySymbol(activeCurrencyCode);

  const formatMetaMoney = useCallback(
    (amount: number): string => {
      if (isMetaAdsLive) {
        return formatAccountCurrency(amount, activeCurrencyCode);
      }
      return formatCurrency(amount, currency);
    },
    [isMetaAdsLive, activeCurrencyCode, currency]
  );

  const timezoneMismatch = Boolean(
    isMetaAdsLive && accountInfo?.timezoneName && accountInfo.timezoneName !== timezone
  );

  const spendChartData = useMemo(() => {
    if (!data) return [];
    return data.spendOverTime.map((pt) => ({
      date: pt.date,
      spendDisplay: isMetaAdsLive ? pt.spend : convertCurrencyFromUsd(pt.spend, currency),
      previousSpendDisplay: isMetaAdsLive
        ? pt.previousSpend
        : convertCurrencyFromUsd(pt.previousSpend, currency),
      leads: pt.leads,
    }));
  }, [data, isMetaAdsLive, currency]);

  const drillLevel: 'campaigns' | 'adsets' | 'ads' = selectedAdSet
    ? 'ads'
    : selectedCampaign
      ? 'adsets'
      : 'campaigns';

  const campaignColumns = useMemo<DataTableColumn<MetaCampaignRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'name',
        header: 'Campaign Name',
        render: (r) => (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                {r.name}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                <span>{r.objective}</span>
                <span>·</span>
                {renderStatusBadge(r.status)}
              </div>
            </div>
            <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 inline-flex items-center gap-0.5 shrink-0">
              <span>Ad Sets</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        ),
      },
      {
        key: 'spend',
        header: 'Spend',
        align: 'right',
        render: (r) => formatMetaMoney(r.spend),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'impressions',
        header: 'Impressions',
        align: 'right',
        render: (r) => formatNumber(r.impressions),
      },
      {
        key: 'reach',
        header: 'Reach',
        align: 'right',
        render: (r) => formatNumber(r.reach),
      },
      {
        key: 'frequency',
        header: 'Freq.',
        align: 'right',
        render: (r) => r.frequency.toFixed(2),
      },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (r) => formatNumber(r.clicks),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (r) => formatPercent(r.ctr),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'cpc',
        header: 'CPC',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpc),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'cpm',
        header: 'CPM',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpm),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'leads',
        header: 'Leads',
        align: 'right',
        render: (r) => formatNumber(r.leads),
      },
      {
        key: 'cpl',
        header: 'Cost / Lead',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpl),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
    ],
    [formatMetaMoney]
  );

  const adSetColumns = useMemo<DataTableColumn<MetaAdSetRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'name',
        header: 'Ad Set Name',
        render: (r) => (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                {r.name}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                <span>{r.audience}</span>
                <span>·</span>
                {renderStatusBadge(r.status)}
              </div>
            </div>
            <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 inline-flex items-center gap-0.5 shrink-0">
              <span>Ads</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        ),
      },
      {
        key: 'spend',
        header: 'Spend',
        align: 'right',
        render: (r) => formatMetaMoney(r.spend),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'impressions',
        header: 'Impressions',
        align: 'right',
        render: (r) => formatNumber(r.impressions),
      },
      {
        key: 'reach',
        header: 'Reach',
        align: 'right',
        render: (r) => formatNumber(r.reach),
      },
      {
        key: 'frequency',
        header: 'Freq.',
        align: 'right',
        render: (r) => r.frequency.toFixed(2),
      },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (r) => formatNumber(r.clicks),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (r) => formatPercent(r.ctr),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'cpc',
        header: 'CPC',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpc),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'cpm',
        header: 'CPM',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpm),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'leads',
        header: 'Leads',
        align: 'right',
        render: (r) => formatNumber(r.leads),
      },
      {
        key: 'cpl',
        header: 'Cost / Lead',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpl),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
    ],
    [formatMetaMoney]
  );

  const adColumns = useMemo<DataTableColumn<MetaAdRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'name',
        header: 'Ad Creative',
        render: (r) => (
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{r.name}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              <span>Format: {r.format}</span>
              <span>·</span>
              {renderStatusBadge(r.status)}
            </div>
          </div>
        ),
      },
      {
        key: 'spend',
        header: 'Spend',
        align: 'right',
        render: (r) => formatMetaMoney(r.spend),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'impressions',
        header: 'Impressions',
        align: 'right',
        render: (r) => formatNumber(r.impressions),
      },
      {
        key: 'reach',
        header: 'Reach',
        align: 'right',
        render: (r) => formatNumber(r.reach),
      },
      {
        key: 'frequency',
        header: 'Freq.',
        align: 'right',
        render: (r) => r.frequency.toFixed(2),
      },
      {
        key: 'clicks',
        header: 'Clicks',
        align: 'right',
        render: (r) => formatNumber(r.clicks),
      },
      {
        key: 'ctr',
        header: 'CTR',
        align: 'right',
        render: (r) => formatPercent(r.ctr),
        csvFormat: (v) => formatPercent(Number(v)),
      },
      {
        key: 'cpc',
        header: 'CPC',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpc),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'cpm',
        header: 'CPM',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpm),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
      {
        key: 'leads',
        header: 'Leads',
        align: 'right',
        render: (r) => formatNumber(r.leads),
      },
      {
        key: 'cpl',
        header: 'Cost / Lead',
        align: 'right',
        render: (r) => formatMetaMoney(r.cpl),
        csvFormat: (v) => formatMetaMoney(Number(v)),
      },
    ],
    [formatMetaMoney]
  );

  const breadcrumbHeader = (
    <nav aria-label="Meta Ads Drill-down Breadcrumb" className="flex items-center gap-1.5 flex-wrap text-xs">
      <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
      <button
        type="button"
        onClick={() => {
          setSelectedCampaign(null);
          setSelectedAdSet(null);
        }}
        className={`font-medium transition-colors cursor-pointer ${
          drillLevel === 'campaigns'
            ? 'text-slate-900 dark:text-slate-100 font-semibold'
            : 'text-blue-600 dark:text-blue-400 hover:underline'
        }`}
      >
        All Campaigns
      </button>

      {selectedCampaign && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <button
            type="button"
            onClick={() => setSelectedAdSet(null)}
            className={`font-medium transition-colors cursor-pointer ${
              drillLevel === 'adsets'
                ? 'text-slate-900 dark:text-slate-100 font-semibold'
                : 'text-blue-600 dark:text-blue-400 hover:underline'
            }`}
          >
            {selectedCampaign.name}
          </button>
        </>
      )}

      {selectedAdSet && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {selectedAdSet.name}
          </span>
        </>
      )}
    </nav>
  );

  const friendlyError = errorCode ? FRIENDLY_META_ERRORS[errorCode] : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Meta Ads Performance
            </h1>
            <SourceBadge source="meta_ads" showMode />
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Paid social spend, reach, lead generation efficiency, and 3-tier campaign drill-down for{' '}
            {TRACKED_SITE.name}
            {isMetaAdsLive && accountInfo && (
              <span data-testid="meta-account-header-info">
                {' '}
                · Account: <span className="font-semibold text-slate-700 dark:text-slate-200">{accountInfo.name}</span> (
                <span className="font-mono">{accountInfo.currency}</span>)
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Ad Account Timezone Mismatch Notice */}
      {timezoneMismatch && accountInfo?.timezoneName && (
        <div
          role="note"
          data-testid="meta-timezone-notice"
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-xs text-slate-600 dark:text-slate-300"
        >
          <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span>Meta reports use the ad account time zone ({accountInfo.timezoneName})</span>
        </div>
      )}

      {error && (
        <ErrorState
          title={friendlyError?.title}
          message={friendlyError?.message ?? error}
          onRetry={refetch}
          actionLabel={
            errorCode === 'META_TOKEN_INVALID' ||
            errorCode === 'META_PERMISSION_DENIED' ||
            errorCode === 'META_NOT_CONFIGURED'
              ? 'Go to Connections'
              : undefined
          }
          onAction={
            errorCode === 'META_TOKEN_INVALID' ||
            errorCode === 'META_PERMISSION_DENIED' ||
            errorCode === 'META_NOT_CONFIGURED'
              ? () => navigate('/connections')
              : undefined
          }
        />
      )}

      {/* 10 Meta Ads KPIs (with inverted polarity on cost metrics: Spend, CPC, CPM, CPL) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Total Spend"
          source="meta_ads"
          loading={loading}
          formattedValue={formatMetaMoney(data?.overview.spend.value ?? 0)}
          previousFormattedValue={formatMetaMoney(data?.overview.spend.previousValue ?? 0)}
          changePercent={data?.overview.spend.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
        <KpiCard
          label="Impressions"
          source="meta_ads"
          loading={loading}
          formattedValue={formatNumber(data?.overview.impressions.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.impressions.previousValue ?? 0)}
          changePercent={data?.overview.impressions.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Unique Reach"
          source="meta_ads"
          loading={loading}
          formattedValue={formatNumber(data?.overview.reach.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.reach.previousValue ?? 0)}
          changePercent={data?.overview.reach.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Frequency"
          source="meta_ads"
          loading={loading}
          formattedValue={(data?.overview.frequency.value ?? 0).toFixed(2)}
          previousFormattedValue={(data?.overview.frequency.previousValue ?? 0).toFixed(2)}
          changePercent={data?.overview.frequency.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Link Clicks"
          source="meta_ads"
          loading={loading}
          formattedValue={formatNumber(data?.overview.clicks.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.clicks.previousValue ?? 0)}
          changePercent={data?.overview.clicks.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Click-Through Rate (CTR)"
          source="meta_ads"
          loading={loading}
          formattedValue={formatPercent(data?.overview.ctr.value ?? 0)}
          previousFormattedValue={formatPercent(data?.overview.ctr.previousValue ?? 0)}
          changePercent={data?.overview.ctr.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Cost per Click (CPC)"
          source="meta_ads"
          loading={loading}
          formattedValue={formatMetaMoney(data?.overview.cpc.value ?? 0)}
          previousFormattedValue={formatMetaMoney(data?.overview.cpc.previousValue ?? 0)}
          changePercent={data?.overview.cpc.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
        <KpiCard
          label="Cost per 1k Impr. (CPM)"
          source="meta_ads"
          loading={loading}
          formattedValue={formatMetaMoney(data?.overview.cpm.value ?? 0)}
          previousFormattedValue={formatMetaMoney(data?.overview.cpm.previousValue ?? 0)}
          changePercent={data?.overview.cpm.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
        <KpiCard
          label="Total Leads"
          source="meta_ads"
          loading={loading}
          formattedValue={formatNumber(data?.overview.leads.value ?? 0)}
          previousFormattedValue={formatNumber(data?.overview.leads.previousValue ?? 0)}
          changePercent={data?.overview.leads.changePercent}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Cost per Lead (CPL)"
          source="meta_ads"
          loading={loading}
          formattedValue={formatMetaMoney(data?.overview.cpl.value ?? 0)}
          previousFormattedValue={formatMetaMoney(data?.overview.cpl.previousValue ?? 0)}
          changePercent={data?.overview.cpl.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
      </div>

      {/* Spend Over Time Chart */}
      <TrendChart
        title={`Daily Ad Spend Over Time (${activeCurrencyCode})`}
        subtitle="Daily Meta Ads expenditure with previous period comparison"
        data={spendChartData}
        xKey="date"
        loading={loading}
        leftAxisFormatter={(v) => `${activeCurrencySymbol}${formatNumber(v)}`}
        series={[
          {
            key: 'spendDisplay',
            label: `Spend (${activeCurrencyCode})`,
            color: '#2563eb',
            type: 'area',
            formatter: (v) => `${activeCurrencySymbol}${formatNumber(v)}`,
          },
          ...(compareEnabled
            ? [
                {
                  key: 'previousSpendDisplay',
                  label: `Prev. Spend (${activeCurrencyCode})`,
                  color: '#94a3b8',
                  type: 'line' as const,
                  dashed: true,
                  formatter: (v: number) => `${activeCurrencySymbol}${formatNumber(v)}`,
                },
              ]
            : []),
        ]}
      />

      {/* 3-Level Drill-Down Table: Campaign -> Ad Set -> Ad */}
      {drillLevel === 'campaigns' && (
        <DataTable
          title="Meta Campaigns (Level 1 of 3)"
          subtitle="Click any campaign row to drill down into its Ad Sets"
          tableName="meta_campaigns"
          columns={campaignColumns}
          data={(data?.campaigns ?? []) as (MetaCampaignRow & Record<string, unknown>)[]}
          rowKey={(r) => r.id}
          loading={loading}
          defaultSortKey="spend"
          searchPlaceholder="Search campaigns..."
          headerExtra={breadcrumbHeader}
          onRowClick={(row) => {
            setSelectedCampaign({ id: row.id, name: row.name });
            setSelectedAdSet(null);
          }}
        />
      )}

      {drillLevel === 'adsets' && (
        <DataTable
          title={`Ad Sets in "${selectedCampaign?.name}" (Level 2 of 3)`}
          subtitle="Click any Ad Set row to drill down into its individual Ads"
          tableName="meta_adsets"
          columns={adSetColumns}
          data={(data?.adSets ?? []) as (MetaAdSetRow & Record<string, unknown>)[]}
          rowKey={(r) => r.id}
          loading={loading}
          defaultSortKey="spend"
          searchPlaceholder="Search ad sets..."
          headerExtra={breadcrumbHeader}
          onRowClick={(row) => {
            setSelectedAdSet({ id: row.id, name: row.name });
          }}
        />
      )}

      {drillLevel === 'ads' && (
        <DataTable
          title={`Ads in "${selectedAdSet?.name}" (Level 3 of 3)`}
          subtitle="Creative-level delivery and conversion metrics"
          tableName="meta_ads"
          columns={adColumns}
          data={(data?.ads ?? []) as (MetaAdRow & Record<string, unknown>)[]}
          rowKey={(r) => r.id}
          loading={loading}
          defaultSortKey="spend"
          searchPlaceholder="Search ads..."
          headerExtra={breadcrumbHeader}
        />
      )}
    </div>
  );
};
