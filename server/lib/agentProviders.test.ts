import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderError,
  buildGeminiRequest,
  buildOpenAiRequest,
  buildWebhookPayload,
  classifyHttpError,
  createAgentProvider,
  generateWebhookSecret,
  geminiUrl,
  openAiChatUrl,
  openAiToolName,
  parseGeminiResponse,
  parseOpenAiResponse,
  parseWebhookResponse,
  redactSecrets,
  signWebhookBody,
  verifyWebhookSignature,
  type AgentMessage,
} from './agentProviders.js';
import { SsrfError, type GuardedRequestOptions, type GuardedResponse } from './ssrfGuard.js';
import type { ToolDefinition } from '../../src/utils/aiTools.js';

const TOOLS: ToolDefinition[] = [
  { id: 'ga4.overview', title: 'GA4 overview', description: 'Totals for sessions and users.', source: 'ga4',
    input: { $schema: 'x', type: 'object', properties: { startDate: { type: 'string' }, endDate: { type: 'string' } }, required: ['startDate', 'endDate'] } },
  { id: 'ga4.trafficBreakdown', title: 'Breakdown', description: 'Traffic by dimension.', source: 'ga4',
    input: { type: 'object', properties: { startDate: { type: 'string' }, dimension: { type: 'string', enum: ['channel', 'country'] } }, required: ['startDate', 'dimension'] } },
];
const CALLS: AgentMessage[] = [
  { role: 'user', content: 'How is traffic?' },
  { role: 'assistant', content: '', toolCalls: [
    { id: 'c1', name: 'ga4.overview', args: {} },
    { id: 'c2', name: 'ga4.trafficBreakdown', args: { dimension: 'country' }, meta: { thoughtSignature: 'SIG123' } },
  ] },
  { role: 'tool', toolCallId: 'c1', name: 'ga4.overview', content: '<report>sessions: 5</report>' },
  { role: 'tool', toolCallId: 'c2', name: 'ga4.trafficBreakdown', content: '<report>US: 3</report>' },
];

test('OpenAI: tool names are made safe and mapped back', () => {
  assert.equal(openAiToolName('ga4.trafficBreakdown'), 'ga4__trafficBreakdown');
  const { body, nameMap } = buildOpenAiRequest({ model: 'm', systemPrompt: 'SYS', messages: CALLS, tools: TOOLS });
  const b = body as { messages: Record<string, any>[]; tools: any[]; tool_choice: string };
  assert.equal(b.messages[0].role, 'system');
  assert.deepEqual(b.tools.map((t) => t.function.name), ['ga4__overview', 'ga4__trafficBreakdown']);
  assert.equal(b.tool_choice, 'auto');
  assert.deepEqual(Object.keys(b.tools[1].function.parameters.properties), ['dimension']); // date args hidden
  assert.equal(nameMap.get('ga4__overview'), 'ga4.overview');
  const assistant = b.messages[2];
  assert.equal(assistant.content, null);
  assert.equal(assistant.tool_calls[1].function.name, 'ga4__trafficBreakdown');
  assert.equal(assistant.tool_calls[1].function.arguments, '{"dimension":"country"}');
  assert.deepEqual(b.messages.slice(3).map((m) => [m.role, m.tool_call_id]), [['tool', 'c1'], ['tool', 'c2']]);
  assert.ok(!('tools' in buildOpenAiRequest({ model: 'm', systemPrompt: 's', messages: [], tools: [] }).body));
});

test('OpenAI: responses with text, parts, tool calls, bad arguments and usage', () => {
  const nameMap = new Map([['ga4__overview', 'ga4.overview']]);
  const t1 = parseOpenAiResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Hello' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }, nameMap);
  assert.deepEqual([t1.text, t1.usage], ['Hello', { inputTokens: 10, outputTokens: 3 }]);
  assert.equal(parseOpenAiResponse({ choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }] }, nameMap).text, 'AB');
  const t2 = parseOpenAiResponse({ choices: [{ message: { content: null, tool_calls: [
    { id: 'x1', type: 'function', function: { name: 'ga4__overview', arguments: '{"limit":3}' } },
    { type: 'function', function: { name: 'unknown_tool', arguments: '{oops' } },
  ] } }] }, nameMap);
  assert.deepEqual(t2.toolCalls[0], { id: 'x1', name: 'ga4.overview', args: { limit: 3 } });
  assert.deepEqual([t2.toolCalls[1].id, t2.toolCalls[1].name, t2.toolCalls[1].parseError], ['call_1', 'unknown_tool', 'Arguments were not valid JSON.']);
  for (const bad of [null, 'text', { choices: [] }, { choices: [{}] }]) assert.throws(() => parseOpenAiResponse(bad, nameMap), ProviderError);
  assert.throws(() => parseOpenAiResponse({ error: { message: 'key sk-secret invalid' } }, nameMap), (e: unknown) => e instanceof ProviderError && e.code === 'PROVIDER_BAD_REQUEST' && !e.message.includes('sk-secret'));
});

test('OpenAI: base URLs get /chat/completions and must be safe', () => {
  assert.equal(openAiChatUrl('https://api.example.com/v1').href, 'https://api.example.com/v1/chat/completions');
  assert.equal(openAiChatUrl('https://api.example.com/v1/').href, 'https://api.example.com/v1/chat/completions');
  assert.equal(openAiChatUrl('https://api.example.com/v1/chat/completions').href, 'https://api.example.com/v1/chat/completions');
  for (const bad of ['http://api.example.com/v1', 'https://localhost/v1', 'https://10.0.0.1/v1', 'https://169.254.169.254/']) assert.throws(() => openAiChatUrl(bad), SsrfError);
});

test('Gemini: URL, contents, merged tool results and signature round trip', () => {
  assert.equal(geminiUrl('models/gemini-x-flash').href, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x-flash:generateContent');
  for (const bad of ['', 'a/b', 'x?key=1', '../v1', 'a b']) assert.throws(() => geminiUrl(bad), ProviderError);
  const body = buildGeminiRequest({ systemPrompt: 'SYS', messages: CALLS, tools: TOOLS, temperature: 0.1, maxOutputTokens: 500 }) as any;
  assert.equal(body.systemInstruction.parts[0].text, 'SYS');
  assert.deepEqual(body.contents.map((c: any) => c.role), ['user', 'model', 'user']);
  assert.equal(body.contents[1].parts.length, 2); // empty text omitted
  assert.deepEqual(body.contents[1].parts[0], { functionCall: { name: 'ga4.overview', args: {} } });
  assert.equal(body.contents[1].parts[1].thoughtSignature, 'SIG123');
  assert.equal(body.contents[2].parts.length, 2); // both results in one turn
  assert.deepEqual(body.contents[2].parts[0].functionResponse, { name: 'ga4.overview', response: { result: '<report>sessions: 5</report>' } });
  assert.deepEqual(body.tools[0].functionDeclarations.map((d: any) => d.name), ['ga4.overview', 'ga4.trafficBreakdown']);
  assert.deepEqual(Object.keys(body.tools[0].functionDeclarations[1].parametersJsonSchema.properties), ['dimension']);
  assert.deepEqual(body.generationConfig, { temperature: 0.1, maxOutputTokens: 500 });
  const noTools = buildGeminiRequest({ systemPrompt: 's', messages: [], tools: [] }) as any;
  assert.ok(!('tools' in noTools) && !('toolConfig' in noTools));
});

test('Gemini: responses with text, function calls, thoughts, blocks and empties', () => {
  const t = parseGeminiResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [
    { text: 'thinking...', thought: true }, { text: 'Traffic is up.' },
    { functionCall: { name: 'ga4.overview', args: { x: 1 } }, thoughtSignature: 'SIGABC' },
  ] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 } });
  assert.equal(t.text, 'Traffic is up.');
  assert.deepEqual(t.toolCalls, [{ id: 'call_2', name: 'ga4.overview', args: { x: 1 }, meta: { thoughtSignature: 'SIGABC' } }]);
  assert.deepEqual(t.usage, { inputTokens: 20, outputTokens: 5 });
  assert.throws(() => parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }), (e: unknown) => e instanceof ProviderError && e.code === 'PROVIDER_BLOCKED');
  assert.throws(() => parseGeminiResponse({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), /blocked/);
  assert.throws(() => parseGeminiResponse({ candidates: [] }), (e: unknown) => e instanceof ProviderError && e.code === 'PROVIDER_EMPTY');
  assert.throws(() => parseGeminiResponse('nope'), ProviderError);
});

test('webhook: payload hides dates, signature verifies and rejects tampering and replay', () => {
  const secret = generateWebhookSecret();
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secret, generateWebhookSecret());
  const payload = buildWebhookPayload({ agent: { id: 'a1', name: 'My agent' }, systemPrompt: 'S', messages: CALLS.slice(0, 1), tools: TOOLS,
    context: { project: { name: 'Shop', domain: 'shop.example' }, dateRange: { startDate: '2026-10-01', endDate: '2026-10-07' }, currency: 'USD' } }) as any;
  assert.equal(payload.protocolVersion, 1);
  assert.deepEqual(Object.keys(payload.tools[1].parameters.properties), ['dimension']);
  const raw = JSON.stringify(payload);
  const header = signWebhookBody(secret, raw, 1_800_000_000);
  assert.match(header, /^t=1800000000,v1=[0-9a-f]{64}$/);
  assert.equal(verifyWebhookSignature(secret, header, raw, 1_800_000_100), true);
  assert.equal(verifyWebhookSignature(secret, header, raw + ' ', 1_800_000_100), false); // body changed
  assert.equal(verifyWebhookSignature('whsec_other', header, raw, 1_800_000_100), false); // wrong secret
  assert.equal(verifyWebhookSignature(secret, header, raw, 1_800_001_000), false); // replayed later
  assert.equal(verifyWebhookSignature(secret, header, raw, 1_799_999_000), false); // from the future
  for (const bad of ['', 'garbage', 't=1,v1=abc', `t=x,v1=${'a'.repeat(64)}`]) assert.equal(verifyWebhookSignature(secret, bad, raw, 1_800_000_000), false);
});

test('webhook: replies are validated', () => {
  assert.deepEqual(parseWebhookResponse({ answer: 'Done.' }), { text: 'Done.', toolCalls: [] });
  const t = parseWebhookResponse({ text: 'checking', toolCalls: [{ name: 'ga4.overview', args: { a: 1 } }, { name: 'x', args: '{bad' }, { nope: 1 }] });
  assert.equal(t.toolCalls.length, 2);
  assert.deepEqual(t.toolCalls[0], { id: 'call_0', name: 'ga4.overview', args: { a: 1 } });
  assert.equal(t.toolCalls[1].parseError, 'Arguments were not valid JSON.');
  for (const bad of [null, [], {}, { answer: '   ' }, { toolCalls: [] }]) assert.throws(() => parseWebhookResponse(bad), (e: unknown) => e instanceof ProviderError && e.code === 'PROVIDER_BAD_RESPONSE');
});

test('redaction and HTTP error mapping never leak keys', () => {
  assert.equal(redactSecrets('Bearer sk-abc123 and sk-abc123%20x', ['sk-abc123']), 'Bearer *** and ***%20x');
  assert.equal(redactSecrets('nothing here', ['', 'ab']), 'nothing here');
  for (const [status, code] of [[401, 'PROVIDER_AUTH'], [403, 'PROVIDER_AUTH'], [404, 'PROVIDER_NOT_FOUND'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_UNAVAILABLE'], [503, 'PROVIDER_UNAVAILABLE'], [400, 'PROVIDER_BAD_REQUEST']] as const) {
    assert.equal(classifyHttpError(status).code, code);
  }
});

function fakeRequest(reply: (url: URL, opts: GuardedRequestOptions) => GuardedResponse | Error) {
  const calls: { url: URL; opts: GuardedRequestOptions }[] = [];
  const fn = async (url: URL, opts: GuardedRequestOptions): Promise<GuardedResponse> => {
    calls.push({ url, opts });
    const r = reply(url, opts);
    if (r instanceof Error) throw r;
    return r;
  };
  return { fn, calls };
}
const ok = (json: unknown): GuardedResponse => ({ status: 200, headers: {}, text: JSON.stringify(json) });
const req = { systemPrompt: 'SYS', messages: [{ role: 'user', content: 'Hi' } as AgentMessage], tools: TOOLS };

test('Gemini provider: key goes in a header only; errors are friendly and key-free', async () => {
  const { fn, calls } = fakeRequest(() => ok({ candidates: [{ content: { parts: [{ text: 'Hi there' }] } }] }));
  const p = createAgentProvider({ kind: 'gemini', model: 'gemini-x', apiKey: 'AIzaSECRETKEY', agent: { id: 'a', name: 'n' } }, { request: fn });
  const turn = await p.complete(req);
  assert.equal(turn.text, 'Hi there');
  assert.ok(!calls[0].url.href.includes('AIzaSECRETKEY'));
  assert.equal(calls[0].opts.headers!['x-goog-api-key'], 'AIzaSECRETKEY');
  assert.ok(!(calls[0].opts.body as string).includes('AIzaSECRETKEY'));

  const denied = fakeRequest(() => ({ status: 403, headers: {}, text: '{"error":"API key AIzaSECRETKEY invalid"}' }));
  const bad = createAgentProvider({ kind: 'gemini', model: 'gemini-x', apiKey: 'AIzaSECRETKEY', agent: { id: 'a', name: 'n' } }, { request: denied.fn });
  await assert.rejects(bad.complete(req), (e: unknown) => e instanceof ProviderError && e.code === 'PROVIDER_AUTH' && !e.message.includes('AIzaSECRETKEY'));
});

test('OpenAI-compatible provider: Bearer key, mapped tools, unreachable servers', async () => {
  const { fn, calls } = fakeRequest(() => ok({ choices: [{ message: { content: null, tool_calls: [{ id: 't', function: { name: 'ga4__overview', arguments: '{}' } }] } }] }));
  const p = createAgentProvider({ kind: 'openai-compatible', model: 'my-model', baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-zzzz1234', agent: { id: 'a', name: 'n' } }, { request: fn });
  const turn = await p.complete(req);
  assert.equal(turn.toolCalls[0].name, 'ga4.overview');
  assert.equal(calls[0].url.href, 'https://llm.example.com/v1/chat/completions');
  assert.equal(calls[0].opts.headers!.authorization, 'Bearer sk-zzzz1234');

  const down = fakeRequest(() => new SsrfError('HOST_NOT_PUBLIC', 'That address points to a private or internal network.'));
  const q = createAgentProvider({ kind: 'openai-compatible', model: 'm', baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-zzzz1234', agent: { id: 'a', name: 'n' } }, { request: down.fn });
  await assert.rejects(q.complete(req), (e: unknown) => e instanceof ProviderError && e.code === 'PROVIDER_UNREACHABLE' && /private or internal/.test(e.message));
  const broken = fakeRequest(() => new Error('ECONNRESET 10.0.0.5:443'));
  const r = createAgentProvider({ kind: 'openai-compatible', model: 'm', baseUrl: 'https://llm.example.com/v1', agent: { id: 'a', name: 'n' } }, { request: broken.fn });
  await assert.rejects(r.complete(req), (e: unknown) => e instanceof ProviderError && !e.message.includes('10.0.0.5'));
  const aborted = fakeRequest(() => new SsrfError('REQUEST_ABORTED', 'cancelled'));
  const s = createAgentProvider({ kind: 'openai-compatible', model: 'm', baseUrl: 'https://llm.example.com/v1', agent: { id: 'a', name: 'n' } }, { request: aborted.fn });
  await assert.rejects(s.complete(req), (e: unknown) => e instanceof SsrfError && e.code === 'REQUEST_ABORTED'); // lets the runner report a timeout
});

test('webhook provider: the signature header matches the exact bytes sent', async () => {
  const secret = generateWebhookSecret();
  const { fn, calls } = fakeRequest(() => ok({ answer: 'From my service.' }));
  const p = createAgentProvider({ kind: 'webhook', baseUrl: 'https://hooks.example.com/adlens', webhookSecret: secret, agent: { id: 'a1', name: 'Mine' },
    context: { project: { name: 'Shop', domain: 'shop.example' }, dateRange: { startDate: '2026-10-01', endDate: '2026-10-07' } } }, { request: fn, nowSeconds: () => 1_800_000_000 });
  assert.equal((await p.complete(req)).text, 'From my service.');
  const { opts } = calls[0];
  assert.equal(verifyWebhookSignature(secret, opts.headers!['x-adlens-signature'], opts.body as string, 1_800_000_000), true);
  assert.equal(opts.headers!['x-adlens-protocol'], '1');
  assert.ok(!(opts.body as string).includes(secret));
});

test('providers refuse incomplete or unsafe configuration', () => {
  const deps = { request: fakeRequest(() => ok({})).fn };
  const base = { agent: { id: 'a', name: 'n' } };
  assert.throws(() => createAgentProvider({ kind: 'gemini', model: 'm', ...base }, deps), ProviderError); // no key
  assert.throws(() => createAgentProvider({ kind: 'openai-compatible', model: 'm', ...base }, deps), ProviderError); // no url
  assert.throws(() => createAgentProvider({ kind: 'webhook', baseUrl: 'https://h.example.com/x', ...base }, deps), ProviderError); // no secret/context
  assert.throws(() => createAgentProvider({ kind: 'openai-compatible', model: 'm', baseUrl: 'http://llm.example.com/v1', ...base }, deps), SsrfError);
  assert.throws(() => createAgentProvider({ kind: 'webhook', baseUrl: 'https://127.0.0.1/x', webhookSecret: 's', context: { project: { name: 'a', domain: null }, dateRange: { startDate: 'a', endDate: 'b' } }, ...base }, deps), SsrfError);
  assert.throws(() => createAgentProvider({ kind: 'carrier-pigeon' as 'gemini', ...base }, deps), /Unknown agent type/);
});
