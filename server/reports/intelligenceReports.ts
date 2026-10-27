import { z } from 'zod';
import { escapeRegex } from '../lib/aiSourceFilter.js';
import { joinMetaWithGa4, type GA4CampaignInput, type MetaCampaignInput } from '../lib/campaignMatcher.js';
import { comparisonPeriod } from '../lib/dateMath.js';
import { GoogleApiError } from '../lib/google.js';
import { buildHostBreakdown, type GA4HostRow, type SearchPageRow } from '../lib/hostBreakdown.js';
import { MetaApiError, metaGet } from '../lib/meta.js';
import { mapMetaCampaigns, type MetaCampaignObject, type MetaInsightsRow } from '../lib/metaAdsMapper.js';
import { joinPages, normalisePath, type Ga4PageInput } from '../lib/pageJoin.js';
import { callSearchConsoleQuery, listSitemaps } from '../lib/searchConsoleApi.js';
import {
  classifyTrends,
  detectCannibalisation,
  findOpportunities,
  groupQueriesIntoTopics,
  type SearchRow,
} from '../lib/searchInsights.js';
import type { SearchConsoleApiRow } from '../lib/searchConsoleMapper.js';
import { callGA4RunReport, ga4OverviewReport } from './ga4Reports.js';
import { reportRegistry } from './registry.js';
import { dateRangeBaseObject, dateRangeSchema, type DateRangeInput } from './schemas.js';
import type { ReportContext, ReportDefinition } from './types.js';

/**
 * Sprint 11 (search intelligence) and Sprint 12 (pages, snapshot, cross-channel) reports.
 * They are registered like every other report, so screens, dashboards, Explore and the AI analyst can all use them.
 */

function ga4Property(ctx: ReportContext): string {
  const id = ctx.project?.ga4PropertyId || ctx.ga4PropertyId;
  if (!id) throw new GoogleApiError('GA4_NOT_SELECTED', 'A connected Google account with a selected GA4 property is required.', 409);
  return id.replace(/^properties\//, '');
}

function scSite(ctx: ReportContext): string {
  const s = ctx.project?.searchConsoleSite || ctx.searchConsoleSite;
  if (!s) throw new GoogleApiError('SC_NOT_SELECTED', 'A connected Google account with a selected Search Console site is required.', 409);
  return s;
}

const hasGa4 = (ctx: ReportContext) => Boolean(ctx.project?.ga4PropertyId || ctx.ga4PropertyId);
const hasSc = (ctx: ReportContext) => Boolean(ctx.project?.searchConsoleSite || ctx.searchConsoleSite);

const num = (v: string | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function toSearchRows(rows: SearchConsoleApiRow[] | undefined, dims: ('query' | 'page')[]): SearchRow[] {
  return (rows ?? []).map((r) => {
    const row: SearchRow = { clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, position: r.position ?? 0 };
    dims.forEach((d, i) => {
      row[d] = r.keys?.[i] ?? '';
    });
    return row;
  });
}

async function scRows(ctx: ReportContext, range: { startDate: string; endDate: string }, dims: ('query' | 'page')[], rowLimit: number) {
  const token = await ctx.getAccessToken();
  const resp = await callSearchConsoleQuery(scSite(ctx), token, { ...range, dimensions: dims, rowLimit });
  return toSearchRows(resp.rows, dims);
}

function brandWords(ctx: ReportContext): string[] {
  const words = new Set<string>();
  for (const t of ctx.project?.brandTerms ?? []) {
    const s = t.trim().toLowerCase();
    if (s) {
      words.add(s);
      for (const w of s.split(/[^a-z0-9ঀ-৿]+/)) if (w.length > 1) words.add(w);
    }
  }
  const name = (ctx.project?.name ?? '').trim().toLowerCase();
  if (name) {
    words.add(name);
    for (const w of name.split(/[^a-z0-9ঀ-৿]+/)) if (w.length > 2) words.add(w);
  }
  return [...words];
}

// ---------------------------------------------------------------------------
// Sprint 11
// ---------------------------------------------------------------------------

export const searchTrendsReport: ReportDefinition<DateRangeInput, unknown> = reportRegistry.register({
  id: 'searchConsole.trends',
  title: 'Search trends: rising, falling, new and lost',
  description:
    'Compares Search Console clicks for each search query and each page against the comparison period (or the previous period of the same length) and lists what is rising, falling, brand new or lost. Use to answer "what changed in search?".',
  source: 'search_console',
  input: dateRangeSchema,
  async run(ctx, input) {
    const prev = comparisonPeriod(input);
    const [qNow, qPrev, pNow, pPrev] = await Promise.all([
      scRows(ctx, input, ['query'], 1000),
      scRows(ctx, prev, ['query'], 1000),
      scRows(ctx, input, ['page'], 1000),
      scRows(ctx, prev, ['page'], 1000),
    ]);
    const toMap = (rows: SearchRow[], key: 'query' | 'page') => new Map(rows.map((r) => [r[key] as string, r.clicks]));
    return {
      period: { startDate: input.startDate, endDate: input.endDate },
      comparedWith: prev,
      queries: classifyTrends(toMap(qNow, 'query'), toMap(qPrev, 'query')),
      pages: classifyTrends(toMap(pNow, 'page'), toMap(pPrev, 'page')),
    };
  },
});

export const searchOpportunitiesReport: ReportDefinition<DateRangeInput, unknown> = reportRegistry.register({
  id: 'searchConsole.opportunities',
  title: 'SEO opportunities',
  description:
    'Finds search queries ranking between positions 5 and 20 whose click-through rate is well below what is typical for that position, with an estimate of the extra clicks a better title or description could bring. The rules used are returned with the result.',
  source: 'search_console',
  input: dateRangeSchema,
  async run(ctx, input) {
    const rows = await scRows(ctx, input, ['query'], 1000);
    return { period: { startDate: input.startDate, endDate: input.endDate }, ...findOpportunities(rows) };
  },
});

export const searchCannibalisationReport: ReportDefinition<DateRangeInput, unknown> = reportRegistry.register({
  id: 'searchConsole.cannibalisation',
  title: 'Keyword cannibalisation',
  description:
    'Finds search queries where two or more of your own pages share the impressions, which can split ranking power between them. Returns each query with the competing pages and their share.',
  source: 'search_console',
  input: dateRangeSchema,
  async run(ctx, input) {
    const rows = await scRows(ctx, input, ['query', 'page'], 5000);
    return {
      period: { startDate: input.startDate, endDate: input.endDate },
      rules: [
        'The query has at least 50 impressions.',
        'Two or more of your pages each get at least 10% of that query\'s impressions.',
      ],
      queries: detectCannibalisation(rows).slice(0, 50),
    };
  },
});

export const searchTopicsReport: ReportDefinition<DateRangeInput, unknown> = reportRegistry.register({
  id: 'searchConsole.topics',
  title: 'Search topics',
  description:
    'Groups search queries into topics by shared words and phrases, ignoring the project\'s brand name, and shows clicks and impressions per topic. A quick orientation, not semantic clustering.',
  source: 'search_console',
  input: dateRangeSchema,
  async run(ctx, input) {
    const rows = await scRows(ctx, input, ['query'], 1000);
    const ignore = brandWords(ctx);
    const topics = groupQueriesIntoTopics(rows, { ignore })
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 40)
      .map((t) => ({ ...t, queries: t.queries.slice(0, 10) }));
    return { period: { startDate: input.startDate, endDate: input.endDate }, ignoredBrandWords: ignore, topics };
  },
});

const noInput = z.object({});

export const searchSitemapsReport: ReportDefinition<Record<string, never>, unknown> = reportRegistry.register({
  id: 'searchConsole.sitemaps',
  title: 'Submitted sitemaps',
  description: 'Lists the sitemaps submitted in Search Console for the selected site, with submitted URL counts, warnings and errors. Read-only.',
  source: 'search_console',
  input: noInput as unknown as z.ZodType<Record<string, never>>,
  async run(ctx) {
    const token = await ctx.getAccessToken();
    return { sitemaps: await listSitemaps(scSite(ctx), token) };
  },
});

export const hostBreakdownReport: ReportDefinition<DateRangeInput, unknown> = reportRegistry.register({
  id: 'site.hostBreakdown',
  title: 'Traffic by host (domain and subdomain)',
  description:
    'Shows, for every host name that receives traffic or appears in search results (for example www and blog subdomains), the sessions, users, key events, search clicks and impressions, plus flags for hosts with traffic but no sitemap, a sitemap but no traffic, or sitemap errors.',
  source: 'combined',
  input: dateRangeSchema,
  async run(ctx, input) {
    if (!hasGa4(ctx) && !hasSc(ctx)) throw new GoogleApiError('GA4_NOT_SELECTED', 'Connect Google Analytics 4 or Search Console first.', 409);
    const token = await ctx.getAccessToken();
    const notes: string[] = [];
    const ga4Rows: GA4HostRow[] = [];
    let searchRows: SearchPageRow[] = [];
    let sitemaps: Awaited<ReturnType<typeof listSitemaps>> = [];

    if (hasGa4(ctx)) {
      const resp = await callGA4RunReport(ga4Property(ctx), token, {
        dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
        dimensions: [{ name: 'hostName' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'keyEvents' }],
        limit: 100,
      });
      for (const r of resp.rows ?? []) {
        ga4Rows.push({
          hostName: r.dimensionValues?.[0]?.value ?? '',
          sessions: num(r.metricValues?.[0]?.value),
          activeUsers: num(r.metricValues?.[1]?.value),
          keyEvents: num(r.metricValues?.[2]?.value),
        });
      }
    } else notes.push('Google Analytics 4 is not set up for this project, so visits are not shown.');

    if (hasSc(ctx)) {
      const rows = await scRows(ctx, input, ['page'], 1000);
      searchRows = rows.map((r) => ({ page: r.page ?? '', clicks: r.clicks, impressions: r.impressions, position: r.position }));
      try {
        sitemaps = await listSitemaps(scSite(ctx), token);
      } catch {
        notes.push('Sitemaps could not be read from Search Console.');
      }
    } else notes.push('Search Console is not set up for this project, so search numbers are not shown.');

    return { period: { startDate: input.startDate, endDate: input.endDate }, ...buildHostBreakdown(ga4Rows, searchRows, sitemaps), notes };
  },
});

// ---------------------------------------------------------------------------
// Sprint 12
// ---------------------------------------------------------------------------

async function ga4Pages(ctx: ReportContext, input: DateRangeInput, limit: number): Promise<Ga4PageInput[]> {
  const token = await ctx.getAccessToken();
  const resp = await callGA4RunReport(ga4Property(ctx), token, {
    dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
    dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }, { name: 'userEngagementDuration' }, { name: 'keyEvents' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit,
  });
  return (resp.rows ?? []).map((r) => ({
    path: r.dimensionValues?.[0]?.value ?? '',
    title: r.dimensionValues?.[1]?.value ?? '',
    views: num(r.metricValues?.[0]?.value),
    users: num(r.metricValues?.[1]?.value),
    engagementSeconds: num(r.metricValues?.[2]?.value),
    keyEvents: num(r.metricValues?.[3]?.value),
  }));
}

export const pagesTableReport: ReportDefinition<DateRangeInput, unknown> = reportRegistry.register({
  id: 'site.pages',
  title: 'Pages: analytics and search together',
  description:
    'One table of your pages that joins Google Analytics 4 (views, users, engagement time, key events) with Search Console (clicks, impressions, click-through rate, position), matched by page path, with flags for pages that only appear in one source or are seen in search but rarely clicked.',
  source: 'combined',
  input: dateRangeSchema,
  async run(ctx, input) {
    if (!hasGa4(ctx) && !hasSc(ctx)) throw new GoogleApiError('GA4_NOT_SELECTED', 'Connect Google Analytics 4 or Search Console first.', 409);
    const notes: string[] = [];
    const ga = hasGa4(ctx) ? await ga4Pages(ctx, input, 500) : (notes.push('Google Analytics 4 is not set up, so visit numbers are missing.'), []);
    const sc = hasSc(ctx)
      ? (await scRows(ctx, input, ['page'], 1000)).map((r) => ({ page: r.page ?? '', clicks: r.clicks, impressions: r.impressions, position: r.position }))
      : (notes.push('Search Console is not set up, so search numbers are missing.'), []);
    return { period: { startDate: input.startDate, endDate: input.endDate }, rows: joinPages(ga, sc), notes };
  },
});

const pageDetailInput = dateRangeBaseObject
  .extend({ path: z.string().min(1).max(300).describe('Page path, for example /pricing') })
  .superRefine((v, ctx) => {
    if (v.startDate > v.endDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'startDate must be on or before endDate.' });
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(v.path)) ctx.addIssue({ code: 'custom', path: ['path'], message: 'That page path is not valid.' });
  });
export type PageDetailInput = z.infer<typeof pageDetailInput>;

export const pageDetailReport: ReportDefinition<PageDetailInput, unknown> = reportRegistry.register({
  id: 'site.pageDetail',
  title: 'Page detail',
  description:
    'Everything about one page (give its path, for example /pricing): daily visits, how people reach it, and the search queries that bring people to it, with clicks, impressions and position.',
  source: 'combined',
  input: pageDetailInput,
  async run(ctx, input) {
    const path = normalisePath(input.path);
    if (!path) throw new GoogleApiError('INVALID_PAGE', 'That page path is not valid.', 400);
    const notes: string[] = [];
    const range = { startDate: input.startDate, endDate: input.endDate };
    const token = await ctx.getAccessToken();
    const rx = `^${escapeRegex(path)}/?(\\?.*)?$`;
    const pageFilter = { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'FULL_REGEXP', value: rx, caseSensitive: true } } };

    let analytics: unknown = null;
    if (hasGa4(ctx)) {
      const prop = ga4Property(ctx);
      const [totals, daily, sources] = await Promise.all([
        callGA4RunReport(prop, token, {
          dateRanges: [range],
          metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }, { name: 'userEngagementDuration' }, { name: 'keyEvents' }, { name: 'bounceRate' }],
          dimensionFilter: pageFilter,
        }),
        callGA4RunReport(prop, token, {
          dateRanges: [range],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }],
          dimensionFilter: pageFilter,
          orderBys: [{ dimension: { dimensionName: 'date' } }],
          limit: 400,
        }),
        callGA4RunReport(prop, token, {
          dateRanges: [range],
          dimensions: [{ name: 'sessionSourceMedium' }],
          metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
          dimensionFilter: pageFilter,
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 10,
        }),
      ]);
      const t = totals.rows?.[0]?.metricValues;
      const users = num(t?.[1]?.value);
      analytics = {
        views: num(t?.[0]?.value),
        users,
        avgEngagementSeconds: users > 0 ? Math.round((num(t?.[2]?.value) / users) * 10) / 10 : 0,
        keyEvents: num(t?.[3]?.value),
        bounceRate: Math.round(num(t?.[4]?.value) * 1000) / 10,
        daily: (daily.rows ?? []).map((r) => {
          const d = r.dimensionValues?.[0]?.value ?? '';
          return { date: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d, views: num(r.metricValues?.[0]?.value), users: num(r.metricValues?.[1]?.value) };
        }),
        sources: (sources.rows ?? []).map((r) => ({ sourceMedium: r.dimensionValues?.[0]?.value ?? '', sessions: num(r.metricValues?.[0]?.value), keyEvents: num(r.metricValues?.[1]?.value) })),
      };
    } else notes.push('Google Analytics 4 is not set up, so visit numbers are missing.');

    let search: unknown = null;
    if (hasSc(ctx)) {
      const filterGroups = [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: `^https?://[^/]+${escapeRegex(path)}/?$` }] }];
      const site = scSite(ctx);
      const [totals, queries] = await Promise.all([
        callSearchConsoleQuery(site, token, { ...range, dimensionFilterGroups: filterGroups }),
        callSearchConsoleQuery(site, token, { ...range, dimensions: ['query'], rowLimit: 25, dimensionFilterGroups: filterGroups }),
      ]);
      const t = totals.rows?.[0];
      const clicks = t?.clicks ?? 0;
      const impressions = t?.impressions ?? 0;
      search = {
        clicks,
        impressions,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        position: impressions > 0 ? Math.round((t?.position ?? 0) * 10) / 10 : null,
        queries: (queries.rows ?? []).map((r) => ({ query: r.keys?.[0] ?? '', clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, position: Math.round((r.position ?? 0) * 10) / 10 })),
      };
    } else notes.push('Search Console is not set up, so search numbers are missing.');

    if (!analytics && !search) throw new GoogleApiError('GA4_NOT_SELECTED', 'Connect Google Analytics 4 or Search Console first.', 409);
    return { path, period: range, analytics, search, notes };
  },
});

export const siteSnapshotReport: ReportDefinition<DateRangeInput, unknown> = reportRegistry.register({
  id: 'site.snapshot',
  title: 'Site snapshot',
  description:
    'One-page health check of the whole site: Google Analytics 4 totals, Search Console totals, the top pages and queries, and how many search opportunities and cannibalised queries exist. Compared with the comparison period (or the previous period). Use first for "how is the site doing?".',
  source: 'combined',
  input: dateRangeSchema,
  async run(ctx, input) {
    const prev = comparisonPeriod(input);
    const unavailable: { source: string; reason: string }[] = [];
    const reason = (e: unknown) => (e instanceof Error ? e.message : 'Unavailable right now.');
    const token = await ctx.getAccessToken();
    const range = { startDate: input.startDate, endDate: input.endDate };

    const analyticsP = hasGa4(ctx)
      ? ga4OverviewReport
          .run(ctx, { ...range, compareStartDate: prev.startDate, compareEndDate: prev.endDate })
          .catch((e) => (unavailable.push({ source: 'Google Analytics 4', reason: reason(e) }), null))
      : Promise.resolve((unavailable.push({ source: 'Google Analytics 4', reason: 'Not set up for this project.' }), null));

    const searchP = hasSc(ctx)
      ? Promise.all([
          callSearchConsoleQuery(scSite(ctx), token, range),
          callSearchConsoleQuery(scSite(ctx), token, prev),
          scRows(ctx, range, ['query'], 1000),
          scRows(ctx, range, ['page'], 250),
          scRows(ctx, range, ['query', 'page'], 2000),
        ]).catch((e) => (unavailable.push({ source: 'Search Console', reason: reason(e) }), null))
      : Promise.resolve((unavailable.push({ source: 'Search Console', reason: 'Not set up for this project.' }), null));

    const [analytics, search] = await Promise.all([analyticsP, searchP]);

    let searchOut: unknown = null;
    let insights: unknown = null;
    if (search) {
      const [now, before, queries, pages, pairs] = search;
      const tot = (r: typeof now) => {
        const row = r.rows?.[0];
        const clicks = row?.clicks ?? 0;
        const impressions = row?.impressions ?? 0;
        return { clicks, impressions, ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0, position: impressions > 0 ? Math.round((row?.position ?? 0) * 10) / 10 : null };
      };
      searchOut = {
        ...tot(now),
        previous: tot(before),
        topQueries: queries.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 5),
        topPages: pages.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 5),
      };
      const opp = findOpportunities(queries);
      insights = {
        opportunityCount: opp.opportunities.length,
        estimatedExtraClicks: opp.opportunities.reduce((t, o) => t + o.estimatedExtraClicks, 0),
        cannibalisedQueryCount: detectCannibalisation(pairs).length,
      };
    }
    return { period: range, comparedWith: prev, analytics, search: searchOut, insights, unavailable };
  },
});

async function metaCampaignsFor(ctx: ReportContext, range: { startDate: string; endDate: string }): Promise<MetaCampaignInput[] | null> {
  const access = ctx.getMeta ? await ctx.getMeta() : null;
  if (!access) return null;
  const credentials = { accessToken: access.accessToken, appSecret: access.appSecret };
  try {
    const [campaignsRes, insightsRes] = await Promise.all([
      metaGet<{ data?: MetaCampaignObject[] }>(`act_${access.accountId}/campaigns`, { fields: 'id,name,objective,effective_status', limit: 500 }, credentials),
      metaGet<{ data?: MetaInsightsRow[] }>(
        `act_${access.accountId}/insights`,
        {
          level: 'campaign',
          fields: 'campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,clicks,actions,account_currency,date_start,date_stop',
          time_range: JSON.stringify({ since: range.startDate, until: range.endDate }),
          use_unified_attribution_setting: 'true',
          limit: 500,
        },
        credentials,
      ),
    ]);
    return mapMetaCampaigns(campaignsRes.data ?? [], insightsRes.data ?? []).map((c) => ({
      id: c.id, name: c.name, spend: c.spend, impressions: c.impressions, clicks: c.clicks, leads: c.leads,
    }));
  } catch (e) {
    if (e instanceof MetaApiError) throw e;
    throw new MetaApiError('META_REQUEST_FAILED', 'Failed to fetch data from Meta Marketing API', 502);
  }
}

export const crossChannelReport: ReportDefinition<DateRangeInput, unknown> = reportRegistry.register({
  id: 'site.crossChannel',
  title: 'Meta ads vs website visits',
  description:
    'Matches each Meta (Facebook and Instagram) campaign to the Google Analytics 4 sessions it brought, using the campaign tag (UTM) in the link, and shows cost per visit, cost per engaged visit, cost per key event and the share of link clicks that became visits. Flags campaigns with spend but no tracked traffic, low landing rate, and tags that do not match any campaign.',
  source: 'combined',
  input: dateRangeSchema,
  async run(ctx, input) {
    const range = { startDate: input.startDate, endDate: input.endDate };
    if (!hasGa4(ctx)) throw new GoogleApiError('GA4_NOT_SELECTED', 'Google Analytics 4 is needed to match ad clicks to website visits.', 409);
    const meta = await metaCampaignsFor(ctx, range);
    if (!meta) throw new GoogleApiError('META_NOT_CONNECTED', 'Connect Facebook and choose an ad account to compare ads with website visits.', 409);
    const token = await ctx.getAccessToken();
    const resp = await callGA4RunReport(ga4Property(ctx), token, {
      dateRanges: [range],
      dimensions: [{ name: 'sessionCampaignName' }, { name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
      limit: 500,
    });
    const ga4Rows: GA4CampaignInput[] = (resp.rows ?? []).map((r) => ({
      campaign: r.dimensionValues?.[0]?.value ?? '',
      source: r.dimensionValues?.[1]?.value ?? '',
      medium: r.dimensionValues?.[2]?.value ?? '',
      sessions: num(r.metricValues?.[0]?.value),
      engagedSessions: num(r.metricValues?.[1]?.value),
      keyEvents: num(r.metricValues?.[2]?.value),
    }));
    return { period: range, currency: ctx.project?.currency ?? null, ...joinMetaWithGa4(meta, ga4Rows) };
  },
});
