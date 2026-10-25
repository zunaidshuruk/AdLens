import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Info, Sparkles } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { KpiCard } from '../components/KpiCard';
import { SourceBadge } from '../components/SourceBadge';
import { TrendChart } from '../components/TrendChart';
import { DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useAdapterStatus, useDateRange, useGA4PropertyInfo, useReport } from '../hooks';
import type { GA4AiAssistantRow, GA4AiLandingPageRow } from '../types';
import { formatNumber, formatPercent } from '../utils/formatters';

export const AITrafficPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeProject } = useAppContext();
  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: activeProject?.domain || DEMO_PROJECT.domain,
  };
  const { compareEnabled } = useDateRange();
  const { isGA4Live } = useAdapterStatus();
  const { propertyInfo } = useGA4PropertyInfo();

  const { data, loading, error, errorCode, refetch } = useReport(async (registry, range) => {
    return registry.ga4.getAiTraffic(range);
  });

  const assistantColumns = useMemo<
    DataTableColumn<GA4AiAssistantRow & Record<string, unknown>>[]
  >(
    () => [
      {
        key: 'assistant',
        header: 'AI Assistant',
        render: (r) => (
          <span className="font-semibold text-fg">{r.assistant}</span>
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
        key: 'engagedSessions',
        header: 'Engaged Sessions',
        align: 'right',
        render: (r) => formatNumber(r.engagedSessions),
      },
      {
        key: 'keyEvents',
        header: 'Key Events',
        align: 'right',
        render: (r) => formatNumber(r.keyEvents),
      },
      {
        key: 'keyEventRate',
        header: 'Key Event Rate',
        align: 'right',
        render: (r) => formatPercent(r.keyEventRate, 1),
        csvFormat: (v) => formatPercent(Number(v), 1),
      },
      {
        key: 'shareOfAiPercent',
        header: 'Share of AI',
        align: 'right',
        render: (r) => formatPercent(r.shareOfAiPercent, 1),
        csvFormat: (v) => formatPercent(Number(v), 1),
      },
      {
        key: 'shareOfAllSessionsPercent',
        header: 'Share of All Sessions',
        align: 'right',
        render: (r) => formatPercent(r.shareOfAllSessionsPercent, 1),
        csvFormat: (v) => formatPercent(Number(v), 1),
      },
    ],
    []
  );

  const landingPageColumns = useMemo<
    DataTableColumn<GA4AiLandingPageRow & Record<string, unknown>>[]
  >(
    () => [
      {
        key: 'landingPage',
        header: 'Landing Page',
        render: (r) => (
          <span className="font-mono font-medium text-fg">
            {r.landingPage}
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
        key: 'keyEvents',
        header: 'Key Events',
        align: 'right',
        render: (r) => formatNumber(r.keyEvents),
      },
      {
        key: 'topAssistant',
        header: 'Top Assistant',
        render: (r) => (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-accent-soft text-accent-text border border-accent-line">
            <Sparkles className="w-3 h-3 shrink-0" />
            <span>{r.topAssistant || '—'}</span>
          </span>
        ),
      },
    ],
    []
  );

  const needsConnectionAction =
    errorCode === 'GA4_PERMISSION_DENIED' ||
    errorCode === 'GOOGLE_REAUTH_REQUIRED' ||
    errorCode === 'GA4_NOT_SELECTED';

  const hasNoAiSessions = !loading && !error && data && data.aiSessions === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
              AI Traffic
            </h1>
            <SourceBadge source="ga4" showMode />
          </div>
          <p className="text-xs sm:text-sm text-fg-muted">
            Sessions, landing pages, and key events referred by AI assistants to{' '}
            {isGA4Live && propertyInfo ? propertyInfo.displayName : TRACKED_SITE.domain}
          </p>
          {isGA4Live && propertyInfo && (
            <div className="flex items-center gap-1.5 text-xs text-fg-muted pt-0.5">
              <Globe className="w-3.5 h-3.5 text-accent-text shrink-0" />
              <span>Property: {propertyInfo.displayName}</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <ErrorState
          message={error}
          onRetry={refetch}
          actionLabel={needsConnectionAction ? 'Go to Connections' : undefined}
          onAction={needsConnectionAction ? () => navigate('/connections') : undefined}
        />
      )}

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="AI sessions"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.aiSessions ?? 0)}
          previousFormattedValue={formatNumber(data?.previousAiSessions ?? 0)}
          changePercent={data?.aiSessionsChangePercent ?? 0}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="AI share of all sessions"
          source="ga4"
          loading={loading}
          formattedValue={formatPercent(data?.aiSharePercent ?? 0, 1)}
          previousFormattedValue={formatPercent(data?.previousAiSharePercent ?? 0, 1)}
          changePercent={data?.aiShareChangePercent ?? 0}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Key events from AI"
          source="ga4"
          loading={loading}
          formattedValue={formatNumber(data?.aiKeyEvents ?? 0)}
          previousFormattedValue={formatNumber(data?.previousAiKeyEvents ?? 0)}
          changePercent={data?.aiKeyEventsChangePercent ?? 0}
          compareEnabled={compareEnabled}
        />
        <KpiCard
          label="Key event rate"
          source="ga4"
          loading={loading}
          formattedValue={formatPercent(data?.aiKeyEventRate ?? 0, 1)}
          previousFormattedValue={formatPercent(data?.previousAiKeyEventRate ?? 0, 1)}
          changePercent={data?.aiKeyEventRateChangePercent ?? 0}
          compareEnabled={compareEnabled}
        />
      </div>

      {hasNoAiSessions ? (
        <EmptyState
          title="No AI assistant visits in this period"
          description="No sessions with a referrer or UTM source matching the tracked AI assistant domains were recorded during this date range."
        />
      ) : (
        <>
          {/* Charts Grid: Sessions by Assistant Bar Chart & AI Sessions by Day Line Chart */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Bar chart: sessions by assistant */}
            <div className="p-5 rounded-xl border border-line bg-surface">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-fg">
                  Sessions by AI Assistant
                </h2>
                <p className="text-xs text-fg-muted mt-0.5">
                  Referred sessions grouped by matched assistant domain or UTM source
                </p>
              </div>
              {loading ? (
                <div className="h-64 rounded-lg bg-fill-2 animate-pulse" />
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data?.byAssistant ?? []}
                      layout="vertical"
                      margin={{ top: 4, right: 18, left: 16, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        horizontal={true}
                        vertical={false}
                        stroke="#e2e8f0"
                      />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickFormatter={(v) => formatNumber(Number(v))}
                      />
                      <YAxis
                        type="category"
                        dataKey="assistant"
                        width={96}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                      />
                      <Tooltip
                        formatter={(value: unknown) => [formatNumber(Number(value)), 'Sessions']}
                        contentStyle={{
                          borderRadius: '0.5rem',
                          border: '1px solid #e2e8f0',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="sessions" fill="#2563eb" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Line chart: AI sessions by day */}
            <TrendChart
              title="AI Sessions by Day"
              subtitle="Daily visits from matched AI assistants across the reporting period"
              data={(data?.byDate ?? []) as unknown as Record<string, unknown>[]}
              xKey="date"
              loading={loading}
              series={[
                {
                  key: 'sessions',
                  label: 'AI Sessions',
                  color: '#2563eb',
                  type: 'area',
                  formatter: (v) => formatNumber(v),
                },
                ...(compareEnabled
                  ? [
                      {
                        key: 'previousSessions',
                        label: 'Prev. AI Sessions',
                        color: '#94a3b8',
                        type: 'line' as const,
                        dashed: true,
                        formatter: (v: number) => formatNumber(v),
                      },
                    ]
                  : []),
              ]}
            />
          </div>

          {/* Landing Pages Table */}
          <DataTable
            title="AI Referral Landing Pages"
            subtitle="Pages receiving visits from AI assistants, with key events and top referring assistant"
            tableName="ga4_ai_landing_pages"
            columns={landingPageColumns}
            data={(data?.byLandingPage ?? []) as (GA4AiLandingPageRow & Record<string, unknown>)[]}
            rowKey={(r, i) => `${r.landingPage}_${i}`}
            loading={loading}
            defaultSortKey="sessions"
            searchPlaceholder="Search landing pages..."
          />

          {/* Assistant Breakdown Table */}
          <DataTable
            title="AI Assistant Breakdown"
            subtitle="Detailed engagement and conversion metrics by AI assistant"
            tableName="ga4_ai_assistants"
            columns={assistantColumns}
            data={(data?.byAssistant ?? []) as (GA4AiAssistantRow & Record<string, unknown>)[]}
            rowKey={(r) => r.assistant}
            loading={loading}
            defaultSortKey="sessions"
            searchPlaceholder="Search assistants..."
          />
        </>
      )}

      {/* Info Box: Note, List Version, and Tracked Assistants */}
      <div
        role="region"
        aria-label="AI Traffic Attribution Methodology"
        data-testid="ai-traffic-info-box"
        className="p-5 rounded-xl border border-line bg-surface space-y-3"
      >
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xs font-semibold text-fg">
                AI Attribution Note & Tracked Assistants
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-fill-2 text-fg-muted">
                List version: {data?.listVersion ?? '2026-10-18'}
              </span>
            </div>
            <p className="text-xs text-fg-muted leading-relaxed">
              {data?.note ??
                'AI visits without a referrer or UTM tag are counted as Direct / unknown, so real AI traffic may be higher.'}
            </p>
          </div>
        </div>

        {data?.trackedAssistants && data.trackedAssistants.length > 0 && (
          <div className="pt-2 border-t border-line">
            <div className="text-[11px] font-medium text-fg-muted mb-2">
              Tracked AI Assistants ({data.trackedAssistants.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {data.trackedAssistants.map((item) => (
                <div
                  key={item.name}
                  className="px-2.5 py-1 rounded-lg border border-line bg-fill-1 text-xs"
                >
                  <span className="font-semibold text-fg">
                    {item.name}
                  </span>
                  <span className="text-fg-subtle mx-1">·</span>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {item.domains.join(', ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
