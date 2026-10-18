import { TRACKED_SITE } from '../../config/app.ts';
import type {
  ComputedDateRange,
  GA4AcquisitionReport,
  GA4CampaignRow,
  GA4ChannelRow,
  GA4ConversionEventRow,
  GA4CountryRow,
  GA4Overview,
  GA4PageRow,
  GA4TrafficPoint,
} from '../../types/index.ts';
import { enumerateDates } from '../../utils/dateUtils.ts';
import { calculatePercentChange } from '../../utils/formatters.ts';
import type { GA4Adapter } from '../ga4.ts';
import { dayOfWeekFactor, seededVariance, SHARED_CAMPAIGNS, simulateLatency } from './seed.ts';

function computeDailyGA4(dateStr: string) {
  const dow = dayOfWeekFactor(dateStr);
  const vSessions = seededVariance(`ga4_sess_${dateStr}`, 0.16);
  const sessions = Math.round(1420 * dow * vSessions);
  const userRatio = 0.76 + (seededVariance(`ga4_ur_${dateStr}`, 0.04) - 1);
  const users = Math.round(sessions * userRatio);
  const engRate = 0.64 + (seededVariance(`ga4_er_${dateStr}`, 0.05) - 1);
  const engagedSessions = Math.round(sessions * engRate);
  const avgEngagementTimeSec = Math.round(158 * seededVariance(`ga4_et_${dateStr}`, 0.1));
  const conversions = Math.max(4, Math.round(sessions * 0.036 * seededVariance(`ga4_cv_${dateStr}`, 0.18)));

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

  const engagementRate = sessions > 0 ? Number(((engagedSessions / sessions) * 100).toFixed(1)) : 0;
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
        changePercent: calculatePercentChange(curr.avgEngagementTimeSec, prev.avgEngagementTimeSec),
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
      const engagementRate = Number((def.er * seededVariance(`er_${def.channel}_${range.endDate}`, 0.03)).toFixed(1));
      const engagedSessions = Math.round((sessions * engagementRate) / 100);
      const conversionRate = Number((def.cr * seededVariance(`cr_${def.channel}_${range.endDate}`, 0.05)).toFixed(1));
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
      const sessions = Math.round(totals.sessions * c.weight * seededVariance(`ga4_cty_${c.code}_${range.startDate}`, 0.04));
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
        (camp.conversionRateBase * seededVariance(`ga4_utm_cr_${camp.id}_${range.startDate}`, 0.08)).toFixed(1)
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
      const avgEngagementTimeSec = Math.round(p.avgSec * seededVariance(`ga4_pg_t_${p.pagePath}_${range.endDate}`, 0.06));
      const bounceRate = Number((p.bounce * seededVariance(`ga4_pg_b_${p.pagePath}_${range.endDate}`, 0.05)).toFixed(1));
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
};
