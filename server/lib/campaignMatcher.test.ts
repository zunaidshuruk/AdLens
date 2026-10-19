import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignKey, isMetaTraffic, joinMetaWithGa4 } from './campaignMatcher.js';

test('campaignKey ignores case, symbols, encoding and accents', () => {
  assert.equal(campaignKey('Spring Sale — Lead Gen'), 'springsaleleadgen');
  assert.equal(campaignKey('spring_sale-lead+gen'), 'springsaleleadgen');
  assert.equal(campaignKey('spring%20sale%20lead%20gen'), 'springsaleleadgen');
  assert.equal(campaignKey('Café Promo'), 'cafepromo');
});

test('isMetaTraffic recognises Meta sources and paid-social mediums', () => {
  assert.ok(isMetaTraffic('facebook', 'paid_social'));
  assert.ok(isMetaTraffic('l.facebook.com', 'referral'));
  assert.ok(isMetaTraffic('ig', 'cpc'));
  assert.ok(!isMetaTraffic('google', 'cpc'));
  assert.ok(!isMetaTraffic('newsletter', 'email'));
});

test('joins by ID, exact name and likely name; computes costs and flags gaps', () => {
  const r = joinMetaWithGa4(
    [
      { id: '120001', name: 'Retargeting Q4', spend: 50, impressions: 9000, clicks: 100, leads: 3 },
      { id: '120002', name: 'Spring Sale — Lead Gen', spend: 200, impressions: 40000, clicks: 400, leads: 12 },
      { id: '120003', name: 'Brand Awareness Dhaka 2026', spend: 80, impressions: 30000, clicks: 120, leads: 0 },
      { id: '120004', name: 'Untagged Video', spend: 30, impressions: 5000, clicks: 60, leads: 0 },
    ],
    [
      { campaign: 'rt_120001', source: 'facebook', medium: 'paid_social', sessions: 80, engagedSessions: 50, keyEvents: 5 },
      { campaign: 'spring_sale_lead_gen', source: 'facebook', medium: 'paid_social', sessions: 150, engagedSessions: 100, keyEvents: 10 },
      { campaign: 'spring_sale_lead_gen', source: 'newsletter', medium: 'email', sessions: 999, engagedSessions: 999, keyEvents: 99 },
      { campaign: 'brand awareness dhaka', source: 'instagram', medium: 'paid_social', sessions: 90, engagedSessions: 40, keyEvents: 1 },
      { campaign: 'old_campaign_name', source: 'fb', medium: 'cpc', sessions: 25, engagedSessions: 10, keyEvents: 0 },
      { campaign: '(not set)', source: 'facebook', medium: 'referral', sessions: 500, engagedSessions: 200, keyEvents: 2 },
    ]
  );
  const byId = Object.fromEntries(r.rows.map((x) => [x.metaCampaignId, x]));

  assert.equal(byId['120001'].matchType, 'id');
  assert.equal(byId['120001'].sessions, 80);

  assert.equal(byId['120002'].matchType, 'exact');
  assert.equal(byId['120002'].sessions, 150); // email traffic with same name excluded
  assert.equal(byId['120002'].costPerEngagedSession, 2);
  assert.equal(byId['120002'].costPerKeyEvent, 20);
  assert.equal(byId['120002'].landingRate, 37.5);
  assert.ok(byId['120002'].flags.includes('low_landing_rate'));

  assert.equal(byId['120003'].matchType, 'likely');
  assert.ok(byId['120003'].flags.includes('likely_match_only'));

  assert.equal(byId['120004'].matchType, 'none');
  assert.deepEqual(byId['120004'].flags, ['no_utm_traffic']);
  assert.equal(byId['120004'].costPerSession, null);

  assert.deepEqual(r.unmatchedGa4MetaCampaigns, [{ campaign: 'old_campaign_name', sessions: 25, keyEvents: 0 }]);
  assert.equal(r.totals.spend, 360);
  assert.equal(r.totals.spendWithoutTracking, 30);
  assert.equal(r.rows[0].metaCampaignId, '120002'); // sorted by spend
});

test('falls back to non-Meta sources only when a campaign has no Meta-tagged rows', () => {
  const r = joinMetaWithGa4(
    [{ id: '9', name: 'Promo', spend: 10, impressions: 100, clicks: 10, leads: 0 }],
    [{ campaign: 'promo', source: 'partner-site.com', medium: 'referral', sessions: 7, engagedSessions: 4, keyEvents: 1 }]
  );
  assert.equal(r.rows[0].sessions, 7);
  assert.ok(r.rows[0].flags.includes('source_not_meta'));
});
