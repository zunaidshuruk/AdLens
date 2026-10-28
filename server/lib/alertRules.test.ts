import assert from 'node:assert/strict';
import test from 'node:test';
import { alertInputSchema, alertSentence, conditionText, evaluate, publicRule, queryFor, type StoredAlertRule } from './alertRules.js';

const base = { name: 'CPC too high', source: 'meta', metric: 'cpc', condition: 'above', threshold: 0.4, windowDays: 7, emails: ['A@B.com'] };
const ok = (x: Record<string, unknown>) => alertInputSchema.safeParse({ ...base, ...x });

test('Alert input: valid rules pass, emails are lower-cased, and the number must exist for the source', () => {
  const r = ok({});
  assert.equal(r.success, true);
  if (r.success) { assert.deepEqual(r.data.emails, ['a@b.com']); assert.equal(r.data.enabled, true); }
  assert.equal(ok({ metric: 'sessions' }).success, false, 'sessions is not a Meta number');
  assert.equal(ok({ source: 'ga4', metric: 'sessions' }).success, true);
  assert.equal(ok({ source: 'search_console', metric: 'ctr' }).success, true);
  assert.equal(ok({ filter: { field: 'campaign', op: 'contains', value: 'Eid' } }).success, true);
  assert.equal(ok({ filter: { field: 'country', op: 'equals', value: 'x' } }).success, false, 'Meta filters are campaign, ad set or ad');
  assert.equal(ok({ source: 'ga4', metric: 'sessions', filter: { field: 'country', op: 'equals', value: 'Bangladesh' } }).success, true);
});

test('Alert input: window, condition, destinations and uploaded tables are checked', () => {
  assert.equal(ok({ windowDays: 3 }).success, false);
  assert.equal(ok({ condition: 'explodes' }).success, false);
  assert.equal(ok({ condition: 'rises_pct', threshold: 0 }).success, false);
  assert.equal(ok({ condition: 'falls_pct', threshold: 25 }).success, true);
  assert.equal(ok({ emails: [] }).success, false, 'needs somewhere to send');
  assert.equal(ok({ emails: ['a@b.com', 'c@d.com', 'e@f.com', 'g@h.com'] }).success, false);
  assert.equal(ok({ emails: ['not an email'] }).success, false);
  assert.equal(ok({ emails: [], webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX' }).success, true);
  for (const bad of ['http://hooks.slack.com/x', 'https://localhost/x', 'https://10.0.0.1/x', 'https://example.com:8443/x', 'javascript:alert(1)', 'hooks.slack.com']) {
    assert.equal(ok({ emails: [], webhookUrl: bad }).success, false, bad);
  }
  assert.equal(ok({ source: 'data', metric: '__rows' }).success, false, 'a table is required');
  assert.equal(ok({ source: 'data', metric: '__rows', datasetId: 'd1' }).success, true);
  assert.equal(ok({ datasetId: 'd1' }).success, false, 'only uploaded tables use a table');
  assert.equal(ok({ name: '  ' }).success, false);
});

test('Alert query: one number, no breakdown, the table and aggregate for uploaded data', () => {
  assert.deepEqual(queryFor({ source: 'ga4', metric: 'sessions' }, { startDate: 'a', endDate: 'b' }), { startDate: 'a', endDate: 'b', dimensions: [], metrics: ['sessions'], filters: [], limit: 1 });
  const q = queryFor({ source: 'data', metric: 'c3', datasetId: 'd1', aggregate: 'avg', filter: { field: 'c2', op: 'equals', value: 'x' } }, { startDate: 'a', endDate: 'b' });
  assert.equal(q.datasetId, 'd1');
  assert.equal(q.aggregate, 'avg');
  assert.equal((q.filters as unknown[]).length, 1);
});

test('Alert judging: above, below and the two percent conditions; no data never triggers', () => {
  assert.equal(evaluate('above', 10, 11, null).triggered, true);
  assert.equal(evaluate('above', 10, 10, null).triggered, false);
  assert.equal(evaluate('below', 10, 9, null).triggered, true);
  assert.equal(evaluate('below', 10, 10, null).triggered, false);
  assert.deepEqual(evaluate('rises_pct', 20, 130, 100), { triggered: true, changePercent: 30 });
  assert.equal(evaluate('rises_pct', 20, 110, 100).triggered, false);
  assert.deepEqual(evaluate('falls_pct', 20, 70, 100), { triggered: true, changePercent: -30 });
  assert.equal(evaluate('falls_pct', 20, 90, 100).triggered, false);
  assert.equal(evaluate('rises_pct', 20, 50, 0).triggered, false, 'cannot compare with zero');
  assert.equal(evaluate('rises_pct', 20, 50, null).triggered, false);
  assert.equal(evaluate('above', 10, null, null).triggered, false);
  assert.equal(evaluate('below', 10, Number.NaN, null).triggered, false);
});

test('Alert wording: plain sentences with numbers formatted', () => {
  const r = { name: 'n', condition: 'above' as const, threshold: 0.4, windowDays: 7 as 1 | 7 | 28 };
  assert.equal(alertSentence(r, 'Cost per click', 0.5234, evaluate('above', 0.4, 0.5234, null), null), 'Cost per click was 0.52 over the last 7 days, above your limit of 0.4.');
  assert.equal(alertSentence({ ...r, condition: 'below', threshold: 1000, windowDays: 1 as const }, 'Sessions', 850, evaluate('below', 1000, 850, null), null), 'Sessions was 850 over yesterday, below your limit of 1,000.');
  const ev = evaluate('falls_pct', 20, 70, 100);
  assert.equal(alertSentence({ ...r, condition: 'falls_pct', threshold: 20 }, 'Clicks', 70, ev, 100), 'Clicks was 70 over the last 7 days, down 30% from 100.');
  assert.match(conditionText('rises_pct', 20), /rises by 20%/);
});

test('Alert rule: the browser never receives the sealed webhook', () => {
  const stored = { id: 'a', sealedWebhook: 'SECRET', webhookHost: 'hooks.slack.com', name: 'n' } as unknown as StoredAlertRule;
  const pub = publicRule(stored);
  assert.equal('sealedWebhook' in pub, false);
  assert.equal(pub.webhookHost, 'hooks.slack.com');
});
