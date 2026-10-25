/**
 * Talking to AI endpoints (Sprint 16): Gemini, any OpenAI-compatible server, or a user's own webhook.
 * The request builders and response parsers are pure; the network call is injected (`RequestFn`),
 * so everything is unit-tested without a network.
 *
 * Safety rules built in
 * - User-supplied endpoints are validated by ssrfGuard before any request is made.
 * - API keys are only ever placed in a header, never in URLs, logs or error messages (redactSecrets).
 * - Provider error bodies are never shown to users; they are mapped to short, friendly messages.
 * - Webhook calls are signed (HMAC-SHA256 with a timestamp) so the receiver can verify them.
 *
 * Imports in this folder end in .js (guard test).
 */

import crypto from 'node:crypto';
import {
  DATE_ARG_KEYS,
  sanitizeToolSchema,
  toGeminiFunctionDeclarations,
  type ToolDefinition,
} from '../../src/utils/aiTools.js';
import { SsrfError, validateOutboundUrl, type GuardedResponse, type RequestFn } from './ssrfGuard.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Set when the model's arguments were not valid JSON; the runner reports it back to the model. */
  parseError?: string;
  meta?: { thoughtSignature?: string };
}

export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ProviderTurn {
  text: string;
  toolCalls: AgentToolCall[];
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ProviderRequest {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export interface AgentProvider {
  complete(req: ProviderRequest): Promise<ProviderTurn>;
}

export type ProviderErrorCode =
  | 'PROVIDER_AUTH'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_BAD_REQUEST'
  | 'PROVIDER_BLOCKED'
  | 'PROVIDER_EMPTY'
  | 'PROVIDER_BAD_RESPONSE'
  | 'PROVIDER_UNREACHABLE';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

const FRIENDLY: Record<ProviderErrorCode, string> = {
  PROVIDER_AUTH: 'The AI provider rejected the API key. Check that the key is correct and still active.',
  PROVIDER_NOT_FOUND: 'The AI provider could not find that model or address. Check the model name and base URL.',
  PROVIDER_RATE_LIMITED: 'The AI provider is limiting requests right now. Try again in a minute.',
  PROVIDER_UNAVAILABLE: 'The AI provider is having problems. Try again shortly.',
  PROVIDER_BAD_REQUEST: 'The AI provider did not accept the request. The model may not support tools.',
  PROVIDER_BLOCKED: 'The AI provider blocked this request.',
  PROVIDER_EMPTY: 'The AI provider returned an empty answer.',
  PROVIDER_BAD_RESPONSE: 'The AI provider sent a reply AdLens could not understand.',
  PROVIDER_UNREACHABLE: 'AdLens could not reach the AI provider.',
};

/** Replaces every occurrence of each secret (and its URL-encoded form) with "***". */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    out = out.split(s).join('***').split(encodeURIComponent(s)).join('***');
  }
  return out;
}

export function classifyHttpError(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('PROVIDER_AUTH', FRIENDLY.PROVIDER_AUTH);
  if (status === 404) return new ProviderError('PROVIDER_NOT_FOUND', FRIENDLY.PROVIDER_NOT_FOUND);
  if (status === 429) return new ProviderError('PROVIDER_RATE_LIMITED', FRIENDLY.PROVIDER_RATE_LIMITED);
  if (status >= 500) return new ProviderError('PROVIDER_UNAVAILABLE', FRIENDLY.PROVIDER_UNAVAILABLE);
  return new ProviderError('PROVIDER_BAD_REQUEST', FRIENDLY.PROVIDER_BAD_REQUEST);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('PROVIDER_BAD_RESPONSE', FRIENDLY.PROVIDER_BAD_RESPONSE);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseArgs(raw: unknown): { args: Record<string, unknown>; parseError?: string } {
  if (isObj(raw)) return { args: raw };
  if (raw === undefined || raw === null || raw === '') return { args: {} };
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return isObj(v) ? { args: v } : { args: {}, parseError: 'Arguments must be a JSON object.' };
    } catch {
      return { args: {}, parseError: 'Arguments were not valid JSON.' };
    }
  }
  return { args: {}, parseError: 'Arguments must be a JSON object.' };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (chat completions with tools)
// ---------------------------------------------------------------------------

/** OpenAI tool names allow only letters, digits, "_" and "-", so "ga4.overview" is sent as "ga4__overview". */
export function openAiToolName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '__').slice(0, 64);
}

export function openAiChatUrl(baseUrl: string): URL {
  const url = validateOutboundUrl(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  url.hash = '';
  return url;
}

export interface OpenAiRequestInput {
  model: string;
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export function buildOpenAiRequest(input: OpenAiRequestInput): { body: Record<string, unknown>; nameMap: Map<string, string> } {
  const nameMap = new Map<string, string>(); // openai name → tool id
  const tools = input.tools.map((t) => {
    const name = openAiToolName(t.id);
    nameMap.set(name, t.id);
    const params = sanitizeToolSchema(t.input, DATE_ARG_KEYS);
    return { type: 'function', function: { name, description: t.description.slice(0, 1000), parameters: params } };
  });
  const idToName = new Map([...nameMap].map(([n, id]) => [id, n]));
  const nameFor = (id: string) => idToName.get(id) ?? openAiToolName(id);

  const messages: Record<string, unknown>[] = [{ role: 'system', content: input.systemPrompt }];
  for (const m of input.messages) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: nameFor(c.name), arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
    } else messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }

  return {
    body: {
      model: input.model,
      messages,
      temperature: input.temperature ?? 0.2,
      ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    },
    nameMap,
  };
}

export function parseOpenAiResponse(json: unknown, nameMap: Map<string, string>): ProviderTurn {
  if (!isObj(json)) throw new ProviderError('PROVIDER_BAD_RESPONSE', FRIENDLY.PROVIDER_BAD_RESPONSE);
  if (isObj(json.error)) throw new ProviderError('PROVIDER_BAD_REQUEST', FRIENDLY.PROVIDER_BAD_REQUEST);
  const choice = Array.isArray(json.choices) && isObj(json.choices[0]) ? json.choices[0] : null;
  const message = choice && isObj(choice.message) ? choice.message : null;
  if (!message) throw new ProviderError('PROVIDER_EMPTY', FRIENDLY.PROVIDER_EMPTY);

  let text = '';
  if (typeof message.content === 'string') text = message.content;
  else if (Array.isArray(message.content)) {
    text = message.content.map((p) => (isObj(p) && typeof p.text === 'string' ? p.text : '')).join('');
  }

  const toolCalls: AgentToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((raw, i) => {
      if (!isObj(raw) || !isObj(raw.function) || typeof raw.function.name !== 'string') return;
      const { args, parseError } = parseArgs(raw.function.arguments);
      toolCalls.push({
        id: typeof raw.id === 'string' && raw.id ? raw.id : `call_${i}`,
        name: nameMap.get(raw.function.name) ?? raw.function.name,
        args,
        ...(parseError ? { parseError } : {}),
      });
    });
  }
  const usage = isObj(json.usage) ? json.usage : null;
  return {
    text,
    toolCalls,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
    usage: usage
      ? {
          inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
          outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Gemini (generateContent REST)
// ---------------------------------------------------------------------------

const GEMINI_MODEL_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function geminiUrl(model: string): URL {
  const clean = model.replace(/^models\//, '');
  if (!GEMINI_MODEL_RE.test(clean)) throw new ProviderError('PROVIDER_NOT_FOUND', FRIENDLY.PROVIDER_NOT_FOUND);
  return new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(clean)}:generateContent`);
}

export interface GeminiRequestInput {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
}

export function buildGeminiRequest(input: GeminiRequestInput): Record<string, unknown> {
  const contents: { role: string; parts: Record<string, unknown>[] }[] = [];
  for (const m of input.messages) {
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content }] });
    else if (m.role === 'assistant') {
      const parts: Record<string, unknown>[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) {
        parts.push({
          functionCall: { name: c.name, args: c.args },
          // Gemini 3 models require the signature that came with a function call to be sent back.
          ...(c.meta?.thoughtSignature ? { thoughtSignature: c.meta.thoughtSignature } : {}),
        });
      }
      contents.push({ role: 'model', parts });
    } else {
      // Results of parallel calls must be returned together in one turn.
      const part = { functionResponse: { name: m.name, response: { result: m.content } } };
      const last = contents[contents.length - 1];
      if (last && last.role === 'user' && last.parts.every((p) => 'functionResponse' in p)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  const declarations = toGeminiFunctionDeclarations(input.tools, { hideDateArgs: true });
  return {
    systemInstruction: { parts: [{ text: input.systemPrompt }] },
    contents,
    ...(declarations.length
      ? { tools: [{ functionDeclarations: declarations }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } }
      : {}),
    generationConfig: {
      temperature: input.temperature ?? 0.2,
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
    },
  };
}

export function parseGeminiResponse(json: unknown): ProviderTurn {
  if (!isObj(json)) throw new ProviderError('PROVIDER_BAD_RESPONSE', FRIENDLY.PROVIDER_BAD_RESPONSE);
  if (isObj(json.promptFeedback) && typeof json.promptFeedback.blockReason === 'string') {
    throw new ProviderError('PROVIDER_BLOCKED', FRIENDLY.PROVIDER_BLOCKED);
  }
  const cand = Array.isArray(json.candidates) && isObj(json.candidates[0]) ? json.candidates[0] : null;
  if (!cand) throw new ProviderError('PROVIDER_EMPTY', FRIENDLY.PROVIDER_EMPTY);
  const parts = isObj(cand.content) && Array.isArray(cand.content.parts) ? cand.content.parts : [];

  let text = '';
  const toolCalls: AgentToolCall[] = [];
  parts.forEach((p, i) => {
    if (!isObj(p)) return;
    if (p.thought === true) return; // internal reasoning summaries are not part of the answer
    if (typeof p.text === 'string') text += p.text;
    if (isObj(p.functionCall) && typeof p.functionCall.name === 'string') {
      const { args, parseError } = parseArgs(p.functionCall.args);
      toolCalls.push({
        id: typeof p.functionCall.id === 'string' && p.functionCall.id ? p.functionCall.id : `call_${i}`,
        name: p.functionCall.name,
        args,
        ...(parseError ? { parseError } : {}),
        ...(typeof p.thoughtSignature === 'string' ? { meta: { thoughtSignature: p.thoughtSignature } } : {}),
      });
    }
  });
  if (cand.finishReason === 'SAFETY' && !text && toolCalls.length === 0) {
    throw new ProviderError('PROVIDER_BLOCKED', FRIENDLY.PROVIDER_BLOCKED);
  }
  const u = isObj(json.usageMetadata) ? json.usageMetadata : null;
  return {
    text,
    toolCalls,
    finishReason: typeof cand.finishReason === 'string' ? cand.finishReason : undefined,
    usage: u
      ? {
          inputTokens: typeof u.promptTokenCount === 'number' ? u.promptTokenCount : undefined,
          outputTokens: typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount : undefined,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Webhook agents (the user's own service)
// ---------------------------------------------------------------------------

export const WEBHOOK_PROTOCOL_VERSION = 1;

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
}

export interface WebhookContext {
  project: { name: string; domain: string | null };
  dateRange: { startDate: string; endDate: string; compareStartDate?: string; compareEndDate?: string };
  currency?: string;
  timezone?: string;
}

export function buildWebhookPayload(input: {
  agent: { id: string; name: string };
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  context: WebhookContext;
}): Record<string, unknown> {
  return {
    protocolVersion: WEBHOOK_PROTOCOL_VERSION,
    agent: input.agent,
    systemPrompt: input.systemPrompt,
    messages: input.messages,
    tools: input.tools.map((t) => ({
      id: t.id,
      description: t.description,
      parameters: sanitizeToolSchema(t.input, DATE_ARG_KEYS),
    })),
    context: input.context,
  };
}

/** Header value: "t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">". */
export function signWebhookBody(secret: string, rawBody: string, nowSeconds: number): string {
  const sig = crypto.createHmac('sha256', secret).update(`${nowSeconds}.${rawBody}`).digest('hex');
  return `t=${nowSeconds},v1=${sig}`;
}

/** For the receiving side (documented to users) and for tests. Rejects stale timestamps (replay). */
export function verifyWebhookSignature(secret: string, header: string, rawBody: string, nowSeconds: number, toleranceSeconds = 300): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(m[2], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Expected reply: { "answer": "text" }  or  { "toolCalls": [{ "id"?, "name", "args"? }] } (optionally with "text"). */
export function parseWebhookResponse(json: unknown): ProviderTurn {
  if (!isObj(json)) throw new ProviderError('PROVIDER_BAD_RESPONSE', FRIENDLY.PROVIDER_BAD_RESPONSE);
  const calls = Array.isArray(json.toolCalls) ? json.toolCalls : [];
  const toolCalls: AgentToolCall[] = [];
  calls.forEach((raw, i) => {
    if (!isObj(raw) || typeof raw.name !== 'string' || !raw.name) return;
    const { args, parseError } = parseArgs(raw.args);
    toolCalls.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : `call_${i}`,
      name: raw.name,
      args,
      ...(parseError ? { parseError } : {}),
    });
  });
  const text = typeof json.answer === 'string' ? json.answer : typeof json.text === 'string' ? json.text : '';
  if (toolCalls.length === 0 && !text.trim()) throw new ProviderError('PROVIDER_BAD_RESPONSE', FRIENDLY.PROVIDER_BAD_RESPONSE);
  return { text, toolCalls };
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export type AgentProviderKind = 'gemini' | 'openai-compatible' | 'webhook';

export interface ProviderConfig {
  kind: AgentProviderKind;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  webhookSecret?: string;
  agent: { id: string; name: string };
  context?: WebhookContext;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export function createAgentProvider(
  cfg: ProviderConfig,
  deps: { request: RequestFn; nowSeconds?: () => number }
): AgentProvider {
  const secrets = [cfg.apiKey ?? '', cfg.webhookSecret ?? ''].filter(Boolean);
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  async function send(url: URL, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const raw = JSON.stringify(body);
    let res: GuardedResponse;
    try {
      res = await deps.request(url, { method: 'POST', body: raw, headers: headers, signal, timeoutMs: cfg.timeoutMs ?? 45_000 });
    } catch (err) {
      if (err instanceof SsrfError) {
        if (err.code === 'REQUEST_ABORTED') throw err;
        throw new ProviderError('PROVIDER_UNREACHABLE', redactSecrets(`${FRIENDLY.PROVIDER_UNREACHABLE} (${err.message})`, secrets));
      }
      throw new ProviderError('PROVIDER_UNREACHABLE', FRIENDLY.PROVIDER_UNREACHABLE);
    }
    if (res.status < 200 || res.status >= 300) throw classifyHttpError(res.status);
    return parseJson(res.text);
  }

  if (cfg.kind === 'gemini') {
    if (!cfg.model || !cfg.apiKey) throw new ProviderError('PROVIDER_BAD_REQUEST', 'Gemini agents need a model and an API key.');
    const url = geminiUrl(cfg.model);
    return {
      async complete(req) {
        const body = buildGeminiRequest({ systemPrompt: req.systemPrompt, messages: req.messages, tools: req.tools, temperature: cfg.temperature, maxOutputTokens: cfg.maxOutputTokens });
        return parseGeminiResponse(await send(url, body, { 'x-goog-api-key': cfg.apiKey! }, req.signal));
      },
    };
  }

  if (cfg.kind === 'openai-compatible') {
    if (!cfg.model || !cfg.baseUrl) throw new ProviderError('PROVIDER_BAD_REQUEST', 'OpenAI-compatible agents need a model and a base URL.');
    const url = openAiChatUrl(cfg.baseUrl);
    return {
      async complete(req) {
        const { body, nameMap } = buildOpenAiRequest({ model: cfg.model!, systemPrompt: req.systemPrompt, messages: req.messages, tools: req.tools, temperature: cfg.temperature, maxTokens: cfg.maxOutputTokens });
        const headers: Record<string, string> = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
        return parseOpenAiResponse(await send(url, body, headers, req.signal), nameMap);
      },
    };
  }

  if (cfg.kind === 'webhook') {
    if (!cfg.baseUrl || !cfg.webhookSecret || !cfg.context) throw new ProviderError('PROVIDER_BAD_REQUEST', 'Webhook agents need a URL and a signing secret.');
    const url = validateOutboundUrl(cfg.baseUrl);
    return {
      async complete(req) {
        const payload = buildWebhookPayload({ agent: cfg.agent, systemPrompt: req.systemPrompt, messages: req.messages, tools: req.tools, context: cfg.context! });
        const raw = JSON.stringify(payload);
        const headers = { 'x-adlens-signature': signWebhookBody(cfg.webhookSecret!, raw, nowSeconds()), 'x-adlens-protocol': String(WEBHOOK_PROTOCOL_VERSION) };
        // The signature covers the exact bytes sent, so send the same string.
        let res: GuardedResponse;
        try {
          res = await deps.request(url, { method: 'POST', body: raw, headers, signal: req.signal, timeoutMs: cfg.timeoutMs ?? 45_000 });
        } catch (err) {
          if (err instanceof SsrfError && err.code === 'REQUEST_ABORTED') throw err;
          throw new ProviderError('PROVIDER_UNREACHABLE', FRIENDLY.PROVIDER_UNREACHABLE);
        }
        if (res.status < 200 || res.status >= 300) throw classifyHttpError(res.status);
        return parseWebhookResponse(parseJson(res.text));
      },
    };
  }

  throw new ProviderError('PROVIDER_BAD_REQUEST', 'Unknown agent type.');
}
