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
  eventName: string;
  label: string;
  count: number;
  previousCount: number;
  changePercent: number;
  users: number;
  conversionRate: number;
}

export interface GA4CountryRow {
  country: string;
  code: string | null;
  sessions: number;
  users: number;
  sharePercent: number;
}

export interface GA4PropertyInfo {
  propertyId: string;
  displayName: string;
  timeZone: string | null;
  currencyCode: string | null;
}

export interface GA4AcquisitionReport {
  channels: GA4ChannelRow[];
  countries: GA4CountryRow[];
}

export type GA4TrafficBreakdownDimension =
  | 'channel'
  | 'sourceMedium'
  | 'referrer'
  | 'landingPage'
  | 'country'
  | 'device'
  | 'browser'
  | 'date';

export interface GA4TrafficBreakdownFilters {
  country?: string;
  deviceCategory?: string;
  browser?: string;
  limit?: number;
}

export interface GA4TrafficBreakdownRow {
  dimensionValue: string;
  compareDate?: string;
  sessions: number;
  previousSessions: number;
  sessionsChangePercent: number;
  activeUsers: number;
  previousActiveUsers: number;
  activeUsersChangePercent: number;
  newUsers: number;
  previousNewUsers: number;
  newUsersChangePercent: number;
  engagedSessions: number;
  previousEngagedSessions: number;
  engagedSessionsChangePercent: number;
  engagementRate: number;
  previousEngagementRate: number;
  engagementRateChangePercent: number;
  keyEvents: number;
  previousKeyEvents: number;
  keyEventsChangePercent: number;
  avgEngagementTimeSec: number;
  previousAvgEngagementTimeSec: number;
  avgEngagementTimeChangePercent: number;
  sharePercent: number;
  changePercent: number;
}

export type GA4SourceGroupName =
  | 'AI assistants'
  | 'Search'
  | 'Social'
  | 'Email'
  | 'Referral'
  | 'Paid'
  | 'Direct / unknown'
  | 'Other';

export interface GA4SourceGroupRow {
  group: GA4SourceGroupName;
  sessions: number;
  previousSessions: number;
  changePercent: number;
  engagedSessions: number;
  keyEvents: number;
  sharePercent: number;
  keyEventRate: number;
}

export interface GA4SourceGroupsReport {
  totalSessions: number;
  previousTotalSessions: number;
  groups: GA4SourceGroupRow[];
  rules: string[];
}

export interface GA4AiAssistantRow {
  assistant: string;
  sessions: number;
  activeUsers: number;
  newUsers: number;
  engagedSessions: number;
  keyEvents: number;
  keyEventRate: number;
  shareOfAiPercent: number;
  shareOfAllSessionsPercent: number;
}

export interface GA4AiLandingPageRow {
  landingPage: string;
  sessions: number;
  keyEvents: number;
  topAssistant: string;
}

export interface GA4AiDatePoint {
  date: string;
  compareDate?: string;
  sessions: number;
  previousSessions?: number;
}

export interface GA4AiTrafficReport {
  listVersion: string;
  note: string;
  trackedAssistants: { name: string; domains: string[]; aliases?: string[] }[];
  totalSessions: number;
  previousTotalSessions: number;
  aiSessions: number;
  previousAiSessions: number;
  aiSessionsChangePercent: number;
  aiSharePercent: number;
  previousAiSharePercent: number;
  aiShareChangePercent: number;
  aiKeyEvents: number;
  previousAiKeyEvents: number;
  aiKeyEventsChangePercent: number;
  aiKeyEventRate: number;
  previousAiKeyEventRate: number;
  aiKeyEventRateChangePercent: number;
  byAssistant: GA4AiAssistantRow[];
  byLandingPage: GA4AiLandingPageRow[];
  byDate: GA4AiDatePoint[];
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
  avgPosition: number | null;
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

export interface SearchConsoleSiteInfo {
  siteUrl: string;
  permissionLevel: string;
}

// ---------------- Meta Ads Types ----------------
export type MetaObjectiveLabel =
  | 'Lead Generation'
  | 'Brand Awareness'
  | 'Traffic'
  | 'Engagement'
  | 'Sales'
  | 'App Promotion'
  | 'Video Views'
  | 'Messages'
  | 'Other';

export type MetaStatusLabel =
  | 'Active'
  | 'Paused'
  | 'In Review'
  | 'Rejected'
  | 'With Issues'
  | 'Archived'
  | 'Deleted';

export type MetaFormatLabel = 'Single Image' | 'Video' | 'Carousel' | 'Dynamic' | 'Other';

export interface MetaAccountInfo {
  accountId: string;
  name: string;
  currency: string;
  timezoneName: string;
  status: string;
}

export interface MetaAdsOverview {
  accountCurrency?: string;
  spend: MetricWithComparison;
  impressions: MetricWithComparison;
  reach: MetricWithComparison;
  frequency: MetricWithComparison;
  clicks: MetricWithComparison;
  ctr: MetricWithComparison;
  cpc: MetricWithComparison;
  cpm: MetricWithComparison;
  leads: MetricWithComparison;
  cpl: MetricWithComparison;
}

export interface MetaSpendPoint {
  date: string;
  compareDate?: string;
  spend: number;
  previousSpend: number;
  clicks: number;
  leads: number;
  impressions: number;
}

export interface MetaEntityMetrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  cpl: number;
}

export interface MetaCampaignRow extends MetaEntityMetrics {
  id: string;
  name: string;
  objective: MetaObjectiveLabel;
  status: MetaStatusLabel;
}

export interface MetaAdSetRow extends MetaEntityMetrics {
  id: string;
  campaignId: string;
  campaignName: string;
  name: string;
  audience: string;
  status: MetaStatusLabel;
}

export interface MetaAdRow extends MetaEntityMetrics {
  id: string;
  adSetId: string;
  adSetName: string;
  campaignId: string;
  campaignName: string;
  name: string;
  format: MetaFormatLabel;
  status: MetaStatusLabel;
}

export interface HealthStatusResponse {
  ok: boolean;
  app: string;
  version: string;
  googleConfigured?: boolean;
  missing?: string[];
  metaConfigured?: boolean;
  metaMissing?: string[];
  firebaseConfigured?: boolean;
  firebaseMissing?: string[];
  timestamp?: string;
}

export interface PublicConfigResponse {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
  };
  providers?: string[];
}

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface UserEmailNotifications {
  weeklyReport?: boolean;
  alerts?: boolean;
  productUpdates?: boolean;
}

export type NumberFormatLocale = 'en-US' | 'en-GB' | 'en-IN' | 'de-DE' | 'fr-FR' | 'bn-BD';

export interface UserSettings {
  theme?: 'light' | 'dark' | 'system';
  defaultDateRange?:
    | 'Today'
    | 'Last 7 days'
    | 'Last 28 days'
    | 'Last 90 days'
    | 'This month'
    | 'Last month';
  compareByDefault?: boolean;
  displayCurrency?: string;
  timezone?: string;
  numberFormat?: NumberFormatLocale;
  emailNotifications?: UserEmailNotifications;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  photoPath?: string | null;
  hasCustomAvatar?: boolean;
  settings: UserSettings;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  ownerId: string;
  role: WorkspaceRole;
  plan: string;
  limits: {
    maxProjects: number;
  };
  logoURL?: string | null;
  logoPath?: string | null;
  hasLogo?: boolean;
  defaults: {
    currency: string;
    timezone: string;
  };
  members: Record<string, WorkspaceRole>;
  memberIds: string[];
}

export interface ProjectConfig {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  ga4PropertyId: string | null;
  ga4PropertyName: string | null;
  searchConsoleSite: string | null;
  metaAdAccountId: string | null;
  metaAdAccountName: string | null;
  timezone: string;
  currency: string;
  brandTerms: string[];
  hostnameFilters: string[];
  isDemo: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeResponse {
  user: UserProfile;
  workspaces: WorkspaceSummary[];
  projects: ProjectConfig[];
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
    configured?: boolean;
    missing?: string[];
    connected: boolean;
    adAccountId?: string | null;
    notAvailable?: boolean;
    availableIn?: string;
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


