export type AgentProviderKind = 'gemini' | 'openai-compatible' | 'webhook';
export type AgentSourceId = 'ga4' | 'search_console' | 'meta';

export interface PublicAgent {
  id: string;
  name: string;
  description: string;
  provider: AgentProviderKind;
  model: string | null;
  baseUrl: string | null;
  systemPrompt: string;
  allowedSources: AgentSourceId[];
  allowedReportIds: string[] | null;
  temperature: number;
  maxToolCalls: number;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  hasWebhookSecret: boolean;
  consentedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentOptions {
  sources: { id: AgentSourceId; connected: boolean }[];
  reports: { id: string; title: string; description: string; source: string }[];
}

/** What the form edits. Sent to the server as `agent`. */
export interface AgentFormValues {
  name: string;
  description: string;
  provider: AgentProviderKind;
  model: string;
  baseUrl: string;
  systemPrompt: string;
  allowedSources: AgentSourceId[];
  /** null = every report of the allowed sources. */
  allowedReportIds: string[] | null;
  temperature: number;
  maxToolCalls: number;
  enabled: boolean;
}

export interface AgentTestResult { ok: boolean; message: string; code?: string; sample?: string }
