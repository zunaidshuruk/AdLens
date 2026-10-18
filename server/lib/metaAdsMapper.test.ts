import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMetrics,
  extractLeads,
  mapAdFormat,
  mapMetaAds,
  mapMetaAdSets,
  mapMetaCampaigns,
  mapMetaErrorCode,
  mapMetaOverview,
  mapMetaSpendOverTime,
  mapObjective,
  mapStatus,
  summarizeTargeting,
} from './metaAdsMapper.ts';

test('extractLeads: "lead" total is never double-counted with its components', () => {
  assert.equal(
    extractLeads([
      { action_type: 'lead', value: '12' },
      { action_type: 'onsite_conversion.lead_grouped', value: '8' },
      { action_type: 'offsite_conversion.fb_pixel_lead', value: '4' },
    ]),
    12
  );
});

test('extractLeads: sums Instant Form + Pixel leads when "lead" is absent', () => {
  assert.equal(
    extractLeads([
      { action_type: 'onsite_conversion.lead_grouped', value: '5' },
      { action_type: 'offsite_conversion.fb_pixel_lead', value: '3' },
      { action_type: 'link_click', value: '400' },
    ]),
    8
  );
});

test('extractLeads: falls back to leadgen_grouped, and handles empty input', () => {
  assert.equal(extractLeads([{ action_type: 'leadgen_grouped', value: '6' }]), 6);
  assert.equal(extractLeads(undefined), 0);
  assert.equal(extractLeads([]), 0);
});

test('deriveMetrics: uses link clicks and recomputes ratios; divide-by-zero gives 0', () => {
  const m = deriveMetrics({ spend: 100, impressions: 20000, reach: 8000, linkClicks: 250, leads: 10 });
  assert.equal(m.ctr, 1.25);
  assert.equal(m.cpcUsd, 0.4);
  assert.equal(m.cpmUsd, 5);
  assert.equal(m.cplUsd, 10);
  assert.equal(m.frequency, 2.5);

  const zero = deriveMetrics({ spend: 0, impressions: 0, reach: 0, linkClicks: 0, leads: 0 });
  assert.deepEqual(
    [zero.ctr, zero.cpcUsd, zero.cpmUsd, zero.cplUsd, zero.frequency],
    [0, 0, 0, 0, 0]
  );
});

test('mapMetaOverview: parses string values and computes % change (all clicks ignored)', () => {
  const o = mapMetaOverview(
    {
      spend: '150.50',
      impressions: '30000',
      reach: '12000',
      inline_link_clicks: '300',
      clicks: '900',
      actions: [{ action_type: 'lead', value: '15' }],
    },
    { spend: '100', impressions: '20000', reach: '10000', inline_link_clicks: '200', actions: [] }
  );
  assert.equal(o.spendUsd.value, 150.5);
  assert.equal(o.spendUsd.changePercent, 50.5);
  assert.equal(o.clicks.value, 300);
  assert.equal(o.leads.value, 15);
  assert.equal(o.leads.previousValue, 0);
  assert.equal(o.frequency.value, 2.5);
  assert.equal(o.cplUsd.value, 10.03);
});

test('mapMetaSpendOverTime: zero-fills missing days and aligns previous period by position', () => {
  const series = mapMetaSpendOverTime(
    [
      { date_start: '2026-10-01', spend: '10', impressions: '1000', inline_link_clicks: '20' },
      { date_start: '2026-10-03', spend: '30', impressions: '3000', inline_link_clicks: '60' },
    ],
    '2026-10-01',
    '2026-10-03',
    [{ date_start: '2026-09-29', spend: '7' }],
    '2026-09-28',
    '2026-09-30'
  );
  assert.equal(series.length, 3);
  assert.deepEqual(
    series.map((p) => [p.date, p.spendUsd, p.compareDate, p.previousSpendUsd]),
    [
      ['2026-10-01', 10, '2026-09-28', 0],
      ['2026-10-02', 0, '2026-09-29', 7],
      ['2026-10-03', 30, '2026-09-30', 0],
    ]
  );
});

test('label mapping: objectives (ODAX + legacy), statuses, formats', () => {
  assert.equal(mapObjective('OUTCOME_LEADS'), 'Lead Generation');
  assert.equal(mapObjective('LINK_CLICKS'), 'Traffic');
  assert.equal(mapObjective('SOMETHING_NEW'), 'Other');
  assert.equal(mapStatus('CAMPAIGN_PAUSED'), 'Paused');
  assert.equal(mapStatus('DISAPPROVED'), 'Rejected');
  assert.equal(mapStatus('PENDING_REVIEW'), 'In Review');
  assert.equal(mapAdFormat({ object_type: 'VIDEO' }), 'Video');
  assert.equal(
    mapAdFormat({ object_type: 'SHARE', object_story_spec: { link_data: { child_attachments: [{}, {}, {}] } } }),
    'Carousel'
  );
  assert.equal(mapAdFormat({ object_type: 'SHARE' }), 'Single Image');
  assert.equal(mapAdFormat({ asset_feed_spec: { images: [{}, {}] } }), 'Dynamic');
  assert.equal(mapAdFormat(undefined), 'Other');
});

test('summarizeTargeting builds a short readable audience string', () => {
  assert.equal(
    summarizeTargeting({
      geo_locations: { countries: ['BD'] },
      age_min: 25,
      age_max: 54,
      genders: [2],
      custom_audiences: [{ id: '1' }, { id: '2' }],
      flexible_spec: [{ interests: [{ id: 'a' }, { id: 'b' }], behaviors: [{ id: 'c' }] }],
    }),
    'BD · 25–54 · Women · 2 custom audiences · 3 interests'
  );
  assert.equal(summarizeTargeting({ geo_locations: { countries: ['BD', 'NP'] } }), 'BD, NP · 18–65+ · All genders');
  assert.equal(summarizeTargeting(undefined), 'Not specified');
});

test('mapMetaCampaigns: joins objects + insights, hides idle archived, keeps deleted-with-spend, sorts by spend', () => {
  const rows = mapMetaCampaigns(
    [
      { id: 'c1', name: 'Lead Gen BD', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' },
      { id: 'c2', name: 'Old Awareness', objective: 'REACH', effective_status: 'ARCHIVED' },
      { id: 'c3', name: 'New Draft', objective: 'OUTCOME_TRAFFIC', effective_status: 'ACTIVE' },
    ],
    [
      { campaign_id: 'c1', spend: '50', impressions: '10000', reach: '5000', inline_link_clicks: '100' },
      { campaign_id: 'c9', campaign_name: 'Removed Campaign', spend: '80', impressions: '9000', reach: '4000' },
    ]
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.name, r.objective, r.status, r.spendUsd]),
    [
      ['c9', 'Removed Campaign', 'Other', 'Deleted', 80],
      ['c1', 'Lead Gen BD', 'Lead Generation', 'Active', 50],
      ['c3', 'New Draft', 'Traffic', 'Active', 0],
    ]
  );
});

test('mapMetaAdSets and mapMetaAds filter by parent and fill names', () => {
  const campaignNames = new Map([['c1', 'Lead Gen BD']]);
  const adSets = mapMetaAdSets(
    [
      { id: 's1', name: 'Dhaka 25-44', campaign_id: 'c1', effective_status: 'ACTIVE', targeting: { geo_locations: { countries: ['BD'] } } },
      { id: 's2', name: 'Other campaign set', campaign_id: 'c2', effective_status: 'ACTIVE' },
    ],
    [{ adset_id: 's1', spend: '20', impressions: '4000', reach: '2000' }],
    campaignNames,
    'c1'
  );
  assert.equal(adSets.length, 1);
  assert.equal(adSets[0].campaignName, 'Lead Gen BD');
  assert.equal(adSets[0].audience, 'BD · 18–65+ · All genders');

  const ads = mapMetaAds(
    [
      { id: 'a1', name: 'Video 1', adset_id: 's1', campaign_id: 'c1', effective_status: 'ACTIVE', creative: { object_type: 'VIDEO' } },
      { id: 'a2', name: 'Elsewhere', adset_id: 's2', campaign_id: 'c2', effective_status: 'ACTIVE' },
    ],
    [{ ad_id: 'a1', spend: '5', impressions: '1000', inline_link_clicks: '10' }],
    new Map([['s1', 'Dhaka 25-44']]),
    campaignNames,
    's1'
  );
  assert.equal(ads.length, 1);
  assert.equal(ads[0].format, 'Video');
  assert.equal(ads[0].adSetName, 'Dhaka 25-44');
  assert.equal(ads[0].cpcUsd, 0.5);
});

test('mapMetaErrorCode maps Graph API errors to AdLens codes', () => {
  assert.equal(mapMetaErrorCode({ code: 190 }), 'META_TOKEN_INVALID');
  assert.equal(mapMetaErrorCode({ code: 200 }), 'META_PERMISSION_DENIED');
  assert.equal(mapMetaErrorCode({ code: 17 }), 'META_RATE_LIMITED');
  assert.equal(mapMetaErrorCode({ code: 80004 }), 'META_RATE_LIMITED');
  assert.equal(mapMetaErrorCode({ code: 100 }), 'META_INVALID_REQUEST');
  assert.equal(mapMetaErrorCode(undefined), 'META_REQUEST_FAILED');
});
