import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getServerConfig } from '../config.js';
import { getContentLimits } from '../config/plans.js';
import { askEngine, analyseAnswer, promptsInputSchema, settingsInputSchema, summariseRuns, type Analysis, type RunRecord } from '../lib/aiVisibility.js';
import { createAgentProvider, type AgentProvider } from '../lib/agentProviders.js';
import { getAgentStore } from '../lib/agentStore.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore, newDocId, type StoredDoc } from '../lib/projectDocs.js';
import { openAgentSecret } from '../lib/tokenVault.js';
import { getAgentKeyring } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import { aiRateLimitMiddleware, getAiRequest } from './ai.js';

/** AI visibility (Sprint 43): saved questions, asked to an AI assistant, with the answers analysed for your brand. */
export const aivisRouter = Router();
const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
const deps: { now: () => number } = { now: Date.now };
export function setAivisTestDeps(d: Partial<typeof deps> | null): void { deps.now = d?.now ?? Date.now; }

aivisRouter.use(requireUser);
aivisRouter.use(verifyGoogleSessionOwnership);
aivisRouter.use(loadProject);

interface Scope { plan: string | undefined; uid: string; ws: string; project: string; canEdit: boolean; canAi: boolean }
async function scope(req: Request, res: Response, write: boolean): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const uid = req.user!.uid;
  if (!ws || !can(ws, uid, write ? 'content.edit' : 'reports.view')) { fail(res, 403, 'NOT_ALLOWED', write ? 'You do not have permission to change AI visibility settings in this project.' : 'You do not have permission to see this project.'); return null; }
  return { plan: ws.plan, uid, ws: project.workspaceId, project: project.id, canEdit: can(ws, uid, 'content.edit'), canAi: can(ws, uid, 'ai.use') };
}
const idOk = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const MAX_RUNS_PER_PROMPT = 40;

const toRun = (d: StoredDoc): RunRecord => ({ id: d.id, promptId: String(d.promptId ?? ''), engine: String(d.engine ?? ''), at: String(d.at ?? ''), analysis: d.analysis as Analysis });
const brandTermsOf = (req: Request): string[] => {
  const p = req.project!;
  return [...new Set([p.name, ...(p.brandTerms ?? [])].map((x) => String(x).trim()).filter((x) => x.length >= 2))].slice(0, 10);
};
async function loadSettings(s: Scope): Promise<{ competitors: string[] }> {
  const d = await getProjectDocsStore().get(s.ws, s.project, 'seoSettings', 'aivis');
  return { competitors: Array.isArray(d?.competitors) ? (d!.competitors as unknown[]).map(String) : [] };
}

aivisRouter.get('/overview', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const docs = getProjectDocsStore();
    const prompts = (await docs.list(s.ws, s.project, 'aiPrompts')).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const runs = (await docs.list(s.ws, s.project, 'aiRuns')).map(toRun).sort((a, b) => a.at.localeCompare(b.at));
    const latest = new Map<string, RunRecord>();
    const counts = new Map<string, number>();
    for (const r of runs) { latest.set(r.promptId, r); counts.set(r.promptId, (counts.get(r.promptId) ?? 0) + 1); }
    const byDay = new Map<string, { m: number; t: number }>();
    for (const r of runs) { const day = r.at.slice(0, 10); const e = byDay.get(day) ?? { m: 0, t: 0 }; e.t++; if (r.analysis.mentioned) e.m++; byDay.set(day, e); }
    const settings = await loadSettings(s);
    let agents: { id: string; name: string }[] = [];
    if (s.canAi) { try { agents = (await getAgentStore().list(s.ws)).filter((a) => a.settings.enabled && a.settings.provider !== 'webhook' && a.hasApiKey && a.consentedAt).map((a) => ({ id: a.id, name: a.settings.name })); } catch { /* agents are optional */ } }
    res.json({
      prompts: prompts.map((p) => ({ id: p.id, text: String(p.text ?? ''), runs: counts.get(p.id) ?? 0, latest: latest.get(p.id) ?? null })),
      competitors: settings.competitors, brandTerms: brandTermsOf(req), ownDomain: req.project!.domain ?? null,
      summary: summariseRuns(prompts.map((p) => latest.get(p.id) ?? null)),
      trend: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30).map(([date, v]) => ({ date, rate: Math.round((v.m / v.t) * 100) })),
      limit: getContentLimits(s.plan).maxAiPrompts, canEdit: s.canEdit, canAi: s.canAi, agents,
    });
  } catch { fail(res, 500, 'AIVIS_FAILED', 'Something went wrong.'); }
});

aivisRouter.post('/prompts', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = promptsInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the questions and try again.');
    const docs = getProjectDocsStore();
    const existing = await docs.list(s.ws, s.project, 'aiPrompts');
    const have = new Set(existing.map((p) => String(p.text).toLowerCase()));
    const fresh: string[] = [];
    for (const raw of parsed.data.texts) { const t = raw.replace(/\s+/g, ' '); if (!have.has(t.toLowerCase())) { have.add(t.toLowerCase()); fresh.push(t); } }
    const limit = getContentLimits(s.plan).maxAiPrompts;
    if (existing.length + fresh.length > limit) return fail(res, 409, 'LIMIT_REACHED', `Your plan allows ${limit} saved questions (${existing.length} used). Remove some or upgrade.`);
    const now = new Date(deps.now()).toISOString();
    for (const text of fresh) await docs.put(s.ws, s.project, 'aiPrompts', { id: newDocId(), text, createdBy: s.uid, createdAt: now });
    res.status(201).json({ added: fresh.length, skipped: parsed.data.texts.length - fresh.length });
  } catch { fail(res, 500, 'AIVIS_FAILED', 'Something went wrong.'); }
});

aivisRouter.delete('/prompts/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That question was not found.');
    const docs = getProjectDocsStore();
    if (!(await docs.delete(s.ws, s.project, 'aiPrompts', req.params.id!))) return fail(res, 404, 'NOT_FOUND', 'That question was not found.');
    for (const r of await docs.list(s.ws, s.project, 'aiRuns')) if (r.promptId === req.params.id) await docs.delete(s.ws, s.project, 'aiRuns', r.id);
    res.json({ ok: true });
  } catch { fail(res, 500, 'AIVIS_FAILED', 'Something went wrong.'); }
});

aivisRouter.put('/settings', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = settingsInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Enter up to 10 competitor names.');
    const competitors = [...new Set(parsed.data.competitors.map((c) => c.replace(/\s+/g, ' ')))];
    await getProjectDocsStore().put(s.ws, s.project, 'seoSettings', { id: 'aivis', competitors });
    res.json({ competitors });
  } catch { fail(res, 500, 'AIVIS_FAILED', 'Something went wrong.'); }
});

aivisRouter.get('/history/:id', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That question was not found.');
    const runs = (await getProjectDocsStore().list(s.ws, s.project, 'aiRuns')).map(toRun).filter((r) => r.promptId === req.params.id).sort((a, b) => b.at.localeCompare(a.at));
    res.json({ runs });
  } catch { fail(res, 500, 'AIVIS_FAILED', 'Something went wrong.'); }
});

// Runs saved questions. Built-in AI: one monthly AI question each (given back on failure). Your own agent: uses your own key, no allowance.
aivisRouter.post('/run', aiRateLimitMiddleware, async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!s.canAi) return fail(res, 403, 'NOT_ALLOWED', 'Your role in this workspace does not allow using the AI.');
    const parsed = z.object({ promptIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)).min(1).max(10), agentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional() }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Choose 1 to 10 questions to run.');
    const docs = getProjectDocsStore();
    const prompts: StoredDoc[] = [];
    for (const id of parsed.data.promptIds) { const p = await docs.get(s.ws, s.project, 'aiPrompts', id); if (p) prompts.push(p); }
    if (prompts.length === 0) return fail(res, 404, 'NOT_FOUND', 'Those questions were not found.');
    const cfg = getServerConfig();
    const store = getFirestoreStore();
    let providers: { provider: AgentProvider; label: string }[] = [];
    let builtin = false;
    if (parsed.data.agentId) {
      const agentStore = getAgentStore();
      const rec = await agentStore.get(s.ws, parsed.data.agentId);
      if (!rec || !rec.settings.enabled || rec.settings.provider === 'webhook' || !rec.consentedAt) return fail(res, 404, 'AGENT_NOT_FOUND', 'That AI agent is not available for this.');
      if (!cfg.vaultReady) return fail(res, 503, 'VAULT_NOT_READY', 'Secure storage is not set up on this server yet.');
      let apiKey: string | null = null;
      try { const sealed = await agentStore.getSecrets(s.ws, rec.id); apiKey = sealed.apiKey ? openAgentSecret(sealed.apiKey, rec.createdBy, rec.id, getAgentKeyring()) : null; } catch { return fail(res, 422, 'AGENT_SECRET_UNREADABLE', "This agent's saved key could not be read. Enter the key again on the AI Agents page."); }
      if (!apiKey) return fail(res, 422, 'AGENT_NO_KEY', 'This agent has no key saved.');
      providers = [{ label: rec.settings.name, provider: createAgentProvider({ kind: rec.settings.provider, model: rec.settings.model, baseUrl: rec.settings.baseUrl, apiKey, agent: { id: rec.id, name: rec.settings.name }, temperature: 0.7 } as never, { request: getAiRequest() }) }];
    } else {
      builtin = true;
      const keys = [cfg.geminiApiKey, cfg.geminiApiKey2].filter((k): k is string => Boolean(k));
      if (keys.length === 0 || !cfg.geminiModel) return fail(res, 503, 'CLOUD_NOT_CONFIGURED', 'The built-in AI is not set up on this server yet.');
      providers = keys.map((apiKey) => ({ label: 'Built-in AI (Gemini)', provider: createAgentProvider({ kind: 'gemini', model: cfg.geminiModel!, apiKey, agent: { id: 'ai-visibility', name: 'AI visibility' }, temperature: 0.7 }, { request: getAiRequest() }) }));
    }
    const settings = await loadSettings(s);
    const brand = brandTermsOf(req);
    const done: (RunRecord & { question: string })[] = []; const errors: string[] = [];
    let quota: { used: number; limit: number | null } | null = null;
    for (const p of prompts) {
      if (builtin) { const q = await store.consumeAiQuota(s.ws); if (!q.ok) { errors.push("You've used all AI questions for this month."); break; } quota = { used: q.used, limit: q.limit }; }
      let outcome: Awaited<ReturnType<typeof askEngine>> | null = null; let label = providers[0]!.label;
      for (const pr of providers) {
        outcome = await askEngine(String(p.text), pr.provider); label = pr.label;
        const retryable = !outcome.ok && outcome.code === 'PROVIDER_ERROR' && ['PROVIDER_AUTH', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(outcome.providerCode ?? '');
        if (!retryable) break;
      }
      if (!outcome || !outcome.ok) { if (builtin) await store.refundAiQuota(s.ws); errors.push(outcome && !outcome.ok ? outcome.message : 'The AI could not be reached.'); continue; }
      const run: RunRecord = { id: newDocId(), promptId: p.id, engine: label, at: new Date(deps.now()).toISOString(), analysis: analyseAnswer(outcome.text, brand, settings.competitors, req.project!.domain) };
      await docs.put(s.ws, s.project, 'aiRuns', { id: run.id, promptId: run.promptId, engine: run.engine, at: run.at, analysis: run.analysis as unknown as Record<string, unknown> });
      done.push({ ...run, question: String(p.text) });
      const mine = (await docs.list(s.ws, s.project, 'aiRuns')).filter((r) => r.promptId === p.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      for (const old of mine.slice(MAX_RUNS_PER_PROMPT)) await docs.delete(s.ws, s.project, 'aiRuns', old.id);
    }
    if (done.length === 0) return fail(res, errors[0]?.startsWith("You've used") ? 429 : 502, errors[0]?.startsWith("You've used") ? 'QUOTA_EXCEEDED' : 'AI_FAILED', errors[0] ?? 'The AI could not be reached.');
    res.json({ runs: done, errors, quota });
  } catch { fail(res, 500, 'AIVIS_FAILED', 'Something went wrong.'); }
});
