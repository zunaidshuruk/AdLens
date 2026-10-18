import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTrends,
  detectCannibalisation,
  findOpportunities,
  groupQueriesIntoTopics,
  typicalCtr,
} from './searchInsights.ts';
import { buildHostBreakdown, normalizeHost } from './hostBreakdown.ts';

test('typicalCtr interpolates between positions and clamps at the ends', () => {
  assert.equal(typicalCtr(1), 28);
  assert.equal(typicalCtr(0.5), 28);
  assert.equal(typicalCtr(5), 6.5);
  assert.equal(Math.round(typicalCtr(5.5) * 100) / 100, 5.75);
  assert.equal(typicalCtr(20), 0.5);
  assert.equal(typicalCtr(35), 0.4);
});

test('findOpportunities applies all rules and ranks by estimated extra clicks', () => {
  const r = findOpportunities([
    { query: 'secure video conferencing', clicks: 5, impressions: 2000, position: 6 }, // 0.25% vs 5% typical → yes
    { query: 'zoom alternative bangladesh', clicks: 2, impressions: 400, position: 8 }, // 0.5% vs 3.2% → yes
    { query: 'convay', clicks: 300, impressions: 1000, position: 1.2 }, // position too high → no
    { query: 'video meeting app', clicks: 30, impressions: 1000, position: 7 }, // 3% vs 4% → not below half → no
    { query: 'rare term', clicks: 0, impressions: 50, position: 9 }, // too few impressions → no
    { query: 'deep page', clicks: 0, impressions: 500, position: 25 }, // beyond 20 → no
  ]);
  assert.deepEqual(r.opportunities.map((o) => o.query), ['secure video conferencing', 'zoom alternative bangladesh']);
  assert.equal(r.opportunities[0].estimatedExtraClicks, 95); // 2000 × (5 − 0.25)%
  assert.equal(r.opportunities[0].typicalCtr, 5);
  assert.equal(r.rules.length, 4);
});

test('detectCannibalisation flags queries split across 2+ pages at >=10% share', () => {
  const out = detectCannibalisation([
    { query: 'video conferencing software', page: 'https://convay.com/', clicks: 10, impressions: 600, position: 8 },
    { query: 'video conferencing software', page: 'https://convay.com/features', clicks: 4, impressions: 350, position: 12 },
    { query: 'video conferencing software', page: 'https://convay.com/blog/x', clicks: 0, impressions: 50, position: 30 },
    { query: 'convay login', page: 'https://convay.com/login', clicks: 90, impressions: 300, position: 1 },
    { query: 'convay login', page: 'https://convay.com/', clicks: 1, impressions: 10, position: 4 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].query, 'video conferencing software');
  assert.deepEqual(out[0].pages.map((p) => [p.page, p.sharePercent]), [
    ['https://convay.com/', 60],
    ['https://convay.com/features', 35],
  ]);
});

test('classifyTrends: new, lost, rising, falling with thresholds', () => {
  const r = classifyTrends(
    new Map([['a', 100], ['b', 40], ['c', 12], ['d', 52], ['e', 3]]),
    new Map([['a', 60], ['b', 80], ['f', 20], ['d', 50], ['g', 4]])
  );
  assert.deepEqual(r.rising.map((i) => [i.key, i.changePercent]), [['a', 66.7]]);
  assert.deepEqual(r.falling.map((i) => [i.key, i.changePercent]), [['b', -50]]);
  assert.deepEqual(r.new.map((i) => i.key), ['c']); // e is below minVolume
  assert.deepEqual(r.lost.map((i) => i.key), ['f']); // g is below minVolume
  // d changed by only 4% → not trending
});

test('groupQueriesIntoTopics groups by shared phrases and ignores brand terms', () => {
  const groups = groupQueriesIntoTopics(
    [
      { query: 'video conferencing software', clicks: 10, impressions: 500, position: 8 },
      { query: 'best video conferencing app', clicks: 6, impressions: 300, position: 9 },
      { query: 'secure meeting app', clicks: 3, impressions: 200, position: 11 },
      { query: 'convay pricing', clicks: 20, impressions: 80, position: 1 },
      { query: 'convay login', clicks: 40, impressions: 90, position: 1 },
    ],
    { ignore: ['convay'] }
  );
  const topic = groups.find((g) => g.topic === 'video conferencing')!;
  assert.deepEqual(topic.queries.sort(), ['best video conferencing app', 'video conferencing software']);
  assert.equal(topic.clicks, 16);
  assert.equal(groups[groups.length - 1].topic, 'Other');
});

test('normalizeHost handles URLs, sc-domain-style input and www', () => {
  assert.equal(normalizeHost('https://www.convay.com/pricing?a=1'), 'convay.com');
  assert.equal(normalizeHost('app.convay.com'), 'app.convay.com');
  assert.equal(normalizeHost('https://convay.com:443/sitemap.xml'), 'convay.com');
});

test('buildHostBreakdown merges sources, excludes local hosts and flags gaps', () => {
  const b = buildHostBreakdown(
    [
      { hostName: 'convay.com', sessions: 900, activeUsers: 700, keyEvents: 30 },
      { hostName: 'app.convay.com', sessions: 400, activeUsers: 200, keyEvents: 0 },
      { hostName: 'localhost', sessions: 50, activeUsers: 1, keyEvents: 0 },
    ],
    [
      { page: 'https://convay.com/', clicks: 80, impressions: 2000, position: 4 },
      { page: 'https://convay.com/features', clicks: 20, impressions: 2000, position: 10 },
      { page: 'https://blog.convay.com/post', clicks: 0, impressions: 0, position: 0 },
    ],
    [
      { path: 'https://convay.com/sitemap.xml', errors: 2 },
      { path: 'https://docs.convay.com/sitemap.xml' },
    ]
  );
  const main = b.hosts.find((h) => h.host === 'convay.com')!;
  assert.equal(main.position, 7); // impression-weighted (4 and 10)
  assert.equal(main.ctr, 2.5);
  assert.deepEqual(main.flags, ['sitemap_errors']);
  assert.deepEqual(b.hosts.find((h) => h.host === 'app.convay.com')!.flags, ['traffic_without_sitemap']);
  assert.deepEqual(b.hosts.find((h) => h.host === 'docs.convay.com')!.flags, ['sitemap_without_traffic']);
  assert.deepEqual(b.excludedHosts, ['localhost']);
  assert.equal(b.totals.sessions, 1300);
});
