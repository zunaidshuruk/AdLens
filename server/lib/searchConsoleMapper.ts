import type {
  SearchConsoleCountryRow,
  SearchConsoleDeviceRow,
  SearchConsoleOverview,
  SearchConsolePageRow,
  SearchConsolePerformancePoint,
  SearchConsoleQueryRow,
} from '../../src/types/index.js';
import { enumerateDates } from '../../src/utils/dateUtils.js';
import { calculatePercentChange } from '../../src/utils/formatters.js';

export interface SearchConsoleApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export interface SearchConsoleQueryResponse {
  rows?: SearchConsoleApiRow[];
  responseAggregationType?: string;
}

function toSafeNum(val: number | undefined | null): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
  return val;
}

/**
 * Computes impression-weighted average position across multiple Search Console rows.
 * Never uses a simple arithmetic average.
 * Returns null if total impressions across all rows is 0.
 */
export function computeImpressionWeightedPosition(
  rows: readonly Pick<SearchConsoleApiRow, 'impressions' | 'position'>[]
): number | null {
  let totalImpressions = 0;
  let weightedSum = 0;

  for (const row of rows) {
    const imp = Math.max(0, toSafeNum(row.impressions));
    const pos = toSafeNum(row.position);
    if (imp > 0 && pos > 0) {
      totalImpressions += imp;
      weightedSum += pos * imp;
    }
  }

  if (totalImpressions <= 0) {
    return null;
  }

  return Number((weightedSum / totalImpressions).toFixed(1));
}

/**
 * ISO 3166-1 alpha-3 to alpha-2 lookup table used to convert Google Search Console
 * 3-letter country codes (e.g. "bgd", "usa") for Intl.DisplayNames(['en'], { type: 'region' }).
 */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  AFG: 'AF', ALB: 'AL', DZA: 'DZ', ASM: 'AS', AND: 'AD', AGO: 'AO', AIA: 'AI', ATA: 'AQ',
  ATG: 'AG', ARG: 'AR', ARM: 'AM', ABW: 'AW', AUS: 'AU', AUT: 'AT', AZE: 'AZ', BHS: 'BS',
  BHR: 'BH', BGD: 'BD', BRB: 'BB', BLR: 'BY', BEL: 'BE', BLZ: 'BZ', BEN: 'BJ', BMU: 'BM',
  BTN: 'BT', BOL: 'BO', BES: 'BQ', BIH: 'BA', BWA: 'BW', BVT: 'BV', BRA: 'BR', IOT: 'IO',
  BRN: 'BN', BGR: 'BG', BFA: 'BF', BDI: 'BI', CPV: 'CV', KHM: 'KH', CMR: 'CM', CAN: 'CA',
  CYM: 'KY', CAF: 'CF', TCD: 'TD', CHL: 'CL', CHN: 'CN', CXR: 'CX', CCK: 'CC', COL: 'CO',
  COM: 'KM', COD: 'CD', COG: 'CG', COK: 'CK', CRI: 'CR', HRV: 'HR', CUB: 'CU', CUW: 'CW',
  CYP: 'CY', CZE: 'CZ', CIV: 'CI', DNK: 'DK', DJI: 'DJ', DMA: 'DM', DOM: 'DO', ECU: 'EC',
  EGY: 'EG', SLV: 'SV', GNQ: 'GQ', ERI: 'ER', EST: 'EE', SWZ: 'SZ', ETH: 'ET', FLK: 'FK',
  FRO: 'FO', FJI: 'FJ', FIN: 'FI', FRA: 'FR', GUF: 'GF', PYF: 'PF', ATF: 'TF', GAB: 'GA',
  GMB: 'GM', GEO: 'GE', DEU: 'DE', GHA: 'GH', GIB: 'GI', GRC: 'GR', GRL: 'GL', GRD: 'GD',
  GLP: 'GP', GUM: 'GU', GTM: 'GT', GGY: 'GG', GIN: 'GN', GNB: 'GW', GUY: 'GY', HTI: 'HT',
  HMD: 'HM', VAT: 'VA', HND: 'HN', HKG: 'HK', HUN: 'HU', ISL: 'IS', IND: 'IN', IDN: 'ID',
  IRN: 'IR', IRQ: 'IQ', IRL: 'IE', IMN: 'IM', ISR: 'IL', ITA: 'IT', JAM: 'JM', JPN: 'JP',
  JEY: 'JE', JOR: 'JO', KAZ: 'KZ', KEN: 'KE', KIR: 'KI', PRK: 'KP', KOR: 'KR', KWT: 'KW',
  KGZ: 'KG', LAO: 'LA', LVA: 'LV', LBN: 'LB', LSO: 'LS', LBR: 'LR', LBY: 'LY', LIE: 'LI',
  LTU: 'LT', LUX: 'LU', MAC: 'MO', MDG: 'MG', MWI: 'MW', MYS: 'MY', MDV: 'MV', MLI: 'ML',
  MLT: 'MT', MHL: 'MH', MTQ: 'MQ', MRT: 'MR', MUS: 'MU', MYT: 'YT', MEX: 'MX', FSM: 'FM',
  MDA: 'MD', MCO: 'MC', MNG: 'MN', MNE: 'ME', MSR: 'MS', MAR: 'MA', MOZ: 'MZ', MMR: 'MM',
  NAM: 'NA', NRU: 'NR', NPL: 'NP', NLD: 'NL', NCL: 'NC', NZL: 'NZ', NIC: 'NI', NER: 'NE',
  NGA: 'NG', NIU: 'NU', NFK: 'NF', MKD: 'MK', MNP: 'MP', NOR: 'NO', OMN: 'OM', PAK: 'PK',
  PLW: 'PW', PSE: 'PS', PAN: 'PA', PNG: 'PG', PRY: 'PY', PER: 'PE', PHL: 'PH', PCN: 'PN',
  POL: 'PL', PRT: 'PT', PRI: 'PR', QAT: 'QA', ROU: 'RO', RUS: 'RU', RWA: 'RW', REU: 'RE',
  BLM: 'BL', SHN: 'SH', KNA: 'KN', LCA: 'LC', MAF: 'MF', SPM: 'PM', VCT: 'VC', WSM: 'WS',
  SMR: 'SM', STP: 'ST', SAU: 'SA', SEN: 'SN', SRB: 'RS', SYC: 'SC', SLE: 'SL', SGP: 'SG',
  SXM: 'SX', SVK: 'SK', SVN: 'SI', SLB: 'SB', SOM: 'SO', ZAF: 'ZA', SGS: 'GS', SSD: 'SS',
  ESP: 'ES', LKA: 'LK', SDN: 'SD', SUR: 'SR', SJM: 'SJ', SWE: 'SE', CHE: 'CH', SYR: 'SY',
  TWN: 'TW', TJK: 'TJ', TZA: 'TZ', THA: 'TH', TLS: 'TL', TGO: 'TG', TKL: 'TK', TON: 'TO',
  TTO: 'TT', TUN: 'TN', TUR: 'TR', TKM: 'TM', TCA: 'TC', TUV: 'TV', UGA: 'UG', UKR: 'UA',
  ARE: 'AE', GBR: 'GB', UMI: 'UM', USA: 'US', URY: 'UY', UZB: 'UZ', VUT: 'VU', VEN: 'VE',
  VNM: 'VN', VGB: 'VG', VIR: 'VI', WLF: 'WF', ESH: 'EH', YEM: 'YE', ZMB: 'ZM', ZWE: 'ZW',
};

const regionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Converts an ISO 3166-1 alpha-3 code (e.g. "bgd", "usa") to an English country name
 * using Intl.DisplayNames, falling back to the uppercase code.
 */
export function alpha3ToCountryName(rawCode: string): { country: string; code: string } {
  const upper = (rawCode || '').trim().toUpperCase();
  if (!upper) {
    return { country: 'Unknown', code: 'UNK' };
  }

  const alpha2 = ALPHA3_TO_ALPHA2[upper] || (upper.length === 2 ? upper : undefined);
  if (alpha2) {
    try {
      const displayName = regionDisplayNames.of(alpha2);
      if (displayName && displayName !== alpha2) {
        return { country: displayName, code: alpha2 };
      }
    } catch {
      // Fall back to uppercase code
    }
  }

  return { country: upper, code: upper };
}

function summarizeOverviewReport(report?: SearchConsoleQueryResponse): {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
} {
  const rows = report?.rows ?? [];
  if (rows.length === 0) {
    return { clicks: 0, impressions: 0, ctr: 0, avgPosition: 0 };
  }

  let clicks = 0;
  let impressions = 0;
  for (const r of rows) {
    clicks += Math.round(Math.max(0, toSafeNum(r.clicks)));
    impressions += Math.round(Math.max(0, toSafeNum(r.impressions)));
  }

  // CTR = clicks / impressions (expressed as percentage 0..100 for SearchConsoleOverview)
  const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(1)) : 0;

  // Position comes straight from the API when 1 row is returned; if multiple rows, impression-weighted average
  let avgPosition = 0;
  if (rows.length === 1) {
    avgPosition = Number(toSafeNum(rows[0].position).toFixed(1));
  } else {
    avgPosition = computeImpressionWeightedPosition(rows) ?? 0;
  }

  return { clicks, impressions, ctr, avgPosition };
}

/**
 * Maps Search Console searchAnalytics.query response(s) without dimensions into SearchConsoleOverview.
 */
export function mapSearchConsoleOverviewResponse(
  currentReport: SearchConsoleQueryResponse,
  previousReport?: SearchConsoleQueryResponse
): SearchConsoleOverview {
  const curr = summarizeOverviewReport(currentReport);
  const prev = summarizeOverviewReport(previousReport);

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
}

/**
 * Maps Search Console searchAnalytics.query response with dimensions ["date"] into
 * SearchConsolePerformancePoint[], filling missing days with zeros and setting
 * avgPosition to null on zero-impression days (not 0).
 */
export function mapSearchConsolePerformanceOverTimeResponse(
  currentReport: SearchConsoleQueryResponse,
  previousReport: SearchConsoleQueryResponse | undefined,
  startDate: string,
  endDate: string,
  compareStartDate?: string,
  compareEndDate?: string
): SearchConsolePerformancePoint[] {
  const currentByDate = new Map<string, SearchConsoleApiRow[]>();
  for (const row of currentReport.rows ?? []) {
    const dateKey = row.keys?.[0]?.trim();
    if (!dateKey) continue;
    const list = currentByDate.get(dateKey) ?? [];
    list.push(row);
    currentByDate.set(dateKey, list);
  }

  const previousByDate = new Map<string, SearchConsoleApiRow[]>();
  for (const row of previousReport?.rows ?? []) {
    const dateKey = row.keys?.[0]?.trim();
    if (!dateKey) continue;
    const list = previousByDate.get(dateKey) ?? [];
    list.push(row);
    previousByDate.set(dateKey, list);
  }

  const currentDates = enumerateDates(startDate, endDate);
  const compareDates =
    compareStartDate && compareEndDate ? enumerateDates(compareStartDate, compareEndDate) : [];

  return currentDates.map((date, idx) => {
    const currRows = currentByDate.get(date) ?? [];
    const clicks = currRows.reduce((acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.clicks))), 0);
    const impressions = currRows.reduce(
      (acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.impressions))),
      0
    );
    const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(1)) : 0;
    const avgPosition = impressions > 0 ? computeImpressionWeightedPosition(currRows) : null;

    const compareDate = compareDates[idx];
    const prevRows = compareDate ? previousByDate.get(compareDate) ?? [] : [];
    const previousClicks = prevRows.reduce(
      (acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.clicks))),
      0
    );
    const previousImpressions = prevRows.reduce(
      (acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.impressions))),
      0
    );

    return {
      date,
      ...(compareDate ? { compareDate } : {}),
      clicks,
      previousClicks,
      impressions,
      previousImpressions,
      ctr,
      avgPosition,
    };
  });
}

/**
 * Maps Search Console searchAnalytics.query response with dimensions ["query"] into
 * SearchConsoleQueryRow[], sorted by clicks descending (up to 250 rows).
 */
export function mapSearchConsoleTopQueriesResponse(
  currentReport: SearchConsoleQueryResponse,
  previousReport?: SearchConsoleQueryResponse
): SearchConsoleQueryRow[] {
  const prevClicksByQuery = new Map<string, number>();
  for (const row of previousReport?.rows ?? []) {
    const q = row.keys?.[0];
    if (!q) continue;
    prevClicksByQuery.set(
      q,
      (prevClicksByQuery.get(q) ?? 0) + Math.round(Math.max(0, toSafeNum(row.clicks)))
    );
  }

  const grouped = new Map<string, SearchConsoleApiRow[]>();
  for (const row of currentReport.rows ?? []) {
    const query = row.keys?.[0];
    if (!query) continue;
    const list = grouped.get(query) ?? [];
    list.push(row);
    grouped.set(query, list);
  }

  const results: SearchConsoleQueryRow[] = [];
  for (const [query, rows] of grouped.entries()) {
    const clicks = rows.reduce((acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.clicks))), 0);
    const impressions = rows.reduce(
      (acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.impressions))),
      0
    );
    const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(1)) : 0;
    const avgPosition =
      rows.length === 1
        ? Number(toSafeNum(rows[0].position).toFixed(1))
        : (computeImpressionWeightedPosition(rows) ?? 0);
    const prevClicks = prevClicksByQuery.get(query) ?? 0;
    const changePercent = previousReport ? calculatePercentChange(clicks, prevClicks) : 0;

    results.push({
      query,
      clicks,
      impressions,
      ctr,
      avgPosition,
      changePercent,
    });
  }

  return results
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 250);
}

/**
 * Maps Search Console searchAnalytics.query response with dimensions ["page"] into
 * SearchConsolePageRow[], combining duplicate rows via impression-weighted position.
 */
export function mapSearchConsoleTopPagesResponse(
  currentReport: SearchConsoleQueryResponse
): SearchConsolePageRow[] {
  const grouped = new Map<string, SearchConsoleApiRow[]>();
  for (const row of currentReport.rows ?? []) {
    const pageUrl = row.keys?.[0];
    if (!pageUrl) continue;
    const list = grouped.get(pageUrl) ?? [];
    list.push(row);
    grouped.set(pageUrl, list);
  }

  const results: SearchConsolePageRow[] = [];
  for (const [pageUrl, rows] of grouped.entries()) {
    const clicks = rows.reduce((acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.clicks))), 0);
    const impressions = rows.reduce(
      (acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.impressions))),
      0
    );
    const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(1)) : 0;
    const avgPosition =
      rows.length === 1
        ? Number(toSafeNum(rows[0].position).toFixed(1))
        : (computeImpressionWeightedPosition(rows) ?? 0);

    results.push({
      pageUrl,
      clicks,
      impressions,
      ctr,
      avgPosition,
    });
  }

  return results
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 250);
}

/**
 * Maps Search Console searchAnalytics.query response with dimensions ["country"] into
 * SearchConsoleCountryRow[], converting ISO 3166-1 alpha-3 codes ("bgd", "usa") to English names.
 */
export function mapSearchConsoleCountriesResponse(
  currentReport: SearchConsoleQueryResponse
): SearchConsoleCountryRow[] {
  const grouped = new Map<string, SearchConsoleApiRow[]>();
  for (const row of currentReport.rows ?? []) {
    const rawCode = row.keys?.[0];
    if (!rawCode) continue;
    const list = grouped.get(rawCode) ?? [];
    list.push(row);
    grouped.set(rawCode, list);
  }

  const results: SearchConsoleCountryRow[] = [];
  for (const [rawCode, rows] of grouped.entries()) {
    const { country, code } = alpha3ToCountryName(rawCode);
    const clicks = rows.reduce((acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.clicks))), 0);
    const impressions = rows.reduce(
      (acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.impressions))),
      0
    );
    const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(1)) : 0;
    const avgPosition =
      rows.length === 1
        ? Number(toSafeNum(rows[0].position).toFixed(1))
        : (computeImpressionWeightedPosition(rows) ?? 0);

    results.push({
      country,
      code,
      clicks,
      impressions,
      ctr,
      avgPosition,
    });
  }

  return results.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

function normalizeDeviceLabel(raw: string): 'Desktop' | 'Mobile' | 'Tablet' {
  const upper = raw.trim().toUpperCase();
  if (upper === 'MOBILE') return 'Mobile';
  if (upper === 'TABLET') return 'Tablet';
  return 'Desktop';
}

/**
 * Maps Search Console searchAnalytics.query response with dimensions ["device"] into
 * SearchConsoleDeviceRow[], mapping DESKTOP/MOBILE/TABLET to "Desktop"/"Mobile"/"Tablet".
 */
export function mapSearchConsoleDevicesResponse(
  currentReport: SearchConsoleQueryResponse
): SearchConsoleDeviceRow[] {
  const grouped = new Map<'Desktop' | 'Mobile' | 'Tablet', SearchConsoleApiRow[]>();
  for (const row of currentReport.rows ?? []) {
    const label = normalizeDeviceLabel(row.keys?.[0] ?? 'DESKTOP');
    const list = grouped.get(label) ?? [];
    list.push(row);
    grouped.set(label, list);
  }

  const rawRows: Omit<SearchConsoleDeviceRow, 'sharePercent'>[] = [];
  let totalImpressions = 0;

  for (const [device, rows] of grouped.entries()) {
    const clicks = rows.reduce((acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.clicks))), 0);
    const impressions = rows.reduce(
      (acc, r) => acc + Math.round(Math.max(0, toSafeNum(r.impressions))),
      0
    );
    totalImpressions += impressions;
    const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(1)) : 0;
    const avgPosition =
      rows.length === 1
        ? Number(toSafeNum(rows[0].position).toFixed(1))
        : (computeImpressionWeightedPosition(rows) ?? 0);

    rawRows.push({
      device,
      clicks,
      impressions,
      ctr,
      avgPosition,
    });
  }

  return rawRows
    .map((r) => ({
      ...r,
      sharePercent:
        totalImpressions > 0
          ? Number(((r.impressions / totalImpressions) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}
