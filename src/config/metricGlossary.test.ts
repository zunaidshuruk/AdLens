import test from 'node:test';
import assert from 'node:assert/strict';
import { METRIC_GLOSSARY, findMetricKey, getMetricInfo, isLowerBetter } from './metricGlossary.js';

test('every entry is complete and readable', () => {
  for (const [key, m] of Object.entries(METRIC_GLOSSARY)) {
    assert.ok(m.label.length > 2, key);
    assert.ok(m.definition.length >= 20 && m.definition.length <= 260, `${key} definition length ${m.definition.length}`);
    assert.ok(m.definition.endsWith('.'), `${key} should end with a full stop`);
    assert.ok(!m.definition.includes('  '), key);
    if (m.note) assert.ok(m.note.length <= 260, `${key} note length`);
    assert.ok(['ga4', 'search_console', 'meta', 'adlens'].includes(m.source));
    assert.ok(['higher', 'lower', 'neutral'].includes(m.better));
  }
});

test('ratio metrics state their formula', () => {
  for (const key of ['engagementRate', 'keyEventRate', 'searchCtr', 'adCtr', 'cpc', 'cpm', 'cpl', 'frequency', 'landingRate', 'aiShare']) {
    assert.ok(METRIC_GLOSSARY[key].formula, key);
  }
});

test('aliases never point at two different metrics', () => {
  const seen = new Map<string, string>();
  for (const [key, m] of Object.entries(METRIC_GLOSSARY)) {
    for (const name of [key.toLowerCase(), m.label.toLowerCase(), ...m.aliases.map((a) => a.toLowerCase())]) {
      const normalised = name.replace(/[^a-z0-9%]+/g, ' ').trim();
      // "clicks", "impressions" and "ctr" are deliberately resolved by source in findMetricKey
      if (['clicks', 'impressions', 'ctr'].includes(normalised)) continue;
      const other = seen.get(normalised);
      assert.ok(!other || other === key, `"${normalised}" is used by both ${other} and ${key}`);
      seen.set(normalised, key);
    }
  }
});

test('lookups by the labels the UI shows', () => {
  assert.equal(findMetricKey('Total Sessions'), 'sessions');
  assert.equal(findMetricKey('Avg. Position'), 'position');
  assert.equal(findMetricKey('Goal Conversions'), 'keyEvents');
  assert.equal(findMetricKey('CPL'), 'cpl');
  assert.equal(findMetricKey('Cost per lead'), 'cpl');
  assert.equal(findMetricKey('% change'), 'changeVsPrevious');
  assert.equal(findMetricKey('nonsense metric'), null);
});

test('clicks, impressions and CTR depend on the data source', () => {
  assert.equal(findMetricKey('Clicks', 'search_console'), 'searchClicks');
  assert.equal(findMetricKey('Clicks', 'meta'), 'linkClicks');
  assert.equal(findMetricKey('Impressions', 'search_console'), 'searchImpressions');
  assert.equal(findMetricKey('Impressions', 'meta'), 'impressions');
  assert.equal(findMetricKey('CTR', 'search_console'), 'searchCtr');
  assert.equal(findMetricKey('CTR', 'meta'), 'adCtr');
  assert.equal(findMetricKey('Organic Search Clicks'), 'searchClicks');
});

test('cost metrics and ranking position are "lower is better"', () => {
  for (const key of ['cpc', 'cpm', 'cpl', 'position', 'costPerEngagedSession', 'costPerKeyEvent']) assert.equal(isLowerBetter(key), true, key);
  for (const key of ['sessions', 'leads', 'searchClicks', 'spend', 'frequency']) assert.equal(isLowerBetter(key), false, key);
  assert.equal(isLowerBetter('unknown'), false);
  assert.equal(getMetricInfo('cpl')?.formula, 'spend ÷ leads');
  assert.equal(getMetricInfo('unknown'), null);
});
