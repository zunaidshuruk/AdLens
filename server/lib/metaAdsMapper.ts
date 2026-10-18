/**
 * Meta Marketing API → AdLens mapper.
 *
 * Pure functions only: no network calls, no tokens. The Sprint 5 route layer fetches
 * raw Graph API responses (handling pagination) and passes them in here.
 *
 * Conventions (match Ads Manager's default columns):
 * - "clicks" = LINK clicks (inline_link_clicks), not all clicks.
 * - CTR = link clicks / impressions × 100 (percent, 2 decimals).
 * - CPC = spend / link clicks; CPM = spend / impressions × 1000; CPL = spend / leads.
 * - Derived metrics are recomputed from summed totals, never averaged across rows.
 * - Reach is NOT additive across days or entities. Totals must come from a single
 *   un-split insights request (no time_increment); daily rows are never summed for reach.
 * - Money values stay in the ad account's currency (insights `spend` is already in
 *   currency units, not cents). Field names ending in "Usd" are legacy; see Sprint 5.
 */

import type {
  MetaAdRow,
  MetaAdSetRow,
  MetaAdsOverview,
  MetaCampaignRow,
  MetaEntityMetrics,
  MetaSpendPoint,
  MetricWithComparison,
} from '../../src/types/index.ts';
import { enumerateDates } from '../../src/utils/dateUtils.ts';
import { calculatePercentChange } from '../../src/utils/formatters.ts';

// ---------------------------------------------------------------------------
// Raw Graph API shapes (only the fields AdLens requests)
// ---------------------------------------------------------------------------

export interface MetaActionValue {
  action_type?: string;
  value?: string;
}

export interface MetaInsightsRow {
  date_start?: string;
  date_stop?: string;
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  inline_link_clicks?: string;
  clicks?: string;
  actions?: MetaActionValue[];
}

export interface MetaCampaignObject {
  id: string;
  name?: string;
  objective?: string;
  effective_status?: string;
}

export interface MetaTargeting {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: {
    countries?: string[];
    cities?: { name?: string }[];
    regions?: { name?: string }[];
  };
  custom_audiences?: { id?: string; name?: string }[];
  excluded_custom_audiences?: { id?: string; name?: string }[];
  flexible_spec?: Record<string, { id?: string; name?: string }[]>[];
}

export interface MetaAdSetObject {
  id: string;
  name?: string;
  campaign_id?: string;
  effective_status?: string;
  targeting?: MetaTargeting;
}

export interface MetaCreative {
  object_type?: string;
  video_id?: string;
  object_story_spec?: {
    video_data?: unknown;
    link_data?: { child_attachments?: unknown[] };
  };
  asset_feed_spec?: { videos?: unknown[]; images?: unknown[] };
}

export interface MetaAdObject {
  id: string;
  name?: string;
  adset_id?: string;
  campaign_id?: string;
  effective_status?: string;
  creative?: MetaCreative;
}

// ---------------------------------------------------------------------------
// Label types (Sprint 5 widens the unions in src/types/index.ts to these)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(val: string | number | undefined | null): number {
  if (val === undefined || val === null || val === '') return 0;
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : 0;
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

/**
 * Lead action types in priority order. Meta reports overlapping action types:
 * "lead" is already the combined total, so it must never be added to the others.
 * Only if "lead" is absent do we sum Instant Form + website (Pixel) leads.
 */
export const LEAD_TOTAL_ACTION = 'lead';
export const LEAD_COMPONENT_ACTIONS = [
  'onsite_conversion.lead_grouped', // Instant Forms
  'offsite_conversion.fb_pixel_lead', // Website leads via Meta Pixel
] as const;
export const LEAD_LAST_RESORT_ACTION = 'leadgen_grouped';

export function extractLeads(actions: MetaActionValue[] | undefined): number {
  if (!actions || actions.length === 0) return 0;
  const byType = new Map<string, number>();
  for (const a of actions) {
    if (a.action_type) byType.set(a.action_type, toNum(a.value));
  }
  if (byType.has(LEAD_TOTAL_ACTION)) return Math.round(byType.get(LEAD_TOTAL_ACTION)!);
  const componentSum = LEAD_COMPONENT_ACTIONS.reduce((sum, t) => sum + (byType.get(t) ?? 0), 0);
  if (componentSum > 0) return Math.round(componentSum);
  return Math.round(byType.get(LEAD_LAST_RESORT_ACTION) ?? 0);
}

interface RawTotals {
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  leads: number;
}

function rawTotals(row: MetaInsightsRow | undefined): RawTotals {
  return {
    spend: toNum(row?.spend),
    impressions: toNum(row?.impressions),
    reach: toNum(row?.reach),
    linkClicks: toNum(row?.inline_link_clicks),
    leads: extractLeads(row?.actions),
  };
}

/** Sum rows that share an entity (e.g. paginated or split rows). Reach is summed only as a fallback. */
function sumRows(rows: MetaInsightsRow[]): RawTotals {
  return rows.reduce<RawTotals>(
    (acc, r) => {
      const t = rawTotals(r);
      return {
        spend: acc.spend + t.spend,
        impressions: acc.impressions + t.impressions,
        reach: acc.reach + t.reach,
        linkClicks: acc.linkClicks + t.linkClicks,
        leads: acc.leads + t.leads,
      };
    },
    { spend: 0, impressions: 0, reach: 0, linkClicks: 0, leads: 0 }
  );
}

export function deriveMetrics(t: RawTotals): MetaEntityMetrics {
  return {
    spendUsd: round(t.spend, 2),
    impressions: Math.round(t.impressions),
    reach: Math.round(t.reach),
    frequency: round(safeDiv(t.impressions, t.reach), 2),
    clicks: Math.round(t.linkClicks),
    ctr: round(safeDiv(t.linkClicks, t.impressions) * 100, 2),
    cpcUsd: round(safeDiv(t.spend, t.linkClicks), 2),
    cpmUsd: round(safeDiv(t.spend, t.impressions) * 1000, 2),
    leads: Math.round(t.leads),
    cplUsd: round(safeDiv(t.spend, t.leads), 2),
  };
}

function withComparison(value: number, previousValue: number): MetricWithComparison {
  return { value, previousValue, changePercent: calculatePercentChange(value, previousValue) };
}

// ---------------------------------------------------------------------------
// Label mapping
// ---------------------------------------------------------------------------

const OBJECTIVE_MAP: Record<string, MetaObjectiveLabel> = {
  // Current (ODAX) objectives
  OUTCOME_LEADS: 'Lead Generation',
  OUTCOME_AWARENESS: 'Brand Awareness',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_SALES: 'Sales',
  OUTCOME_APP_PROMOTION: 'App Promotion',
  // Legacy objectives still returned for older campaigns
  LEAD_GENERATION: 'Lead Generation',
  BRAND_AWARENESS: 'Brand Awareness',
  REACH: 'Brand Awareness',
  LINK_CLICKS: 'Traffic',
  POST_ENGAGEMENT: 'Engagement',
  PAGE_LIKES: 'Engagement',
  EVENT_RESPONSES: 'Engagement',
  CONVERSIONS: 'Sales',
  PRODUCT_CATALOG_SALES: 'Sales',
  STORE_VISITS: 'Sales',
  APP_INSTALLS: 'App Promotion',
  VIDEO_VIEWS: 'Video Views',
  MESSAGES: 'Messages',
};

export function mapObjective(raw: string | undefined): MetaObjectiveLabel {
  return (raw && OBJECTIVE_MAP[raw.toUpperCase()]) || 'Other';
}

export function mapStatus(raw: string | undefined): MetaStatusLabel {
  switch ((raw ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'Active';
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
    case 'ADSET_PAUSED':
      return 'Paused';
    case 'PENDING_REVIEW':
    case 'IN_PROCESS':
    case 'PREAPPROVED':
    case 'PENDING_BILLING_INFO':
      return 'In Review';
    case 'DISAPPROVED':
      return 'Rejected';
    case 'WITH_ISSUES':
      return 'With Issues';
    case 'ARCHIVED':
      return 'Archived';
    case 'DELETED':
      return 'Deleted';
    default:
      return 'Paused';
  }
}

export function mapAdFormat(creative: MetaCreative | undefined): MetaFormatLabel {
  if (!creative) return 'Other';
  const feed = creative.asset_feed_spec;
  if (feed && ((feed.videos?.length ?? 0) + (feed.images?.length ?? 0) > 1)) return 'Dynamic';
  if ((creative.object_story_spec?.link_data?.child_attachments?.length ?? 0) > 1) return 'Carousel';
  const type = (creative.object_type ?? '').toUpperCase();
  if (type === 'VIDEO' || creative.video_id || creative.object_story_spec?.video_data) return 'Video';
  if (type === 'PHOTO' || type === 'SHARE' || type === 'LINK' || type === 'STATUS') return 'Single Image';
  return 'Other';
}

const GENDER_LABEL: Record<number, string> = { 1: 'Men', 2: 'Women' };

/** Short, human-readable targeting summary, e.g. "BD · 25–54 · Women · 2 audiences · 3 interests". */
export function summarizeTargeting(t: MetaTargeting | undefined): string {
  if (!t) return 'Not specified';
  const parts: string[] = [];

  const geo = t.geo_locations;
  const places = [
    ...(geo?.countries ?? []),
    ...(geo?.regions ?? []).map((r) => r.name).filter(Boolean),
    ...(geo?.cities ?? []).map((c) => c.name).filter(Boolean),
  ] as string[];
  if (places.length > 0) {
    parts.push(places.length > 3 ? `${places.slice(0, 3).join(', ')} +${places.length - 3}` : places.join(', '));
  }

  const ageMin = t.age_min ?? 18;
  const ageMax = t.age_max ?? 65;
  parts.push(ageMax >= 65 ? `${ageMin}–65+` : `${ageMin}–${ageMax}`);

  const genders = (t.genders ?? []).map((g) => GENDER_LABEL[g]).filter(Boolean);
  parts.push(genders.length === 1 ? genders[0] : 'All genders');

  const audiences = t.custom_audiences?.length ?? 0;
  if (audiences > 0) parts.push(`${audiences} custom audience${audiences > 1 ? 's' : ''}`);

  const interestCount = (t.flexible_spec ?? []).reduce(
    (sum, spec) => sum + Object.values(spec).reduce((s, list) => s + (Array.isArray(list) ? list.length : 0), 0),
    0
  );
  if (interestCount > 0) parts.push(`${interestCount} interest${interestCount > 1 ? 's' : ''}`);

  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Report mappers
// ---------------------------------------------------------------------------

/**
 * Overview from ONE account-level insights row per period (no time_increment, no breakdowns),
 * so reach is properly de-duplicated by Meta.
 */
export function mapMetaOverview(
  current: MetaInsightsRow | undefined,
  previous?: MetaInsightsRow
): MetaAdsOverview {
  const c = deriveMetrics(rawTotals(current));
  const p = deriveMetrics(rawTotals(previous));
  return {
    spendUsd: withComparison(c.spendUsd, p.spendUsd),
    impressions: withComparison(c.impressions, p.impressions),
    reach: withComparison(c.reach, p.reach),
    frequency: withComparison(c.frequency, p.frequency),
    clicks: withComparison(c.clicks, p.clicks),
    ctr: withComparison(c.ctr, p.ctr),
    cpcUsd: withComparison(c.cpcUsd, p.cpcUsd),
    cpmUsd: withComparison(c.cpmUsd, p.cpmUsd),
    leads: withComparison(c.leads, p.leads),
    cplUsd: withComparison(c.cplUsd, p.cplUsd),
  };
}

/** Daily series from account-level insights with time_increment=1. Missing days are zero-filled. */
export function mapMetaSpendOverTime(
  currentDaily: MetaInsightsRow[],
  startDate: string,
  endDate: string,
  previousDaily: MetaInsightsRow[] = [],
  compareStartDate?: string,
  compareEndDate?: string
): MetaSpendPoint[] {
  const groupByDay = (rows: MetaInsightsRow[]) => {
    const map = new Map<string, MetaInsightsRow[]>();
    for (const r of rows) {
      if (!r.date_start) continue;
      const list = map.get(r.date_start) ?? [];
      list.push(r);
      map.set(r.date_start, list);
    }
    return map;
  };
  const curr = groupByDay(currentDaily);
  const prev = groupByDay(previousDaily);
  const compareDates =
    compareStartDate && compareEndDate ? enumerateDates(compareStartDate, compareEndDate) : [];

  return enumerateDates(startDate, endDate).map((date, idx) => {
    const t = sumRows(curr.get(date) ?? []);
    const compareDate = compareDates[idx];
    const pt = sumRows(compareDate ? prev.get(compareDate) ?? [] : []);
    return {
      date,
      ...(compareDate ? { compareDate } : {}),
      spendUsd: round(t.spend, 2),
      previousSpendUsd: round(pt.spend, 2),
      clicks: Math.round(t.linkClicks),
      leads: Math.round(t.leads),
      impressions: Math.round(t.impressions),
    };
  });
}

/**
 * Should an entity appear in tables? Show anything that delivered in the range or is
 * still live/pending; hide archived/deleted/paused entities with zero delivery.
 */
function shouldInclude(status: MetaStatusLabel, metrics: MetaEntityMetrics): boolean {
  if (metrics.impressions > 0 || metrics.spendUsd > 0) return true;
  return status === 'Active' || status === 'In Review' || status === 'With Issues';
}

function groupInsightsBy(rows: MetaInsightsRow[], key: 'campaign_id' | 'adset_id' | 'ad_id') {
  const map = new Map<string, MetaInsightsRow[]>();
  for (const r of rows) {
    const id = r[key];
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(r);
    map.set(id, list);
  }
  return map;
}

/**
 * Campaign table: campaign objects joined with insights (level=campaign, no time_increment).
 * Insights rows for campaigns missing from the object list (e.g. deleted) are still shown.
 */
export function mapMetaCampaigns(
  campaigns: MetaCampaignObject[],
  insights: MetaInsightsRow[]
): MetaCampaignRow[] {
  const byId = groupInsightsBy(insights, 'campaign_id');
  const seen = new Set<string>();
  const rows: MetaCampaignRow[] = [];

  for (const c of campaigns) {
    seen.add(c.id);
    const metrics = deriveMetrics(sumRows(byId.get(c.id) ?? []));
    const status = mapStatus(c.effective_status);
    if (!shouldInclude(status, metrics)) continue;
    rows.push({
      id: c.id,
      name: c.name ?? `Campaign ${c.id}`,
      objective: mapObjective(c.objective) as MetaCampaignRow['objective'],
      status: status as MetaCampaignRow['status'],
      ...metrics,
    });
  }

  for (const [id, list] of byId) {
    if (seen.has(id)) continue;
    const metrics = deriveMetrics(sumRows(list));
    if (metrics.impressions === 0 && metrics.spendUsd === 0) continue;
    rows.push({
      id,
      name: list[0]?.campaign_name ?? `Campaign ${id}`,
      objective: 'Other' as MetaCampaignRow['objective'],
      status: 'Deleted' as MetaCampaignRow['status'],
      ...metrics,
    });
  }

  return rows.sort((a, b) => b.spendUsd - a.spendUsd);
}

/** Ad set table (optionally for one campaign): ad set objects joined with level=adset insights. */
export function mapMetaAdSets(
  adSets: MetaAdSetObject[],
  insights: MetaInsightsRow[],
  campaignNames: Map<string, string>,
  campaignId?: string
): MetaAdSetRow[] {
  const byId = groupInsightsBy(insights, 'adset_id');
  const rows: MetaAdSetRow[] = [];

  for (const s of adSets) {
    if (campaignId && s.campaign_id !== campaignId) continue;
    const list = byId.get(s.id) ?? [];
    const metrics = deriveMetrics(sumRows(list));
    const status = mapStatus(s.effective_status);
    if (!shouldInclude(status, metrics)) continue;
    const cId = s.campaign_id ?? list[0]?.campaign_id ?? '';
    rows.push({
      id: s.id,
      campaignId: cId,
      campaignName: campaignNames.get(cId) ?? list[0]?.campaign_name ?? '',
      name: s.name ?? `Ad set ${s.id}`,
      audience: summarizeTargeting(s.targeting),
      status: status as MetaAdSetRow['status'],
      ...metrics,
    });
  }

  return rows.sort((a, b) => b.spendUsd - a.spendUsd);
}

/** Ad table (optionally for one ad set): ad objects joined with level=ad insights. */
export function mapMetaAds(
  ads: MetaAdObject[],
  insights: MetaInsightsRow[],
  adSetNames: Map<string, string>,
  campaignNames: Map<string, string>,
  adSetId?: string
): MetaAdRow[] {
  const byId = groupInsightsBy(insights, 'ad_id');
  const rows: MetaAdRow[] = [];

  for (const ad of ads) {
    if (adSetId && ad.adset_id !== adSetId) continue;
    const list = byId.get(ad.id) ?? [];
    const metrics = deriveMetrics(sumRows(list));
    const status = mapStatus(ad.effective_status);
    if (!shouldInclude(status, metrics)) continue;
    const sId = ad.adset_id ?? list[0]?.adset_id ?? '';
    const cId = ad.campaign_id ?? list[0]?.campaign_id ?? '';
    rows.push({
      id: ad.id,
      adSetId: sId,
      adSetName: adSetNames.get(sId) ?? list[0]?.adset_name ?? '',
      campaignId: cId,
      campaignName: campaignNames.get(cId) ?? list[0]?.campaign_name ?? '',
      name: ad.name ?? `Ad ${ad.id}`,
      format: mapAdFormat(ad.creative) as MetaAdRow['format'],
      status: status as MetaAdRow['status'],
      ...metrics,
    });
  }

  return rows.sort((a, b) => b.spendUsd - a.spendUsd);
}

/** Maps Graph API error payloads to AdLens error codes (never forward raw messages). */
export function mapMetaErrorCode(err: { code?: number; error_subcode?: number; type?: string } | undefined): string {
  if (!err) return 'META_REQUEST_FAILED';
  if (err.code === 190) return 'META_TOKEN_INVALID'; // expired / revoked token
  if (err.code === 10 || err.code === 200 || (err.code ?? 0) >= 200 && (err.code ?? 0) < 300) {
    return 'META_PERMISSION_DENIED';
  }
  if (err.code === 4 || err.code === 17 || err.code === 32 || err.code === 613 || err.code === 80004) {
    return 'META_RATE_LIMITED';
  }
  if (err.code === 100) return 'META_INVALID_REQUEST';
  return 'META_REQUEST_FAILED';
}
