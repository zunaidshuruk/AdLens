import type {
  GA4AcquisitionReport,
  GA4AiTrafficReport,
  GA4CampaignRow,
  GA4ConversionEventRow,
  GA4Overview,
  GA4PageRow,
  GA4PropertyInfo,
  GA4SourceGroupsReport,
  GA4TrafficBreakdownDimension,
  GA4TrafficBreakdownRow,
  GA4TrafficPoint,
} from '../../src/types/index.js';
import { buildAiSourceDimensionFilter } from '../lib/aiSourceFilter.js';
import {
  type GA4RunReportResponse,
  mapGA4AcquisitionResponse,
  mapGA4AiTrafficResponse,
  mapGA4CampaignsResponse,
  mapGA4ConversionsResponse,
  mapGA4OverviewResponse,
  mapGA4SourceGroupsResponse,
  mapGA4TopPagesResponse,
  mapGA4TrafficBreakdownResponse,
  mapGA4TrafficOverTimeResponse,
} from '../lib/ga4Mapper.js';
import { GoogleApiError } from '../lib/google.js';
import { reportRegistry } from './registry.js';
import {
  type DateRangeInput,
  dateRangeSchema,
  type OptionalDateRangeInput,
  optionalDateRangeSchema,
  type TrafficBreakdownInput,
  trafficBreakdownInputSchema,
} from './schemas.js';
import type { ReportContext, ReportDefinition } from './types.js';

function requirePropertyId(ctx: ReportContext): string {
  const propId = ctx.ga4PropertyId || ctx.session.google?.ga4Property?.id;
  if (!propId) {
    throw new GoogleApiError(
      'GA4_NOT_SELECTED',
      'A connected Google account with a selected GA4 property is required.',
      409
    );
  }
  return propId.replace(/^properties\//, '');
}

export function buildDateRangesPayload(dates: DateRangeInput) {
  const ranges: { name: string; startDate: string; endDate: string }[] = [
    { name: 'current', startDate: dates.startDate, endDate: dates.endDate },
  ];
  if (dates.compareStartDate && dates.compareEndDate) {
    ranges.push({
      name: 'previous',
      startDate: dates.compareStartDate,
      endDate: dates.compareEndDate,
    });
  }
  return ranges;
}

export async function callGA4RunReport(
  propertyId: string,
  accessToken: string,
  payload: Record<string, unknown>
): Promise<GA4RunReportResponse> {
  const cleanId = propertyId.replace(/^properties\//, '');
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${cleanId}:runReport`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    let googleStatus = '';
    try {
      const errJson = (await resp.json()) as { error?: { status?: string } };
      googleStatus = errJson?.error?.status || '';
    } catch {
      // ignore body parse errors; never forward raw Google error bodies
    }

    if (resp.status === 401) {
      throw new GoogleApiError(
        'GOOGLE_REAUTH_REQUIRED',
        'Your Google session has expired or been revoked. Please reconnect your Google account.',
        401
      );
    }

    if (resp.status === 403 || googleStatus === 'PERMISSION_DENIED') {
      throw new GoogleApiError(
        'GA4_PERMISSION_DENIED',
        'This Google account no longer has access to the selected property',
        403
      );
    }

    if (resp.status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') {
      throw new GoogleApiError(
        'GA4_QUOTA_EXCEEDED',
        'Google Analytics 4 API quota exceeded. Please wait a moment and retry.',
        429
      );
    }

    throw new GoogleApiError(
      'GA4_REQUEST_FAILED',
      'Unable to retrieve report data from Google Analytics 4.',
      502
    );
  }

  return (await resp.json()) as GA4RunReportResponse;
}

export const ga4OverviewReport: ReportDefinition<DateRangeInput, GA4Overview> =
  reportRegistry.register({
    id: 'ga4.overview',
    title: 'GA4 Executive Overview',
    description:
      'Returns top-level Google Analytics 4 KPI totals (sessions, total users, engaged sessions, engagement rate, average engagement time per user, and key events) for the selected date range, along with previous-period values and percentage changes when comparison dates are provided. Use this first to understand overall website traffic volume and engagement health.',
    source: 'ga4',
    input: dateRangeSchema,
    async run(ctx, input) {
      const propertyId = requirePropertyId(ctx);
      const accessToken = await ctx.getAccessToken();
      const report = await callGA4RunReport(propertyId, accessToken, {
        dateRanges: buildDateRangesPayload(input),
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'userEngagementDuration' },
          { name: 'keyEvents' },
        ],
      });
      return mapGA4OverviewResponse(report);
    },
  });

export const ga4TrafficOverTimeReport: ReportDefinition<DateRangeInput, GA4TrafficPoint[]> =
  reportRegistry.register({
    id: 'ga4.trafficOverTime',
    title: 'GA4 Daily Traffic Over Time',
    description:
      'Returns a zero-filled daily time series of GA4 sessions, active users, engaged sessions, and key events across the requested date range, aligned day-by-day with the comparison period when provided. Use this to spot daily traffic spikes, dips, or weekday seasonality.',
    source: 'ga4',
    input: dateRangeSchema,
    async run(ctx, input) {
      const propertyId = requirePropertyId(ctx);
      const accessToken = await ctx.getAccessToken();
      const report = await callGA4RunReport(propertyId, accessToken, {
        dateRanges: buildDateRangesPayload(input),
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
          { name: 'keyEvents' },
        ],
        limit: 1000,
      });
      return mapGA4TrafficOverTimeResponse(
        report,
        input.startDate,
        input.endDate,
        input.compareStartDate,
        input.compareEndDate
      );
    },
  });

export const ga4AcquisitionReport: ReportDefinition<DateRangeInput, GA4AcquisitionReport> =
  reportRegistry.register({
    id: 'ga4.acquisition',
    title: 'GA4 Channel & Country Acquisition Summary',
    description:
      'Returns session and user acquisition breakdowns by GA4 default channel group and top countries, including engagement rates, key events, conversion rates, and traffic share percentages. Use this for a high-level summary of where visitors come from.',
    source: 'ga4',
    input: dateRangeSchema,
    async run(ctx, input) {
      const propertyId = requirePropertyId(ctx);
      const accessToken = await ctx.getAccessToken();
      const primaryRange = [{ name: 'current', startDate: input.startDate, endDate: input.endDate }];
      const [channelsReport, countriesReport] = await Promise.all([
        callGA4RunReport(propertyId, accessToken, {
          dateRanges: primaryRange,
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'engagedSessions' },
            { name: 'engagementRate' },
            { name: 'keyEvents' },
          ],
          limit: 25,
        }),
        callGA4RunReport(propertyId, accessToken, {
          dateRanges: primaryRange,
          dimensions: [{ name: 'country' }, { name: 'countryId' }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
          limit: 25,
        }),
      ]);
      return mapGA4AcquisitionResponse(channelsReport, countriesReport);
    },
  });

export const ga4CampaignsReport: ReportDefinition<DateRangeInput, GA4CampaignRow[]> =
  reportRegistry.register({
    id: 'ga4.campaigns',
    title: 'GA4 UTM Campaign Attribution',
    description:
      'Returns session performance grouped by UTM campaign name and source/medium, including sessions, users, engagement rate, key events, and session conversion rate. Use this to evaluate tagged marketing campaigns and paid social UTM landings.',
    source: 'ga4',
    input: dateRangeSchema,
    async run(ctx, input) {
      const propertyId = requirePropertyId(ctx);
      const accessToken = await ctx.getAccessToken();
      const report = await callGA4RunReport(propertyId, accessToken, {
        dateRanges: [{ name: 'current', startDate: input.startDate, endDate: input.endDate }],
        dimensions: [
          { name: 'sessionCampaignName' },
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagementRate' },
          { name: 'keyEvents' },
        ],
        limit: 50,
      });
      return mapGA4CampaignsResponse(report);
    },
  });

export const ga4TopPagesReport: ReportDefinition<DateRangeInput, GA4PageRow[]> =
  reportRegistry.register({
    id: 'ga4.topPages',
    title: 'GA4 Top Pages by Views',
    description:
      'Returns the top 50 website pages ranked by screen page views, along with total users, average engagement time per user, bounce rate, and key events. Use this to identify the most visited content and product pages.',
    source: 'ga4',
    input: dateRangeSchema,
    async run(ctx, input) {
      const propertyId = requirePropertyId(ctx);
      const accessToken = await ctx.getAccessToken();
      const report = await callGA4RunReport(propertyId, accessToken, {
        dateRanges: [{ name: 'current', startDate: input.startDate, endDate: input.endDate }],
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
          { name: 'userEngagementDuration' },
          { name: 'bounceRate' },
          { name: 'keyEvents' },
        ],
        limit: 50,
      });
      return mapGA4TopPagesResponse(report);
    },
  });

export const ga4ConversionsReport: ReportDefinition<DateRangeInput, GA4ConversionEventRow[]> =
  reportRegistry.register({
    id: 'ga4.conversions',
    title: 'GA4 Key Events (Conversions)',
    description:
      'Returns all GA4 key events (conversions) with at least one occurrence in the current period, including event counts, converting users, session conversion rate, and percentage change against the comparison period. Use this to audit lead and signup actions.',
    source: 'ga4',
    input: dateRangeSchema,
    async run(ctx, input) {
      const propertyId = requirePropertyId(ctx);
      const accessToken = await ctx.getAccessToken();
      const report = await callGA4RunReport(propertyId, accessToken, {
        dateRanges: buildDateRangesPayload(input),
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'keyEvents' }, { name: 'totalUsers' }, { name: 'sessions' }],
        limit: 50,
      });
      return mapGA4ConversionsResponse(report);
    },
  });

export const ga4PropertyInfoReport: ReportDefinition<OptionalDateRangeInput, GA4PropertyInfo> =
  reportRegistry.register({
    id: 'ga4.propertyInfo',
    title: 'GA4 Property Metadata',
    description:
      'Returns metadata for the connected Google Analytics 4 property from the Analytics Admin API, including property ID, display name, configured reporting time zone, and currency code. Use this to verify which GA4 property is active and check its time zone.',
    source: 'ga4',
    input: optionalDateRangeSchema,
    async run(ctx) {
      const propertyId = requirePropertyId(ctx);
      const fallbackName = ctx.ga4PropertyName || ctx.session.google?.ga4Property?.name || propertyId;
      const accessToken = await ctx.getAccessToken();

      const url = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!resp.ok) {
        let googleStatus = '';
        try {
          const errJson = (await resp.json()) as { error?: { status?: string } };
          googleStatus = errJson?.error?.status || '';
        } catch {
          // ignore
        }

        if (resp.status === 401) {
          throw new GoogleApiError(
            'GOOGLE_REAUTH_REQUIRED',
            'Your Google session has expired or been revoked. Please reconnect your Google account.',
            401
          );
        }

        if (resp.status === 403 || googleStatus === 'PERMISSION_DENIED') {
          throw new GoogleApiError(
            'GA4_PERMISSION_DENIED',
            'This Google account no longer has access to the selected property',
            403
          );
        }

        if (resp.status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') {
          throw new GoogleApiError(
            'GA4_QUOTA_EXCEEDED',
            'Google Analytics 4 API quota exceeded. Please wait a moment and retry.',
            429
          );
        }

        throw new GoogleApiError(
          'GA4_REQUEST_FAILED',
          'Unable to fetch GA4 property details.',
          502
        );
      }

      const body = (await resp.json()) as {
        displayName?: string;
        timeZone?: string;
        currencyCode?: string;
      };

      return {
        propertyId,
        displayName: body.displayName || fallbackName,
        timeZone: body.timeZone ?? null,
        currencyCode: body.currencyCode ?? null,
      };
    },
  });

function getGA4DimensionsForBreakdown(
  dimension: GA4TrafficBreakdownDimension
): { name: string }[] {
  switch (dimension) {
    case 'channel':
      return [{ name: 'sessionDefaultChannelGroup' }];
    case 'sourceMedium':
      return [{ name: 'sessionSource' }, { name: 'sessionMedium' }];
    case 'referrer':
      return [{ name: 'sessionSource' }];
    case 'landingPage':
      return [{ name: 'landingPagePlusQueryString' }];
    case 'country':
      return [{ name: 'country' }];
    case 'device':
      return [{ name: 'deviceCategory' }];
    case 'browser':
      return [{ name: 'browser' }];
    case 'date':
      return [{ name: 'date' }];
  }
}

function buildTrafficBreakdownDimensionFilter(
  dimension: GA4TrafficBreakdownDimension,
  filters?: { country?: string; deviceCategory?: string; browser?: string }
): Record<string, unknown> | undefined {
  const expressions: Record<string, unknown>[] = [];

  if (dimension === 'referrer') {
    expressions.push({
      filter: {
        fieldName: 'sessionMedium',
        stringFilter: {
          matchType: 'EXACT',
          value: 'referral',
          caseSensitive: false,
        },
      },
    });
  }

  if (filters?.country && filters.country.trim() !== '') {
    expressions.push({
      filter: {
        fieldName: 'country',
        stringFilter: {
          matchType: 'EXACT',
          value: filters.country.trim(),
          caseSensitive: false,
        },
      },
    });
  }

  if (filters?.deviceCategory && filters.deviceCategory.trim() !== '') {
    expressions.push({
      filter: {
        fieldName: 'deviceCategory',
        stringFilter: {
          matchType: 'EXACT',
          value: filters.deviceCategory.trim(),
          caseSensitive: false,
        },
      },
    });
  }

  if (filters?.browser && filters.browser.trim() !== '') {
    expressions.push({
      filter: {
        fieldName: 'browser',
        stringFilter: {
          matchType: 'EXACT',
          value: filters.browser.trim(),
          caseSensitive: false,
        },
      },
    });
  }

  if (expressions.length === 0) return undefined;
  if (expressions.length === 1) return expressions[0];
  return { andGroup: { expressions } };
}

export const ga4TrafficBreakdownReport: ReportDefinition<
  TrafficBreakdownInput,
  GA4TrafficBreakdownRow[]
> = reportRegistry.register({
  id: 'ga4.trafficBreakdown',
  title: 'GA4 Flexible Traffic Breakdown',
  description:
    'Breaks down GA4 traffic by channel, source/medium, referring domain, landing page, country, device category, browser, or date, with optional country/device/browser filters and full period-over-period comparison across sessions, active users, new users, engaged sessions, engagement rate, key events, and average engagement time per active user.',
  source: 'ga4',
  input: trafficBreakdownInputSchema,
  async run(ctx, input) {
    const propertyId = requirePropertyId(ctx);
    const accessToken = await ctx.getAccessToken();
    const limit = Math.min(500, Math.max(1, input.limit ?? 50));
    const dimensionFilter = buildTrafficBreakdownDimensionFilter(input.dimension, input.filters);

    const payload: Record<string, unknown> = {
      dateRanges: buildDateRangesPayload(input),
      dimensions: getGA4DimensionsForBreakdown(input.dimension),
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'keyEvents' },
        { name: 'userEngagementDuration' },
      ],
      limit: input.dimension === 'date' ? 1000 : limit,
    };

    if (dimensionFilter) {
      payload.dimensionFilter = dimensionFilter;
    }

    const report = await callGA4RunReport(propertyId, accessToken, payload);
    return mapGA4TrafficBreakdownResponse(
      report,
      input.dimension,
      input.startDate,
      input.endDate,
      input.compareStartDate,
      input.compareEndDate,
      limit
    );
  },
});

export const ga4SourceGroupsReport: ReportDefinition<DateRangeInput, GA4SourceGroupsReport> =
  reportRegistry.register({
    id: 'ga4.sourceGroups',
    title: 'GA4 Traffic by AdLens Source Group',
    description:
      'Classifies all GA4 traffic into the 8 AdLens source groups (AI assistants, Search, Social, Email, Referral, Paid, Direct / unknown, and Other) using session source, session medium, and default channel group, returning sessions, engaged sessions, key events, traffic share, key event rate, comparison period deltas, and classification rules.',
    source: 'ga4',
    input: dateRangeSchema,
    async run(ctx, input) {
      const propertyId = requirePropertyId(ctx);
      const accessToken = await ctx.getAccessToken();
      const report = await callGA4RunReport(propertyId, accessToken, {
        dateRanges: buildDateRangesPayload(input),
        dimensions: [
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
          { name: 'sessionDefaultChannelGroup' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'keyEvents' },
        ],
        limit: 10000,
      });

      return mapGA4SourceGroupsResponse(report);
    },
  });

export const ga4AiTrafficReport: ReportDefinition<DateRangeInput, GA4AiTrafficReport> =
  reportRegistry.register({
    id: 'ga4.aiTraffic',
    title: 'GA4 AI Assistant Referral Traffic',
    description:
      'Measures website visits referred by AI assistants (ChatGPT, Perplexity, Gemini, Claude, Copilot, DeepSeek, Meta AI, Grok, and others) by filtering GA4 session sources against the versioned AdLens AI domain list and summarizing sessions, share of total traffic, key events, landing pages, and daily trends with comparison.',
    source: 'ga4',
    input: dateRangeSchema,
    async run(ctx, input) {
      const propertyId = requirePropertyId(ctx);
      const accessToken = await ctx.getAccessToken();
      const dateRanges = buildDateRangesPayload(input);
      const aiDimensionFilter = buildAiSourceDimensionFilter();

      const [pagesReport, dateReport, totalsReport] = await Promise.all([
        callGA4RunReport(propertyId, accessToken, {
          dateRanges,
          dimensions: [{ name: 'sessionSource' }, { name: 'landingPage' }],
          metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'newUsers' },
            { name: 'engagedSessions' },
            { name: 'keyEvents' },
          ],
          dimensionFilter: aiDimensionFilter,
          limit: 5000,
        }),
        callGA4RunReport(propertyId, accessToken, {
          dateRanges,
          dimensions: [{ name: 'sessionSource' }, { name: 'date' }],
          metrics: [{ name: 'sessions' }],
          dimensionFilter: aiDimensionFilter,
          limit: 5000,
        }),
        callGA4RunReport(propertyId, accessToken, {
          dateRanges,
          metrics: [{ name: 'sessions' }],
        }),
      ]);

      return mapGA4AiTrafficResponse(
        pagesReport,
        dateReport,
        totalsReport,
        input.startDate,
        input.endDate,
        input.compareStartDate,
        input.compareEndDate
      );
    },
  });
