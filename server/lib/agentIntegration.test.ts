import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAgentProvider, generateWebhookSecret, verifyWebhookSignature } from './agentProviders.js';
import { buildSystemPrompt, runAgent } from './agentRunner.js';
import { parseAgentInput, resolveAllowedTools, toProviderConfig } from './agentConfig.js';
import { createGuardedLookup, guardedRequest, type GuardedRequestOptions } from './ssrfGuard.js';
import type { ToolDefinition } from '../../src/utils/aiTools.js';

const T = (id: string, source: ToolDefinition['source']): ToolDefinition => ({
  id, title: id, description: `Report ${id}`, source,
  input: { type: 'object', properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, dimension: { type: 'string', enum: ['channel', 'country'] } }, required: ['startDate', 'endDate'] },
});
const ALL_TOOLS = [T('ga4.overview', 'ga4'), T('ga4.trafficBreakdown', 'ga4'), T('meta.campaigns', 'meta')];
const DATES = { startDate: '2026-10-01', endDate: '2026-10-07' };

/** A real local server standing in for the user's AI endpoint; requests to https://<name> are sent to it over http. */
async function withEndpoint(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void, run: (request: (url: URL, opts: GuardedRequestOptions) => ReturnType<typeof guardedRequest>) => Promise<void>) {
  const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => handler(req, b, res)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const lookup = createGuardedLookup({ resolveAll: async () => [{ address: '127.0.0.1', family: 4 }], isAllowedAddress: () => true });
  const request = (url: URL, opts: GuardedRequestOptions) => {
    const local = new URL(url.href);
    local.protocol = 'http:';
    local.port = String(port);
    return guardedRequest(local, opts, { transport: http, lookup });
  };
  try { await run(request); } finally { await new Promise<void>((r) => server.close(() => r())); }
}

test('END TO END: an OpenAI-compatible agent uses an allowed report and cannot reach a forbidden one', async () => {
  const agent = parseAgentInput({ name: 'Web analyst', provider: 'openai-compatible', model: 'my-model', baseUrl: 'https://llm.example.com/v1', allowedSources: ['ga4'] });
  assert.ok(agent.ok);
  if (!agent.ok) return;
  const { allowed } = resolveAllowedTools(agent.value, ALL_TOOLS, ['ga4', 'meta']);
  assert.deepEqual(allowed.map((t) => t.id), ['ga4.overview', 'ga4.trafficBreakdown']); // meta not allowed

  const seen: { auth?: string; path?: string; bodies: any[] } = { bodies: [] };
  let turn = 0;
  await withEndpoint((req, body, res) => {
    seen.auth = req.headers.authorization; seen.path = req.url; seen.bodies.push(JSON.parse(body));
    res.setHeader('content-type', 'application/json');
    turn++;
    if (turn === 1) {
      // The model asks for an allowed report AND a forbidden one, trying to choose its own dates.
      res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [
        { id: 't1', type: 'function', function: { name: 'ga4__trafficBreakdown', arguments: '{"dimension":"country","startDate":"1999-01-01"}' } },
        { id: 't2', type: 'function', function: { name: 'meta__campaigns', arguments: '{}' } },
      ] } }] }));
    } else res.end(JSON.stringify({ choices: [{ message: { content: 'Most traffic came from Bangladesh.' } }], usage: { prompt_tokens: 100, completion_tokens: 8 } }));
  }, async (request) => {
    const provider = createAgentProvider(toProviderConfig({ id: 'ag1', ...agent.value }, { apiKey: 'sk-test-key-123456' }, { project: { name: 'Shop', domain: 'shop.example' }, dateRange: DATES }), { request });
    const executed: { id: string; args: Record<string, unknown> }[] = [];
    const r = await runAgent({
      question: 'Where does my traffic come from?', tools: allowed, dates: DATES,
      systemPrompt: buildSystemPrompt({ project: { name: 'Shop' }, dates: DATES, connectedSources: ['ga4'] }),
    }, { provider, executeTool: async (id, args) => { executed.push({ id, args }); return { rows: [{ country: 'Bangladesh', sessions: 800 }, { country: 'India', sessions: 120 }] }; } });

    assert.equal(r.answer, 'Most traffic came from Bangladesh.');
    assert.equal(r.stopReason, 'answer');
    assert.deepEqual(executed, [{ id: 'ga4.trafficBreakdown', args: { dimension: 'country', startDate: '2026-10-01', endDate: '2026-10-07' } }]); // dates from the app; Meta never ran
    assert.deepEqual(r.trace.map((t) => t.kind), ['tool', 'denied']);
    assert.equal(seen.path, '/v1/chat/completions');
    assert.equal(seen.auth, 'Bearer sk-test-key-123456');
    assert.deepEqual(seen.bodies[0].tools.map((t: any) => t.function.name), ['ga4__overview', 'ga4__trafficBreakdown']); // forbidden report was never even offered
    assert.ok(!JSON.stringify(seen.bodies).includes('sk-test-key')); // key only in the header
    assert.ok(!JSON.stringify(seen.bodies[0].tools).includes('startDate')); // date arguments hidden from the model
    const toolMsgs = seen.bodies[1].messages.filter((m: any) => m.role === 'tool');
    assert.match(toolMsgs[0].content, /^<report id="ga4\.trafficBreakdown">\n\[rows\] 2 rows\ncountry \| sessions\nBangladesh \| 800/);
    assert.match(toolMsgs[1].content, /not available/);
    assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 8 });
  });
});

test('END TO END: a webhook agent receives a signed request it can verify and answers through it', async () => {
  const secret = generateWebhookSecret();
  const agent = parseAgentInput({ name: 'My service', provider: 'webhook', baseUrl: 'https://hooks.example.com/adlens' });
  assert.ok(agent.ok);
  if (!agent.ok) return;
  const received: { sig?: string; raw?: string } = {};
  let calls = 0;
  await withEndpoint((req, body, res) => {
    received.sig = String(req.headers['x-adlens-signature']); received.raw = body;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(++calls === 1 ? { toolCalls: [{ name: 'ga4.overview', args: {} }] } : { answer: 'Sessions are 5,000 this week.' }));
  }, async (request) => {
    const provider = createAgentProvider(toProviderConfig({ id: 'wh1', ...agent.value }, { webhookSecret: secret }, { project: { name: 'Shop', domain: null }, dateRange: DATES }), { request });
    const r = await runAgent({ question: 'Summary?', tools: [ALL_TOOLS[0]], dates: DATES, systemPrompt: 'SYS' }, { provider, executeTool: async () => ({ sessions: { value: 5000 } }) });
    assert.equal(r.answer, 'Sessions are 5,000 this week.');
    assert.equal(r.toolCallsUsed, 1);
    // The receiver can verify exactly what it was sent, and a tampered copy fails.
    const now = Math.floor(Date.now() / 1000);
    assert.equal(verifyWebhookSignature(secret, received.sig!, received.raw!, now), true);
    assert.equal(verifyWebhookSignature(secret, received.sig!, received.raw! + ' ', now), false);
    const payload = JSON.parse(received.raw!);
    assert.equal(payload.protocolVersion, 1);
    assert.deepEqual(payload.messages.map((m: any) => m.role), ['user', 'assistant', 'tool']);
    assert.ok(!received.raw!.includes(secret));
  });
});

test('END TO END: a rejected key shows a friendly message and nothing sensitive', async () => {
  await withEndpoint((_req, _body, res) => { res.statusCode = 401; res.end('{"error":"Incorrect API key provided: sk-test-key-123456"}'); }, async (request) => {
    const provider = createAgentProvider({ kind: 'openai-compatible', model: 'm', baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-test-key-123456', agent: { id: 'a', name: 'n' } }, { request });
    const r = await runAgent({ question: 'Hi', tools: [], dates: DATES, systemPrompt: 'SYS' }, { provider, executeTool: async () => ({}) });
    assert.deepEqual([r.stopReason, r.error?.code], ['provider_error', 'PROVIDER_AUTH']);
    assert.ok(!JSON.stringify(r).includes('sk-test-key'));
    assert.match(r.error!.message, /rejected the API key/);
  });
});
