/**
 * Meta Ads ↔ GA4 campaign matching (Sprint 11, cross-channel snapshot). Pure functions.
 *
 * Joins each Meta campaign (spend, clicks, leads) to the GA4 sessions it produced, using the
 * utm_campaign value that GA4 reports as sessionCampaignName. This shows spend next to what
 * visitors actually did on the site, and flags tracking gaps.
 *
 * Matching order (first that applies):
 *   1. id      — the GA4 campaign value contains the Meta campaign ID (e.g. utm_campaign={{campaign.id}})
 *   2. exact   — names are equal after normalisation (case, spaces, underscores, dashes, accents)
 *   3. likely  — high word overlap (Jaccard ≥ 0.6) with a single clear best candidate
 * Only GA4 rows whose source/medium looks like Meta are used, unless none exist for that
 * campaign (then any source is used and the row is flagged).
 */

export interface MetaCampaignInput {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number; // link clicks
  leads: number;
}

export interface GA4CampaignInput {
  campaign: string; // sessionCampaignName
  source: string;
  medium: string;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
}

export type MatchType = 'id' | 'exact' | 'likely' | 'none';
export type CampaignFlag = 'no_utm_traffic' | 'low_landing_rate' | 'source_not_meta' | 'likely_match_only';

export interface CampaignJoinRow {
  metaCampaignId: string;
  metaCampaignName: string;
  matchType: MatchType;
  matchedGa4Campaigns: string[];
  spend: number;
  clicks: number;
  leads: number;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  /** Sessions ÷ link clicks, percent. Low values suggest broken links, slow pages or missing tags. */
  landingRate: number | null;
  costPerSession: number | null;
  costPerEngagedSession: number | null;
  costPerKeyEvent: number | null;
  flags: CampaignFlag[];
}

export interface CampaignJoinResult {
  rows: CampaignJoinRow[];
  /** Meta-tagged GA4 campaigns that didn't match any Meta campaign (renamed or typo'd UTMs). */
  unmatchedGa4MetaCampaigns: { campaign: string; sessions: number; keyEvents: number }[];
  totals: {
    spend: number;
    sessions: number;
    engagedSessions: number;
    keyEvents: number;
    costPerEngagedSession: number | null;
    costPerKeyEvent: number | null;
    spendWithoutTracking: number;
  };
  rules: string[];
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s.replace(/\+/g, ' ');
  }
}

/** "Spring Sale — Lead Gen" and "spring_sale-lead+gen" both → "springsaleleadgen". */
export function campaignKey(name: string): string {
  return safeDecode(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function campaignTokens(name: string): Set<string> {
  return new Set(
    safeDecode(name)
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const META_SOURCES = /^(facebook|fb|instagram|ig|meta|messenger|msg|an|audience[-_ ]?network|threads)(\.com)?$|(^|\.)facebook\.com$|(^|\.)instagram\.com$/;
const META_MEDIUMS = /^(paid[-_ ]?social|social[-_ ]?paid|cpc|ppc|paid|paidsocial|facebook[-_ ]?ads|meta[-_ ]?ads)$/;

export function isMetaTraffic(source: string, medium: string): boolean {
  const s = source.trim().toLowerCase().replace(/^(www|m|l|lm)\./, '');
  const m = medium.trim().toLowerCase();
  return META_SOURCES.test(s) || (META_MEDIUMS.test(m) && /face|insta|meta|fb|ig/.test(s));
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function per(spend: number, count: number): number | null {
  return count > 0 ? round(spend / count, 2) : null;
}

interface Ga4Group {
  campaign: string;
  key: string;
  tokens: Set<string>;
  metaRows: GA4CampaignInput[];
  otherRows: GA4CampaignInput[];
}

const NOT_SET = new Set(['(not set)', '(direct)', '(organic)', '(referral)', '']);

export function joinMetaWithGa4(
  metaCampaigns: MetaCampaignInput[],
  ga4Rows: GA4CampaignInput[],
  opts: { lowLandingRatePercent?: number; minClicksForLandingCheck?: number } = {}
): CampaignJoinResult {
  const lowRate = opts.lowLandingRatePercent ?? 50;
  const minClicks = opts.minClicksForLandingCheck ?? 50;

  // Group GA4 rows by campaign value
  const groups = new Map<string, Ga4Group>();
  for (const r of ga4Rows) {
    if (NOT_SET.has(r.campaign.trim().toLowerCase())) continue;
    const g = groups.get(r.campaign) ?? {
      campaign: r.campaign,
      key: campaignKey(r.campaign),
      tokens: campaignTokens(r.campaign),
      metaRows: [],
      otherRows: [],
    };
    (isMetaTraffic(r.source, r.medium) ? g.metaRows : g.otherRows).push(r);
    groups.set(r.campaign, g);
  }
  const allGroups = [...groups.values()];
  const used = new Set<string>();

  const rows: CampaignJoinRow[] = metaCampaigns.map((mc) => {
    const key = campaignKey(mc.name);
    const tokens = campaignTokens(mc.name);
    let matchType: MatchType = 'none';
    let matched: Ga4Group[] = allGroups.filter((g) => mc.id && g.campaign.includes(mc.id));
    if (matched.length) matchType = 'id';
    if (!matched.length && key) {
      matched = allGroups.filter((g) => g.key === key);
      if (matched.length) matchType = 'exact';
    }
    if (!matched.length && tokens.size) {
      const scored = allGroups
        .map((g) => ({ g, s: jaccard(tokens, g.tokens) }))
        .filter((x) => x.s >= 0.6)
        .sort((a, b) => b.s - a.s);
      if (scored.length && (scored.length === 1 || scored[0].s - scored[1].s >= 0.15)) {
        matched = [scored[0].g];
        matchType = 'likely';
      }
    }
    matched.forEach((g) => used.add(g.campaign));

    const metaRows = matched.flatMap((g) => g.metaRows);
    const sourceRows = metaRows.length ? metaRows : matched.flatMap((g) => g.otherRows);
    const sessions = sourceRows.reduce((s, r) => s + r.sessions, 0);
    const engagedSessions = sourceRows.reduce((s, r) => s + r.engagedSessions, 0);
    const keyEvents = sourceRows.reduce((s, r) => s + r.keyEvents, 0);

    const flags: CampaignFlag[] = [];
    if (mc.spend > 0 && sessions === 0) flags.push('no_utm_traffic');
    if (matched.length && !metaRows.length && sessions > 0) flags.push('source_not_meta');
    if (matchType === 'likely') flags.push('likely_match_only');
    const landingRate = mc.clicks > 0 ? round((sessions / mc.clicks) * 100, 1) : null;
    if (landingRate !== null && mc.clicks >= minClicks && sessions > 0 && landingRate < lowRate) {
      flags.push('low_landing_rate');
    }

    return {
      metaCampaignId: mc.id,
      metaCampaignName: mc.name,
      matchType,
      matchedGa4Campaigns: matched.map((g) => g.campaign),
      spend: round(mc.spend),
      clicks: mc.clicks,
      leads: mc.leads,
      sessions,
      engagedSessions,
      keyEvents,
      landingRate,
      costPerSession: per(mc.spend, sessions),
      costPerEngagedSession: per(mc.spend, engagedSessions),
      costPerKeyEvent: per(mc.spend, keyEvents),
      flags,
    };
  });

  rows.sort((a, b) => b.spend - a.spend);

  const unmatchedGa4MetaCampaigns = allGroups
    .filter((g) => !used.has(g.campaign) && g.metaRows.length > 0)
    .map((g) => ({
      campaign: g.campaign,
      sessions: g.metaRows.reduce((s, r) => s + r.sessions, 0),
      keyEvents: g.metaRows.reduce((s, r) => s + r.keyEvents, 0),
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const sessions = rows.reduce((s, r) => s + r.sessions, 0);
  const engagedSessions = rows.reduce((s, r) => s + r.engagedSessions, 0);
  const keyEvents = rows.reduce((s, r) => s + r.keyEvents, 0);

  return {
    rows,
    unmatchedGa4MetaCampaigns,
    totals: {
      spend: round(spend),
      sessions,
      engagedSessions,
      keyEvents,
      costPerEngagedSession: per(spend, engagedSessions),
      costPerKeyEvent: per(spend, keyEvents),
      spendWithoutTracking: round(rows.filter((r) => r.flags.includes('no_utm_traffic')).reduce((s, r) => s + r.spend, 0)),
    },
    rules: [
      'Campaigns are matched by Meta campaign ID inside utm_campaign, then by name (ignoring case, spaces and symbols), then by close word overlap.',
      'Only GA4 sessions from Meta sources (facebook, instagram, fb, ig, meta…) are counted, unless a campaign has none.',
      `"No tracked traffic": the campaign spent money but GA4 recorded no sessions with its utm_campaign. Check the UTM tags on its ads.`,
      `"Low landing rate": fewer than ${lowRate}% of link clicks became GA4 sessions (min. ${minClicks} clicks). Check page speed, broken links or consent banners.`,
      'Tip: set utm_campaign={{campaign.id}} or {{campaign.name}} in Meta ads so matching is exact.',
    ],
  };
}

export const CAMPAIGN_FLAG_LABELS: Record<CampaignFlag, string> = {
  no_utm_traffic: 'No tracked traffic in GA4',
  low_landing_rate: 'Many clicks never reached the site',
  source_not_meta: 'Matched traffic is not tagged as Meta',
  likely_match_only: 'Matched by similar name; check UTMs',
};
