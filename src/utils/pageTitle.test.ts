import assert from 'node:assert/strict';
import test from 'node:test';
import { pageTitleFor } from './pageTitle.js';

test('each screen has its own title', () => {
  assert.equal(pageTitleFor('/', 'AdLens'), 'Overview · AdLens');
  assert.equal(pageTitleFor('/meta-ads', 'AdLens'), 'Meta Ads · AdLens');
  assert.equal(pageTitleFor('/ai-analyst', 'AdLens'), 'AI Analyst · AdLens');
  assert.equal(pageTitleFor('/dashboards/abc', 'AdLens'), 'Dashboards · AdLens');
});

test('unknown or odd paths fall back to the app name', () => {
  assert.equal(pageTitleFor('/nothing-here', 'AdLens'), 'AdLens');
  assert.equal(pageTitleFor('/ga4x', 'AdLens'), 'AdLens');
  assert.equal(pageTitleFor(undefined as unknown as string, 'AdLens'), 'Overview · AdLens');
});
