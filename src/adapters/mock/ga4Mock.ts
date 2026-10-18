import {
  aggregateBySourceGroup,
  AI_ASSISTANTS,
  AI_DOMAIN_LIST_VERSION,
  SOURCE_GROUP_RULES,
  type SourceMetricsRow,
  summarizeAiReferrals,
} from '../../../server/lib/sourceGroups.js';
import { TRACKED_SITE } from '../../config/app.js';
import type {
  ComputedDateRange,
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
  GA4TrafficBreakdownFilters,
  GA4TrafficBreakdownRow,
  GA4TrafficPoint,
} from '../../types/index.js';
import { enumerateDates } from '../../utils/dateUtils.js';
import { calculatePercentChange } from '../../utils/formatters.js';
import type { GA4Adapter } from '../ga4.js';
import { dayOfWeekFactor, seededVariance, SHARED_CAMPAIGNS, simulateLatency } from './seed.js';

const AI_TRAFFIC_NOTE =
  'AI visits without a referrer or UTM tag are counted as Direct / unknown, so real AI traffic may be higher.';

function computeDailyGA4(dateStr: string) {
  const dow = dayOfWeekFactor(dateStr);
  const vSessions = seededVariance(`ga4_sess_${dateStr}`, 0.16);
  const sessions = Math.round(1420 * dow * vSessions);
  const userRatio = 0.76 + (seededVariance(`ga4_ur_${dateStr}`, 0.04) - 1);
  const users = Math.round(sessions * userRatio);
  const engRate = 0.64 + (seededVariance(`ga4_er_${dateStr}`, 0.05) - 1);
  const engagedSessions = Math.round(sessions * engRate);
  const avgEngagementTimeSec = Math.round(158 * seededVariance(`ga4_et_${dateStr}`, 0.1));
  const conversions = Math.max(
    4,
    Math.round(sessions * 0.036 * seededVariance(`ga4_cv_${dateStr}`, 0.18))
  );

  return {
    sessions,
    users,
    engagedSessions,
    avgEngagementTimeSec,
    conversions,
  };
}

function aggregateGA4Range(startDate: string, endDate: string) {
  const dates = enumerateDates(startDate, endDate);
  let sessions = 0;
  let users = 0;
  let engagedSessions = 0;
  let weightedEngagementSec = 0;
  let conversions = 0;

  for (const d of dates) {
    const day = computeDailyGA4(d);
    sessions += day.sessions;
    users += day.users;
    engagedSessions += day.engagedSessions;
    weightedEngagementSec += day.avgEngagementTimeSec * day.sessions;
    conversions += day.conversions;
  }

  const engagementRate =
    sessions > 0 ? Number(((engagedSessions / sessions) * 100).toFixed(1)) : 0;
  const avgEngagementTimeSec = sessions > 0 ? Math.round(weightedEngagementSec / sessions) : 0;

  return {
    sessions,
    users,
    engagedSessions,
    engagementRate,
    avgEngagementTimeSec,
    conversions,
  };
}

interface MockSourceBlueprint {
  source: string;
  medium: string;
  channelGroup: string;
  weight: number;
  er: number;
  cr: number;
  avgSec: number;
}

const SOURCE_BLUEPRINTS: MockSourceBlueprint[] = [
  // Search (~34.5%)
  { source: 'google', medium: 'organic', channelGroup: 'Organic Search', weight: 0.305, er: 69.2, cr: 4.1, avgSec: 174 },
  { source: 'bing', medium: 'organic', channelGroup: 'Organic Search', weight: 0.028, er: 66.5, cr: 3.7, avgSec: 162 },
  { source: 'duckduckgo', medium: 'organic', channelGroup: 'Organic Search', weight: 0.012, er: 67.8, cr: 3.9, avgSec: 168 },
  // Paid (~28.0% — includes paid Meta traffic with utm_medium paid_social & cpc)
  { source: 'meta', medium: 'paid_social', channelGroup: 'Paid Social', weight: 0.215, er: 61.4, cr: 4.7, avgSec: 146 },
  { source: 'google', medium: 'cpc', channelGroup: 'Paid Search', weight: 0.065, er: 64.0, cr: 5.1, avgSec: 159 },
  // Direct / unknown (~16.5%)
  { source: '(direct)', medium: '(none)', channelGroup: 'Direct', weight: 0.165, er: 65.8, cr: 3.2, avgSec: 152 },
  // Referral (~7.6%)
  { source: 'prothomalo.com', medium: 'referral', channelGroup: 'Referral', weight: 0.032, er: 71.0, cr: 3.8, avgSec: 185 },
  { source: 'thedailystar.net', medium: 'referral', channelGroup: 'Referral', weight: 0.026, er: 69.5, cr: 3.6, avgSec: 179 },
  { source: 'g2.com', medium: 'referral', channelGroup: 'Referral', weight: 0.018, er: 74.2, cr: 5.2, avgSec: 204 },
  // Social (~5.2%)
  { source: 'linkedin.com', medium: 'social', channelGroup: 'Organic Social', weight: 0.034, er: 68.1, cr: 4.3, avgSec: 171 },
  { source: 'facebook.com', medium: 'social', channelGroup: 'Organic Social', weight: 0.018, er: 59.4, cr: 2.9, avgSec: 138 },
  // Email (~4.6%)
  { source: 'newsletter', medium: 'email', channelGroup: 'Email', weight: 0.046, er: 74.5, cr: 5.4, avgSec: 196 },
  // AI assistants (~2.6% total, well within 1–4% share)
  { source: 'chatgpt.com', medium: 'referral', channelGroup: 'Referral', weight: 0.0115, er: 76.4, cr: 6.2, avgSec: 218 },
  { source: 'perplexity.ai', medium: 'referral', channelGroup: 'Referral', weight: 0.0058, er: 78.1, cr: 6.8, avgSec: 229 },
  { source: 'gemini.google.com', medium: 'referral', channelGroup: 'Referral', weight: 0.0042, er: 73.8, cr: 5.6, avgSec: 205 },
  { source: 'claude.ai', medium: 'referral', channelGroup: 'Referral', weight: 0.0028, er: 79.0, cr: 6.5, avgSec: 234 },
  { source: 'copilot.microsoft.com', medium: 'referral', channelGroup: 'Referral', weight: 0.0017, er: 72.5, cr: 5.4, avgSec: 198 },
  // Other (~1.0%)
  { source: 'partner_portal', medium: 'affiliate_partner', channelGroup: 'Unassigned', weight: 0.01, er: 63.0, cr: 3.5, avgSec: 150 },
];

const AI_LANDING_PAGE_SHARES = [
  { landingPage: '/', weight: 0.34 },
  { landingPage: '/enterprise-security', weight: 0.24 },
  { landingPage: '/compare/zoom-alternative-bangladesh', weight: 0.18 },
  { landingPage: '/pricing', weight: 0.14 },
  { landingPage: '/request-demo', weight: 0.1 },
];

function buildSeededSourceMetricsRows(startDate: string, endDate: string): {
  totalSessions: number;
  rows: (SourceMetricsRow & { avgSec: number })[];
} {
  const totals = aggregateGA4Range(startDate, endDate);
  const rawWeights = SOURCE_BLUEPRINTS.map((b) => {
    const v = seededVariance(`ga4_src_${b.source}_${b.medium}_${startDate}_${endDate}`, 0.06);
    return b.weight * v;
  });
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);

  let allocatedSessions = 0;
  const rows = SOURCE_BLUEPRINTS.map((b, idx) => {
    const normalizedShare = weightSum > 0 ? rawWeights[idx] / weightSum : b.weight;
    const sessions = Math.max(1, Math.round(totals.sessions * normalizedShare));
    allocatedSessions += sessions;
    const activeUsers = Math.max(1, Math.round(sessions * 0.79));
    const newUsers = Math.max(1, Math.round(activeUsers * 0.68));
    const engagedSessions = Math.min(sessions, Math.round((sessions * b.er) / 100));
    const keyEvents = Math.max(0, Math.round((sessions * b.cr) / 100));

    return {
      source: b.source,
      medium: b.medium,
      channelGroup: b.channelGroup,
      sessions,
      activeUsers,
      newUsers,
      engagedSessions,
      keyEvents,
      avgSec: b.avgSec,
    };
  });

  // Adjust the largest bucket (google / organic) so sum of sessions === totals.sessions exactly
  const diff = totals.sessions - allocatedSessions;
  if (rows.length > 0 && diff !== 0) {
    rows[0].sessions = Math.max(1, rows[0].sessions + diff);
    rows[0].activeUsers = Math.max(1, Math.round(rows[0].sessions * 0.79));
    rows[0].newUsers = Math.max(1, Math.round(rows[0].activeUsers * 0.68));
    rows[0].engagedSessions = Math.min(
      rows[0].sessions,
      Math.round((rows[0].sessions * SOURCE_BLUEPRINTS[0].er) / 100)
    );
  }

  return { totalSessions: totals.sessions, rows };
}

function computeFilterMultiplier(filters?: GA4TrafficBreakdownFilters): number {
  let mult = 1;
  if (filters?.country) {
    const c = filters.country.toLowerCase();
    if (c === 'bangladesh') mult *= 0.61;
    else if (c === 'singapore') mult *= 0.11;
    else if (c === 'united arab emirates') mult *= 0.09;
    else if (c === 'united states') mult *= 0.08;
    else if (c === 'united kingdom') mult *= 0.06;
    else mult *= 0.05;
  }
  if (filters?.deviceCategory) {
    const d = filters.deviceCategory.toLowerCase();
    if (d === 'desktop') mult *= 0.58;
    else if (d === 'mobile') mult *= 0.39;
    else if (d === 'tablet') mult *= 0.03;
    else mult *= 0.1;
  }
  if (filters?.browser) {
    const b = filters.browser.toLowerCase();
    if (b === 'chrome') mult *= 0.66;
    else if (b === 'safari') mult *= 0.19;
    else if (b === 'edge') mult *= 0.08;
    else if (b === 'firefox') mult *= 0.05;
    else mult *= 0.02;
  }
  return mult;
}

export const mockGA4Adapter: GA4Adapter = {
  id: 'ga4',
  name: 'Google Analytics 4',
  isMock: true,

  async isConnected(): Promise<boolean> {
    return false;
  },

  async getOverview(range: ComputedDateRange): Promise<GA4Overview> {
    await simulateLatency(`ga4_overview_${range.startDate}_${range.endDate}`);
    const curr = aggregateGA4Range(range.startDate, range.endDate);
    const prev = aggregateGA4Range(range.compareStartDate, range.compareEndDate);

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
        changePercent: calculatePercentChange(
          curr.avgEngagementTimeSec,
          prev.avgEngagementTimeSec
        ),
      },
      conversions: {
        value: curr.conversions,
        previousValue: prev.conversions,
        changePercent: calculatePercentChange(curr.conversions, prev.conversions),
      },
    };
  },

  async getTrafficOverTime(range: ComputedDateRange): Promise<GA4TrafficPoint[]> {
    await simulateLatency(`ga4_traffic_${range.startDate}_${range.endDate}`);
    const currDates = enumerateDates(range.startDate, range.endDate);
    const prevDates = enumerateDates(range.compareStartDate, range.compareEndDate);

    return currDates.map((date, idx) => {
      const curr = computeDailyGA4(date);
      const compareDate = prevDates[idx] ?? prevDates[0];
      const prev = computeDailyGA4(compareDate);

      return {
        date,
        compareDate,
        sessions: curr.sessions,
        previousSessions: prev.sessions,
        users: curr.users,
        previousUsers: prev.users,
        engagedSessions: curr.engagedSessions,
        conversions: curr.conversions,
      };
    });
  },

  async getAcquisition(range: ComputedDateRange): Promise<GA4AcquisitionReport> {
    await simulateLatency(`ga4_acq_${range.startDate}_${range.endDate}`);
    const totals = aggregateGA4Range(range.startDate, range.endDate);

    const channelDefs = [
      { channel: 'Organic Search', weight: 0.36, er: 68.4, cr: 4.1 },
      { channel: 'Paid Social', weight: 0.28, er: 61.2, cr: 4.6 },
      { channel: 'Direct', weight: 0.18, er: 65.8, cr: 3.2 },
      { channel: 'Referral', weight: 0.11, er: 70.1, cr: 3.9 },
      { channel: 'Email', weight: 0.07, er: 74.5, cr: 5.4 },
    ];

    const channels: GA4ChannelRow[] = channelDefs.map((def) => {
      const v = seededVariance(`ga4_ch_${def.channel}_${range.startDate}`, 0.06);
      const sessions = Math.round(totals.sessions * def.weight * v);
      const users = Math.round(sessions * 0.78);
      const engagementRate = Number(
        (def.er * seededVariance(`er_${def.channel}_${range.endDate}`, 0.03)).toFixed(1)
      );
      const engagedSessions = Math.round((sessions * engagementRate) / 100);
      const conversionRate = Number(
        (def.cr * seededVariance(`cr_${def.channel}_${range.endDate}`, 0.05)).toFixed(1)
      );
      const conversions = Math.max(1, Math.round((sessions * conversionRate) / 100));
      const sharePercent = Number(((sessions / Math.max(1, totals.sessions)) * 100).toFixed(1));

      return {
        channel: def.channel,
        sessions,
        users,
        engagedSessions,
        engagementRate,
        conversions,
        conversionRate,
        sharePercent,
      };
    });

    const countryDefs = [
      { country: 'Bangladesh', code: 'BD', weight: 0.61 },
      { country: 'Singapore', code: 'SG', weight: 0.11 },
      { country: 'United Arab Emirates', code: 'AE', weight: 0.09 },
      { country: 'United States', code: 'US', weight: 0.08 },
      { country: 'United Kingdom', code: 'GB', weight: 0.06 },
      { country: 'Malaysia', code: 'MY', weight: 0.05 },
    ];

    const countries: GA4CountryRow[] = countryDefs.map((c) => {
      const sessions = Math.round(
        totals.sessions * c.weight * seededVariance(`ga4_cty_${c.code}_${range.startDate}`, 0.04)
      );
      const users = Math.round(sessions * 0.79);
      const sharePercent = Number(((sessions / Math.max(1, totals.sessions)) * 100).toFixed(1));
      return {
        country: c.country,
        code: c.code,
        sessions,
        users,
        sharePercent,
      };
    });

    return { channels, countries };
  },

  async getCampaigns(range: ComputedDateRange): Promise<GA4CampaignRow[]> {
    await simulateLatency(`ga4_camp_${range.startDate}_${range.endDate}`);
    const days = range.dayCount;

    return SHARED_CAMPAIGNS.map((camp) => {
      const v = seededVariance(`ga4_utm_${camp.id}_${range.startDate}_${range.endDate}`, 0.12);
      const dailyClicksEst = (camp.dailyBaseSpendUsd / 0.36) * (camp.ctrBase / 2.1);
      const sessions = Math.max(12, Math.round(dailyClicksEst * days * 0.88 * v));
      const users = Math.round(sessions * 0.81);
      const engagementRate = Number(
        (60 + seededVariance(`ga4_utm_er_${camp.id}_${range.endDate}`, 0.12) * 8).toFixed(1)
      );
      const conversionRate = Number(
        (
          camp.conversionRateBase *
          seededVariance(`ga4_utm_cr_${camp.id}_${range.startDate}`, 0.08)
        ).toFixed(1)
      );
      const conversions = Math.max(1, Math.round((sessions * conversionRate) / 100));

      return {
        campaign: camp.utmCampaign,
        sourceMedium: 'meta / paid_social',
        sessions,
        users,
        engagementRate,
        conversions,
        conversionRate,
      };
    }).sort((a, b) => b.sessions - a.sessions);
  },

  async getTopPages(range: ComputedDateRange): Promise<GA4PageRow[]> {
    await simulateLatency(`ga4_pages_${range.startDate}_${range.endDate}`);
    const totals = aggregateGA4Range(range.startDate, range.endDate);

    const pageBlueprints = [
      {
        pagePath: '/',
        pageTitle: `${TRACKED_SITE.name} — Enterprise & Gov Video Conferencing`,
        share: 0.31,
        avgSec: 142,
        bounce: 31.4,
        convShare: 0.24,
      },
      {
        pagePath: '/enterprise-security',
        pageTitle: `End-to-End Encrypted Meetings | ${TRACKED_SITE.name}`,
        share: 0.19,
        avgSec: 214,
        bounce: 24.8,
        convShare: 0.22,
      },
      {
        pagePath: '/pricing',
        pageTitle: `Plans & On-Premise Licensing — ${TRACKED_SITE.domain}`,
        share: 0.16,
        avgSec: 188,
        bounce: 27.2,
        convShare: 0.28,
      },
      {
        pagePath: '/request-demo',
        pageTitle: `Schedule an Enterprise Demo | ${TRACKED_SITE.name}`,
        share: 0.13,
        avgSec: 165,
        bounce: 21.5,
        convShare: 0.16,
      },
      {
        pagePath: '/solutions/government-banking',
        pageTitle: `Sovereign Cloud Video Platform for Government & Banking`,
        share: 0.12,
        avgSec: 232,
        bounce: 26.1,
        convShare: 0.06,
      },
      {
        pagePath: '/compare/zoom-alternative-bangladesh',
        pageTitle: `Why Leading Organizations Choose ${TRACKED_SITE.name} Over Zoom`,
        share: 0.09,
        avgSec: 196,
        bounce: 29.7,
        convShare: 0.04,
      },
    ];

    return pageBlueprints.map((p) => {
      const v = seededVariance(`ga4_pg_${p.pagePath}_${range.startDate}`, 0.08);
      const views = Math.round(totals.sessions * 1.45 * p.share * v);
      const users = Math.round(views * 0.71);
      const avgEngagementTimeSec = Math.round(
        p.avgSec * seededVariance(`ga4_pg_t_${p.pagePath}_${range.endDate}`, 0.06)
      );
      const bounceRate = Number(
        (p.bounce * seededVariance(`ga4_pg_b_${p.pagePath}_${range.endDate}`, 0.05)).toFixed(1)
      );
      const conversions = Math.max(1, Math.round(totals.conversions * p.convShare * v));

      return {
        pagePath: p.pagePath,
        pageTitle: p.pageTitle,
        views,
        users,
        avgEngagementTimeSec,
        bounceRate,
        conversions,
      };
    });
  },

  async getConversions(range: ComputedDateRange): Promise<GA4ConversionEventRow[]> {
    await simulateLatency(`ga4_conv_${range.startDate}_${range.endDate}`);
    const curr = aggregateGA4Range(range.startDate, range.endDate);
    const prev = aggregateGA4Range(range.compareStartDate, range.compareEndDate);

    const events: {
      eventName: 'demo_request' | 'signup' | 'contact_form';
      label: string;
      share: number;
    }[] = [
      { eventName: 'demo_request', label: 'Enterprise Demo Request', share: 0.42 },
      { eventName: 'signup', label: 'Workspace Trial Signup', share: 0.36 },
      { eventName: 'contact_form', label: 'Sales & Tender Inquiry Form', share: 0.22 },
    ];

    return events.map((ev) => {
      const vCurr = seededVariance(`ga4_ev_${ev.eventName}_${range.startDate}`, 0.07);
      const vPrev = seededVariance(`ga4_ev_${ev.eventName}_${range.compareStartDate}`, 0.07);
      const count = Math.max(2, Math.round(curr.conversions * ev.share * vCurr));
      const previousCount = Math.max(2, Math.round(prev.conversions * ev.share * vPrev));
      const users = Math.max(1, Math.round(count * 0.91));
      const conversionRate = Number(((count / Math.max(1, curr.sessions)) * 100).toFixed(2));

      return {
        eventName: ev.eventName,
        label: ev.label,
        count,
        previousCount,
        changePercent: calculatePercentChange(count, previousCount),
        users,
        conversionRate,
      };
    });
  },

  async getTrafficBreakdown(
    range: ComputedDateRange,
    dimension: GA4TrafficBreakdownDimension,
    filters?: GA4TrafficBreakdownFilters
  ): Promise<GA4TrafficBreakdownRow[]> {
    await simulateLatency(`ga4_tb_${dimension}_${range.startDate}_${range.endDate}`);
    const filterMult = computeFilterMultiplier(filters);
    const limit = filters?.limit ?? 50;

    if (dimension === 'date') {
      const currDates = enumerateDates(range.startDate, range.endDate);
      const prevDates = enumerateDates(range.compareStartDate, range.compareEndDate);
      const dailyPoints = currDates.map((date, idx) => {
        const cDay = computeDailyGA4(date);
        const compareDate = prevDates[idx] ?? prevDates[0];
        const pDay = computeDailyGA4(compareDate);
        return { date, compareDate, cDay, pDay };
      });
      const totalSessions = dailyPoints.reduce(
        (s, d) => s + Math.max(1, Math.round(d.cDay.sessions * filterMult)),
        0
      );

      return dailyPoints.map(({ date, compareDate, cDay, pDay }) => {
        const sessions = Math.max(1, Math.round(cDay.sessions * filterMult));
        const previousSessions = Math.max(1, Math.round(pDay.sessions * filterMult));
        const activeUsers = Math.max(1, Math.round(cDay.users * filterMult));
        const previousActiveUsers = Math.max(1, Math.round(pDay.users * filterMult));
        const newUsers = Math.max(1, Math.round(activeUsers * 0.68));
        const previousNewUsers = Math.max(1, Math.round(previousActiveUsers * 0.68));
        const engagedSessions = Math.max(1, Math.round(cDay.engagedSessions * filterMult));
        const previousEngagedSessions = Math.max(1, Math.round(pDay.engagedSessions * filterMult));
        const engagementRate = Number(((engagedSessions / sessions) * 100).toFixed(1));
        const previousEngagementRate = Number(
          ((previousEngagedSessions / previousSessions) * 100).toFixed(1)
        );
        const keyEvents = Math.max(0, Math.round(cDay.conversions * filterMult));
        const previousKeyEvents = Math.max(0, Math.round(pDay.conversions * filterMult));
        const sessionsChangePercent = calculatePercentChange(sessions, previousSessions);

        return {
          dimensionValue: date,
          compareDate,
          sessions,
          previousSessions,
          sessionsChangePercent,
          activeUsers,
          previousActiveUsers,
          activeUsersChangePercent: calculatePercentChange(activeUsers, previousActiveUsers),
          newUsers,
          previousNewUsers,
          newUsersChangePercent: calculatePercentChange(newUsers, previousNewUsers),
          engagedSessions,
          previousEngagedSessions,
          engagedSessionsChangePercent: calculatePercentChange(
            engagedSessions,
            previousEngagedSessions
          ),
          engagementRate,
          previousEngagementRate,
          engagementRateChangePercent: calculatePercentChange(
            engagementRate,
            previousEngagementRate
          ),
          keyEvents,
          previousKeyEvents,
          keyEventsChangePercent: calculatePercentChange(keyEvents, previousKeyEvents),
          avgEngagementTimeSec: cDay.avgEngagementTimeSec,
          previousAvgEngagementTimeSec: pDay.avgEngagementTimeSec,
          avgEngagementTimeChangePercent: calculatePercentChange(
            cDay.avgEngagementTimeSec,
            pDay.avgEngagementTimeSec
          ),
          sharePercent: Number(((sessions / Math.max(1, totalSessions)) * 100).toFixed(1)),
          changePercent: sessionsChangePercent,
        };
      });
    }

    const currTotals = aggregateGA4Range(range.startDate, range.endDate);
    const prevTotals = aggregateGA4Range(range.compareStartDate, range.compareEndDate);

    interface SpecItem {
      value: string;
      weight: number;
      er: number;
      cr: number;
      avgSec: number;
    }

    let specs: SpecItem[] = [];
    if (dimension === 'channel') {
      specs = [
        { value: 'Organic Search', weight: 0.345, er: 68.4, cr: 4.1, avgSec: 172 },
        { value: 'Paid Social', weight: 0.215, er: 61.2, cr: 4.7, avgSec: 146 },
        { value: 'Direct', weight: 0.165, er: 65.8, cr: 3.2, avgSec: 152 },
        { value: 'Referral', weight: 0.102, er: 72.1, cr: 4.4, avgSec: 194 },
        { value: 'Paid Search', weight: 0.065, er: 64.0, cr: 5.1, avgSec: 159 },
        { value: 'Organic Social', weight: 0.052, er: 65.0, cr: 3.8, avgSec: 160 },
        { value: 'Email', weight: 0.046, er: 74.5, cr: 5.4, avgSec: 196 },
      ];
    } else if (dimension === 'sourceMedium') {
      specs = SOURCE_BLUEPRINTS.map((b) => ({
        value: `${b.source} / ${b.medium}`,
        weight: b.weight,
        er: b.er,
        cr: b.cr,
        avgSec: b.avgSec,
      }));
    } else if (dimension === 'referrer') {
      const refBlueprints = SOURCE_BLUEPRINTS.filter((b) => b.medium === 'referral');
      const refWeightSum = refBlueprints.reduce((s, b) => s + b.weight, 0);
      specs = refBlueprints.map((b) => ({
        value: b.source,
        weight: refWeightSum > 0 ? (b.weight / refWeightSum) * 0.12 : b.weight,
        er: b.er,
        cr: b.cr,
        avgSec: b.avgSec,
      }));
    } else if (dimension === 'landingPage') {
      specs = [
        { value: '/', weight: 0.31, er: 67.2, cr: 3.8, avgSec: 142 },
        { value: '/enterprise-security', weight: 0.19, er: 74.1, cr: 4.6, avgSec: 214 },
        { value: '/pricing', weight: 0.16, er: 71.5, cr: 5.8, avgSec: 188 },
        { value: '/request-demo', weight: 0.13, er: 78.4, cr: 7.4, avgSec: 165 },
        { value: '/solutions/government-banking', weight: 0.12, er: 73.0, cr: 4.1, avgSec: 232 },
        { value: '/compare/zoom-alternative-bangladesh', weight: 0.09, er: 69.8, cr: 4.5, avgSec: 196 },
      ];
    } else if (dimension === 'country') {
      const allCountries = [
        { value: 'Bangladesh', weight: 0.61, er: 67.5, cr: 4.2, avgSec: 168 },
        { value: 'Singapore', weight: 0.11, er: 71.2, cr: 4.8, avgSec: 184 },
        { value: 'United Arab Emirates', weight: 0.09, er: 69.4, cr: 4.5, avgSec: 176 },
        { value: 'United States', weight: 0.08, er: 72.0, cr: 4.1, avgSec: 181 },
        { value: 'United Kingdom', weight: 0.06, er: 70.1, cr: 3.9, avgSec: 172 },
        { value: 'Malaysia', weight: 0.05, er: 66.8, cr: 3.7, avgSec: 160 },
      ];
      specs = filters?.country
        ? allCountries.filter((c) => c.value.toLowerCase() === filters.country!.toLowerCase())
        : allCountries;
    } else if (dimension === 'device') {
      const allDevices = [
        { value: 'desktop', weight: 0.58, er: 72.4, cr: 4.8, avgSec: 192 },
        { value: 'mobile', weight: 0.39, er: 60.2, cr: 3.1, avgSec: 132 },
        { value: 'tablet', weight: 0.03, er: 64.5, cr: 3.5, avgSec: 148 },
      ];
      specs = filters?.deviceCategory
        ? allDevices.filter(
            (d) => d.value.toLowerCase() === filters.deviceCategory!.toLowerCase()
          )
        : allDevices;
    } else if (dimension === 'browser') {
      const allBrowsers = [
        { value: 'Chrome', weight: 0.66, er: 68.2, cr: 4.2, avgSec: 168 },
        { value: 'Safari', weight: 0.19, er: 66.4, cr: 3.9, avgSec: 158 },
        { value: 'Edge', weight: 0.08, er: 73.1, cr: 4.9, avgSec: 194 },
        { value: 'Firefox', weight: 0.05, er: 70.5, cr: 4.1, avgSec: 178 },
        { value: 'Samsung Internet', weight: 0.02, er: 58.0, cr: 2.8, avgSec: 124 },
      ];
      specs = filters?.browser
        ? allBrowsers.filter((b) => b.value.toLowerCase() === filters.browser!.toLowerCase())
        : allBrowsers;
    }

    const rawRows = specs.map((spec) => {
      const vCurr = seededVariance(`tb_c_${dimension}_${spec.value}_${range.startDate}`, 0.07);
      const vPrev = seededVariance(
        `tb_p_${dimension}_${spec.value}_${range.compareStartDate}`,
        0.07
      );
      const sessions = Math.max(
        1,
        Math.round(currTotals.sessions * spec.weight * filterMult * vCurr)
      );
      const previousSessions = Math.max(
        1,
        Math.round(prevTotals.sessions * spec.weight * filterMult * vPrev)
      );
      const activeUsers = Math.max(1, Math.round(sessions * 0.79));
      const previousActiveUsers = Math.max(1, Math.round(previousSessions * 0.79));
      const newUsers = Math.max(1, Math.round(activeUsers * 0.68));
      const previousNewUsers = Math.max(1, Math.round(previousActiveUsers * 0.68));
      const engagementRate = Number((spec.er * seededVariance(`tb_er_${spec.value}`, 0.03)).toFixed(1));
      const previousEngagementRate = Number(
        (spec.er * seededVariance(`tb_per_${spec.value}`, 0.03)).toFixed(1)
      );
      const engagedSessions = Math.round((sessions * engagementRate) / 100);
      const previousEngagedSessions = Math.round(
        (previousSessions * previousEngagementRate) / 100
      );
      const keyEvents = Math.max(0, Math.round((sessions * spec.cr) / 100));
      const previousKeyEvents = Math.max(0, Math.round((previousSessions * spec.cr) / 100));
      const avgEngagementTimeSec = Math.round(spec.avgSec * vCurr);
      const previousAvgEngagementTimeSec = Math.round(spec.avgSec * vPrev);

      return {
        dimensionValue: spec.value,
        sessions,
        previousSessions,
        activeUsers,
        previousActiveUsers,
        newUsers,
        previousNewUsers,
        engagedSessions,
        previousEngagedSessions,
        engagementRate,
        previousEngagementRate,
        keyEvents,
        previousKeyEvents,
        avgEngagementTimeSec,
        previousAvgEngagementTimeSec,
      };
    });

    const totalDimSessions = rawRows.reduce((s, r) => s + r.sessions, 0);

    return rawRows
      .map((r) => {
        const sessionsChangePercent = calculatePercentChange(r.sessions, r.previousSessions);
        return {
          ...r,
          sessionsChangePercent,
          activeUsersChangePercent: calculatePercentChange(
            r.activeUsers,
            r.previousActiveUsers
          ),
          newUsersChangePercent: calculatePercentChange(r.newUsers, r.previousNewUsers),
          engagedSessionsChangePercent: calculatePercentChange(
            r.engagedSessions,
            r.previousEngagedSessions
          ),
          engagementRateChangePercent: calculatePercentChange(
            r.engagementRate,
            r.previousEngagementRate
          ),
          keyEventsChangePercent: calculatePercentChange(r.keyEvents, r.previousKeyEvents),
          avgEngagementTimeChangePercent: calculatePercentChange(
            r.avgEngagementTimeSec,
            r.previousAvgEngagementTimeSec
          ),
          sharePercent: Number(
            ((r.sessions / Math.max(1, totalDimSessions)) * 100).toFixed(1)
          ),
          changePercent: sessionsChangePercent,
        };
      })
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, limit);
  },

  async getSourceGroups(range: ComputedDateRange): Promise<GA4SourceGroupsReport> {
    await simulateLatency(`ga4_sg_${range.startDate}_${range.endDate}`);
    const curr = buildSeededSourceMetricsRows(range.startDate, range.endDate);
    const prev = buildSeededSourceMetricsRows(range.compareStartDate, range.compareEndDate);

    const currGroups = aggregateBySourceGroup(curr.rows);
    const prevGroups = aggregateBySourceGroup(prev.rows);
    const prevByGroup = new Map(prevGroups.map((g) => [g.group, g]));

    const groups: GA4SourceGroupRow[] = currGroups.map((g) => {
      const previousSessions = prevByGroup.get(g.group)?.sessions ?? 0;
      return {
        ...g,
        previousSessions,
        changePercent: calculatePercentChange(g.sessions, previousSessions),
      };
    });

    return {
      totalSessions: curr.totalSessions,
      previousTotalSessions: prev.totalSessions,
      groups,
      rules: [...SOURCE_GROUP_RULES],
    };
  },

  async getAiTraffic(range: ComputedDateRange): Promise<GA4AiTrafficReport> {
    await simulateLatency(`ga4_ai_${range.startDate}_${range.endDate}`);
    const curr = buildSeededSourceMetricsRows(range.startDate, range.endDate);
    const prev = buildSeededSourceMetricsRows(range.compareStartDate, range.compareEndDate);

    const aiSources = new Set([
      'chatgpt.com',
      'perplexity.ai',
      'gemini.google.com',
      'claude.ai',
      'copilot.microsoft.com',
    ]);

    const expandAiRowsByLandingPage = (
      sourceRows: (SourceMetricsRow & { avgSec: number })[]
    ): SourceMetricsRow[] => {
      const expanded: SourceMetricsRow[] = [];
      for (const r of sourceRows) {
        if (!aiSources.has(r.source)) continue;
        let remSessions = r.sessions;
        let remEvents = r.keyEvents;
        AI_LANDING_PAGE_SHARES.forEach((lp, idx) => {
          const isLast = idx === AI_LANDING_PAGE_SHARES.length - 1;
          const s = isLast
            ? Math.max(0, remSessions)
            : Math.max(0, Math.round(r.sessions * lp.weight));
          const ke = isLast
            ? Math.max(0, remEvents)
            : Math.max(0, Math.round(r.keyEvents * lp.weight));
          remSessions -= s;
          remEvents -= ke;
          if (s > 0) {
            expanded.push({
              source: r.source,
              medium: r.medium,
              landingPage: lp.landingPage,
              sessions: s,
              activeUsers: Math.max(1, Math.round(s * 0.82)),
              newUsers: Math.max(1, Math.round(s * 0.64)),
              engagedSessions: Math.min(s, Math.round(s * 0.76)),
              keyEvents: ke,
            });
          }
        });
      }
      return expanded;
    };

    const currSummary = summarizeAiReferrals(
      expandAiRowsByLandingPage(curr.rows),
      curr.totalSessions
    );
    const prevSummary = summarizeAiReferrals(
      expandAiRowsByLandingPage(prev.rows),
      prev.totalSessions
    );

    const currDates = enumerateDates(range.startDate, range.endDate);
    const prevDates = enumerateDates(range.compareStartDate, range.compareEndDate);

    // Distribute AI sessions across days proportionally to daily GA4 traffic
    const rawDaily = currDates.map((d) => computeDailyGA4(d).sessions);
    const rawDailySum = rawDaily.reduce((a, b) => a + b, 0);
    const rawPrevDaily = prevDates.map((d) => computeDailyGA4(d).sessions);
    const rawPrevDailySum = rawPrevDaily.reduce((a, b) => a + b, 0);

    const byDate: GA4AiDatePoint[] = currDates.map((date, idx) => {
      const compareDate = prevDates[idx];
      const sessions =
        rawDailySum > 0
          ? Math.max(0, Math.round((currSummary.aiSessions * rawDaily[idx]) / rawDailySum))
          : 0;
      const previousSessions =
        compareDate && rawPrevDailySum > 0
          ? Math.max(0, Math.round((prevSummary.aiSessions * rawPrevDaily[idx]) / rawPrevDailySum))
          : 0;
      return {
        date,
        ...(compareDate ? { compareDate } : {}),
        sessions,
        previousSessions,
      };
    });

    const aiKeyEvents = currSummary.byAssistant.reduce((s, a) => s + a.keyEvents, 0);
    const previousAiKeyEvents = prevSummary.byAssistant.reduce((s, a) => s + a.keyEvents, 0);
    const aiKeyEventRate =
      currSummary.aiSessions > 0
        ? Math.round((aiKeyEvents / currSummary.aiSessions) * 1000) / 10
        : 0;
    const previousAiKeyEventRate =
      prevSummary.aiSessions > 0
        ? Math.round((previousAiKeyEvents / prevSummary.aiSessions) * 1000) / 10
        : 0;

    return {
      listVersion: AI_DOMAIN_LIST_VERSION,
      note: AI_TRAFFIC_NOTE,
      trackedAssistants: AI_ASSISTANTS.map((a) => ({
        name: a.name,
        domains: [...a.domains],
        ...(a.aliases ? { aliases: [...a.aliases] } : {}),
      })),
      totalSessions: currSummary.totalSessions,
      previousTotalSessions: prevSummary.totalSessions,
      aiSessions: currSummary.aiSessions,
      previousAiSessions: prevSummary.aiSessions,
      aiSessionsChangePercent: calculatePercentChange(
        currSummary.aiSessions,
        prevSummary.aiSessions
      ),
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
  },
};
