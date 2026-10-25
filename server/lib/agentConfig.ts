/**
 * What a user can configure for a custom AI agent (Sprint 16), and how those settings turn into
 * permissions. Pure functions; the server routes call these before saving anything.
 *
 * Storage plan (Firestore, set up in the build step):
 * - workspaces/{ws}/agents/{agentId}         public settings (no secrets); written by the server only
 * - workspaces/{ws}/agentSecrets/{agentId}   sealed API key / webhook secret (sealAgentSecret); server only
 *
 * Imports in this folder end in .js (guard test).
 */

import { z } from 'zod';
import type { ToolDefinition, ToolSource } from '../../src/utils/aiTools.js';
import { MAX_CUSTOM_PROMPT_CHARS } from './agentRunner.js';
import type { AgentProviderKind, ProviderConfig, WebhookContext } from './agentProviders.js';
import { SsrfError, validateOutboundUrl } from './ssrfGuard.js';

export const AGENT_PROVIDER_KINDS = ['gemini', 'openai-compatible', 'webhook'] as const;
export const AGENT_SOURCES = ['ga4', 'search_console', 'meta'] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const REPORT_ID_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export const agentInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the agent a name').max(60),
    description: z.string().trim().max(200).optional(),
    provider: z.enum(AGENT_PROVIDER_KINDS),
    model: z.string().trim().regex(MODEL_RE, 'Use only letters, numbers and . _ - : /').optional(),
    baseUrl: z.string().trim().max(500).optional(),
    systemPrompt: z.string().max(MAX_CUSTOM_PROMPT_CHARS, `Keep instructions under ${MAX_CUSTOM_PROMPT_CHARS} characters`).default(''),
    allowedSources: z.array(z.enum(AGENT_SOURCES)).min(1, 'Allow at least one data source').max(3).default([...AGENT_SOURCES]),
    allowedReportIds: z.array(z.string().regex(REPORT_ID_RE)).max(60).optional(),
    temperature: z.number().min(0).max(1.5).default(0.2),
    maxToolCalls: z.number().int().min(1).max(10).default(6),
    enabled: z.boolean().default(true),
  })
  .superRefine((a, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (new Set(a.allowedSources).size !== a.allowedSources.length) issue('allowedSources', 'Each data source can only be listed once');

    if (a.provider === 'gemini' && !a.model) issue('model', 'Enter the Gemini model name');
    if (a.provider === 'openai-compatible' && !a.model) issue('model', 'Enter the model name');
    if (a.provider === 'openai-compatible' || a.provider === 'webhook') {
      if (!a.baseUrl) {
        issue('baseUrl', a.provider === 'webhook' ? 'Enter your webhook URL' : 'Enter the base URL of the API');
      } else {
        try {
          validateOutboundUrl(a.baseUrl);
        } catch (err) {
          issue('baseUrl', err instanceof SsrfError ? err.message : 'Enter a valid web address.');
        }
      }
    }
  });

export type AgentInput = z.infer<typeof agentInputSchema>;

export type ParseResult = { ok: true; value: AgentInput } | { ok: false; errors: { path: string; message: string }[] };

export function parseAgentInput(raw: unknown): ParseResult {
  const r = agentInputSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, errors: r.error.issues.map((i) => ({ path: i.path.join('.') || 'agent', message: i.message })) };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export type KeyCheck = { ok: true; key: string | null } | { ok: false; message: string };

/**
 * The key ends up in an HTTP header, so it must be plain printable characters (no spaces, line breaks
 * or non-ASCII), which also blocks header-injection tricks. Gemini needs a key; OpenAI-compatible
 * servers may not; webhooks use a generated signing secret instead.
 */
export function validateApiKey(provider: AgentProviderKind, input: unknown): KeyCheck {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (provider === 'webhook') return { ok: true, key: null };
  if (!raw) return provider === 'gemini' ? { ok: false, message: 'Enter your Gemini API key.' } : { ok: true, key: null };
  if (raw.length < 8 || raw.length > 400) return { ok: false, message: 'That does not look like an API key (wrong length).' };
  if (!/^[\x21-\x7e]+$/.test(raw)) return { ok: false, message: 'The key contains spaces or unusual characters. Paste only the key itself.' };
  return { ok: true, key: raw };
}

/** For showing a saved key: "••••abcd". Never store or send more than this to the browser. */
export function maskKey(key: string): string {
  return key.length >= 8 ? `••••${key.slice(-4)}` : '••••';
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type ToolExclusionReason = 'source_not_allowed' | 'source_not_connected' | 'not_selected' | 'needs_all_sources';
export interface ToolExclusion { id: string; reason: ToolExclusionReason }

export const EXCLUSION_MESSAGES: Record<ToolExclusionReason, string> = {
  source_not_allowed: 'This agent is not allowed to use that data source.',
  source_not_connected: 'That data source is not connected to this project.',
  not_selected: 'This report was not selected for this agent.',
  needs_all_sources: 'Cross-channel reports need every connected source to be allowed for this agent.',
};

/**
 * The reports an agent may call = reports whose data source the agent is allowed AND the project has
 * connected, optionally narrowed to a hand-picked list. Cross-channel ("combined") reports can touch
 * any connected source, so they require every connected source to be allowed.
 */
export function resolveAllowedTools(
  agent: Pick<AgentInput, 'allowedSources' | 'allowedReportIds'>,
  tools: ToolDefinition[],
  connectedSources: AgentSource[]
): { allowed: ToolDefinition[]; excluded: ToolExclusion[] } {
  const allowedSources = new Set<string>(agent.allowedSources);
  const connected = new Set<string>(connectedSources);
  const picked = agent.allowedReportIds ? new Set(agent.allowedReportIds) : null;
  const allowed: ToolDefinition[] = [];
  const excluded: ToolExclusion[] = [];

  for (const t of tools) {
    let reason: ToolExclusionReason | null = null;
    if (t.source === 'combined') {
      if (connected.size === 0 || [...connected].some((s) => !allowedSources.has(s))) reason = 'needs_all_sources';
    } else if (!allowedSources.has(t.source)) reason = 'source_not_allowed';
    else if (!connected.has(t.source)) reason = 'source_not_connected';
    if (!reason && picked && !picked.has(t.id)) reason = 'not_selected';
    if (reason) excluded.push({ id: t.id, reason });
    else allowed.push(t);
  }
  return { allowed, excluded };
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export const agentsPath = (workspaceId: string) => `workspaces/${workspaceId}/agents`;
export const agentSecretsPath = (workspaceId: string) => `workspaces/${workspaceId}/agentSecrets`;

/** Settings + decrypted secrets → what createAgentProvider needs. */
export function toProviderConfig(
  agent: { id: string } & Pick<AgentInput, 'name' | 'provider' | 'model' | 'baseUrl' | 'temperature'>,
  secrets: { apiKey?: string | null; webhookSecret?: string | null },
  context: WebhookContext
): ProviderConfig {
  return {
    kind: agent.provider,
    model: agent.model,
    baseUrl: agent.baseUrl,
    apiKey: secrets.apiKey ?? undefined,
    webhookSecret: secrets.webhookSecret ?? undefined,
    agent: { id: agent.id, name: agent.name },
    context,
    temperature: agent.temperature,
  };
}
