import React, { useMemo, useState } from 'react';
import { ChevronRight, Layers } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { ErrorState } from '../components/ErrorState';
import { KpiCard } from '../components/KpiCard';
import { TrendChart } from '../components/TrendChart';
import { TRACKED_SITE } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useDateRange, useReport } from '../hooks';
import type { MetaAdRow, MetaAdSetRow, MetaCampaignRow } from '../types';
import {
  convertCurrencyFromUsd,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../utils/formatters';

interface SelectedCampaign {
  id: string;
  name: string;
}

interface SelectedAdSet {
  id: string;
  name: string;
}

export const MetaAdsPage: React.FC = () => {
  const { currency } = useAppContext();
  const { compareEnabled } = useDateRange();

  const [selectedCampaign, setSelectedCampaign] = useState<SelectedCampaign | null>(null);
  const [selectedAdSet, setSelectedAdSet] = useState<SelectedAdSet | null>(null);

  const { data, loading, error, refetch } = useReport(
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

  const spendChartData = useMemo(() => {
    if (!data) return [];
    return data.spendOverTime.map((pt) => ({
      date: pt.date,
      spendDisplay: convertCurrencyFromUsd(pt.spendUsd, currency),
      previousSpendDisplay: convertCurrencyFromUsd(pt.previousSpendUsd, currency),
      leads: pt.leads,
    }));
  }, [data, currency]);

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
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {r.objective} · {r.status}
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
        key: 'spendUsd',
        header: 'Spend',
        align: 'right',
        render: (r) => formatCurrency(r.spendUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
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
        key: 'cpcUsd',
        header: 'CPC',
        align: 'right',
        render: (r) => formatCurrency(r.cpcUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
      {
        key: 'cpmUsd',
        header: 'CPM',
        align: 'right',
        render: (r) => formatCurrency(r.cpmUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
      {
        key: 'leads',
        header: 'Leads',
        align: 'right',
        render: (r) => formatNumber(r.leads),
      },
      {
        key: 'cplUsd',
        header: 'Cost / Lead',
        align: 'right',
        render: (r) => formatCurrency(r.cplUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
    ],
    [currency]
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
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {r.audience} · {r.status}
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
        key: 'spendUsd',
        header: 'Spend',
        align: 'right',
        render: (r) => formatCurrency(r.spendUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
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
        key: 'cpcUsd',
        header: 'CPC',
        align: 'right',
        render: (r) => formatCurrency(r.cpcUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
      {
        key: 'cpmUsd',
        header: 'CPM',
        align: 'right',
        render: (r) => formatCurrency(r.cpmUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
      {
        key: 'leads',
        header: 'Leads',
        align: 'right',
        render: (r) => formatNumber(r.leads),
      },
      {
        key: 'cplUsd',
        header: 'Cost / Lead',
        align: 'right',
        render: (r) => formatCurrency(r.cplUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
    ],
    [currency]
  );

  const adColumns = useMemo<DataTableColumn<MetaAdRow & Record<string, unknown>>[]>(
    () => [
      {
        key: 'name',
        header: 'Ad Creative',
        render: (r) => (
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{r.name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Format: {r.format} · {r.status}
            </div>
          </div>
        ),
      },
      {
        key: 'spendUsd',
        header: 'Spend',
        align: 'right',
        render: (r) => formatCurrency(r.spendUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
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
        key: 'cpcUsd',
        header: 'CPC',
        align: 'right',
        render: (r) => formatCurrency(r.cpcUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
      {
        key: 'cpmUsd',
        header: 'CPM',
        align: 'right',
        render: (r) => formatCurrency(r.cpmUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
      {
        key: 'leads',
        header: 'Leads',
        align: 'right',
        render: (r) => formatNumber(r.leads),
      },
      {
        key: 'cplUsd',
        header: 'Cost / Lead',
        align: 'right',
        render: (r) => formatCurrency(r.cplUsd, currency),
        csvFormat: (v) => formatCurrency(Number(v), currency),
      },
    ],
    [currency]
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Meta Ads Performance
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Paid social spend, reach, lead generation efficiency, and 3-tier campaign drill-down for{' '}
          {TRACKED_SITE.name}
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={refetch} />}

      {/* 10 Meta Ads KPIs (with inverted polarity on cost metrics: Spend, CPC, CPM, CPL) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Total Spend"
          source="meta_ads"
          loading={loading}
          formattedValue={formatCurrency(data?.overview.spendUsd.value ?? 0, currency)}
          previousFormattedValue={formatCurrency(
            data?.overview.spendUsd.previousValue ?? 0,
            currency
          )}
          changePercent={data?.overview.spendUsd.changePercent}
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
          formattedValue={formatCurrency(data?.overview.cpcUsd.value ?? 0, currency)}
          previousFormattedValue={formatCurrency(
            data?.overview.cpcUsd.previousValue ?? 0,
            currency
          )}
          changePercent={data?.overview.cpcUsd.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
        <KpiCard
          label="Cost per 1k Impr. (CPM)"
          source="meta_ads"
          loading={loading}
          formattedValue={formatCurrency(data?.overview.cpmUsd.value ?? 0, currency)}
          previousFormattedValue={formatCurrency(
            data?.overview.cpmUsd.previousValue ?? 0,
            currency
          )}
          changePercent={data?.overview.cpmUsd.changePercent}
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
          formattedValue={formatCurrency(data?.overview.cplUsd.value ?? 0, currency)}
          previousFormattedValue={formatCurrency(
            data?.overview.cplUsd.previousValue ?? 0,
            currency
          )}
          changePercent={data?.overview.cplUsd.changePercent}
          compareEnabled={compareEnabled}
          invertPolarity
        />
      </div>

      {/* Spend Over Time Chart */}
      <TrendChart
        title={`Daily Ad Spend Over Time (${currency})`}
        subtitle="Daily Meta Ads expenditure with previous period comparison"
        data={spendChartData}
        xKey="date"
        loading={loading}
        leftAxisFormatter={(v) => `${currency === 'BDT' ? '৳' : '$'}${formatNumber(v)}`}
        series={[
          {
            key: 'spendDisplay',
            label: `Spend (${currency})`,
            color: '#2563eb',
            type: 'area',
            formatter: (v) => `${currency === 'BDT' ? '৳' : '$'}${formatNumber(v)}`,
          },
          ...(compareEnabled
            ? [
                {
                  key: 'previousSpendDisplay',
                  label: `Prev. Spend (${currency})`,
                  color: '#94a3b8',
                  type: 'line' as const,
                  dashed: true,
                  formatter: (v: number) => `${currency === 'BDT' ? '৳' : '$'}${formatNumber(v)}`,
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
          defaultSortKey="spendUsd"
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
          defaultSortKey="spendUsd"
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
          defaultSortKey="spendUsd"
          searchPlaceholder="Search ads..."
          headerExtra={breadcrumbHeader}
        />
      )}
    </div>
  );
};
