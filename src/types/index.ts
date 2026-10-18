export type DatePreset =
  | 'Today'
  | 'Last 7 days'
  | 'Last 28 days'
  | 'Last 90 days'
  | 'This month'
  | 'Last month'
  | 'Custom';

export interface CustomDateInput {
  startDate: string;
  endDate: string;
}

export interface ComputedDateRange {
  preset: DatePreset;
  timezone: string;
  startDate: string;
  endDate: string;
  compareStartDate: string;
  compareEndDate: string;
  dayCount: number;
  compareEnabled: boolean;
}

export type CurrencyCode = 'BDT' | 'USD';
export type ThemeMode = 'light' | 'dark';
export type DataSourceId = 'ga4' | 'search_console' | 'meta_ads';

export interface MetricWithComparison {
  value: number;
  previousValue: number;
  changePercent: number;
}

// ---------------- GA4 Types ----------------
export interface GA4Overview {
  sessions: MetricWithComparison;
  users: MetricWithComparison;
  engagedSessions: MetricWithComparison;
  engagementRate: MetricWithComparison; // percentage 0-100
  avgEngagementTimeSec: MetricWithComparison; // seconds
  conversions: MetricWithComparison;
}

export interface GA4TrafficPoint {
  date: string;
  compareDate?: string;
  sessions: number;
  previousSessions: number;
  users: number;
  previousUsers: number;
  engagedSessions: number;
  conversions: number;
}

export interface GA4ChannelRow {
  channel: string;
  sessions: number;
  users: number;
  engagedSessions: number;
  engagementRate: number;
  conversions: number;
  conversionRate: number;
  sharePercent: number;
}

export interface GA4CampaignRow {
  campaign: string;
  sourceMedium: string;
  sessions: number;
  users: number;
  engagementRate: number;
  conversions: number;
  conversionRate: number;
}

export interface GA4PageRow {
  pagePath: string;
  pageTitle: string;
  views: number;
  users: number;
  avgEngagementTimeSec: number;
  bounceRate: number;
  conversions: number;
}

export interface GA4ConversionEventRow {
  eventName: 'demo_request' | 'signup' | 'contact_form';
  label: string;
  count: number;
  previousCount: number;
  changePercent: number;
  users: number;
  conversionRate: number;
}

export interface GA4CountryRow {
  country: string;
  code: string;
  sessions: number;
  users: number;
  sharePercent: number;
}

export interface GA4AcquisitionReport {
  channels: GA4ChannelRow[];
  countries: GA4CountryRow[];
}

// ---------------- Search Console Types ----------------
export interface SearchConsoleOverview {
  clicks: MetricWithComparison;
  impressions: MetricWithComparison;
  ctr: MetricWithComparison; // percentage 0-100
  avgPosition: MetricWithComparison; // lower is better
}

export interface SearchConsolePerformancePoint {
  date: string;
  compareDate?: string;
  clicks: number;
  previousClicks: number;
  impressions: number;
  previousImpressions: number;
  ctr: number;
  avgPosition: number;
}

export interface SearchConsoleQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
  changePercent: number;
}

export interface SearchConsolePageRow {
  pageUrl: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
}

export interface SearchConsoleCountryRow {
  country: string;
  code: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
}

export interface SearchConsoleDeviceRow {
  device: 'Desktop' | 'Mobile' | 'Tablet';
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
  sharePercent: number;
}

// ---------------- Meta Ads Types ----------------
export interface MetaAdsOverview {
  spendUsd: MetricWithComparison;
  impressions: MetricWithComparison;
  reach: MetricWithComparison;
  frequency: MetricWithComparison;
  clicks: MetricWithComparison;
  ctr: MetricWithComparison;
  cpcUsd: MetricWithComparison;
  cpmUsd: MetricWithComparison;
  leads: MetricWithComparison;
  cplUsd: MetricWithComparison;
}

export interface MetaSpendPoint {
  date: string;
  compareDate?: string;
  spendUsd: number;
  previousSpendUsd: number;
  clicks: number;
  leads: number;
  impressions: number;
}

export interface MetaEntityMetrics {
  spendUsd: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  ctr: number;
  cpcUsd: number;
  cpmUsd: number;
  leads: number;
  cplUsd: number;
}

export interface MetaCampaignRow extends MetaEntityMetrics {
  id: string;
  name: string;
  objective: 'Lead Generation' | 'Brand Awareness' | 'Retargeting';
  status: 'Active' | 'Paused';
}

export interface MetaAdSetRow extends MetaEntityMetrics {
  id: string;
  campaignId: string;
  campaignName: string;
  name: string;
  audience: string;
  status: 'Active' | 'Paused';
}

export interface MetaAdRow extends MetaEntityMetrics {
  id: string;
  adSetId: string;
  adSetName: string;
  campaignId: string;
  campaignName: string;
  name: string;
  format: 'Single Image' | 'Video' | 'Carousel';
  status: 'Active' | 'Paused';
}

export interface HealthStatusResponse {
  ok: boolean;
  app: string;
  version: string;
  googleConfigured?: boolean;
  missing?: string[];
  timestamp?: string;
}

export interface GA4SelectedProperty {
  id: string;
  name: string;
}

export interface SearchConsoleSelectedSite {
  url: string;
}

export interface ConnectionsResponse {
  google: {
    configured: boolean;
    missing?: string[];
    connected: boolean;
    email: string | null;
    ga4Property: GA4SelectedProperty | null;
    searchConsoleSite: SearchConsoleSelectedSite | null;
  };
  meta: {
    connected: boolean;
    availableIn: string;
  };
}

export interface GA4PropertyOption {
  accountName: string;
  propertyId: string;
  propertyName: string;
}

export interface SearchConsoleSiteOption {
  siteUrl: string;
  permissionLevel: string;
}

