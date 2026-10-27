import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectDoc } from './lib/firestore.js';
import {
  crossChannelReport,
  hostBreakdownReport,
  pageDetailReport,
  pagesTableReport,
  searchCannibalisationReport,
  searchOpportunitiesReport,
  searchSitemapsReport,
  searchTopicsReport,
  searchTrendsReport,
  siteSnapshotReport,
} from './reports/intelligenceReports.js';
import { reportRegistry } from './reports/registry.js';
import type { ReportContext } from './reports/types.js';

const project = { id: 'p', name: 'Convay Meet', brandTerms: ['convay'], currency: 'BDT', ga4PropertyId: '123', searchConsoleSite: 'https://convay.com/' } as unknown as ProjectDoc;
const ctx = (extra: Partial<ReportContext> = {}): ReportContext => ({
  getAccessToken: async () => 'tok',
  ga4PropertyId: '123',
  searchConsoleSite: 'https://convay.com/',
  project,
  ...extra,
});
const range = { startDate: '2026-10-08', endDate: '2026-10-14' };

type Handler = (url: string, body: any) => unknown;
async function withFetch<T>(handler: Handler, fn: (calls: { url: string; body: any }[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    return new Response(JSON.stringify(handler(url, body)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const sc = (rows: { keys?: string[]; clicks: number; impressions: number; position: number }[]) => ({ rows: rows.map((r) => ({ ...r, ctr: r.impressions ? r.clicks / r.impressions : 0 })) });

test('all Sprint 11 and 12 reports are registered with the registry', () => {
  const ids = reportRegistry.list().map((r) => r.id);
  for (const id of ['searchConsole.trends', 'searchConsole.opportunities', 'searchConsole.cannibalisation', 'searchConsole.topics', 'searchConsole.sitemaps', 'site.hostBreakdown', 'site.pages', 'site.pageDetail', 'site.snapshot', 'site.crossChannel']) {
    assert.ok(ids.includes(id), id);
  }
});

test('trends compare against the previous period of the same length when no comparison is chosen', async () => {
  await withFetch(
    (_u, body) => {
      const isPrev = body.startDate === '2026-10-01';
      if (body.dimensions[0] === 'query') return sc(isPrev ? [{ keys: ['old'], clicks: 50, impressions: 500, position: 3 }, { keys: ['grow'], clicks: 20, impressions: 400, position: 5 }] : [{ keys: ['grow'], clicks: 80, impressions: 600, position: 4 }, { keys: ['fresh'], clicks: 40, impressions: 300, position: 6 }]);
      return sc([]);
    },
    async (calls) => {
      const r = (await searchTrendsReport.run(ctx(), range)) as any;
      assert.deepEqual(r.comparedWith, { startDate: '2026-10-01', endDate: '2026-10-07' });
      assert.ok(r.queries.rising.some((x: any) => x.key === 'grow'));
      assert.ok(r.queries.new.some((x: any) => x.key === 'fresh'));
      assert.ok(r.queries.lost.some((x: any) => x.key === 'old'));
      assert.equal(calls.length, 4);
    },
  );
});

test('opportunities, cannibalisation and topics use Search Console rows', async () => {
  await withFetch(
    (_u, body) => {
      const dims: string[] = body.dimensions;
      if (dims.length === 2) return sc([{ keys: ['pricing plans', '/a'], clicks: 5, impressions: 400, position: 6 }, { keys: ['pricing plans', '/b'], clicks: 4, impressions: 300, position: 8 }]);
      return sc([
        { keys: ['convay pricing plans'], clicks: 2, impressions: 2000, position: 8 },
        { keys: ['video meeting pricing'], clicks: 30, impressions: 300, position: 2 },
        { keys: ['video meeting software'], clicks: 20, impressions: 300, position: 3 },
      ]);
    },
    async () => {
      const opp = (await searchOpportunitiesReport.run(ctx(), range)) as any;
      assert.equal(opp.opportunities[0].query, 'convay pricing plans');
      assert.ok(opp.rules.length >= 3);
      const can = (await searchCannibalisationReport.run(ctx(), range)) as any;
      assert.equal(can.queries[0].query, 'pricing plans');
      assert.equal(can.queries[0].pages.length, 2);
      const topics = (await searchTopicsReport.run(ctx(), range)) as any;
      assert.ok(topics.ignoredBrandWords.includes('convay'));
      assert.ok(!topics.topics.some((t: any) => t.topic.includes('convay')), 'brand name is ignored as a topic');
    },
  );
});

test('sitemaps are read-only and parsed', async () => {
  await withFetch(
    () => ({ sitemap: [{ path: 'https://convay.com/sitemap.xml', errors: '2', warnings: '0', contents: [{ type: 'web', submitted: '120' }] }] }),
    async (calls) => {
      const r = (await searchSitemapsReport.run(ctx(), {} as never)) as any;
      assert.equal(r.sitemaps[0].errors, 2);
      assert.equal(r.sitemaps[0].submittedUrls, 120);
      assert.match(calls[0].url, /sitemaps$/);
    },
  );
});

test('host breakdown flags a host with traffic but no sitemap and survives a sitemap failure', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url.endsWith('/sitemaps')) return new Response('{}', { status: 500 });
    if (url.includes('runReport')) return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: 'blog.convay.com' }], metricValues: [{ value: '10' }, { value: '8' }, { value: '1' }] }, { dimensionValues: [{ value: 'localhost' }], metricValues: [{ value: '99' }, { value: '9' }, { value: '0' }] }] }), { status: 200 });
    void init;
    return new Response(JSON.stringify(sc([{ keys: ['https://blog.convay.com/x'], clicks: 3, impressions: 90, position: 7 }])), { status: 200 });
  }) as typeof fetch;
  try {
    const r = (await hostBreakdownReport.run(ctx(), range)) as any;
    assert.equal(r.hosts[0].host, 'blog.convay.com');
    assert.ok(r.hosts[0].flags.includes('traffic_without_sitemap'));
    assert.deepEqual(r.excludedHosts, ['localhost']);
    assert.ok(r.notes.some((n: string) => /Sitemaps could not be read/.test(n)));
  } finally {
    globalThis.fetch = original;
  }
});

test('pages table joins analytics and search by path', async () => {
  await withFetch(
    (url) => {
      if (url.includes('runReport')) return { rows: [{ dimensionValues: [{ value: '/pricing' }, { value: 'Pricing' }], metricValues: [{ value: '100' }, { value: '50' }, { value: '500' }, { value: '4' }] }] };
      return sc([{ keys: ['https://convay.com/pricing/'], clicks: 30, impressions: 1000, position: 4 }]);
    },
    async () => {
      const r = (await pagesTableReport.run(ctx(), range)) as any;
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0].views, 100);
      assert.equal(r.rows[0].clicks, 30);
    },
  );
});

test('page detail validates the path, escapes it in filters and returns analytics and search', async () => {
  assert.equal(pageDetailReport.input.safeParse({ ...range, path: '' }).success, false);
  assert.equal(pageDetailReport.input.safeParse({ ...range, path: '/a\nb' }).success, false);
  await withFetch(
    (url, body) => {
      if (url.includes('runReport')) {
        if (body.dimensions?.[0]?.name === 'date') return { rows: [{ dimensionValues: [{ value: '20261008' }], metricValues: [{ value: '5' }, { value: '3' }] }] };
        if (body.dimensions?.[0]?.name === 'sessionSourceMedium') return { rows: [{ dimensionValues: [{ value: 'google / organic' }], metricValues: [{ value: '4' }, { value: '1' }] }] };
        return { rows: [{ metricValues: [{ value: '5' }, { value: '3' }, { value: '30' }, { value: '1' }, { value: '0.4' }] }] };
      }
      if (body.dimensions) return sc([{ keys: ['convay pricing'], clicks: 3, impressions: 60, position: 4.2 }]);
      return sc([{ clicks: 3, impressions: 60, position: 4.2 }]);
    },
    async (calls) => {
      const r = (await pageDetailReport.run(ctx(), { ...range, path: '/pricing (new)/' })) as any;
      assert.equal(r.path, '/pricing (new)');
      assert.equal(r.analytics.views, 5);
      assert.equal(r.analytics.daily[0].date, '2026-10-08');
      assert.equal(r.analytics.bounceRate, 40);
      assert.equal(r.search.queries[0].query, 'convay pricing');
      const ga = calls.find((c) => c.url.includes('runReport'))!;
      assert.match(ga.body.dimensionFilter.filter.stringFilter.value, /\\\(new\\\)/, 'regex characters in the path are escaped');
    },
  );
});

test('snapshot keeps working when one source is missing and says so', async () => {
  const noGa = { ...project, ga4PropertyId: null } as unknown as ProjectDoc;
  await withFetch(
    (_u, body) => (body.dimensions ? sc([{ keys: ['q'], clicks: 1, impressions: 10, position: 2 }]) : sc([{ clicks: 5, impressions: 100, position: 3 }])),
    async () => {
      const r = (await siteSnapshotReport.run(ctx({ project: noGa, ga4PropertyId: undefined }), range)) as any;
      assert.equal(r.analytics, null);
      assert.equal(r.search.clicks, 5);
      assert.ok(r.unavailable.some((u: any) => u.source === 'Google Analytics 4'));
      assert.equal(typeof r.insights.opportunityCount, 'number');
    },
  );
});

test('cross-channel needs a connected Facebook account and a GA4 property', async () => {
  await assert.rejects(() => crossChannelReport.run(ctx({ getMeta: async () => null }), range), (e: any) => e.code === 'META_NOT_CONNECTED');
  await assert.rejects(() => crossChannelReport.run(ctx({ ga4PropertyId: undefined, project: { ...project, ga4PropertyId: null } as unknown as ProjectDoc }), range), (e: any) => e.code === 'GA4_NOT_SELECTED');
});

test('cross-channel joins Meta campaigns with GA4 tagged sessions', async () => {
  await withFetch(
    (url) => {
      if (url.includes('graph.facebook.com') && url.includes('/campaigns')) return { data: [{ id: '777', name: 'Spring Sale', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }] };
      if (url.includes('graph.facebook.com')) return { data: [{ campaign_id: '777', campaign_name: 'Spring Sale', spend: '100', impressions: '5000', reach: '4000', inline_link_clicks: '200', clicks: '300', actions: [{ action_type: 'lead', value: '5' }] }] };
      return { rows: [{ dimensionValues: [{ value: 'spring_sale' }, { value: 'facebook' }, { value: 'paid_social' }], metricValues: [{ value: '150' }, { value: '100' }, { value: '5' }] }] };
    },
    async () => {
      const r = (await crossChannelReport.run(ctx({ getMeta: async () => ({ accessToken: 't', appSecret: 's', accountId: '1' }) }), range)) as any;
      assert.equal(r.rows[0].metaCampaignName, 'Spring Sale');
      assert.equal(r.rows[0].sessions, 150);
      assert.equal(r.rows[0].costPerEngagedSession, 1);
      assert.equal(r.currency, 'BDT');
    },
  );
});
