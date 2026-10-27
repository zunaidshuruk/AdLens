import assert from 'node:assert/strict';
import test from 'node:test';
import { joinPages, normalisePath } from './pageJoin.js';

test('normalisePath handles urls, queries, slashes and the home page', () => {
  assert.equal(normalisePath('https://www.example.com/a/b/?x=1#top'), '/a/b');
  assert.equal(normalisePath('/a/b/'), '/a/b');
  assert.equal(normalisePath('a/b'), '/a/b');
  assert.equal(normalisePath('https://example.com'), '/');
  assert.equal(normalisePath('/'), '/');
  assert.equal(normalisePath(''), '');
  assert.equal(normalisePath('/caf%C3%A9'), '/café');
});

test('joins the two sources and flags gaps', () => {
  const rows = joinPages(
    [
      { path: '/pricing', title: 'Pricing', views: 100, users: 50, engagementSeconds: 500, keyEvents: 4 },
      { path: '/pricing/', title: 'Pricing', views: 20, users: 10, engagementSeconds: 100, keyEvents: 1 },
      { path: '/internal', views: 30, users: 10, engagementSeconds: 0, keyEvents: 0 },
    ],
    [
      { page: 'https://example.com/pricing', clicks: 30, impressions: 1000, position: 4 },
      { page: 'https://example.com/blog/post', clicks: 0, impressions: 500, position: 12 },
      { page: 'https://example.com/guide', clicks: 1, impressions: 800, position: 9 },
    ],
  );
  const by = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.equal(by['/pricing'].views, 120);
  assert.equal(by['/pricing'].users, 60);
  assert.equal(by['/pricing'].avgEngagementSeconds, 10);
  assert.equal(by['/pricing'].clicks, 30);
  assert.equal(by['/pricing'].ctr, 3);
  assert.deepEqual(by['/pricing'].flags, []);
  assert.deepEqual(by['/internal'].flags, ['analytics_only']);
  assert.deepEqual(by['/blog/post'].flags.sort(), ['search_only', 'seen_not_clicked']);
  assert.ok(by['/guide'].flags.includes('seen_not_clicked'));
  assert.equal(rows[0].path, '/pricing'); // most views first
});

test('limit is applied', () => {
  const ga = Array.from({ length: 10 }, (_, i) => ({ path: `/p${i}`, views: i, users: 1, engagementSeconds: 1, keyEvents: 0 }));
  assert.equal(joinPages(ga, [], { limit: 3 }).length, 3);
});

test('impression-weighted position', () => {
  const rows = joinPages([], [
    { page: 'https://e.com/x', clicks: 1, impressions: 100, position: 2 },
    { page: 'https://e.com/x?y=1', clicks: 1, impressions: 300, position: 6 },
  ]);
  assert.equal(rows[0].position, 5);
});
