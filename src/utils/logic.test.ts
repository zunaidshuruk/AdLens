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
import { adapters } from '../adapters/index.ts';
import { decryptPayload, encryptPayload } from '../../server/lib/crypto.ts';

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
