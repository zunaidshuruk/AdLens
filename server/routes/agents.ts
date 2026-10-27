import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getContentLimits } from '../config/plans.js';
import { AGENT_SOURCES, maskKey, parseAgentInput, toProviderConfig, validateApiKey, type AgentInput } from '../lib/agentConfig.js';
import { createAgentProvider, generateWebhookSecret, ProviderError } from '../lib/agentProviders.js';
import { getAgentStore, type AgentRecord, type AgentSecretsRecord } from '../lib/agentStore.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { newDocId } from '../lib/projectDocs.js';
import { openAgentSecret, sealAgentSecret } from '../lib/tokenVault.js';
import { getAgentKeyring } from '../lib/vault.js';
import { getServerConfig } from '../config.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import { reportRegistry } from '../reports/registry.js';
import '../reports/ga4Reports.js';
import '../reports/exploreReports.js';
import { aiRateLimitMiddleware, getAiRequest, resolveConnectedSourcesForProject } from './ai.js';

export const agentsRouter = Router();

const fail = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });

agentsRouter.use(requireUser);
agentsRouter.use(verifyGoogleSessionOwnership);
agentsRouter.use(loadProject);

/** What the browser may see: settings and whether secrets exist, never the secrets themselves. */
export function toPublicAgent(rec: AgentRecord) {
  const s = rec.settings;
  return {
    id: rec.id,
    name: s.name,
    description: s.description ?? '',
    provider: s.provider,
    model: s.model ?? null,
    baseUrl: s.baseUrl ?? null,
    systemPrompt: s.systemPrompt,
    allowedSources: s.allowedSources,
    allowedReportIds: s.allowedReportIds ?? null,
    temperature: s.temperature,
    maxToolCalls: s.maxToolCalls,
    enabled: s.enabled,
    hasApiKey: rec.hasApiKey,
    apiKeyHint: rec.apiKeyHint,
    hasWebhookSecret: rec.hasWebhookSecret,
    consentedAt: rec.consentedAt,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

async function workspaceScope(req: Request, res: Response, write: boolean): Promise<{ ws: string; plan: string | undefined; uid: string } | null> {
  const project = req.project;
  if (!project) {
    fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.');
    return null;
  }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const role = ws?.members?.[req.user!.uid];
  if (!role || (write && role !== 'owner' && role !== 'admin')) {
    fail(res, 403, 'NOT_ALLOWED', write ? 'Only workspace owners and admins can change AI agents.' : 'You do not have access to this workspace.');
    return null;
  }
  return { ws: project.workspaceId, plan: ws?.plan, uid: req.user!.uid };
}

function requireVault(res: Response): boolean {
  if (!getServerConfig().vaultReady) {
    fail(res, 503, 'VAULT_NOT_READY', 'Secure storage is not set up on this server yet, so agent keys cannot be saved.');
    return false;
  }
  return true;
}

const bodySchema = z.object({
  agent: z.unknown(),
  apiKey: z.string().max(400).optional(),
  removeApiKey: z.boolean().optional(),
  consent: z.boolean().optional(),
  rotateWebhookSecret: z.boolean().optional(),
});

const providerChanged = (a: AgentInput, b: AgentInput) => a.provider !== b.provider || (a.baseUrl ?? '') !== (b.baseUrl ?? '');

// GET /api/agents  -> agents of this workspace
agentsRouter.get('/', async (req, res) => {
  try {
    const s = await workspaceScope(req, res, false);
    if (!s) return;
    const list = (await getAgentStore().list(s.ws)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json({ agents: list.map(toPublicAgent), limit: getContentLimits(s.plan).maxAgents });
  } catch { fail(res, 500, 'AGENTS_FAILED', 'Could not load AI agents.'); }
});

// GET /api/agents/options -> what an agent can be allowed to use in this project
agentsRouter.get('/options', async (req, res) => {
  try {
    const s = await workspaceScope(req, res, false);
    if (!s) return;
    const connected = await resolveConnectedSourcesForProject(req.user!.uid, req.user?.email, req.project);
    res.json({
      sources: AGENT_SOURCES.map((id) => ({ id, connected: connected.includes(id) })),
      reports: reportRegistry.list().map((r) => ({ id: r.id, title: r.title, description: r.description, source: r.source })),
    });
  } catch { fail(res, 500, 'AGENTS_FAILED', 'Could not load options.'); }
});

// POST /api/agents -> create
agentsRouter.post('/', async (req, res) => {
  try {
    const s = await workspaceScope(req, res, true);
    if (!s || !requireVault(res)) return;
    const body = bodySchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'INVALID_AGENT', 'The request is not valid.');
    const parsed = parseAgentInput(body.data.agent);
    if (!parsed.ok) return fail(res, 400, 'INVALID_AGENT', parsed.errors[0].message);
    const agent = parsed.value;
    if (body.data.consent !== true) return fail(res, 400, 'CONSENT_REQUIRED', 'Confirm that your analytics numbers may be sent to this provider.');
    const key = validateApiKey(agent.provider, body.data.apiKey);
    if (!key.ok) return fail(res, 400, 'INVALID_API_KEY', key.message);

    const store = getAgentStore();
    if ((await store.list(s.ws)).length >= getContentLimits(s.plan).maxAgents) {
      return fail(res, 409, 'LIMIT_REACHED', getContentLimits(s.plan).maxAgents === 0 ? 'Your plan does not include your own AI agents. Upgrade to add one.' : `Your plan allows ${getContentLimits(s.plan).maxAgents} AI agents. Delete one or upgrade to add more.`);
    }

    const id = newDocId();
    const ring = getAgentKeyring();
    const secrets: AgentSecretsRecord = {};
    let webhookSecret: string | undefined;
    if (key.key) secrets.apiKey = sealAgentSecret(key.key, s.uid, id, ring);
    if (agent.provider === 'webhook') {
      webhookSecret = generateWebhookSecret();
      secrets.webhookSecret = sealAgentSecret(webhookSecret, s.uid, id, ring);
    }
    const now = new Date().toISOString();
    const rec: AgentRecord = {
      id, createdBy: s.uid, createdAt: now, updatedAt: now, consentedAt: now, settings: agent,
      hasApiKey: Boolean(key.key), apiKeyHint: key.key ? maskKey(key.key) : null, hasWebhookSecret: Boolean(webhookSecret),
    };
    await store.putSecrets(s.ws, id, secrets);
    await store.put(s.ws, rec);
    // The webhook signing secret is shown this once; afterwards only "a secret exists" is visible.
    res.status(201).json({ agent: toPublicAgent(rec), ...(webhookSecret ? { webhookSecret } : {}) });
  } catch { fail(res, 500, 'AGENTS_FAILED', 'Could not save this agent.'); }
});

// PUT /api/agents/:id -> update
agentsRouter.put('/:id', async (req, res) => {
  try {
    const s = await workspaceScope(req, res, true);
    if (!s || !requireVault(res)) return;
    const store = getAgentStore();
    const current = await store.get(s.ws, String(req.params.id));
    if (!current) return fail(res, 404, 'AGENT_NOT_FOUND', 'AI agent not found.');
    const body = bodySchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'INVALID_AGENT', 'The request is not valid.');
    const parsed = parseAgentInput(body.data.agent);
    if (!parsed.ok) return fail(res, 400, 'INVALID_AGENT', parsed.errors[0].message);
    const agent = parsed.value;

    const ring = getAgentKeyring();
    const secrets = await store.getSecrets(s.ws, current.id);
    const next: AgentSecretsRecord = { ...secrets };
    let apiKeyHint = current.apiKeyHint;
    let hasApiKey = current.hasApiKey;

    if (agent.provider === 'webhook') {
      delete next.apiKey; hasApiKey = false; apiKeyHint = null;
    } else {
      if (body.data.apiKey && body.data.apiKey.trim()) {
        const key = validateApiKey(agent.provider, body.data.apiKey);
        if (!key.ok) return fail(res, 400, 'INVALID_API_KEY', key.message);
        if (key.key) { next.apiKey = sealAgentSecret(key.key, current.createdBy, current.id, ring); hasApiKey = true; apiKeyHint = maskKey(key.key); }
      } else if (body.data.removeApiKey && agent.provider === 'openai-compatible') {
        delete next.apiKey; hasApiKey = false; apiKeyHint = null;
      }
      if (agent.provider === 'gemini' && !next.apiKey) return fail(res, 400, 'INVALID_API_KEY', 'Enter your Gemini API key.');
      delete next.webhookSecret;
    }

    let webhookSecret: string | undefined;
    if (agent.provider === 'webhook' && (!next.webhookSecret || body.data.rotateWebhookSecret)) {
      webhookSecret = generateWebhookSecret();
      next.webhookSecret = sealAgentSecret(webhookSecret, current.createdBy, current.id, ring);
    }

    // Sending data somewhere new needs a fresh yes.
    const needsConsent = providerChanged(current.settings, agent) || (current.settings.provider !== 'webhook' && agent.provider === 'webhook');
    let consentedAt = current.consentedAt;
    if (body.data.consent === true) consentedAt = new Date().toISOString();
    else if (needsConsent) consentedAt = null;

    const rec: AgentRecord = {
      ...current, settings: agent, consentedAt, hasApiKey, apiKeyHint,
      hasWebhookSecret: Boolean(next.webhookSecret), updatedAt: new Date().toISOString(),
    };
    await store.putSecrets(s.ws, current.id, next);
    await store.put(s.ws, rec);
    res.json({ agent: toPublicAgent(rec), ...(webhookSecret ? { webhookSecret } : {}) });
  } catch { fail(res, 500, 'AGENTS_FAILED', 'Could not save this agent.'); }
});

// DELETE /api/agents/:id
agentsRouter.delete('/:id', async (req, res) => {
  try {
    const s = await workspaceScope(req, res, true);
    if (!s) return;
    if (!(await getAgentStore().delete(s.ws, String(req.params.id)))) return fail(res, 404, 'AGENT_NOT_FOUND', 'AI agent not found.');
    res.status(204).end();
  } catch { fail(res, 500, 'AGENTS_FAILED', 'Could not delete this agent.'); }
});

// POST /api/agents/:id/test -> a tiny message with no analytics numbers, to check the connection
agentsRouter.post('/:id/test', aiRateLimitMiddleware, async (req, res) => {
  try {
    const s = await workspaceScope(req, res, true);
    if (!s || !requireVault(res)) return;
    const store = getAgentStore();
    const rec = await store.get(s.ws, String(req.params.id));
    if (!rec) return fail(res, 404, 'AGENT_NOT_FOUND', 'AI agent not found.');
    const secrets = await store.getSecrets(s.ws, rec.id);
    const ring = getAgentKeyring();
    const provider = createAgentProvider(
      toProviderConfig({ id: rec.id, ...rec.settings }, {
        apiKey: secrets.apiKey ? openAgentSecret(secrets.apiKey, rec.createdBy, rec.id, ring) : null,
        webhookSecret: secrets.webhookSecret ? openAgentSecret(secrets.webhookSecret, rec.createdBy, rec.id, ring) : null,
      }, {
        project: { name: req.project?.name ?? 'Connection test', domain: null },
        dateRange: { startDate: '2026-01-01', endDate: '2026-01-02' },
      }),
      { request: getAiRequest() }
    );
    try {
      const turn = await provider.complete({
        systemPrompt: 'This is a connection test. Reply with the single word OK.',
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        tools: [],
      });
      res.json({ ok: true, message: 'Connected. The provider answered.', sample: turn.text.slice(0, 80) });
    } catch (err) {
      if (err instanceof ProviderError) return void res.json({ ok: false, code: err.code, message: err.message });
      res.json({ ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'Could not reach the provider.' });
    }
  } catch { fail(res, 500, 'AGENTS_FAILED', 'Could not test this agent.'); }
});
