import { GoogleApiError } from '../lib/google.js';
import {
  buildGA4ExplorePayload,
  buildSCExplorePayload,
  ga4ExploreInputSchema,
  mapGA4Explore,
  mapSCExplore,
  scExploreInputSchema,
  type ExploreResult,
  type GA4ExploreInput,
  type SCExploreInput,
} from '../lib/exploreSpec.js';
import { callSearchConsoleQuery } from '../lib/searchConsoleApi.js';
import { callGA4RunReport } from './ga4Reports.js';
import { reportRegistry } from './registry.js';
import type { ReportDefinition } from './types.js';

/** Flexible reports: any allowed mix of dimensions, metrics and filters. Used by Explore, dashboards and the AI analyst. */

export const ga4ExploreReport: ReportDefinition<GA4ExploreInput, ExploreResult> = reportRegistry.register({
  id: 'ga4.explore',
  title: 'GA4 flexible report',
  description:
    'Runs a custom Google Analytics 4 report: choose up to 4 dimensions (for example country, channel, landing page, device, date) and up to 6 metrics (for example sessions, users, engagement rate, key events), with optional text filters and sorting. Use when no ready-made GA4 report answers the question. Returns a table plus totals.',
  source: 'ga4',
  input: ga4ExploreInputSchema,
  async run(ctx, input) {
    const propId = ctx.project?.ga4PropertyId || ctx.ga4PropertyId;
    if (!propId) {
      throw new GoogleApiError('GA4_NOT_SELECTED', 'A connected Google account with a selected GA4 property is required.', 409);
    }
    const token = await ctx.getAccessToken();
    const resp = await callGA4RunReport(propId, token, buildGA4ExplorePayload(input));
    return mapGA4Explore(resp as Parameters<typeof mapGA4Explore>[0], input);
  },
});

export const searchConsoleExploreReport: ReportDefinition<SCExploreInput, ExploreResult> = reportRegistry.register({
  id: 'searchConsole.explore',
  title: 'Search Console flexible report',
  description:
    'Runs a custom Google Search Console report: choose up to 3 dimensions (search query, page, country, device, date) and metrics (clicks, impressions, click-through rate, average position), with optional text filters and sorting. Use when no ready-made search report answers the question. Returns a table plus totals.',
  source: 'search_console',
  input: scExploreInputSchema,
  async run(ctx, input) {
    const site = ctx.project?.searchConsoleSite || ctx.searchConsoleSite;
    if (!site) {
      throw new GoogleApiError('SC_NOT_SELECTED', 'A connected Google account with a selected Search Console site is required.', 409);
    }
    const token = await ctx.getAccessToken();
    const resp = await callSearchConsoleQuery(site, token, buildSCExplorePayload(input));
    return mapSCExplore(resp, input);
  },
});
