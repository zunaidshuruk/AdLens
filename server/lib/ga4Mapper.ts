import type {
  GA4AcquisitionReport,
  GA4CampaignRow,
  GA4ChannelRow,
  GA4ConversionEventRow,
  GA4CountryRow,
  GA4Overview,
  GA4PageRow,
  GA4TrafficPoint,
} from '../../src/types/index.ts';
import { enumerateDates } from '../../src/utils/dateUtils.ts';
import { calculatePercentChange } from '../../src/utils/formatters.ts';

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
