import assert from 'node:assert/strict';
import test from 'node:test';
import { signWebhookBody } from '../../server/lib/agentProviders.js';
import type { PublicAgent } from '../types/agents.js';
import { agentReadiness, emptyForm, formFromAgent, formToPayload, validateForm, toggleInList } from './agentForm.js';
import { checkSignature, computeSignature } from './webhookSignature.js';

test('Sprint 16 — agent form: payload leaves out empty and irrelevant fields', () => {
  const g = { ...emptyForm('gemini'), name: ' Gem ' };
  assert.deepEqual(formToPayload(g), { name: 'Gem', provider: 'gemini', model: 'gemini-2.5-flash', systemPrompt: '', allowedSources: ['ga4', 'search_console', 'meta'], temperature: 0.2, maxToolCalls: 6, enabled: true });
  const w = { ...emptyForm('webhook'), name: 'Hook', baseUrl: 'https://x.example/h', model: 'ignored' };
  const p = formToPayload(w);
  assert.equal('model' in p, false);
  assert.equal(p.baseUrl, 'https://x.example/h');
  const picked = { ...emptyForm('gemini'), name: 'a', allowedReportIds: ['ga4.overview'] };
  assert.deepEqual(formToPayload(picked).allowedReportIds, ['ga4.overview']);
});

test('Sprint 16 — agent form: validation messages are plain and ordered', () => {
  assert.deepEqual(validateForm(emptyForm('gemini'), { needsKey: true, apiKey: '' }), ['Give the agent a name.', 'Paste your Gemini API key.']);
  assert.deepEqual(validateForm({ ...emptyForm('gemini'), name: 'x' }, { needsKey: false, apiKey: '' }), []);
  const o = { ...emptyForm('openai-compatible'), name: 'x', model: 'm', baseUrl: 'http://insecure.example' };
  assert.deepEqual(validateForm(o, { needsKey: false, apiKey: '' }), ['The address must start with https://']);
  assert.ok(validateForm({ ...emptyForm('webhook'), name: 'x' }, { needsKey: false, apiKey: '' })[0].includes('webhook address'));
  assert.ok(validateForm({ ...emptyForm('gemini'), name: 'x', allowedSources: [] }, { needsKey: false, apiKey: '' }).includes('Allow at least one data source.'));
  assert.ok(validateForm({ ...emptyForm('gemini'), name: 'x', allowedReportIds: [] }, { needsKey: false, apiKey: '' }).length === 1);
});

test('Sprint 16 — agent form: round trip, toggle, readiness', () => {
  const a: PublicAgent = { id: 'a', name: 'N', description: 'd', provider: 'openai-compatible', model: 'm', baseUrl: 'https://u.example/v1', systemPrompt: 's', allowedSources: ['ga4'], allowedReportIds: null, temperature: 0.5, maxToolCalls: 3, enabled: true, hasApiKey: true, apiKeyHint: '••••1234', hasWebhookSecret: false, consentedAt: null, createdAt: '', updatedAt: '' };
  const f = formFromAgent(a);
  assert.equal(f.baseUrl, 'https://u.example/v1');
  assert.deepEqual(toggleInList(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleInList(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(agentReadiness(a), { ready: false, reason: 'Needs your confirmation' });
  assert.deepEqual(agentReadiness({ ...a, consentedAt: 'x', enabled: false }), { ready: false, reason: 'Switched off' });
  assert.deepEqual(agentReadiness({ ...a, consentedAt: 'x' }), { ready: true });
});

test('Sprint 16 — webhook signature check in the browser matches the server', async () => {
  const secret = 'whsec_test';
  const body = '{"protocolVersion":1,"messages":[]}';
  const t = 1_700_000_000;
  const header = signWebhookBody(secret, body, t);
  assert.equal(await computeSignature(secret, t, body), header.split('v1=')[1]);
  assert.deepEqual(await checkSignature(secret, header, body, t + 10), { ok: true });
  assert.deepEqual(await checkSignature(secret, header, body, t + 301), { ok: false, reason: 'stale' });
  assert.deepEqual(await checkSignature('other', header, body, t), { ok: false, reason: 'mismatch' });
  assert.deepEqual(await checkSignature(secret, header, `${body} `, t), { ok: false, reason: 'mismatch' });
  assert.deepEqual(await checkSignature(secret, 'garbage', body, t), { ok: false, reason: 'format' });
});
