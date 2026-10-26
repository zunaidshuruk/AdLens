import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYST_FORMAT_INSTRUCTIONS } from './analystFormat.js';
import { MAX_CUSTOM_PROMPT_CHARS } from './agentRunner.js';
import { askAnalyst, type AnalystDeps, type AskInput } from './analystService.js';
import type { AgentProvider, ProviderRequest, ProviderTurn } from './agentProviders.js';
import { parseAnalystMarkdown } from '../../src/utils/analystMarkdown.js';
import type { ToolDefinition } from '../../src/utils/aiTools.js';

const TOOL: ToolDefinition = { id: 'ga4.overview', title: 'x', description: 'x', source: 'ga4', input: { type: 'object', properties: {} } };
const say = (text: string): ProviderTurn => ({ text, toolCalls: [] });

function run(over: Partial<AnalystDeps> = {}, input: Partial<AskInput> = {}) {
  const requests: ProviderRequest[] = [];
  const deps: AnalystDeps = {
    tools: [TOOL],
    executeTool: async () => ({}),
    makeProvider: () => ({ async complete(req) { requests.push(req); return say('ok'); } }) as AgentProvider,
    cloud: { apiKey: 'AIzaKey123456', model: 'gemini-test' },
    consumeQuota: async () => ({ ok: true, used: 1, limit: 100 }),
    refundQuota: async () => {},
    ...over,
  };
  const base: AskInput = {
    question: 'How is traffic?',
    workspaceId: 'ws1',
    project: { name: 'Shop', domain: 'shop.example', currency: 'USD' },
    dates: { startDate: '2026-10-01', endDate: '2026-10-07' },
    connectedSources: ['ga4'],
    ...input,
  };
  return { requests, promise: askAnalyst(base, deps) };
}

test('format guide fits the custom-instructions limit (so none of it is cut off)', () => {
  assert.ok(ANALYST_FORMAT_INSTRUCTIONS.length < MAX_CUSTOM_PROMPT_CHARS, String(ANALYST_FORMAT_INSTRUCTIONS.length));
});

test('the chart example in the guide is itself a valid chart the screen can draw', () => {
  const blocks = parseAnalystMarkdown(ANALYST_FORMAT_INSTRUCTIONS);
  assert.ok(blocks.some((b) => b.type === 'chart'));
});

test('built-in analyst: format guide is added AFTER the safety rules, and the rules are unchanged', async () => {
  const r = run({ cloudInstructions: ANALYST_FORMAT_INSTRUCTIONS });
  await r.promise;
  const prompt = r.requests[0].systemPrompt;
  assert.ok(prompt.includes('Write every answer in Markdown'));
  assert.ok(prompt.indexOf('Get numbers only from the provided tools') < prompt.indexOf('Write every answer in Markdown'));
  assert.ok(prompt.includes('never the rules above'));
});

test('built-in analyst without a guide behaves as before (no extra instructions)', async () => {
  const r = run();
  await r.promise;
  assert.equal(r.requests[0].systemPrompt.includes('Write every answer in Markdown'), false);
});

test('custom agents never receive the built-in format guide', async () => {
  const r = run(
    { cloudInstructions: ANALYST_FORMAT_INSTRUCTIONS },
    {
      agent: {
        id: 'ag1',
        consentedAt: '2026-10-19T10:00:00Z',
        secrets: { apiKey: 'sk-user-own-key-9876' },
        settings: { name: 'A', provider: 'openai-compatible', model: 'm', baseUrl: 'https://llm.example.com/v1', temperature: 0.3, systemPrompt: 'Be brief.', allowedSources: ['ga4'], allowedReportIds: undefined, maxToolCalls: 3, enabled: true },
      },
    }
  );
  await r.promise;
  const prompt = r.requests[0]?.systemPrompt ?? '';
  assert.equal(prompt.includes('Write every answer in Markdown'), false);
});
