/** Shapes returned by the Sprint 11 and 12 reports (server/reports/intelligenceReports.ts). */

export interface Period {
  startDate: string;
  endDate: string;
}

export interface TrendItem {
  key: string;
  status: 'rising' | 'falling' | 'new' | 'lost';
  current: number;
  previous: number;
  change: number;
  changePercent: number | null;
}
export interface TrendResult {
  rules: string[];
  rising: TrendItem[];
  falling: TrendItem[];
  new: TrendItem[];
  lost: TrendItem[];
}
export interface TrendsReport {
  period: Period;
  comparedWith: Period;
  queries: TrendResult;
  pages: TrendResult;
}

export interface Opportunity {
  query: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  typicalCtr: number;
  estimatedExtraClicks: number;
}
export interface OpportunitiesReport {
  period: Period;
  rules: string[];
  opportunities: Opportunity[];
}

export interface CannibalisedQuery {
  query: string;
  totalImpressions: number;
  totalClicks: number;
  pages: { page: string; impressions: number; clicks: number; position: number; sharePercent: number }[];
}
export interface CannibalisationReport {
  period: Period;
  rules: string[];
  queries: CannibalisedQuery[];
}

export interface TopicsReport {
  period: Period;
  ignoredBrandWords: string[];
  topics: { topic: string; queries: string[]; clicks: number; impressions: number }[];
}

export interface HostRow {
  host: string;
  sessions: number;
  activeUsers: number;
  keyEvents: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  sitemaps: { path: string; errors?: number; warnings?: number }[];
  flags: ('traffic_without_sitemap' | 'sitemap_without_traffic' | 'sitemap_errors')[];
}
export interface HostBreakdownReport {
  period: Period;
  hosts: HostRow[];
  totals: { sessions: number; activeUsers: number; keyEvents: number; clicks: number; impressions: number };
  excludedHosts: string[];
  notes: string[];
}

export interface SitemapsReport {
  sitemaps: { path: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; warnings?: number; errors?: number; submittedUrls?: number }[];
}

export type PageFlag = 'search_only' | 'analytics_only' | 'seen_not_clicked';
export interface PageRow {
  path: string;
  title: string | null;
  views: number | null;
  users: number | null;
  avgEngagementSeconds: number | null;
  keyEvents: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  flags: PageFlag[];
}
export interface PagesReport {
  period: Period;
  rows: PageRow[];
  notes: string[];
}

export interface PageDetailReport {
  path: string;
  period: Period;
  analytics: {
    views: number;
    users: number;
    avgEngagementSeconds: number;
    keyEvents: number;
    bounceRate: number;
    daily: { date: string; views: number; users: number }[];
    sources: { sourceMedium: string; sessions: number; keyEvents: number }[];
  } | null;
  search: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
    queries: { query: string; clicks: number; impressions: number; position: number }[];
  } | null;
  notes: string[];
}

export interface Ga4OverviewMetric {
  value: number;
  previousValue?: number;
  changePercent?: number;
}
export interface SnapshotReport {
  period: Period;
  comparedWith: Period;
  analytics: {
    sessions: Ga4OverviewMetric;
    users: Ga4OverviewMetric;
    engagedSessions: Ga4OverviewMetric;
    engagementRate: Ga4OverviewMetric;
    conversions: Ga4OverviewMetric;
  } | null;
  search: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
    previous: { clicks: number; impressions: number; ctr: number; position: number | null };
    topQueries: { query?: string; clicks: number; impressions: number; position: number }[];
    topPages: { page?: string; clicks: number; impressions: number; position: number }[];
  } | null;
  insights: { opportunityCount: number; estimatedExtraClicks: number; cannibalisedQueryCount: number } | null;
  unavailable: { source: string; reason: string }[];
}

export interface CampaignJoinRow {
  metaCampaignId: string;
  metaCampaignName: string;
  matchType: 'id' | 'exact' | 'likely' | 'none';
  matchedGa4Campaigns: string[];
  spend: number;
  clicks: number;
  leads: number;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  landingRate: number | null;
  costPerSession: number | null;
  costPerEngagedSession: number | null;
  costPerKeyEvent: number | null;
  flags: ('no_utm_traffic' | 'low_landing_rate' | 'source_not_meta' | 'likely_match_only')[];
}
export interface CrossChannelReport {
  period: Period;
  currency: string | null;
  rows: CampaignJoinRow[];
  unmatchedGa4MetaCampaigns: { campaign: string; sessions: number; keyEvents: number }[];
  totals: {
    spend: number;
    sessions: number;
    engagedSessions: number;
    keyEvents: number;
    costPerEngagedSession: number | null;
    costPerKeyEvent: number | null;
    spendWithoutTracking: number;
  };
  rules: string[];
}
