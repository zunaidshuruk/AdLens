import { Router, type Request, type Response } from 'express';
import { getServerConfig } from '../config.js';
import { buildFromRecord, getProviderStore, providerInputSchema, ProviderError, secretScope, validateCustomConfig, type ProviderDeps, type ProviderRecord } from '../lib/dataProviders.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { openAgentSecret, sealAgentSecret } from '../lib/tokenVault.js';
import { getAgentKeyring } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** Connect your own market-data provider (Sprint 45). One connection per workspace. */
export const dataProviderRouter = Router();
const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
const deps: { provider: ProviderDeps | undefined; now: () => number } = { provider: undefined, now: Date.now };
export function setDataProviderTestDeps(d: { provider?: ProviderDeps; now?: () => number } | null): void { deps.provider = d?.provider; deps.now = d?.now ?? Date.now; }

dataProviderRouter.use(requireUser);
dataProviderRouter.use(verifyGoogleSessionOwnership);
dataProviderRouter.use(loadProject);

async function scope(req: Request, res: Response, write: boolean): Promise<{ ws: string; uid: string } | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const uid = req.user!.uid;
  if (!ws || !can(ws, uid, write ? 'workspace.settings' : 'reports.view')) { fail(res, 403, 'NOT_ALLOWED', write ? 'Only owners and admins can connect a data provider.' : 'You do not have permission to see this.'); return null; }
  return { ws: project.workspaceId, uid };
}
const publicRecord = (r: ProviderRecord | null) => r ? { kind: r.kind, enabled: r.enabled, config: r.config, hasSecret: Boolean(r.sealedSecret), lastTestedAt: r.lastTestedAt, lastTestOk: r.lastTestOk, lastError: r.lastError, updatedAt: r.updatedAt } : null;

dataProviderRouter.get('/', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const canEdit = can((await getFirestoreStore().getWorkspace(s.ws))!, s.uid, 'workspace.settings');
    res.json({ provider: publicRecord(await getProviderStore().get(s.ws)), canEdit, vaultReady: getServerConfig().vaultReady });
  } catch { fail(res, 500, 'PROVIDER_FAILED', 'Something went wrong.'); }
});

dataProviderRouter.put('/', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!getServerConfig().vaultReady) return fail(res, 503, 'VAULT_NOT_READY', 'Secure storage is not set up on this server yet.');
    const parsed = providerInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the details and try again.');
    const input = parsed.data;
    const store = getProviderStore();
    const cur = await store.get(s.ws);
    if (input.kind === 'custom') { const msg = validateCustomConfig(input.config); if (msg) return fail(res, 400, 'INVALID_CONFIG', msg); }
    let secretJson: string;
    if (input.credentials) secretJson = JSON.stringify(input.credentials);
    else if (cur && cur.kind === input.kind) { try { secretJson = openAgentSecret(cur.sealedSecret, cur.createdBy, secretScope(s.ws), getAgentKeyring()); } catch { return fail(res, 422, 'SECRET_UNREADABLE', 'The saved sign-in details could not be read. Enter them again.'); } }
    else if (input.kind === 'custom' && input.config.auth.type === 'none') secretJson = '{}';
    else return fail(res, 400, 'CREDENTIALS_REQUIRED', 'Enter your sign-in details for the provider.');
    if (input.kind === 'dataforseo') { const c = JSON.parse(secretJson) as { login?: string; password?: string }; if (!c.login || !c.password) return fail(res, 400, 'CREDENTIALS_REQUIRED', 'Enter your DataForSEO login and password.'); }
    const now = new Date(deps.now()).toISOString();
    // Sealed to whoever saves it, so only this person's saved copy can be opened.
    const rec: ProviderRecord = {
      id: s.ws, kind: input.kind, enabled: input.enabled, config: input.kind === 'custom' ? input.config : null,
      sealedSecret: sealAgentSecret(secretJson, s.uid, secretScope(s.ws), getAgentKeyring()),
      createdBy: s.uid, createdAt: cur?.createdAt ?? now, updatedAt: now, lastTestedAt: null, lastTestOk: null, lastError: null,
    };
    await store.put(rec);
    res.json({ provider: publicRecord(rec) });
  } catch { fail(res, 500, 'PROVIDER_FAILED', 'Something went wrong.'); }
});

dataProviderRouter.delete('/', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    await getProviderStore().delete(s.ws);
    res.json({ ok: true });
  } catch { fail(res, 500, 'PROVIDER_FAILED', 'Something went wrong.'); }
});

// Tries each lookup once with a small, cheap example, so the owner sees what works before relying on it. Each lookup may cost a little on the provider's side.
dataProviderRouter.post('/test', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const rl = await checkRateLimit('provider-test', s.uid, 10, 3_600_000);
    if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', `You have tested a lot. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`);
    const store = getProviderStore();
    const rec = await store.get(s.ws);
    if (!rec) return fail(res, 404, 'NOT_CONNECTED', 'Connect a provider first.');
    let provider;
    try { provider = buildFromRecord(rec, JSON.parse(openAgentSecret(rec.sealedSecret, rec.createdBy, secretScope(s.ws), getAgentKeyring())), deps.provider); } catch { return fail(res, 422, 'SECRET_UNREADABLE', 'The saved sign-in details could not be read. Enter them again.'); }
    const checks: { name: string; ok: boolean; message: string }[] = [];
    const attempt = async (name: string, enabled: boolean, fn: () => Promise<string>) => {
      if (!enabled) { checks.push({ name, ok: false, message: 'Not set up.' }); return; }
      try { checks.push({ name, ok: true, message: await fn() }); } catch (e) { checks.push({ name, ok: false, message: e instanceof ProviderError ? e.message : 'Could not read the reply.' }); }
    };
    const cfg = rec.config;
    const has = (k: 'keywordMetrics' | 'competitorKeywords' | 'backlinks') => rec.kind === 'dataforseo' || Boolean(cfg?.[k]);
    await attempt('Keyword numbers', has('keywordMetrics'), async () => { const r = await provider.keywordMetrics(['coffee'], 'us'); if (!r.length) throw new ProviderError('The provider answered, but no numbers were found in the reply. Check the field names.'); const m = r[0]!; return `"${m.keyword}": ${m.volume ?? 'no'} searches a month${m.cpc != null ? `, about ${m.cpc} per click` : ''}.`; });
    await attempt('Competitor keywords', has('competitorKeywords'), async () => { const r = await provider.competitorKeywords('wikipedia.org', 'us'); if (!r.length) throw new ProviderError('The provider answered, but no keywords were found in the reply. Check the field names.'); return `${r.length} keywords found, for example "${r[0]!.keyword}".`; });
    await attempt('Backlinks', has('backlinks'), async () => { const r = await provider.backlinks('wikipedia.org'); if (!r) throw new ProviderError('The provider answered, but no backlink numbers were found in the reply. Check the field names.'); return `${r.referringDomains ?? 'unknown'} linking sites.`; });
    const ok = checks.some((c) => c.ok);
    const next = { ...rec, lastTestedAt: new Date(deps.now()).toISOString(), lastTestOk: ok, lastError: ok ? null : (checks.find((c) => c.message !== 'Not set up.')?.message ?? 'Nothing worked.') };
    await store.put(next);
    res.json({ ok, checks, provider: publicRecord(next) });
  } catch { fail(res, 500, 'PROVIDER_FAILED', 'Something went wrong while testing.'); }
});
