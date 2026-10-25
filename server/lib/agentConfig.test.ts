import test from 'node:test';
import assert from 'node:assert/strict';
import { EXCLUSION_MESSAGES, agentSecretsPath, agentsPath, maskKey, parseAgentInput, resolveAllowedTools, toProviderConfig, validateApiKey } from './agentConfig.js';
import type { ToolDefinition } from '../../src/utils/aiTools.js';

const errs = (raw: unknown) => { const r = parseAgentInput(raw); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };
const ok = (raw: unknown) => { const r = parseAgentInput(raw); assert.ok(r.ok, JSON.stringify(r)); return r.ok ? r.value : (null as never); };

test('valid agents of each type, with sensible defaults', () => {
  const g = ok({ name: ' My Gemini ', provider: 'gemini', model: 'gemini-x-flash' });
  assert.deepEqual([g.name, g.systemPrompt, g.allowedSources, g.temperature, g.maxToolCalls, g.enabled], ['My Gemini', '', ['ga4', 'search_console', 'meta'], 0.2, 6, true]);
  ok({ name: 'Local', provider: 'openai-compatible', model: 'org/model:7b', baseUrl: 'https://llm.example.com/v1' });
  ok({ name: 'Hook', provider: 'webhook', baseUrl: 'https://hooks.example.com:8443/adlens', allowedSources: ['ga4'], allowedReportIds: ['ga4.overview'] });
});

test('each type has its own required fields', () => {
  assert.deepEqual(errs({ name: 'a', provider: 'gemini' }), ['model: Enter the Gemini model name']);
  assert.deepEqual(errs({ name: 'a', provider: 'openai-compatible', baseUrl: 'https://x.example.com' }), ['model: Enter the model name']);
  assert.match(errs({ name: 'a', provider: 'openai-compatible', model: 'm' })[0], /Enter the base URL/);
  assert.match(errs({ name: 'a', provider: 'webhook' })[0], /Enter your webhook URL/);
  assert.match(errs({ name: '', provider: 'gemini', model: 'm' })[0], /Give the agent a name/);
  assert.ok(errs({ name: 'a', provider: 'skynet', model: 'm' }).length > 0);
  assert.ok(errs('not an object').length > 0);
  assert.ok(errs(null).length > 0);
});

test('endpoint addresses go through the SSRF checks', () => {
  for (const baseUrl of ['http://llm.example.com/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/', 'https://user:pw@llm.example.com/', 'https://llm.example.com:9000/', 'https://intranet/v1', 'nonsense']) {
    const e = errs({ name: 'a', provider: 'openai-compatible', model: 'm', baseUrl });
    assert.ok(e.length === 1 && e[0].startsWith('baseUrl:'), `${baseUrl} → ${e}`);
    assert.equal(errs({ name: 'a', provider: 'webhook', baseUrl }).length, 1, baseUrl);
  }
});

test('limits on prompt, sources, reports, temperature and tool calls', () => {
  const base = { name: 'a', provider: 'gemini', model: 'm' };
  assert.match(errs({ ...base, systemPrompt: 'x'.repeat(4001) })[0], /under 4000/);
  assert.equal(errs({ ...base, systemPrompt: 'x'.repeat(4000) }).length, 0);
  assert.match(errs({ ...base, allowedSources: [] })[0], /at least one data source/);
  assert.match(errs({ ...base, allowedSources: ['ga4', 'ga4'] })[0], /only be listed once/);
  assert.ok(errs({ ...base, allowedSources: ['tiktok'] }).length > 0);
  assert.ok(errs({ ...base, allowedReportIds: ['ga4 overview; drop'] }).length > 0);
  assert.ok(errs({ ...base, temperature: 2 }).length > 0 && errs({ ...base, temperature: -0.1 }).length > 0);
  assert.ok(errs({ ...base, maxToolCalls: 0 }).length > 0 && errs({ ...base, maxToolCalls: 11 }).length > 0 && errs({ ...base, maxToolCalls: 2.5 }).length > 0);
  assert.ok(errs({ ...base, model: 'bad model name!' }).length > 0);
  assert.equal(errs({ ...base, name: 'x'.repeat(61) }).length, 1);
});

test('API keys: header-safe, required only where needed, masked for display', () => {
  assert.deepEqual(validateApiKey('gemini', '  AIzaSyExampleKey123  '), { ok: true, key: 'AIzaSyExampleKey123' });
  assert.deepEqual(validateApiKey('gemini', ''), { ok: false, message: 'Enter your Gemini API key.' });
  assert.deepEqual(validateApiKey('gemini', undefined), { ok: false, message: 'Enter your Gemini API key.' });
  assert.deepEqual(validateApiKey('openai-compatible', ''), { ok: true, key: null });
  assert.deepEqual(validateApiKey('webhook', 'anything'), { ok: true, key: null });
  for (const bad of ['short', 'has space inside key', 'line\nbreak-key-123', 'key\r\nX-Evil: 1', 'ключ-ключ-ключ', 'a'.repeat(401), 'tab\tkey-123456']) {
    assert.equal(validateApiKey('openai-compatible', bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(maskKey('sk-abcdef1234'), '••••1234');
  assert.equal(maskKey('short'), '••••');
});

const T = (id: string, source: ToolDefinition['source']): ToolDefinition => ({ id, title: id, description: id, source, input: { type: 'object' } });
const TOOLS = [T('ga4.overview', 'ga4'), T('ga4.aiTraffic', 'ga4'), T('searchConsole.topQueries', 'search_console'), T('meta.campaigns', 'meta'), T('cross.metaVsWeb', 'combined')];

test('permissions: allowed AND connected sources, optional hand-picked reports', () => {
  const r1 = resolveAllowedTools({ allowedSources: ['ga4', 'meta'], allowedReportIds: undefined }, TOOLS, ['ga4', 'search_console', 'meta']);
  assert.deepEqual(r1.allowed.map((t) => t.id), ['ga4.overview', 'ga4.aiTraffic', 'meta.campaigns']);
  assert.deepEqual(r1.excluded, [{ id: 'searchConsole.topQueries', reason: 'source_not_allowed' }, { id: 'cross.metaVsWeb', reason: 'needs_all_sources' }]);

  const r2 = resolveAllowedTools({ allowedSources: ['ga4', 'search_console', 'meta'], allowedReportIds: undefined }, TOOLS, ['ga4']);
  assert.deepEqual(r2.allowed.map((t) => t.id), ['ga4.overview', 'ga4.aiTraffic', 'cross.metaVsWeb']); // only GA4 connected → combined is fine
  assert.deepEqual(r2.excluded.map((e) => e.reason), ['source_not_connected', 'source_not_connected']);

  const r3 = resolveAllowedTools({ allowedSources: ['ga4', 'search_console', 'meta'], allowedReportIds: ['ga4.overview', 'meta.campaigns'] }, TOOLS, ['ga4', 'meta', 'search_console']);
  assert.deepEqual(r3.allowed.map((t) => t.id), ['ga4.overview', 'meta.campaigns']);
  assert.ok(r3.excluded.some((e) => e.id === 'ga4.aiTraffic' && e.reason === 'not_selected'));

  const none = resolveAllowedTools({ allowedSources: ['ga4'], allowedReportIds: undefined }, TOOLS, []);
  assert.deepEqual(none.allowed, []);
  assert.equal(none.excluded.find((e) => e.id === 'cross.metaVsWeb')!.reason, 'needs_all_sources');
  assert.ok(Object.values(EXCLUSION_MESSAGES).every((m) => m.endsWith('.')));
});

test('settings + secrets become a provider configuration; storage paths are fixed', () => {
  const cfg = toProviderConfig({ id: 'a1', name: 'Mine', provider: 'openai-compatible', model: 'm', baseUrl: 'https://x.example.com/v1', temperature: 0.3 }, { apiKey: 'sk-1234567890' }, { project: { name: 'S', domain: null }, dateRange: { startDate: 'a', endDate: 'b' } });
  assert.deepEqual([cfg.kind, cfg.apiKey, cfg.webhookSecret, cfg.agent, cfg.temperature], ['openai-compatible', 'sk-1234567890', undefined, { id: 'a1', name: 'Mine' }, 0.3]);
  assert.equal(agentsPath('ws1'), 'workspaces/ws1/agents');
  assert.equal(agentSecretsPath('ws1'), 'workspaces/ws1/agentSecrets');
});
