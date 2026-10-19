import { DEMO_PROJECT as TRACKED_SITE } from '../../config/app.js';
import type {
  ComputedDateRange,
  SearchConsoleCountryRow,
  SearchConsoleDeviceRow,
  SearchConsoleOverview,
  SearchConsolePageRow,
  SearchConsolePerformancePoint,
  SearchConsoleQueryRow,
} from '../../types/index.ts';
import { enumerateDates } from '../../utils/dateUtils.ts';
import { calculatePercentChange } from '../../utils/formatters.ts';
import type { SearchConsoleAdapter } from '../searchConsole.ts';
import { dayOfWeekFactor, seededVariance, simulateLatency } from './seed.ts';

function computeDailyGSC(dateStr: string) {
  const dow = dayOfWeekFactor(dateStr);
  const impressions = Math.round(14800 * dow * seededVariance(`gsc_imp_${dateStr}`, 0.15));
  const ctr = Number((4.6 * seededVariance(`gsc_ctr_${dateStr}`, 0.08)).toFixed(2));
  const clicks = Math.round((impressions * ctr) / 100);
  const avgPosition = Number((8.4 * seededVariance(`gsc_pos_${dateStr}`, 0.06)).toFixed(1));

  return {
    clicks,
    impressions,
    ctr,
    avgPosition,
  };
}

function aggregateGSCRange(startDate: string, endDate: string) {
  const dates = enumerateDates(startDate, endDate);
  let clicks = 0;
  let impressions = 0;
  let weightedPos = 0;

  for (const d of dates) {
    const day = computeDailyGSC(d);
    clicks += day.clicks;
    impressions += day.impressions;
    weightedPos += day.avgPosition * day.impressions;
  }

  const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(1)) : 0;
  const avgPosition = impressions > 0 ? Number((weightedPos / impressions).toFixed(1)) : 0;

  return {
    clicks,
    impressions,
    ctr,
    avgPosition,
  };
}

export const mockSearchConsoleAdapter: SearchConsoleAdapter = {
  id: 'search_console',
  name: 'Google Search Console',
  isMock: true,

  async isConnected(): Promise<boolean> {
    return false;
  },

  async getOverview(range: ComputedDateRange): Promise<SearchConsoleOverview> {
    await simulateLatency(`gsc_overview_${range.startDate}_${range.endDate}`);
    const curr = aggregateGSCRange(range.startDate, range.endDate);
    const prev = aggregateGSCRange(range.compareStartDate, range.compareEndDate);

    return {
      clicks: {
        value: curr.clicks,
        previousValue: prev.clicks,
        changePercent: calculatePercentChange(curr.clicks, prev.clicks),
      },
      impressions: {
        value: curr.impressions,
        previousValue: prev.impressions,
        changePercent: calculatePercentChange(curr.impressions, prev.impressions),
      },
      ctr: {
        value: curr.ctr,
        previousValue: prev.ctr,
        changePercent: calculatePercentChange(curr.ctr, prev.ctr),
      },
      avgPosition: {
        value: curr.avgPosition,
        previousValue: prev.avgPosition,
        changePercent: calculatePercentChange(curr.avgPosition, prev.avgPosition),
      },
    };
  },

  async getPerformanceOverTime(range: ComputedDateRange): Promise<SearchConsolePerformancePoint[]> {
    await simulateLatency(`gsc_perf_${range.startDate}_${range.endDate}`);
    const currDates = enumerateDates(range.startDate, range.endDate);
    const prevDates = enumerateDates(range.compareStartDate, range.compareEndDate);

    return currDates.map((date, idx) => {
      const curr = computeDailyGSC(date);
      const compareDate = prevDates[idx] ?? prevDates[0];
      const prev = computeDailyGSC(compareDate);

      return {
        date,
        compareDate,
        clicks: curr.clicks,
        previousClicks: prev.clicks,
        impressions: curr.impressions,
        previousImpressions: prev.impressions,
        ctr: curr.ctr,
        avgPosition: curr.avgPosition,
      };
    });
  },

  async getTopQueries(range: ComputedDateRange): Promise<SearchConsoleQueryRow[]> {
    await simulateLatency(`gsc_queries_${range.startDate}_${range.endDate}`);
    const totals = aggregateGSCRange(range.startDate, range.endDate);
    const brandQuery = TRACKED_SITE.name.toLowerCase();

    const queryBlueprints = [
      { query: brandQuery, impShare: 0.16, ctrBase: 14.2, pos: 1.2 },
      { query: 'video conferencing software bangladesh', impShare: 0.18, ctrBase: 6.8, pos: 2.8 },
      { query: 'secure meeting app', impShare: 0.14, ctrBase: 4.9, pos: 5.4 },
      { query: 'zoom alternative', impShare: 0.15, ctrBase: 3.6, pos: 8.7 },
      { query: `${brandQuery} video conferencing`, impShare: 0.09, ctrBase: 11.4, pos: 1.5 },
      { query: 'on premise video conferencing server', impShare: 0.08, ctrBase: 5.1, pos: 4.6 },
      { query: 'encrypted video call platform enterprise', impShare: 0.07, ctrBase: 4.2, pos: 6.9 },
      { query: 'bangladesh government virtual meeting tool', impShare: 0.06, ctrBase: 7.5, pos: 2.3 },
      { query: 'low bandwidth video conference app', impShare: 0.04, ctrBase: 4.8, pos: 6.1 },
      { query: 'synesis it video platform', impShare: 0.03, ctrBase: 9.6, pos: 1.8 },
    ];

    return queryBlueprints
      .map((q) => {
        const vCurr = seededVariance(`gsc_q_${q.query}_${range.startDate}`, 0.1);
        const vPrev = seededVariance(`gsc_q_${q.query}_${range.compareStartDate}`, 0.1);
        const impressions = Math.max(40, Math.round(totals.impressions * q.impShare * vCurr));
        const ctr = Number((q.ctrBase * seededVariance(`gsc_q_ctr_${q.query}_${range.endDate}`, 0.06)).toFixed(1));
        const clicks = Math.max(2, Math.round((impressions * ctr) / 100));
        const prevClicks = Math.max(2, Math.round(clicks * (vPrev / vCurr) * 0.92));
        const avgPosition = Number((q.pos * seededVariance(`gsc_q_pos_${q.query}_${range.endDate}`, 0.05)).toFixed(1));

        return {
          query: q.query,
          clicks,
          impressions,
          ctr,
          avgPosition,
          changePercent: calculatePercentChange(clicks, prevClicks),
        };
      })
      .sort((a, b) => b.clicks - a.clicks);
  },

  async getTopPages(range: ComputedDateRange): Promise<SearchConsolePageRow[]> {
    await simulateLatency(`gsc_pages_${range.startDate}_${range.endDate}`);
    const totals = aggregateGSCRange(range.startDate, range.endDate);
    const baseDomain = `https://${TRACKED_SITE.domain}`;

    const pages = [
      { path: '/', impShare: 0.32, ctr: 6.2, pos: 3.4 },
      { path: '/enterprise-security', impShare: 0.21, ctr: 5.1, pos: 4.9 },
      { path: '/compare/zoom-alternative-bangladesh', impShare: 0.18, ctr: 4.8, pos: 6.2 },
      { path: '/pricing', impShare: 0.14, ctr: 5.5, pos: 4.1 },
      { path: '/solutions/government-banking', impShare: 0.09, ctr: 6.4, pos: 3.8 },
      { path: '/request-demo', impShare: 0.06, ctr: 7.1, pos: 2.9 },
    ];

    return pages.map((p) => {
      const v = seededVariance(`gsc_p_${p.path}_${range.startDate}`, 0.09);
      const impressions = Math.round(totals.impressions * p.impShare * v);
      const ctr = Number((p.ctr * seededVariance(`gsc_p_ctr_${p.path}_${range.endDate}`, 0.05)).toFixed(1));
      const clicks = Math.round((impressions * ctr) / 100);
      const avgPosition = Number((p.pos * seededVariance(`gsc_p_pos_${p.path}_${range.endDate}`, 0.05)).toFixed(1));

      return {
        pageUrl: `${baseDomain}${p.path}`,
        clicks,
        impressions,
        ctr,
        avgPosition,
      };
    });
  },

  async getCountries(range: ComputedDateRange): Promise<SearchConsoleCountryRow[]> {
    await simulateLatency(`gsc_countries_${range.startDate}_${range.endDate}`);
    const totals = aggregateGSCRange(range.startDate, range.endDate);

    const countries = [
      { country: 'Bangladesh', code: 'BD', share: 0.58, ctr: 6.1, pos: 3.9 },
      { country: 'India', code: 'IN', share: 0.12, ctr: 3.8, pos: 9.4 },
      { country: 'Singapore', code: 'SG', share: 0.09, ctr: 4.4, pos: 7.2 },
      { country: 'United Arab Emirates', code: 'AE', share: 0.08, ctr: 4.2, pos: 8.1 },
      { country: 'United States', code: 'US', share: 0.07, ctr: 3.2, pos: 12.6 },
      { country: 'United Kingdom', code: 'GB', share: 0.06, ctr: 3.5, pos: 11.2 },
    ];

    return countries.map((c) => {
      const v = seededVariance(`gsc_c_${c.code}_${range.startDate}`, 0.06);
      const impressions = Math.round(totals.impressions * c.share * v);
      const ctr = Number((c.ctr * seededVariance(`gsc_c_ctr_${c.code}_${range.endDate}`, 0.05)).toFixed(1));
      const clicks = Math.round((impressions * ctr) / 100);
      const avgPosition = Number((c.pos * seededVariance(`gsc_c_pos_${c.code}_${range.endDate}`, 0.04)).toFixed(1));

      return {
        country: c.country,
        code: c.code,
        clicks,
        impressions,
        ctr,
        avgPosition,
      };
    });
  },

  async getDevices(range: ComputedDateRange): Promise<SearchConsoleDeviceRow[]> {
    await simulateLatency(`gsc_devices_${range.startDate}_${range.endDate}`);
    const totals = aggregateGSCRange(range.startDate, range.endDate);

    const devices: { device: 'Desktop' | 'Mobile' | 'Tablet'; share: number; ctr: number; pos: number }[] = [
      { device: 'Desktop', share: 0.64, ctr: 5.4, pos: 6.8 },
      { device: 'Mobile', share: 0.33, ctr: 3.9, pos: 9.1 },
      { device: 'Tablet', share: 0.03, ctr: 4.1, pos: 8.4 },
    ];

    return devices.map((d) => {
      const v = seededVariance(`gsc_d_${d.device}_${range.startDate}`, 0.04);
      const impressions = Math.round(totals.impressions * d.share * v);
      const ctr = Number((d.ctr * seededVariance(`gsc_d_ctr_${d.device}_${range.endDate}`, 0.04)).toFixed(1));
      const clicks = Math.round((impressions * ctr) / 100);
      const avgPosition = Number((d.pos * seededVariance(`gsc_d_pos_${d.device}_${range.endDate}`, 0.04)).toFixed(1));
      const sharePercent = Number((d.share * 100).toFixed(1));

      return {
        device: d.device,
        clicks,
        impressions,
        ctr,
        avgPosition,
        sharePercent,
      };
    });
  },
};
