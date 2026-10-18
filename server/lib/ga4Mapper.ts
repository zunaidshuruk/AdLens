import type {
  GA4AcquisitionReport,
  GA4AiDatePoint,
  GA4AiTrafficReport,
  GA4CampaignRow,
  GA4ChannelRow,
  GA4ConversionEventRow,
  GA4CountryRow,
  GA4Overview,
  GA4PageRow,
  GA4SourceGroupRow,
  GA4SourceGroupsReport,
  GA4TrafficBreakdownDimension,
  GA4TrafficBreakdownRow,
  GA4TrafficPoint,
} from '../../src/types/index.js';
import { enumerateDates } from '../../src/utils/dateUtils.js';
import { calculatePercentChange } from '../../src/utils/formatters.js';
import {
  aggregateBySourceGroup,
  AI_ASSISTANTS,
  AI_DOMAIN_LIST_VERSION,
  matchAiAssistant,
  SOURCE_GROUP_RULES,
  type SourceMetricsRow,
  summarizeAiReferrals,
} from './sourceGroups.js';

export interface GA4RunReportResponse {
  dimensionHeaders?: { name?: string }[];
  metricHeaders?: { name?: string; type?: string }[];
  rows?: {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[];
  totals?: {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[];
}

function toNum(val: string | undefined): number {
  if (!val) return 0;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Converts GA4 ratio (0..1) or percentage to 0..100 with 1 decimal place.
 */
function toPercentage(val: number, decimals: number = 1): number {
  const pct = val <= 1 && val >= 0 ? val * 100 : val;
  return Number(pct.toFixed(decimals));
}

/**
 * Converts YYYYMMDD to YYYY-MM-DD
 */
export function formatGA4Date(yyyymmdd: string): string {
  const clean = yyyymmdd.trim();
  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  return clean;
}

function isPreviousRangeTag(val: string | undefined): boolean {
  return val === 'previous' || val === 'date_range_1';
}

function isCurrentRangeTag(val: string | undefined): boolean {
  return !val || val === 'current' || val === 'date_range_0';
}

/**
 * Maps GA4 runReport response for /api/ga4/overview into GA4Overview.
 * Metrics order:
 * 0: sessions
 * 1: totalUsers
 * 2: engagedSessions
 * 3: engagementRate
 * 4: userEngagementDuration
 * 5: keyEvents
 */
export function mapGA4OverviewResponse(report: GA4RunReportResponse): GA4Overview {
  const dimHeaders = report.dimensionHeaders ?? [];
  const dateRangeIdx = dimHeaders.findIndex((d) => d.name === 'dateRange');

  let curr = {
    sessions: 0,
    users: 0,
    engagedSessions: 0,
    engagementRate: 0,
    avgEngagementTimeSec: 0,
    conversions: 0,
  };

  let prev = {
    sessions: 0,
    users: 0,
    engagedSessions: 0,
    engagementRate: 0,
    avgEngagementTimeSec: 0,
    conversions: 0,
  };

  const rows = report.rows ?? [];

  for (const row of rows) {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const rangeTag = dateRangeIdx >= 0 ? dims[dateRangeIdx]?.value : 'current';

    const sessions = Math.round(toNum(mets[0]?.value));
    const users = Math.round(toNum(mets[1]?.value));
    const engagedSessions = Math.round(toNum(mets[2]?.value));
    const engagementRate = toPercentage(toNum(mets[3]?.value), 1);
    const userEngagementDuration = toNum(mets[4]?.value);
    const avgEngagementTimeSec = users > 0 ? Math.round(userEngagementDuration / users) : 0;
    const conversions = Math.round(toNum(mets[5]?.value));

    const parsed = {
      sessions,
      users,
      engagedSessions,
      engagementRate,
      avgEngagementTimeSec,
      conversions,
    };

    if (isPreviousRangeTag(rangeTag)) {
      prev = parsed;
    } else if (isCurrentRangeTag(rangeTag)) {
      curr = parsed;
    }
  }

  return {
    sessions: {
      value: curr.sessions,
      previousValue: prev.sessions,
      changePercent: calculatePercentChange(curr.sessions, prev.sessions),
    },
    users: {
      value: curr.users,
      previousValue: prev.users,
      changePercent: calculatePercentChange(curr.users, prev.users),
    },
    engagedSessions: {
      value: curr.engagedSessions,
      previousValue: prev.engagedSessions,
      changePercent: calculatePercentChange(curr.engagedSessions, prev.engagedSessions),
    },
    engagementRate: {
      value: curr.engagementRate,
      previousValue: prev.engagementRate,
      changePercent: calculatePercentChange(curr.engagementRate, prev.engagementRate),
    },
    avgEngagementTimeSec: {
      value: curr.avgEngagementTimeSec,
      previousValue: prev.avgEngagementTimeSec,
      changePercent: calculatePercentChange(curr.avgEngagementTimeSec, prev.avgEngagementTimeSec),
    },
    conversions: {
      value: curr.conversions,
      previousValue: prev.conversions,
      changePercent: calculatePercentChange(curr.conversions, prev.conversions),
    },
  };
}

/**
 * Maps GA4 runReport response for /api/ga4/traffic-over-time into GA4TrafficPoint[],
 * filling any missing days in [startDate..endDate] and [compareStartDate..compareEndDate] with zeros.
 * Dimension 0: date (YYYYMMDD)
 * Optional Dimension 1: dateRange ("current" | "previous")
 * Metrics: 0: sessions, 1: totalUsers, 2: engagedSessions, 3: keyEvents
 */
export function mapGA4TrafficOverTimeResponse(
  report: GA4RunReportResponse,
  startDate: string,
  endDate: string,
  compareStartDate?: string,
  compareEndDate?: string
): GA4TrafficPoint[] {
  const dimHeaders = report.dimensionHeaders ?? [];
  const dateIdx = Math.max(0, dimHeaders.findIndex((d) => d.name === 'date'));
  const dateRangeIdx = dimHeaders.findIndex((d) => d.name === 'dateRange');

  const currentByDate = new Map<
    string,
    { sessions: number; users: number; engagedSessions: number; conversions: number }
  >();
  const previousByDate = new Map<string, { sessions: number; users: number }>();

  for (const row of report.rows ?? []) {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const isoDate = formatGA4Date(dims[dateIdx]?.value ?? '');
    if (!isoDate) continue;

    const rangeTag = dateRangeIdx >= 0 ? dims[dateRangeIdx]?.value : 'current';
    const sessions = Math.round(toNum(mets[0]?.value));
    const users = Math.round(toNum(mets[1]?.value));
    const engagedSessions = Math.round(toNum(mets[2]?.value));
    const conversions = Math.round(toNum(mets[3]?.value));

    if (isPreviousRangeTag(rangeTag)) {
      previousByDate.set(isoDate, { sessions, users });
    } else if (isCurrentRangeTag(rangeTag)) {
      currentByDate.set(isoDate, { sessions, users, engagedSessions, conversions });
    }
  }

  const currentDates = enumerateDates(startDate, endDate);
  const compareDates =
    compareStartDate && compareEndDate ? enumerateDates(compareStartDate, compareEndDate) : [];

  return currentDates.map((date, idx) => {
    const curr = currentByDate.get(date) ?? {
      sessions: 0,
      users: 0,
      engagedSessions: 0,
      conversions: 0,
    };
    const compareDate = compareDates[idx];
    const prev = (compareDate ? previousByDate.get(compareDate) : undefined) ?? {
      sessions: 0,
      users: 0,
    };

    return {
      date,
      ...(compareDate ? { compareDate } : {}),
      sessions: curr.sessions,
      previousSessions: prev.sessions,
      users: curr.users,
      previousUsers: prev.users,
      engagedSessions: curr.engagedSessions,
      conversions: curr.conversions,
    };
  });
}

/**
 * Maps channel report and country report into GA4AcquisitionReport
 */
export function mapGA4AcquisitionResponse(
  channelsReport: GA4RunReportResponse,
  countriesReport: GA4RunReportResponse
): GA4AcquisitionReport {
  const rawChannels = (channelsReport.rows ?? []).map((row) => {
    const channel = row.dimensionValues?.[0]?.value || 'Unassigned';
    const sessions = Math.round(toNum(row.metricValues?.[0]?.value));
    const users = Math.round(toNum(row.metricValues?.[1]?.value));
    const engagedSessions = Math.round(toNum(row.metricValues?.[2]?.value));
    const engagementRate = toPercentage(toNum(row.metricValues?.[3]?.value), 1);
    const conversions = Math.round(toNum(row.metricValues?.[4]?.value));
    const conversionRate =
      sessions > 0 ? Number(((conversions / sessions) * 100).toFixed(1)) : 0;

    return {
      channel,
      sessions,
      users,
      engagedSessions,
      engagementRate,
      conversions,
      conversionRate,
    };
  });

  const totalChannelSessions = rawChannels.reduce((acc, r) => acc + r.sessions, 0);
  const channels: GA4ChannelRow[] = rawChannels
    .map((r) => ({
      ...r,
      sharePercent:
        totalChannelSessions > 0
          ? Number(((r.sessions / totalChannelSessions) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const rawCountries = (countriesReport.rows ?? []).map((row) => {
    const country = row.dimensionValues?.[0]?.value || '(not set)';
    const rawCode = row.dimensionValues?.[1]?.value || '';
    const code = rawCode && rawCode !== '(not set)' ? rawCode : null;
    const sessions = Math.round(toNum(row.metricValues?.[0]?.value));
    const users = Math.round(toNum(row.metricValues?.[1]?.value));
    return { country, code, sessions, users };
  });

  const totalCountrySessions = rawCountries.reduce((acc, r) => acc + r.sessions, 0);
  const countries: GA4CountryRow[] = rawCountries
    .map((r) => ({
      ...r,
      sharePercent:
        totalCountrySessions > 0
          ? Number(((r.sessions / totalCountrySessions) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  return { channels, countries };
}

/**
 * Maps GA4 campaigns report into GA4CampaignRow[].
 * Dimensions: 0: sessionCampaignName, 1: sessionSource, 2: sessionMedium
 * Metrics: 0: sessions, 1: totalUsers, 2: engagementRate, 3: keyEvents
 * Excludes "(not set)" and "(direct)" unless they are the only rows.
 */
export function mapGA4CampaignsResponse(report: GA4RunReportResponse): GA4CampaignRow[] {
  const allRows: GA4CampaignRow[] = (report.rows ?? []).map((row) => {
    const campaign = row.dimensionValues?.[0]?.value || '(not set)';
    const source = row.dimensionValues?.[1]?.value || '(direct)';
    const medium = row.dimensionValues?.[2]?.value || '(none)';
    const sessions = Math.round(toNum(row.metricValues?.[0]?.value));
    const users = Math.round(toNum(row.metricValues?.[1]?.value));
    const engagementRate = toPercentage(toNum(row.metricValues?.[2]?.value), 1);
    const conversions = Math.round(toNum(row.metricValues?.[3]?.value));
    const conversionRate =
      sessions > 0 ? Number(((conversions / sessions) * 100).toFixed(1)) : 0;

    return {
      campaign,
      sourceMedium: `${source} / ${medium}`,
      sessions,
      users,
      engagementRate,
      conversions,
      conversionRate,
    };
  });

  const filtered = allRows.filter((r) => {
    const lower = r.campaign.trim().toLowerCase();
    return lower !== '(not set)' && lower !== '(direct)';
  });

  const chosen = filtered.length > 0 ? filtered : allRows;
  return chosen.sort((a, b) => b.sessions - a.sessions);
}

/**
 * Maps GA4 top pages report into GA4PageRow[].
 * Dimensions: 0: pagePath, 1: pageTitle
 * Metrics: 0: screenPageViews, 1: totalUsers, 2: userEngagementDuration, 3: bounceRate, 4: keyEvents
 */
export function mapGA4TopPagesResponse(report: GA4RunReportResponse): GA4PageRow[] {
  return (report.rows ?? [])
    .slice(0, 50)
    .map((row) => {
      const pagePath = row.dimensionValues?.[0]?.value || '/';
      const pageTitle = row.dimensionValues?.[1]?.value || pagePath;
      const views = Math.round(toNum(row.metricValues?.[0]?.value));
      const users = Math.round(toNum(row.metricValues?.[1]?.value));
      const engagementDuration = toNum(row.metricValues?.[2]?.value);
      const avgEngagementTimeSec = users > 0 ? Math.round(engagementDuration / users) : 0;
      const bounceRate = toPercentage(toNum(row.metricValues?.[3]?.value), 1);
      const conversions = Math.round(toNum(row.metricValues?.[4]?.value));

      return {
        pagePath,
        pageTitle,
        views,
        users,
        avgEngagementTimeSec,
        bounceRate,
        conversions,
      };
    })
    .sort((a, b) => b.views - a.views);
}

function humanizeEventName(eventName: string): string {
  const knownLabels: Record<string, string> = {
    demo_request: 'Enterprise Demo Request',
    signup: 'Workspace Trial Signup',
    sign_up: 'Workspace Trial Signup',
    contact_form: 'Sales & Tender Inquiry Form',
    generate_lead: 'Lead Generation Submission',
    purchase: 'Subscription Purchase',
  };
  if (knownLabels[eventName]) {
    return knownLabels[eventName];
  }
  return eventName
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Maps GA4 conversions report into GA4ConversionEventRow[].
 * Dimension 0: eventName
 * Optional Dimension 1: dateRange ("current" | "previous")
 * Metrics: 0: keyEvents, 1: totalUsers, 2: sessions
 * Keeps only rows with keyEvents > 0 in the current range.
 */
export function mapGA4ConversionsResponse(report: GA4RunReportResponse): GA4ConversionEventRow[] {
  const dimHeaders = report.dimensionHeaders ?? [];
  const eventIdx = Math.max(0, dimHeaders.findIndex((d) => d.name === 'eventName'));
  const dateRangeIdx = dimHeaders.findIndex((d) => d.name === 'dateRange');

  const currentMap = new Map<
    string,
    { count: number; users: number; sessions: number }
  >();
  const previousMap = new Map<string, number>();

  for (const row of report.rows ?? []) {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const eventName = dims[eventIdx]?.value || '';
    if (!eventName) continue;

    const rangeTag = dateRangeIdx >= 0 ? dims[dateRangeIdx]?.value : 'current';
    const keyEvents = Math.round(toNum(mets[0]?.value));
    const users = Math.round(toNum(mets[1]?.value));
    const sessions = Math.round(toNum(mets[2]?.value));

    if (isPreviousRangeTag(rangeTag)) {
      previousMap.set(eventName, keyEvents);
    } else if (isCurrentRangeTag(rangeTag)) {
      currentMap.set(eventName, { count: keyEvents, users, sessions });
    }
  }

  const results: GA4ConversionEventRow[] = [];
  for (const [eventName, curr] of currentMap.entries()) {
    if (curr.count <= 0) continue;
    const previousCount = previousMap.get(eventName) ?? 0;
    const conversionRate =
      curr.sessions > 0 ? Number(((curr.count / curr.sessions) * 100).toFixed(2)) : 0;

    results.push({
      eventName,
      label: humanizeEventName(eventName),
      count: curr.count,
      previousCount,
      changePercent: calculatePercentChange(curr.count, previousCount),
      users: curr.users,
      conversionRate,
    });
  }

  return results.sort((a, b) => b.count - a.count);
}

export const AI_TRAFFIC_LIMITATION_NOTE =
  'AI visits without a referrer or UTM tag are counted as Direct / unknown, so real AI traffic may be higher.';

interface ParsedBreakdownMetrics {
  sessions: number;
  activeUsers: number;
  newUsers: number;
  engagedSessions: number;
  engagementRate: number;
  keyEvents: number;
  avgEngagementTimeSec: number;
}

const ZERO_BREAKDOWN_METRICS: ParsedBreakdownMetrics = {
  sessions: 0,
  activeUsers: 0,
  newUsers: 0,
  engagedSessions: 0,
  engagementRate: 0,
  keyEvents: 0,
  avgEngagementTimeSec: 0,
};

function parseBreakdownMetrics(
  mets: { value?: string }[] | undefined
): ParsedBreakdownMetrics {
  const sessions = Math.round(toNum(mets?.[0]?.value));
  const activeUsers = Math.round(toNum(mets?.[1]?.value));
  const newUsers = Math.round(toNum(mets?.[2]?.value));
  const engagedSessions = Math.round(toNum(mets?.[3]?.value));
  const engagementRate = toPercentage(toNum(mets?.[4]?.value), 1);
  const keyEvents = Math.round(toNum(mets?.[5]?.value));
  const userEngagementDuration = toNum(mets?.[6]?.value);
  const avgEngagementTimeSec =
    activeUsers > 0 ? Math.round(userEngagementDuration / activeUsers) : 0;

  return {
    sessions,
    activeUsers,
    newUsers,
    engagedSessions,
    engagementRate,
    keyEvents,
    avgEngagementTimeSec,
  };
}

function buildBreakdownRow(
  dimensionValue: string,
  curr: ParsedBreakdownMetrics,
  prev: ParsedBreakdownMetrics,
  totalSessions: number,
  compareDate?: string
): GA4TrafficBreakdownRow {
  const sessionsChangePercent = calculatePercentChange(curr.sessions, prev.sessions);
  return {
    dimensionValue,
    ...(compareDate ? { compareDate } : {}),
    sessions: curr.sessions,
    previousSessions: prev.sessions,
    sessionsChangePercent,
    activeUsers: curr.activeUsers,
    previousActiveUsers: prev.activeUsers,
    activeUsersChangePercent: calculatePercentChange(curr.activeUsers, prev.activeUsers),
    newUsers: curr.newUsers,
    previousNewUsers: prev.newUsers,
    newUsersChangePercent: calculatePercentChange(curr.newUsers, prev.newUsers),
    engagedSessions: curr.engagedSessions,
    previousEngagedSessions: prev.engagedSessions,
    engagedSessionsChangePercent: calculatePercentChange(
      curr.engagedSessions,
      prev.engagedSessions
    ),
    engagementRate: curr.engagementRate,
    previousEngagementRate: prev.engagementRate,
    engagementRateChangePercent: calculatePercentChange(curr.engagementRate, prev.engagementRate),
    keyEvents: curr.keyEvents,
    previousKeyEvents: prev.keyEvents,
    keyEventsChangePercent: calculatePercentChange(curr.keyEvents, prev.keyEvents),
    avgEngagementTimeSec: curr.avgEngagementTimeSec,
    previousAvgEngagementTimeSec: prev.avgEngagementTimeSec,
    avgEngagementTimeChangePercent: calculatePercentChange(
      curr.avgEngagementTimeSec,
      prev.avgEngagementTimeSec
    ),
    sharePercent:
      totalSessions > 0 ? Number(((curr.sessions / totalSessions) * 100).toFixed(1)) : 0,
    changePercent: sessionsChangePercent,
  };
}

/**
 * Maps GA4 runReport response for ga4.trafficBreakdown into GA4TrafficBreakdownRow[].
 * Metrics order:
 * 0: sessions, 1: activeUsers, 2: newUsers, 3: engagedSessions, 4: engagementRate, 5: keyEvents, 6: userEngagementDuration
 */
export function mapGA4TrafficBreakdownResponse(
  report: GA4RunReportResponse,
  dimension: GA4TrafficBreakdownDimension,
  startDate: string,
  endDate: string,
  compareStartDate?: string,
  compareEndDate?: string,
  limit: number = 50
): GA4TrafficBreakdownRow[] {
  const dimHeaders = report.dimensionHeaders ?? [];
  const dateRangeIdx = dimHeaders.findIndex((d) => d.name === 'dateRange');

  const currentMap = new Map<string, ParsedBreakdownMetrics>();
  const previousMap = new Map<string, ParsedBreakdownMetrics>();

  for (const row of report.rows ?? []) {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const rangeTag = dateRangeIdx >= 0 ? dims[dateRangeIdx]?.value : 'current';

    let dimValue = '';
    if (dimension === 'sourceMedium') {
      const source = dims[0]?.value || '(direct)';
      const medium = dims[1]?.value || '(none)';
      dimValue = `${source} / ${medium}`;
    } else if (dimension === 'date') {
      dimValue = formatGA4Date(dims[0]?.value ?? '');
    } else {
      dimValue = dims[0]?.value || '(not set)';
    }

    if (!dimValue) continue;
    const parsed = parseBreakdownMetrics(mets);

    if (isPreviousRangeTag(rangeTag)) {
      previousMap.set(dimValue, parsed);
    } else if (isCurrentRangeTag(rangeTag)) {
      currentMap.set(dimValue, parsed);
    }
  }

  if (dimension === 'date') {
    const currentDates = enumerateDates(startDate, endDate);
    const compareDates =
      compareStartDate && compareEndDate ? enumerateDates(compareStartDate, compareEndDate) : [];
    const totalCurrentSessions = currentDates.reduce(
      (sum, d) => sum + (currentMap.get(d)?.sessions ?? 0),
      0
    );

    return currentDates.map((date, idx) => {
      const curr = currentMap.get(date) ?? ZERO_BREAKDOWN_METRICS;
      const compareDate = compareDates[idx];
      const prev =
        (compareDate ? previousMap.get(compareDate) : previousMap.get(date)) ??
        ZERO_BREAKDOWN_METRICS;
      return buildBreakdownRow(date, curr, prev, totalCurrentSessions, compareDate);
    });
  }

  const allKeys = new Set<string>([...currentMap.keys()]);
  let totalCurrentSessions = 0;
  for (const m of currentMap.values()) {
    totalCurrentSessions += m.sessions;
  }

  const rows: GA4TrafficBreakdownRow[] = [];
  for (const key of allKeys) {
    const curr = currentMap.get(key) ?? ZERO_BREAKDOWN_METRICS;
    const prev = previousMap.get(key) ?? ZERO_BREAKDOWN_METRICS;
    rows.push(buildBreakdownRow(key, curr, prev, totalCurrentSessions));
  }

  return rows.sort((a, b) => b.sessions - a.sessions).slice(0, limit);
}

/**
 * Maps GA4 runReport response for ga4.sourceGroups into GA4SourceGroupsReport.
 * Dimensions: 0: sessionSource, 1: sessionMedium, 2: sessionDefaultChannelGroup, optional dateRange
 * Metrics: 0: sessions, 1: engagedSessions, 2: keyEvents
 */
export function mapGA4SourceGroupsResponse(report: GA4RunReportResponse): GA4SourceGroupsReport {
  const dimHeaders = report.dimensionHeaders ?? [];
  const dateRangeIdx = dimHeaders.findIndex((d) => d.name === 'dateRange');

  const currentRows: SourceMetricsRow[] = [];
  const previousRows: SourceMetricsRow[] = [];

  for (const row of report.rows ?? []) {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const rangeTag = dateRangeIdx >= 0 ? dims[dateRangeIdx]?.value : 'current';

    const item: SourceMetricsRow = {
      source: dims[0]?.value || '(direct)',
      medium: dims[1]?.value || '(none)',
      channelGroup: dims[2]?.value || '',
      sessions: Math.round(toNum(mets[0]?.value)),
      engagedSessions: Math.round(toNum(mets[1]?.value)),
      keyEvents: Math.round(toNum(mets[2]?.value)),
    };

    if (isPreviousRangeTag(rangeTag)) {
      previousRows.push(item);
    } else if (isCurrentRangeTag(rangeTag)) {
      currentRows.push(item);
    }
  }

  const currGroups = aggregateBySourceGroup(currentRows);
  const prevGroups = aggregateBySourceGroup(previousRows);
  const prevByGroup = new Map(prevGroups.map((g) => [g.group, g]));

  const totalSessions = currGroups.reduce((s, g) => s + g.sessions, 0);
  const previousTotalSessions = prevGroups.reduce((s, g) => s + g.sessions, 0);

  const groups: GA4SourceGroupRow[] = currGroups.map((g) => {
    const prevSessions = prevByGroup.get(g.group)?.sessions ?? 0;
    return {
      ...g,
      previousSessions: prevSessions,
      changePercent: calculatePercentChange(g.sessions, prevSessions),
    };
  });

  return {
    totalSessions,
    previousTotalSessions,
    groups,
    rules: [...SOURCE_GROUP_RULES],
  };
}

/**
 * Maps GA4 runReport responses for ga4.aiTraffic into GA4AiTrafficReport.
 * Double-checks every row with matchAiAssistant() and zero-fills byDate across [startDate..endDate].
 */
export function mapGA4AiTrafficResponse(
  pagesReport: GA4RunReportResponse,
  dateReport: GA4RunReportResponse,
  totalsReport: GA4RunReportResponse,
  startDate: string,
  endDate: string,
  compareStartDate?: string,
  compareEndDate?: string
): GA4AiTrafficReport {
  // 1. Unfiltered total sessions for current and previous periods
  const totalDimHeaders = totalsReport.dimensionHeaders ?? [];
  const totalRangeIdx = totalDimHeaders.findIndex((d) => d.name === 'dateRange');
  let currentTotalSessions = 0;
  let previousTotalSessions = 0;

  for (const row of totalsReport.rows ?? []) {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const rangeTag = totalRangeIdx >= 0 ? dims[totalRangeIdx]?.value : 'current';
    const sessions = Math.round(toNum(mets[0]?.value));
    if (isPreviousRangeTag(rangeTag)) {
      previousTotalSessions += sessions;
    } else if (isCurrentRangeTag(rangeTag)) {
      currentTotalSessions += sessions;
    }
  }

  // 2. Query (a): sessionSource + landingPage with sessions, activeUsers, newUsers, engagedSessions, keyEvents
  const pagesDimHeaders = pagesReport.dimensionHeaders ?? [];
  const pagesRangeIdx = pagesDimHeaders.findIndex((d) => d.name === 'dateRange');
  const currentPageRows: SourceMetricsRow[] = [];
  const previousPageRows: SourceMetricsRow[] = [];

  for (const row of pagesReport.rows ?? []) {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const source = dims[0]?.value || '';
    // Double-check with matchAiAssistant after GA4's regex
    if (!matchAiAssistant(source)) continue;

    const landingPage = dims[1]?.value || '/';
    const rangeTag = pagesRangeIdx >= 0 ? dims[pagesRangeIdx]?.value : 'current';

    const item: SourceMetricsRow = {
      source,
      medium: 'referral',
      landingPage,
      sessions: Math.round(toNum(mets[0]?.value)),
      activeUsers: Math.round(toNum(mets[1]?.value)),
      newUsers: Math.round(toNum(mets[2]?.value)),
      engagedSessions: Math.round(toNum(mets[3]?.value)),
      keyEvents: Math.round(toNum(mets[4]?.value)),
    };

    if (isPreviousRangeTag(rangeTag)) {
      previousPageRows.push(item);
    } else if (isCurrentRangeTag(rangeTag)) {
      currentPageRows.push(item);
    }
  }

  const currSummary = summarizeAiReferrals(currentPageRows, currentTotalSessions);
  const prevSummary = summarizeAiReferrals(previousPageRows, previousTotalSessions);

  // 3. Query (b): sessionSource + date with sessions
  const dateDimHeaders = dateReport.dimensionHeaders ?? [];
  const dateRangeIdx = dateDimHeaders.findIndex((d) => d.name === 'dateRange');
  const currentDateRows: SourceMetricsRow[] = [];
  const previousDateRows: SourceMetricsRow[] = [];

  for (const row of dateReport.rows ?? []) {
    const dims = row.dimensionValues ?? [];
    const mets = row.metricValues ?? [];
    const source = dims[0]?.value || '';
    if (!matchAiAssistant(source)) continue;

    const isoDate = formatGA4Date(dims[1]?.value ?? '');
    if (!isoDate) continue;

    const rangeTag = dateRangeIdx >= 0 ? dims[dateRangeIdx]?.value : 'current';
    const item: SourceMetricsRow = {
      source,
      medium: 'referral',
      date: isoDate,
      sessions: Math.round(toNum(mets[0]?.value)),
      engagedSessions: 0,
      keyEvents: 0,
    };

    if (isPreviousRangeTag(rangeTag)) {
      previousDateRows.push(item);
    } else if (isCurrentRangeTag(rangeTag)) {
      currentDateRows.push(item);
    }
  }

  const currDateSummary = summarizeAiReferrals(currentDateRows, currentTotalSessions);
  const prevDateSummary = summarizeAiReferrals(previousDateRows, previousTotalSessions);
  const currByDateMap = new Map(currDateSummary.byDate.map((d) => [d.date, d.sessions]));
  const prevByDateMap = new Map(prevDateSummary.byDate.map((d) => [d.date, d.sessions]));

  const currentDates = enumerateDates(startDate, endDate);
  const compareDates =
    compareStartDate && compareEndDate ? enumerateDates(compareStartDate, compareEndDate) : [];

  const byDate: GA4AiDatePoint[] = currentDates.map((date, idx) => {
    const compareDate = compareDates[idx];
    return {
      date,
      ...(compareDate ? { compareDate } : {}),
      sessions: currByDateMap.get(date) ?? 0,
      previousSessions: compareDate ? prevByDateMap.get(compareDate) ?? 0 : 0,
    };
  });

  const aiKeyEvents = currSummary.byAssistant.reduce((sum, a) => sum + a.keyEvents, 0);
  const previousAiKeyEvents = prevSummary.byAssistant.reduce((sum, a) => sum + a.keyEvents, 0);
  const aiKeyEventRate =
    currSummary.aiSessions > 0 ? Math.round((aiKeyEvents / currSummary.aiSessions) * 1000) / 10 : 0;
  const previousAiKeyEventRate =
    prevSummary.aiSessions > 0
      ? Math.round((previousAiKeyEvents / prevSummary.aiSessions) * 1000) / 10
      : 0;

  return {
    listVersion: AI_DOMAIN_LIST_VERSION,
    note: AI_TRAFFIC_LIMITATION_NOTE,
    trackedAssistants: AI_ASSISTANTS.map((a) => ({
      name: a.name,
      domains: [...a.domains],
      ...(a.aliases ? { aliases: [...a.aliases] } : {}),
    })),
    totalSessions: currSummary.totalSessions,
    previousTotalSessions: prevSummary.totalSessions,
    aiSessions: currSummary.aiSessions,
    previousAiSessions: prevSummary.aiSessions,
    aiSessionsChangePercent: calculatePercentChange(currSummary.aiSessions, prevSummary.aiSessions),
    aiSharePercent: currSummary.aiSharePercent,
    previousAiSharePercent: prevSummary.aiSharePercent,
    aiShareChangePercent: calculatePercentChange(
      currSummary.aiSharePercent,
      prevSummary.aiSharePercent
    ),
    aiKeyEvents,
    previousAiKeyEvents,
    aiKeyEventsChangePercent: calculatePercentChange(aiKeyEvents, previousAiKeyEvents),
    aiKeyEventRate,
    previousAiKeyEventRate,
    aiKeyEventRateChangePercent: calculatePercentChange(aiKeyEventRate, previousAiKeyEventRate),
    byAssistant: currSummary.byAssistant,
    byLandingPage: currSummary.byLandingPage,
    byDate,
  };
}

