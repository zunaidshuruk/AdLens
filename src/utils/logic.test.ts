import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_NAME, TRACKED_SITE } from '../config/app.ts';
import {
  addDays,
  computeDateRange,
  DATE_PRESETS,
  daysBetweenInclusive,
  getTodayInTimezone,
} from './dateUtils.ts';
import {
  calculatePercentChange,
  evaluateChangeSentiment,
  exportRowsToCsv,
  formatCurrency,
  formatNumber,
  formatPercent,
} from './formatters.ts';
import { adapters, setGA4LiveMode } from '../adapters/index.ts';
import { decryptPayload, encryptPayload } from '../../server/lib/crypto.ts';
import {
  formatGA4Date,
  mapGA4AcquisitionResponse,
  mapGA4CampaignsResponse,
  mapGA4ConversionsResponse,
  mapGA4OverviewResponse,
  mapGA4TopPagesResponse,
  mapGA4TrafficOverTimeResponse,
} from '../../server/lib/ga4Mapper.ts';

test('config constants are defined cleanly', () => {
  assert.ok(APP_NAME.length > 0);
  assert.equal(TRACKED_SITE.domain, 'convay.com');
});

test('computeDateRange computes valid ranges and matching compare ranges for all 7 presets', () => {
  const fixedNow = new Date('2026-10-18T02:00:00Z'); // 08:00 AM in Asia/Dhaka (2026-10-18)
  const dhakaToday = getTodayInTimezone('Asia/Dhaka', fixedNow);
  assert.equal(dhakaToday, '2026-10-18');

  for (const preset of DATE_PRESETS) {
    const custom = preset === 'Custom' ? { startDate: '2026-10-05', endDate: '2026-10-14' } : undefined;
    const range = computeDateRange(preset, 'Asia/Dhaka', custom, fixedNow, true);

    const primaryDays = daysBetweenInclusive(range.startDate, range.endDate);
    const compareDays = daysBetweenInclusive(range.compareStartDate, range.compareEndDate);

    assert.equal(range.dayCount, primaryDays, `Preset ${preset} dayCount matches primaryDays`);
    assert.equal(compareDays, primaryDays, `Preset ${preset} compareDays matches primaryDays`);
    assert.equal(
      range.compareEndDate,
      addDays(range.startDate, -1),
      `Preset ${preset} compareEndDate is immediately before startDate`
    );
  }
});

test('formatters format numbers, currency, percentages, and inverted cost sentiment properly', () => {
  assert.equal(formatNumber(12450), '12,450');
  assert.equal(formatCurrency(10, 'USD'), '$10.00');
  assert.equal(formatCurrency(10, 'BDT'), '৳1,200');
  assert.equal(formatPercent(4.56), '4.6%');
  assert.equal(calculatePercentChange(120, 100), 20);

  // Normal metric: rising is positive
  assert.equal(evaluateChangeSentiment(12.5, false), 'positive');
  assert.equal(evaluateChangeSentiment(-8.2, false), 'negative');

  // Cost metric (CPC, CPM, CPL): rising is negative (red), falling is positive (green)
  assert.equal(evaluateChangeSentiment(12.5, true), 'negative');
  assert.equal(evaluateChangeSentiment(-8.2, true), 'positive');

  const csvFilename = exportRowsToCsv('Top Campaigns', [{ key: 'name', header: 'Campaign' }], [
    { name: 'Test' },
  ]);
  assert.equal(csvFilename, 'adlens_top_campaigns.csv');
});

test('adapters return deterministic data and GA4 UTM campaigns match Meta campaign names', async () => {
  setGA4LiveMode(false);
  const fixedNow = new Date('2026-10-18T02:00:00Z');
  const range7d = computeDateRange('Last 7 days', 'Asia/Dhaka', undefined, fixedNow, true);
  const range28d = computeDateRange('Last 28 days', 'Asia/Dhaka', undefined, fixedNow, true);

  const [ga4Overview7d, ga4Overview28d, ga4Campaigns, metaCampaigns] = await Promise.all([
    adapters.ga4.getOverview(range7d),
    adapters.ga4.getOverview(range28d),
    adapters.ga4.getCampaigns(range7d),
    adapters.metaAds.getCampaigns(range7d),
  ]);

  assert.ok(ga4Overview28d.sessions.value > ga4Overview7d.sessions.value);

  const metaNames = new Set(metaCampaigns.map((c) => c.name));
  for (const ga4Camp of ga4Campaigns) {
    assert.ok(
      metaNames.has(ga4Camp.campaign),
      `GA4 UTM campaign "${ga4Camp.campaign}" matches a Meta campaign name`
    );
  }

  // Test 3-level Meta drill-down: Campaign -> Ad Set -> Ad
  const firstCampaign = metaCampaigns[0];
  const adSets = await adapters.metaAds.getAdSets(range7d, firstCampaign.id);
  assert.ok(adSets.length > 0, 'Campaign has ad sets');
  assert.ok(adSets.every((as) => as.campaignId === firstCampaign.id));

  const firstAdSet = adSets[0];
  const ads = await adapters.metaAds.getAds(range7d, firstAdSet.id);
  assert.ok(ads.length > 0, 'Ad Set has ads');
  assert.ok(ads.every((ad) => ad.adSetId === firstAdSet.id));
});

test('AES-256-GCM crypto encrypt/decrypt round-trip produces distinct IVs and recovers plaintext', () => {
  const secret = 'test-encryption-secret-key-for-sprint-2';
  const sessionPayload = JSON.stringify({
    google: {
      refreshToken: '1//0g_sample_refresh_token',
      accessToken: 'ya29.sample_access_token',
      accessTokenExpiry: 1792281600000,
      email: 'analyst@convay.com',
      ga4Property: { id: '44981234', name: 'Convay Web' },
      searchConsoleSite: { url: 'sc-domain:convay.com' },
    },
  });

  const encrypted1 = encryptPayload(sessionPayload, secret);
  const encrypted2 = encryptPayload(sessionPayload, secret);

  // Random IV per encryption means two encryptions of identical plaintext differ
  assert.notEqual(encrypted1, encrypted2);

  // Token must be base64url encoded and under 4 KB
  assert.match(encrypted1, /^[A-Za-z0-9_-]+$/);
  assert.ok(Buffer.byteLength(encrypted1, 'utf8') < 4000);

  // Round-trip decryption recovers exact JSON
  assert.equal(decryptPayload(encrypted1, secret), sessionPayload);
  assert.equal(decryptPayload(encrypted2, secret), sessionPayload);
});

test('AES-256-GCM decrypt rejects tampered ciphertext, tampered auth tag, and wrong key', () => {
  const secret = 'test-encryption-secret-key-for-sprint-2';
  const plaintext = JSON.stringify({ google: { email: 'analyst@convay.com' } });
  const token = encryptPayload(plaintext, secret);

  // Wrong key must fail
  assert.throws(() => {
    decryptPayload(token, 'wrong-secret-key');
  });

  // Tamper with a byte in the middle (auth tag / ciphertext)
  const raw = Buffer.from(token, 'base64url');
  raw[20] ^= 0xff;
  const tamperedToken = raw.toString('base64url');

  assert.throws(() => {
    decryptPayload(tamperedToken, secret);
  });

  // Truncated token must fail
  assert.throws(() => {
    decryptPayload('abc', secret);
  });
});

test('GA4 mapper accurately maps overview, zero-fills missing traffic days, filters campaigns, and filters conversions', () => {
  assert.equal(formatGA4Date('20261015'), '2026-10-15');

  const overview = mapGA4OverviewResponse({
    dimensionHeaders: [{ name: 'dateRange' }],
    rows: [
      {
        dimensionValues: [{ value: 'current' }],
        metricValues: [
          { value: '1200' }, // sessions
          { value: '900' }, // totalUsers
          { value: '810' }, // engagedSessions
          { value: '0.675' }, // engagementRate
          { value: '108000' }, // userEngagementDuration -> 108000 / 900 = 120s
          { value: '45' }, // keyEvents
        ],
      },
      {
        dimensionValues: [{ value: 'previous' }],
        metricValues: [
          { value: '1000' },
          { value: '800' },
          { value: '600' },
          { value: '0.60' },
          { value: '80000' }, // 100s
          { value: '30' },
        ],
      },
    ],
  });

  assert.equal(overview.sessions.value, 1200);
  assert.equal(overview.sessions.previousValue, 1000);
  assert.equal(overview.sessions.changePercent, 20);
  assert.equal(overview.engagementRate.value, 67.5);
  assert.equal(overview.avgEngagementTimeSec.value, 120);
  assert.equal(overview.conversions.value, 45);
  assert.equal(overview.conversions.changePercent, 50);

  // Traffic over time with missing middle day (2026-10-11 missing)
  const traffic = mapGA4TrafficOverTimeResponse(
    {
      dimensionHeaders: [{ name: 'date' }, { name: 'dateRange' }],
      rows: [
        {
          dimensionValues: [{ value: '20261010' }, { value: 'current' }],
          metricValues: [{ value: '100' }, { value: '80' }, { value: '65' }, { value: '5' }],
        },
        {
          dimensionValues: [{ value: '20261012' }, { value: 'current' }],
          metricValues: [{ value: '140' }, { value: '110' }, { value: '95' }, { value: '7' }],
        },
        {
          dimensionValues: [{ value: '20261007' }, { value: 'previous' }],
          metricValues: [{ value: '90' }, { value: '70' }, { value: '50' }, { value: '3' }],
        },
      ],
    },
    '2026-10-10',
    '2026-10-12',
    '2026-10-07',
    '2026-10-09'
  );

  assert.equal(traffic.length, 3);
  assert.equal(traffic[0].date, '2026-10-10');
  assert.equal(traffic[0].sessions, 100);
  assert.equal(traffic[0].previousSessions, 90);
  // Missing day filled with zeros:
  assert.equal(traffic[1].date, '2026-10-11');
  assert.equal(traffic[1].sessions, 0);
  assert.equal(traffic[1].previousSessions, 0);
  assert.equal(traffic[2].date, '2026-10-12');
  assert.equal(traffic[2].sessions, 140);

  // Campaigns exclude (not set) and (direct) when real campaigns exist
  const campaigns = mapGA4CampaignsResponse({
    rows: [
      {
        dimensionValues: [{ value: '(direct)' }, { value: '(direct)' }, { value: '(none)' }],
        metricValues: [{ value: '500' }, { value: '400' }, { value: '0.5' }, { value: '10' }],
      },
      {
        dimensionValues: [{ value: '(not set)' }, { value: 'google' }, { value: 'organic' }],
        metricValues: [{ value: '300' }, { value: '250' }, { value: '0.6' }, { value: '8' }],
      },
      {
        dimensionValues: [
          { value: 'convay_enterprise_demo_q4' },
          { value: 'facebook' },
          { value: 'paid_social' },
        ],
        metricValues: [{ value: '200' }, { value: '180' }, { value: '0.72' }, { value: '12' }],
      },
    ],
  });
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].campaign, 'convay_enterprise_demo_q4');
  assert.equal(campaigns[0].sourceMedium, 'facebook / paid_social');

  // Campaigns keep (direct) / (not set) if they are the ONLY rows
  const fallbackCampaigns = mapGA4CampaignsResponse({
    rows: [
      {
        dimensionValues: [{ value: '(direct)' }, { value: '(direct)' }, { value: '(none)' }],
        metricValues: [{ value: '500' }, { value: '400' }, { value: '0.5' }, { value: '10' }],
      },
    ],
  });
  assert.equal(fallbackCampaigns.length, 1);
  assert.equal(fallbackCampaigns[0].campaign, '(direct)');

  // Conversions keep only keyEvents > 0
  const conversions = mapGA4ConversionsResponse({
    dimensionHeaders: [{ name: 'eventName' }, { name: 'dateRange' }],
    rows: [
      {
        dimensionValues: [{ value: 'page_view' }, { value: 'current' }],
        metricValues: [{ value: '0' }, { value: '500' }, { value: '600' }],
      },
      {
        dimensionValues: [{ value: 'demo_request' }, { value: 'current' }],
        metricValues: [{ value: '15' }, { value: '14' }, { value: '300' }],
      },
      {
        dimensionValues: [{ value: 'demo_request' }, { value: 'previous' }],
        metricValues: [{ value: '10' }, { value: '9' }, { value: '250' }],
      },
    ],
  });
  assert.equal(conversions.length, 1);
  assert.equal(conversions[0].eventName, 'demo_request');
  assert.equal(conversions[0].count, 15);
  assert.equal(conversions[0].previousCount, 10);
  assert.equal(conversions[0].changePercent, 50);

  // Acquisition channels & countries sharePercent
  const acq = mapGA4AcquisitionResponse(
    {
      rows: [
        {
          dimensionValues: [{ value: 'Organic Search' }],
          metricValues: [{ value: '600' }, { value: '500' }, { value: '420' }, { value: '0.7' }, { value: '20' }],
        },
        {
          dimensionValues: [{ value: 'Paid Social' }],
          metricValues: [{ value: '400' }, { value: '350' }, { value: '260' }, { value: '0.65' }, { value: '10' }],
        },
      ],
    },
    {
      rows: [
        {
          dimensionValues: [{ value: 'Bangladesh' }, { value: 'BD' }],
          metricValues: [{ value: '800' }, { value: '650' }],
        },
        {
          dimensionValues: [{ value: 'United States' }, { value: 'US' }],
          metricValues: [{ value: '200' }, { value: '180' }],
        },
      ],
    }
  );
  assert.equal(acq.channels[0].sharePercent, 60);
  assert.equal(acq.channels[1].sharePercent, 40);
  assert.equal(acq.countries[0].sharePercent, 80);
  assert.equal(acq.countries[0].code, 'BD');

  const topPages = mapGA4TopPagesResponse({
    rows: [
      {
        dimensionValues: [{ value: '/pricing' }, { value: 'Convay Pricing' }],
        metricValues: [{ value: '300' }, { value: '200' }, { value: '18000' }, { value: '0.25' }, { value: '9' }],
      },
    ],
  });
  assert.equal(topPages.length, 1);
  assert.equal(topPages[0].avgEngagementTimeSec, 90);
  assert.equal(topPages[0].bounceRate, 25);

  // Adapter registry switches ga4 between mock and live while keeping isAnyMocked true (since GSC & Meta are mock)
  setGA4LiveMode(true);
  assert.equal(adapters.ga4.isMock, false);
  assert.equal(adapters.isAnyMocked(), true);
  setGA4LiveMode(false);
  assert.equal(adapters.ga4.isMock, true);
});

test('/api/ga4 routes enforce GA4_NOT_SELECTED, validate date ranges, set X-AdLens-Cache header, and map Google errors cleanly', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-3';
  process.env.APP_BASE_URL = 'http://localhost:3000';

  const { app } = await import('../../server/index.ts');
  const { clearGA4Cache } = await import('../../server/routes/ga4.ts');
  const { SESSION_COOKIE_NAME } = await import('../../server/lib/session.ts');

  clearGA4Cache();
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const originalFetch = globalThis.fetch;

  try {
    // 1. Session without ga4Property -> 409 GA4_NOT_SELECTED
    const noPropCookie = `${SESSION_COOKIE_NAME}=${encryptPayload(
      JSON.stringify({
        google: {
          refreshToken: 'ref-1',
          accessToken: 'acc-1',
          accessTokenExpiry: Date.now() + 3600_000,
          email: 'analyst@convay.com',
        },
      }),
      process.env.TOKEN_ENCRYPTION_KEY
    )}`;

    const res409 = await originalFetch(
      `${baseUrl}/api/ga4/overview?startDate=2026-10-01&endDate=2026-10-07`,
      { headers: { Cookie: noPropCookie } }
    );
    assert.equal(res409.status, 409);
    const body409 = (await res409.json()) as { error: { code: string } };
    assert.equal(body409.error.code, 'GA4_NOT_SELECTED');

    // 2. Session WITH selected ga4Property
    const validCookie = `${SESSION_COOKIE_NAME}=${encryptPayload(
      JSON.stringify({
        google: {
          refreshToken: 'ref-1',
          accessToken: 'acc-1',
          accessTokenExpiry: Date.now() + 3600_000,
          email: 'analyst@convay.com',
          ga4Property: { id: '44981234', name: 'Convay Production' },
        },
      }),
      process.env.TOKEN_ENCRYPTION_KEY
    )}`;

    // Invalid date range (startDate > endDate) -> 400 INVALID_DATE_RANGE
    const res400 = await originalFetch(
      `${baseUrl}/api/ga4/overview?startDate=2026-10-10&endDate=2026-10-05`,
      { headers: { Cookie: validCookie } }
    );
    assert.equal(res400.status, 400);
    const body400 = (await res400.json()) as { error: { code: string } };
    assert.equal(body400.error.code, 'INVALID_DATE_RANGE');

    // 3. Mock upstream Google Analytics Data API & Admin API calls
    let upstreamCallCount = 0;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }

      upstreamCallCount += 1;

      if (urlStr.includes('analyticsadmin.googleapis.com/v1beta/properties/44981234')) {
        return new Response(
          JSON.stringify({
            name: 'properties/44981234',
            displayName: 'Convay Production',
            timeZone: 'Asia/Dhaka',
            currencyCode: 'BDT',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('analyticsdata.googleapis.com/v1beta/properties/44981234:runReport')) {
        return new Response(
          JSON.stringify({
            dimensionHeaders: [{ name: 'dateRange' }],
            rows: [
              {
                dimensionValues: [{ value: 'current' }],
                metricValues: [
                  { value: '1500' },
                  { value: '1100' },
                  { value: '990' },
                  { value: '0.66' },
                  { value: '132000' },
                  { value: '55' },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    };

    // First call to /api/ga4/overview -> X-AdLens-Cache: false
    const resOverview1 = await originalFetch(
      `${baseUrl}/api/ga4/overview?startDate=2026-10-01&endDate=2026-10-07`,
      { headers: { Cookie: validCookie } }
    );
    assert.equal(resOverview1.status, 200);
    assert.equal(resOverview1.headers.get('x-adlens-cache'), 'false');
    const overviewData = (await resOverview1.json()) as { sessions: { value: number } };
    assert.equal(overviewData.sessions.value, 1500);
    assert.equal(upstreamCallCount, 1);

    // Second call with identical params -> X-AdLens-Cache: true (served from 10-min cache)
    const resOverview2 = await originalFetch(
      `${baseUrl}/api/ga4/overview?startDate=2026-10-01&endDate=2026-10-07`,
      { headers: { Cookie: validCookie } }
    );
    assert.equal(resOverview2.status, 200);
    assert.equal(resOverview2.headers.get('x-adlens-cache'), 'true');
    assert.equal(upstreamCallCount, 1);

    // Property info endpoint
    const resPropInfo = await originalFetch(`${baseUrl}/api/ga4/property-info`, {
      headers: { Cookie: validCookie },
    });
    assert.equal(resPropInfo.status, 200);
    const propInfo = (await resPropInfo.json()) as {
      propertyId: string;
      displayName: string;
      timeZone: string;
      currencyCode: string;
    };
    assert.equal(propInfo.propertyId, '44981234');
    assert.equal(propInfo.displayName, 'Convay Production');
    assert.equal(propInfo.timeZone, 'Asia/Dhaka');
    assert.equal(propInfo.currencyCode, 'BDT');

    // 4. Test 403 PERMISSION_DENIED mapping
    clearGA4Cache();
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }
      return new Response(
        JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Raw internal Google message' } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res403 = await originalFetch(
      `${baseUrl}/api/ga4/overview?startDate=2026-10-01&endDate=2026-10-07`,
      { headers: { Cookie: validCookie } }
    );
    assert.equal(res403.status, 403);
    const body403 = (await res403.json()) as { error: { code: string; message: string } };
    assert.equal(body403.error.code, 'GA4_PERMISSION_DENIED');
    assert.equal(
      body403.error.message,
      'This Google account no longer has access to the selected property'
    );

    // 5. Test 429 RESOURCE_EXHAUSTED mapping
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }
      return new Response(
        JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res429 = await originalFetch(
      `${baseUrl}/api/ga4/overview?startDate=2026-10-01&endDate=2026-10-07`,
      { headers: { Cookie: validCookie } }
    );
    assert.equal(res429.status, 429);
    const body429 = (await res429.json()) as { error: { code: string } };
    assert.equal(body429.error.code, 'GA4_QUOTA_EXCEEDED');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.APP_BASE_URL;
    server.close();
  }
});


