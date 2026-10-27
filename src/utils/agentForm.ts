import type { AgentFormValues, AgentProviderKind, PublicAgent } from '../types/agents.js';

export const PROVIDER_LABEL: Record<AgentProviderKind, string> = {
  gemini: 'Google Gemini (your own key)',
  'openai-compatible': 'OpenAI or compatible (ChatGPT, Groq, OpenRouter, local servers…)',
  webhook: 'My own service (webhook)',
};

export const PROVIDER_DEFAULTS: Record<AgentProviderKind, { model: string; baseUrl: string }> = {
  gemini: { model: 'gemini-2.5-flash', baseUrl: '' },
  'openai-compatible': { model: '', baseUrl: 'https://api.openai.com/v1' },
  webhook: { model: '', baseUrl: '' },
};

export function emptyForm(provider: AgentProviderKind = 'gemini'): AgentFormValues {
  return {
    name: '',
    description: '',
    provider,
    model: PROVIDER_DEFAULTS[provider].model,
    baseUrl: PROVIDER_DEFAULTS[provider].baseUrl,
    systemPrompt: '',
    allowedSources: ['ga4', 'search_console', 'meta'],
    allowedReportIds: null,
    temperature: 0.2,
    maxToolCalls: 6,
    enabled: true,
  };
}

export function formFromAgent(a: PublicAgent): AgentFormValues {
  return {
    name: a.name,
    description: a.description,
    provider: a.provider,
    model: a.model ?? '',
    baseUrl: a.baseUrl ?? '',
    systemPrompt: a.systemPrompt,
    allowedSources: [...a.allowedSources],
    allowedReportIds: a.allowedReportIds ? [...a.allowedReportIds] : null,
    temperature: a.temperature,
    maxToolCalls: a.maxToolCalls,
    enabled: a.enabled,
  };
}

/** The object the server expects: empty optional fields are left out. */
export function formToPayload(f: AgentFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: f.name.trim(),
    provider: f.provider,
    systemPrompt: f.systemPrompt,
    allowedSources: f.allowedSources,
    temperature: f.temperature,
    maxToolCalls: f.maxToolCalls,
    enabled: f.enabled,
  };
  if (f.description.trim()) out.description = f.description.trim();
  if (f.provider !== 'webhook' && f.model.trim()) out.model = f.model.trim();
  if (f.provider !== 'gemini' && f.baseUrl.trim()) out.baseUrl = f.baseUrl.trim();
  if (f.allowedReportIds) out.allowedReportIds = f.allowedReportIds;
  return out;
}

/** Plain-English problems found before anything is sent. */
export function validateForm(f: AgentFormValues, opts: { needsKey: boolean; apiKey: string }): string[] {
  const p: string[] = [];
  if (!f.name.trim()) p.push('Give the agent a name.');
  if (f.provider !== 'webhook' && !f.model.trim()) p.push('Enter the model name.');
  if (f.provider !== 'gemini' && !f.baseUrl.trim()) p.push(f.provider === 'webhook' ? 'Enter your webhook address.' : 'Enter the API address.');
  if (f.provider !== 'gemini' && f.baseUrl.trim() && !/^https:\/\//i.test(f.baseUrl.trim())) p.push('The address must start with https://');
  if (f.provider === 'gemini' && opts.needsKey && !opts.apiKey.trim()) p.push('Paste your Gemini API key.');
  if (f.allowedSources.length === 0) p.push('Allow at least one data source.');
  if (f.allowedReportIds && f.allowedReportIds.length === 0) p.push('Pick at least one report, or allow all reports.');
  return p;
}

export function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Which agent can answer right now, and if not, why. */
export function agentReadiness(a: Pick<PublicAgent, 'enabled' | 'consentedAt'>): { ready: boolean; reason?: string } {
  if (!a.enabled) return { ready: false, reason: 'Switched off' };
  if (!a.consentedAt) return { ready: false, reason: 'Needs your confirmation' };
  return { ready: true };
}

/** Python and Node snippets that check a request really came from AdLens. */
export const NODE_VERIFY_SNIPPET = `import crypto from 'node:crypto';

// rawBody must be the exact text AdLens sent (do not re-serialise the parsed JSON).
export function verifyAdLens(secret, header, rawBody, toleranceSeconds = 300) {
  const m = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header || '');
  if (!m) return false;
  if (Math.abs(Date.now() / 1000 - Number(m[1])) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(\`\${m[1]}.\${rawBody}\`).digest();
  const given = Buffer.from(m[2], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}`;

export const PYTHON_VERIFY_SNIPPET = `import hmac, hashlib, re, time

def verify_adlens(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    m = re.fullmatch(r"t=(\\d+),v1=([0-9a-f]{64})", header or "")
    if not m:
        return False
    if abs(time.time() - int(m.group(1))) > tolerance:
        return False
    signed = m.group(1).encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, m.group(2))`;

export const WEBHOOK_REPLY_EXAMPLES = {
  answer: `{ "answer": "Organic search brought 4,120 sessions, up 12%." }`,
  toolCalls: `{ "toolCalls": [ { "id": "c1", "name": "ga4.overview", "args": {} } ] }`,
};
