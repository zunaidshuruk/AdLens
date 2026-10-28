/**
 * Explore (Sprint 13): flexible reports for Google Analytics 4 and Search Console.
 * Only names on the allow-lists below can be asked for, so a browser (or an AI model) can never send an arbitrary query to Google.
 * Pure functions: input validation, request building and result mapping. No network here.
 */
import { z } from 'zod';
import { alpha3ToCountryName, countryToAlpha3 } from './searchConsoleMapper.js';

export type ColumnType = 'text' | 'integer' | 'decimal' | 'percent' | 'seconds' | 'date' | 'position';
export interface FieldInfo { key: string; label: string; type: ColumnType; group: string }

// ---------------------------------------------------------------------------
// Allow-lists
// ---------------------------------------------------------------------------

export const GA4_DIMENSIONS: FieldInfo[] = [
  { key: 'date', label: 'Date', type: 'date', group: 'Time' },
  { key: 'sessionDefaultChannelGroup', label: 'Channel', type: 'text', group: 'Traffic source' },
  { key: 'sessionSource', label: 'Source', type: 'text', group: 'Traffic source' },
  { key: 'sessionMedium', label: 'Medium', type: 'text', group: 'Traffic source' },
  { key: 'sessionSourceMedium', label: 'Source / medium', type: 'text', group: 'Traffic source' },
  { key: 'sessionCampaignName', label: 'Campaign', type: 'text', group: 'Traffic source' },
  { key: 'firstUserDefaultChannelGroup', label: 'First-visit channel', type: 'text', group: 'Traffic source' },
  { key: 'landingPagePlusQueryString', label: 'Landing page', type: 'text', group: 'Pages' },
  { key: 'pagePath', label: 'Page path', type: 'text', group: 'Pages' },
  { key: 'pageTitle', label: 'Page title', type: 'text', group: 'Pages' },
  { key: 'hostName', label: 'Hostname', type: 'text', group: 'Pages' },
  { key: 'eventName', label: 'Event name', type: 'text', group: 'Events' },
  { key: 'country', label: 'Country', type: 'text', group: 'Audience' },
  { key: 'region', label: 'Region', type: 'text', group: 'Audience' },
  { key: 'city', label: 'City', type: 'text', group: 'Audience' },
  { key: 'language', label: 'Language', type: 'text', group: 'Audience' },
  { key: 'newVsReturning', label: 'New or returning', type: 'text', group: 'Audience' },
  { key: 'deviceCategory', label: 'Device', type: 'text', group: 'Technology' },
  { key: 'browser', label: 'Browser', type: 'text', group: 'Technology' },
  { key: 'operatingSystem', label: 'Operating system', type: 'text', group: 'Technology' },
];

export const GA4_METRICS: FieldInfo[] = [
  { key: 'sessions', label: 'Sessions', type: 'integer', group: 'Traffic' },
  { key: 'totalUsers', label: 'Total users', type: 'integer', group: 'Traffic' },
  { key: 'activeUsers', label: 'Active users', type: 'integer', group: 'Traffic' },
  { key: 'newUsers', label: 'New users', type: 'integer', group: 'Traffic' },
  { key: 'screenPageViews', label: 'Page views', type: 'integer', group: 'Traffic' },
  { key: 'screenPageViewsPerSession', label: 'Pages per session', type: 'decimal', group: 'Engagement' },
  { key: 'engagedSessions', label: 'Engaged sessions', type: 'integer', group: 'Engagement' },
  { key: 'engagementRate', label: 'Engagement rate', type: 'percent', group: 'Engagement' },
  { key: 'bounceRate', label: 'Bounce rate', type: 'percent', group: 'Engagement' },
  { key: 'averageSessionDuration', label: 'Average session duration', type: 'seconds', group: 'Engagement' },
  { key: 'userEngagementDuration', label: 'Total engagement time', type: 'seconds', group: 'Engagement' },
  { key: 'eventCount', label: 'Event count', type: 'integer', group: 'Events' },
  { key: 'keyEvents', label: 'Key events', type: 'integer', group: 'Events' },
  { key: 'sessionKeyEventRate', label: 'Key event rate', type: 'percent', group: 'Events' },
];

export const SC_DIMENSIONS: FieldInfo[] = [
  { key: 'query', label: 'Search query', type: 'text', group: 'Search' },
  { key: 'page', label: 'Page', type: 'text', group: 'Search' },
  { key: 'country', label: 'Country', type: 'text', group: 'Search' },
  { key: 'device', label: 'Device', type: 'text', group: 'Search' },
  { key: 'date', label: 'Date', type: 'date', group: 'Time' },
];

export const SC_METRICS: FieldInfo[] = [
  { key: 'clicks', label: 'Clicks', type: 'integer', group: 'Performance' },
  { key: 'impressions', label: 'Impressions', type: 'integer', group: 'Performance' },
  { key: 'ctr', label: 'Click-through rate', type: 'percent', group: 'Performance' },
  { key: 'position', label: 'Average position', type: 'position', group: 'Performance' },
];

export const META_DIMENSIONS: FieldInfo[] = [
  { key: 'date', label: 'Date', type: 'date', group: 'Time' },
  { key: 'campaign', label: 'Campaign', type: 'text', group: 'Ads' },
  { key: 'adset', label: 'Ad set', type: 'text', group: 'Ads' },
  { key: 'ad', label: 'Ad', type: 'text', group: 'Ads' },
  { key: 'country', label: 'Country', type: 'text', group: 'Audience' },
  { key: 'age', label: 'Age', type: 'text', group: 'Audience' },
  { key: 'gender', label: 'Gender', type: 'text', group: 'Audience' },
  { key: 'platform', label: 'Platform (Facebook, Instagram…)', type: 'text', group: 'Placement' },
  { key: 'device', label: 'Device', type: 'text', group: 'Placement' },
];

export const META_METRICS: FieldInfo[] = [
  { key: 'spend', label: 'Amount spent', type: 'decimal', group: 'Cost' },
  { key: 'impressions', label: 'Impressions', type: 'integer', group: 'Reach' },
  { key: 'reach', label: 'Reach', type: 'integer', group: 'Reach' },
  { key: 'frequency', label: 'Frequency', type: 'decimal', group: 'Reach' },
  { key: 'clicks', label: 'Clicks (all)', type: 'integer', group: 'Clicks' },
  { key: 'inline_link_clicks', label: 'Link clicks', type: 'integer', group: 'Clicks' },
  { key: 'ctr', label: 'Click-through rate', type: 'percent', group: 'Clicks' },
  { key: 'cpc', label: 'Cost per click', type: 'decimal', group: 'Cost' },
  { key: 'cpm', label: 'Cost per 1,000 impressions', type: 'decimal', group: 'Cost' },
];

const keysOf = (f: FieldInfo[]) => f.map((x) => x.key) as [string, ...string[]];
const lookup = (f: FieldInfo[]) => new Map(f.map((x) => [x.key, x]));

export const MAX_ROWS = 1000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const dateFields = {
  startDate: z.string().regex(ISO, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(ISO, 'endDate must be YYYY-MM-DD'),
};

const checkDates = (v: { startDate: string; endDate: string }, ctx: z.RefinementCtx) => {
  if (v.startDate > v.endDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'startDate must be on or before endDate.' });
};

const filterOps = z.enum(['equals', 'notEquals', 'contains', 'notContains', 'startsWith']);
const filterValue = z.string().trim().min(1, 'Filter value is required').max(200);

export const ga4ExploreInputSchema = z
  .object({
    ...dateFields,
    dimensions: z.array(z.enum(keysOf(GA4_DIMENSIONS))).max(4).default([]),
    metrics: z.array(z.enum(keysOf(GA4_METRICS))).min(1, 'Pick at least one metric').max(6),
    filters: z.array(z.object({ field: z.enum(keysOf(GA4_DIMENSIONS)), op: filterOps, value: filterValue })).max(5).default([]),
    orderBy: z.object({ field: z.string().max(60), desc: z.boolean().default(true) }).optional(),
    limit: z.number().int().min(1).max(MAX_ROWS).default(100),
  })
  .superRefine(checkDates)
  .superRefine((v, ctx) => {
    if (new Set(v.dimensions).size !== v.dimensions.length) ctx.addIssue({ code: 'custom', path: ['dimensions'], message: 'Each dimension can be used once.' });
    if (new Set(v.metrics).size !== v.metrics.length) ctx.addIssue({ code: 'custom', path: ['metrics'], message: 'Each metric can be used once.' });
    if (v.orderBy && !v.metrics.includes(v.orderBy.field) && !v.dimensions.includes(v.orderBy.field)) {
      ctx.addIssue({ code: 'custom', path: ['orderBy'], message: 'Sort by a column that is in the report.' });
    }
  });
export type GA4ExploreInput = z.infer<typeof ga4ExploreInputSchema>;

export const scExploreInputSchema = z
  .object({
    ...dateFields,
    dimensions: z.array(z.enum(keysOf(SC_DIMENSIONS))).max(3).default([]),
    metrics: z.array(z.enum(keysOf(SC_METRICS))).min(1, 'Pick at least one metric').max(4),
    filters: z.array(z.object({ field: z.enum(['query', 'page', 'country', 'device']), op: filterOps.exclude(['startsWith']), value: filterValue })).max(5).default([]),
    orderBy: z.object({ field: z.string().max(60), desc: z.boolean().default(true) }).optional(),
    limit: z.number().int().min(1).max(MAX_ROWS).default(100),
  })
  .superRefine(checkDates)
  .superRefine((v, ctx) => {
    if (new Set(v.dimensions).size !== v.dimensions.length) ctx.addIssue({ code: 'custom', path: ['dimensions'], message: 'Each dimension can be used once.' });
    if (new Set(v.metrics).size !== v.metrics.length) ctx.addIssue({ code: 'custom', path: ['metrics'], message: 'Each metric can be used once.' });
    if (v.orderBy && !v.metrics.includes(v.orderBy.field) && !v.dimensions.includes(v.orderBy.field)) {
      ctx.addIssue({ code: 'custom', path: ['orderBy'], message: 'Sort by a column that is in the report.' });
    }
  });
export type SCExploreInput = z.infer<typeof scExploreInputSchema>;

export const metaExploreInputSchema = z
  .object({
    ...dateFields,
    dimensions: z.array(z.enum(keysOf(META_DIMENSIONS))).max(3).default([]),
    metrics: z.array(z.enum(keysOf(META_METRICS))).min(1, 'Pick at least one metric').max(6),
    filters: z.array(z.object({ field: z.enum(['campaign', 'adset', 'ad']), op: filterOps.exclude(['startsWith']), value: filterValue })).max(5).default([]),
    orderBy: z.object({ field: z.string().max(60), desc: z.boolean().default(true) }).optional(),
    limit: z.number().int().min(1).max(MAX_ROWS).default(100),
  })
  .superRefine(checkDates)
  .superRefine((v, ctx) => {
    if (new Set(v.dimensions).size !== v.dimensions.length) ctx.addIssue({ code: 'custom', path: ['dimensions'], message: 'Each dimension can be used once.' });
    if (new Set(v.metrics).size !== v.metrics.length) ctx.addIssue({ code: 'custom', path: ['metrics'], message: 'Each metric can be used once.' });
    if (v.orderBy && !v.metrics.includes(v.orderBy.field) && !v.dimensions.includes(v.orderBy.field)) {
      ctx.addIssue({ code: 'custom', path: ['orderBy'], message: 'Sort by a column that is in the report.' });
    }
  });
export type MetaExploreInput = z.infer<typeof metaExploreInputSchema>;

/** What a saved report remembers: everything except the dates (dates come from the date picker each time). */
export const ga4SpecSchema = z.object({
  dimensions: ga4ExploreInputSchema.shape.dimensions,
  metrics: ga4ExploreInputSchema.shape.metrics,
  filters: ga4ExploreInputSchema.shape.filters,
  orderBy: ga4ExploreInputSchema.shape.orderBy,
  limit: ga4ExploreInputSchema.shape.limit,
});
export const metaSpecSchema = z.object({
  dimensions: metaExploreInputSchema.shape.dimensions,
  metrics: metaExploreInputSchema.shape.metrics,
  filters: metaExploreInputSchema.shape.filters,
  orderBy: metaExploreInputSchema.shape.orderBy,
  limit: metaExploreInputSchema.shape.limit,
});
export const scSpecSchema = z.object({
  dimensions: scExploreInputSchema.shape.dimensions,
  metrics: scExploreInputSchema.shape.metrics,
  filters: scExploreInputSchema.shape.filters,
  orderBy: scExploreInputSchema.shape.orderBy,
  limit: scExploreInputSchema.shape.limit,
});

// ---------------------------------------------------------------------------
// Result shape (same for both sources, so one table component renders both)
// ---------------------------------------------------------------------------

export interface ExploreColumn { key: string; label: string; type: ColumnType; role: 'dimension' | 'metric' }
export type ExploreCell = string | number | null;
export interface ExploreResult {
  source: 'ga4' | 'search_console' | 'meta' | 'data';
  columns: ExploreColumn[];
  rows: Record<string, ExploreCell>[];
  /** Totals for the metrics across the rows returned (GA4: reported by Google; Search Console: summed, position weighted). */
  totals: Record<string, ExploreCell> | null;
  rowCount: number;
  truncated: boolean;
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

function columnsFor(dims: string[], mets: string[], dimInfo: Map<string, FieldInfo>, metInfo: Map<string, FieldInfo>): ExploreColumn[] {
  return [
    ...dims.map((k) => ({ key: k, label: dimInfo.get(k)!.label, type: dimInfo.get(k)!.type, role: 'dimension' as const })),
    ...mets.map((k) => ({ key: k, label: metInfo.get(k)!.label, type: metInfo.get(k)!.type, role: 'metric' as const })),
  ];
}

const metaDim = lookup(META_DIMENSIONS);
const metaMet = lookup(META_METRICS);
const ga4Dim = lookup(GA4_DIMENSIONS);
const ga4Met = lookup(GA4_METRICS);
const scDim = lookup(SC_DIMENSIONS);
const scMet = lookup(SC_METRICS);

export const fieldLabel = (source: 'ga4' | 'search_console' | 'meta' | 'data', key: string): string =>
  (source === 'ga4' ? ga4Dim.get(key) ?? ga4Met.get(key) : source === 'meta' ? metaDim.get(key) ?? metaMet.get(key) : source === 'data' ? undefined : scDim.get(key) ?? scMet.get(key))?.label ?? key;

// ---------------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------------

const GA4_MATCH: Record<string, string> = { equals: 'EXACT', notEquals: 'EXACT', contains: 'CONTAINS', notContains: 'CONTAINS', startsWith: 'BEGINS_WITH' };

export function buildGA4ExplorePayload(input: GA4ExploreInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
    dimensions: input.dimensions.map((name) => ({ name })),
    metrics: input.metrics.map((name) => ({ name })),
    limit: input.limit,
    metricAggregations: ['TOTAL'],
  };
  if (input.filters.length > 0) {
    const exprs = input.filters.map((f) => {
      const leaf = { filter: { fieldName: f.field, stringFilter: { matchType: GA4_MATCH[f.op], value: f.value, caseSensitive: false } } };
      return f.op === 'notEquals' || f.op === 'notContains' ? { notExpression: leaf } : leaf;
    });
    payload.dimensionFilter = exprs.length === 1 ? exprs[0] : { andGroup: { expressions: exprs } };
  }
  if (input.orderBy) {
    payload.orderBys = [
      input.metrics.includes(input.orderBy.field)
        ? { metric: { metricName: input.orderBy.field }, desc: input.orderBy.desc }
        : { dimension: { dimensionName: input.orderBy.field }, desc: input.orderBy.desc },
    ];
  } else if (input.dimensions.includes('date')) {
    payload.orderBys = [{ dimension: { dimensionName: 'date' } }];
  } else {
    payload.orderBys = [{ metric: { metricName: input.metrics[0] }, desc: true }];
  }
  return payload;
}

interface GA4Resp {
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  totals?: { metricValues?: { value?: string }[] }[];
  rowCount?: number;
}

function ga4Value(type: ColumnType, raw: string | undefined): ExploreCell {
  if (type === 'text') return raw ?? '';
  if (type === 'date') {
    const s = (raw ?? '').trim();
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
  }
  const n = toNum(raw);
  if (type === 'percent') return Number((n * 100).toFixed(2)); // GA4 sends 0.6 for 60%
  if (type === 'decimal' || type === 'seconds') return Number(n.toFixed(2));
  return Math.round(n);
}

export function mapGA4Explore(resp: GA4Resp, input: GA4ExploreInput): ExploreResult {
  const columns = columnsFor(input.dimensions, input.metrics, ga4Dim, ga4Met);
  const rows = (resp.rows ?? []).map((r) => {
    const row: Record<string, ExploreCell> = {};
    input.dimensions.forEach((k, i) => { row[k] = ga4Value(ga4Dim.get(k)!.type, r.dimensionValues?.[i]?.value); });
    input.metrics.forEach((k, i) => { row[k] = ga4Value(ga4Met.get(k)!.type, r.metricValues?.[i]?.value); });
    return row;
  });
  const t = resp.totals?.[0]?.metricValues;
  const totals = t ? Object.fromEntries(input.metrics.map((k, i) => [k, ga4Value(ga4Met.get(k)!.type, t[i]?.value)])) : null;
  const rowCount = typeof resp.rowCount === 'number' ? resp.rowCount : rows.length;
  return { source: 'ga4', columns, rows, totals, rowCount, truncated: rowCount > rows.length };
}

// ---------------------------------------------------------------------------
// Search Console
// ---------------------------------------------------------------------------

export function buildSCExplorePayload(input: SCExploreInput): { startDate: string; endDate: string; dimensions: string[]; rowLimit: number; dimensionFilterGroups?: unknown[]; dataState: string } {
  const payload = {
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions: input.dimensions,
    rowLimit: input.limit,
    dataState: 'final',
  } as ReturnType<typeof buildSCExplorePayload>;
  if (input.filters.length > 0) {
    payload.dimensionFilterGroups = [{
      groupType: 'and',
      filters: input.filters.map((f) => ({ dimension: f.field, operator: f.op, expression: f.field === 'country' && (f.op === 'equals' || f.op === 'notEquals') ? countryToAlpha3(f.value) : f.value })),
    }];
  }
  return payload;
}

interface SCResp { rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[] }

function scDimValue(key: string, raw: string | undefined): string {
  const v = raw ?? '';
  if (key === 'country') return alpha3ToCountryName(v).country;
  return v;
}

function scMetricValue(key: string, row: NonNullable<SCResp['rows']>[number]): number {
  const v = toNum((row as Record<string, unknown>)[key]);
  if (key === 'ctr') return Number((v * 100).toFixed(2));
  if (key === 'position') return Number(v.toFixed(2));
  return Math.round(v);
}

export function mapSCExplore(resp: SCResp, input: SCExploreInput): ExploreResult {
  const columns = columnsFor(input.dimensions, input.metrics, scDim, scMet);
  const src = resp.rows ?? [];
  let rows = src.map((r) => {
    const row: Record<string, ExploreCell> = {};
    input.dimensions.forEach((k, i) => { row[k] = scDimValue(k, r.keys?.[i]); });
    input.metrics.forEach((k) => { row[k] = scMetricValue(k, r); });
    return row;
  });

  if (input.orderBy) {
    const { field, desc } = input.orderBy;
    const dir = desc ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = a[field]; const y = b[field];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x ?? '').localeCompare(String(y ?? '')) * dir;
    });
  } else if (input.dimensions.includes('date')) {
    rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  // Totals across the rows returned. CTR is recomputed and position is weighted by impressions; never averaged.
  let totals: Record<string, ExploreCell> | null = null;
  if (src.length > 0) {
    const clicks = src.reduce((s, r) => s + toNum(r.clicks), 0);
    const impressions = src.reduce((s, r) => s + toNum(r.impressions), 0);
    const weighted = src.reduce((s, r) => s + toNum(r.position) * toNum(r.impressions), 0);
    const all: Record<string, ExploreCell> = {
      clicks: Math.round(clicks),
      impressions: Math.round(impressions),
      ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      position: impressions > 0 ? Number((weighted / impressions).toFixed(2)) : null,
    };
    totals = Object.fromEntries(input.metrics.map((k) => [k, all[k]]));
  }
  return { source: 'search_console', columns, rows, totals, rowCount: rows.length, truncated: rows.length >= input.limit };
}

// ---------------------------------------------------------------------------
// Meta Ads (Marketing API insights; read-only)
// ---------------------------------------------------------------------------

const META_DIM_FIELD: Record<string, string> = {
  date: 'date_start', campaign: 'campaign_name', adset: 'adset_name', ad: 'ad_name',
  country: 'country', age: 'age', gender: 'gender', platform: 'publisher_platform', device: 'device_platform',
};
const META_FILTER_FIELD: Record<string, string> = { campaign: 'campaign.name', adset: 'adset.name', ad: 'ad.name' };
const META_FILTER_OP: Record<string, string> = { equals: 'EQUAL', notEquals: 'NOT_EQUAL', contains: 'CONTAIN', notContains: 'NOT_CONTAIN' };
const META_PAGE_ROWS = 500;

/** The query-string parameters for act_{id}/insights. Only allow-listed names ever reach Meta. */
export function buildMetaExploreParams(input: MetaExploreInput): Record<string, string | number> {
  const level = input.dimensions.includes('ad') || input.filters.some((f) => f.field === 'ad') ? 'ad'
    : input.dimensions.includes('adset') || input.filters.some((f) => f.field === 'adset') ? 'adset'
    : input.dimensions.includes('campaign') || input.filters.some((f) => f.field === 'campaign') ? 'campaign'
    : 'account';
  const nameFields = input.dimensions.filter((d) => d === 'campaign' || d === 'adset' || d === 'ad').map((d) => META_DIM_FIELD[d]);
  const breakdowns = input.dimensions.filter((d) => ['country', 'age', 'gender', 'platform', 'device'].includes(d)).map((d) => META_DIM_FIELD[d]);
  const params: Record<string, string | number> = {
    level,
    fields: [...new Set([...nameFields, ...input.metrics, 'account_currency', 'date_start'])].join(','),
    time_range: JSON.stringify({ since: input.startDate, until: input.endDate }),
    use_unified_attribution_setting: 'true',
    limit: META_PAGE_ROWS,
  };
  if (breakdowns.length > 0) params.breakdowns = breakdowns.join(',');
  if (input.dimensions.includes('date')) params.time_increment = 1;
  if (input.filters.length > 0) {
    params.filtering = JSON.stringify(input.filters.map((f) => ({ field: META_FILTER_FIELD[f.field], operator: META_FILTER_OP[f.op], value: f.value })));
  }
  return params;
}

const metaCountryNames = new Intl.DisplayNames(['en'], { type: 'region' });
function metaDimValue(key: string, raw: unknown): string {
  const v = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (key === 'country' && /^[A-Za-z]{2}$/.test(v)) {
    try { return metaCountryNames.of(v.toUpperCase()) ?? v; } catch { return v; }
  }
  return v;
}

function metaMetricValue(key: string, raw: unknown): number {
  const n = toNum(raw);
  const type = metaMet.get(key)!.type;
  if (type === 'integer') return Math.round(n);
  return Number(n.toFixed(2));
}

export function mapMetaExplore(rowsIn: Record<string, unknown>[], input: MetaExploreInput): ExploreResult {
  const columns = columnsFor(input.dimensions, input.metrics, metaDim, metaMet);
  let rows = rowsIn.map((r) => {
    const row: Record<string, ExploreCell> = {};
    input.dimensions.forEach((k) => { row[k] = metaDimValue(k, r[META_DIM_FIELD[k]]); });
    input.metrics.forEach((k) => { row[k] = metaMetricValue(k, r[k]); });
    return row;
  });

  if (input.orderBy) {
    const { field, desc } = input.orderBy;
    const dir = desc ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = a[field]; const y = b[field];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x ?? '').localeCompare(String(y ?? '')) * dir;
    });
  } else if (input.dimensions.includes('date')) {
    rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  } else if (input.metrics.length > 0) {
    const first = input.metrics[0];
    rows = [...rows].sort((a, b) => Number(b[first] ?? 0) - Number(a[first] ?? 0));
  }

  // Totals: sums where a sum is meaningful; ratios recomputed; reach and frequency cannot be added up across rows.
  let totals: Record<string, ExploreCell> | null = null;
  if (rowsIn.length > 0) {
    const sum = (k: string) => rowsIn.reduce((s, r) => s + toNum(r[k]), 0);
    const spend = sum('spend');
    const impressions = sum('impressions');
    const clicks = sum('clicks');
    const all: Record<string, ExploreCell> = {
      spend: Number(spend.toFixed(2)),
      impressions: Math.round(impressions),
      reach: null,
      frequency: null,
      clicks: Math.round(clicks),
      inline_link_clicks: Math.round(sum('inline_link_clicks')),
      ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      cpc: clicks > 0 ? Number((spend / clicks).toFixed(2)) : null,
      cpm: impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(2)) : null,
    };
    totals = Object.fromEntries(input.metrics.map((k) => [k, all[k]]));
  }
  const truncated = rows.length > input.limit;
  rows = rows.slice(0, input.limit);
  return { source: 'meta', columns, rows, totals, rowCount: rowsIn.length, truncated };
}
