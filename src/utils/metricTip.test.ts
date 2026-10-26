import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveMetricTip } from './metricTip.js';

test('tip: plain-language text, source name and direction', () => {
  const t = resolveMetricTip('Cost per Lead (CPL)', 'meta_ads');
  assert.ok(t);
  assert.equal(t.sourceName, 'Meta Ads');
  assert.equal(t.direction, 'A lower number is better.');
  assert.ok(t.definition.length > 20);
});

test('tip: the same word means different things in different sources', () => {
  assert.equal(resolveMetricTip('Impressions', 'meta_ads')?.key, 'impressions');
  assert.equal(resolveMetricTip('Impressions', 'search_console')?.key, 'searchImpressions');
  assert.equal(resolveMetricTip('Click-Through Rate (CTR)', 'meta_ads')?.key, 'adCtr');
  assert.equal(resolveMetricTip('Click-Through Rate (CTR)', 'search_console')?.key, 'searchCtr');
});

test('tip: spend has no good/bad direction; unknown labels give no tip', () => {
  assert.equal(resolveMetricTip('Total Spend', 'meta_ads')?.direction, null);
  assert.equal(resolveMetricTip('Something we never defined', 'ga4'), null);
});

test('tip: an explicit key wins over the label', () => {
  assert.equal(resolveMetricTip('Whatever', 'ga4', 'sessions')?.key, 'sessions');
  assert.equal(resolveMetricTip('Whatever', 'ga4', 'not-a-key'), null);
});

test('coverage: every KPI card written in the pages has an explanation', () => {
  const dir = path.join(process.cwd(), 'src', 'pages');
  const missing: string[] = [];
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const block of text.match(/<KpiCard[\s\S]*?\/>/g) ?? []) {
      const label = /label="([^"]+)"/.exec(block)?.[1];
      if (!label) continue; // label comes from a variable: checked at run time by the card itself
      const source = /source="(ga4|search_console|meta_ads)"/.exec(block)?.[1] as 'ga4' | 'search_console' | 'meta_ads' | undefined;
      checked += 1;
      if (!resolveMetricTip(label, source)) missing.push(`${f}: ${label} (${source ?? 'no source'})`);
    }
  }
  assert.ok(checked >= 25, `expected to find the KPI cards, found ${checked}`);
  assert.deepEqual(missing, []);
});
