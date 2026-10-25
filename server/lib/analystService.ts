/**
 * The "ask a question" service for the built-in cloud analyst (Sprint 15a) and for users' own agents
 * (Sprint 16). It ties the tested pieces together and enforces the rules that must never depend on a
 * screen or a route being written correctly:
 *
 * - Input is validated before anything costs money or reaches a provider.
 * - A project with no connected data source gets a clear message, not an AI call.
 * - Custom agents need the owner's recorded consent and must be enabled.
 * - Permissions: only reports whose data source is allowed AND connected are offered to the model.
 * - The monthly AI limit applies to the built-in analyst only (custom agents use the user's own key);
 *   it is checked BEFORE the provider is called and handed back if the provider fails.
 * - Secrets (API keys, webhook secrets) are used to build the provider and never appear in the result.
 *
 * Storage, quotas and the network are injected, so the service is fully unit-tested.
 * Imports in this folder end in .js.
 */

import type { DateDefaults, ToolDefinition } from '../../src/utils/aiTools.js';
import { toProviderConfig, resolveAllowedTools, type AgentInput, type AgentSource } from './agentConfig.js';
import type { AgentProvider, ProviderConfig } from './agentProviders.js';
import { buildSystemPrompt, runAgent, sanitizeHistory, type AgentRunResult, type NumbersUsed, type StopReason } from './agentRunner.js';

export const MAX_QUESTION_CHARS = 2000;

export type AskErrorCode =
  | 'QUESTION_INVALID'
  | 'NO_DATA_SOURCES'
  | 'NO_REPORTS_AVAILABLE'
  | 'CLOUD_NOT_CONFIGURED'
  | 'QUOTA_EXCEEDED'
  | 'AGENT_DISABLED'
  | 'AGENT_CONSENT_REQUIRED'
  | 'PROVIDER_SETUP_FAILED'
  | string; // provider and runner codes pass through (PROVIDER_AUTH, TIMEOUT, ...)

export interface CustomAgentInput {
  id: string;
  settings: Pick<AgentInput, 'name' | 'provider' | 'model' | 'baseUrl' | 'temperature' | 'systemPrompt' | 'allowedSources' | 'allowedReportIds' | 'maxToolCalls' | 'enabled'>;
  /** ISO time the owner confirmed that their data may be sent to this provider; null if never. */
  consentedAt: string | null;
  secrets: { apiKey?: string | null; webhookSecret?: string | null };
}

export interface AskInput {
  question: unknown;
  history?: unknown;
  workspaceId: string;
  project: { name: string; domain: string | null; currency?: string; timezone?: string };
  dates: DateDefaults;
  connectedSources: AgentSource[];
  /** Omit for the built-in cloud analyst. */
  agent?: CustomAgentInput;
}

export interface AnalystDeps {
  /** Every registered report definition. */
  tools: ToolDefinition[];
  /** Runs one report for this request (project, tokens). Throw ToolInputError for arguments the model can fix. */
  executeTool: (toolId: string, args: Record<string, unknown>) => Promise<unknown>;
  makeProvider: (cfg: ProviderConfig) => AgentProvider;
  /** Built-in analyst settings from the server environment. */
  cloud: { apiKey?: string; model?: string };
  /** Atomically takes one question from the workspace's monthly allowance (false when none is left). */
  consumeQuota: (workspaceId: string) => Promise<{ ok: boolean; used: number; limit: number }>;
  /** Gives it back when the provider failed. */
  refundQuota: (workspaceId: string) => Promise<void>;
}

export interface AskResult {
  ok: boolean;
  answer: string;
  error?: { code: AskErrorCode; message: string };
  engine: { kind: 'cloud-gemini' | 'custom-agent'; label: string; dataLeavesDevice: true } | null;
  stopReason: StopReason | 'rejected';
  numbersUsed: NumbersUsed[];
  toolsUsed: { id: string; args: Record<string, unknown> }[];
  quota: { used: number; limit: number } | null;
  usage: { inputTokens: number; outputTokens: number };
}

const reject = (code: AskErrorCode, message: string, extra: Partial<AskResult> = {}): AskResult => ({
  ok: false,
  answer: '',
  error: { code, message },
  engine: null,
  stopReason: 'rejected',
  numbersUsed: [],
  toolsUsed: [],
  quota: null,
  usage: { inputTokens: 0, outputTokens: 0 },
  ...extra,
});

const ALL_SOURCES: AgentSource[] = ['ga4', 'search_console', 'meta'];

export async function askAnalyst(input: AskInput, deps: AnalystDeps): Promise<AskResult> {
  // 1. Validate before anything else.
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) return reject('QUESTION_INVALID', 'Type a question first.');
  if (question.length > MAX_QUESTION_CHARS) return reject('QUESTION_INVALID', `Please keep your question under ${MAX_QUESTION_CHARS} characters.`);

  if (input.connectedSources.length === 0) {
    return reject('NO_DATA_SOURCES', 'Connect Google Analytics, Search Console or Meta Ads to this project first, then ask again.');
  }

  // 2. Which engine, and is it allowed to run?
  const agent = input.agent;
  let providerConfig: ProviderConfig;
  let engine: NonNullable<AskResult['engine']>;
  if (agent) {
    if (!agent.settings.enabled) return reject('AGENT_DISABLED', 'This agent is switched off. Turn it on in Settings → AI agents.');
    if (!agent.consentedAt) {
      return reject('AGENT_CONSENT_REQUIRED', `Before using this agent, confirm that your analytics numbers may be sent to its provider.`);
    }
    providerConfig = toProviderConfig(
      { id: agent.id, ...agent.settings },
      agent.secrets,
      { project: { name: input.project.name, domain: input.project.domain }, dateRange: input.dates, currency: input.project.currency, timezone: input.project.timezone }
    );
    engine = { kind: 'custom-agent', label: agent.settings.name, dataLeavesDevice: true };
  } else {
    if (!deps.cloud.apiKey || !deps.cloud.model) return reject('CLOUD_NOT_CONFIGURED', 'The built-in AI is not set up on this server yet.');
    providerConfig = {
      kind: 'gemini',
      model: deps.cloud.model,
      apiKey: deps.cloud.apiKey,
      agent: { id: 'built-in', name: 'AdLens analyst' },
      temperature: 0.2,
    };
    engine = { kind: 'cloud-gemini', label: 'Gemini (AdLens analyst)', dataLeavesDevice: true };
  }

  // 3. Permissions: only reports the agent may use AND the project has connected.
  const { allowed } = resolveAllowedTools(
    agent ? agent.settings : { allowedSources: ALL_SOURCES, allowedReportIds: undefined },
    deps.tools,
    input.connectedSources
  );
  if (allowed.length === 0) {
    return reject('NO_REPORTS_AVAILABLE', agent ? 'This agent has no reports it can use for this project. Check its data sources in Settings → AI agents.' : 'No reports are available for the connected sources.');
  }

  // 4. Monthly allowance (built-in analyst only), taken before the provider is called.
  let quota: AskResult['quota'] = null;
  if (!agent) {
    const q = await deps.consumeQuota(input.workspaceId);
    quota = { used: q.used, limit: q.limit };
    if (!q.ok) {
      return reject('QUOTA_EXCEEDED', `This workspace has used all ${q.limit} AI questions for this month.`, { engine, quota });
    }
  }

  // 5. Build the provider and run the loop. Nothing here may throw to the caller.
  let result: AgentRunResult;
  try {
    const provider = deps.makeProvider(providerConfig);
    result = await runAgent(
      {
        question,
        history: sanitizeHistory(input.history),
        systemPrompt: buildSystemPrompt({
          customPrompt: agent?.settings.systemPrompt,
          project: input.project,
          dates: input.dates,
          connectedSources: input.connectedSources,
        }),
        tools: allowed,
        dates: input.dates,
        limits: agent ? { maxToolCalls: agent.settings.maxToolCalls } : undefined,
      },
      { provider, executeTool: deps.executeTool }
    );
  } catch {
    if (!agent) await deps.refundQuota(input.workspaceId);
    return reject('PROVIDER_SETUP_FAILED', 'The AI provider could not be reached with the saved settings. Check the address, model and key.', { engine });
  }

  // 6. Failed calls are not charged.
  const failed = result.stopReason === 'provider_error' || result.stopReason === 'timeout';
  if (failed && !agent) {
    await deps.refundQuota(input.workspaceId);
    if (quota) quota = { used: Math.max(0, quota.used - 1), limit: quota.limit };
  }

  return {
    ok: !failed && result.answer.length > 0,
    answer: result.answer,
    ...(result.error ? { error: { code: result.error.code, message: result.error.message } } : {}),
    engine,
    stopReason: result.stopReason,
    numbersUsed: result.numbersUsed,
    toolsUsed: result.trace.filter((t) => t.kind === 'tool').map((t) => ({ id: t.toolId, args: t.args })),
    quota,
    usage: result.usage,
  };
}
