import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getServerConfig, requireGoogleConfigured } from '../config.js';
import { getContentLimits } from '../config/plans.js';
import { createAgentProvider } from '../lib/agentProviders.js';
import { decryptPayload, encryptPayload } from '../lib/crypto.js';
import { createDataset } from '../lib/datasets.js';
import { accountOk, createLocalPost, defaultGbpDeps, fetchPerformance, GBP_SCOPE, GbpError, getGbpStore, listLocations, locationOk, openRefresh, performanceCsv, postInputSchema, replyInputSchema, replyPrompt, replyToReview, REPLY_SYSTEM, revokeToken, sealRefresh, exchangeCode, type GbpDeps, type GbpRecord, type ReviewItem } from '../lib/gbp.js';
import { accessTokenFor, syncReviews, toReviewItem } from '../lib/gbpRunner.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore, newDocId, type StoredDoc } from '../lib/projectDocs.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { getSessionCookieOptions, OAUTH_STATE_MAX_AGE_MS } from '../lib/session.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import { getAiRequest } from './ai.js';
import crypto from 'node:crypto';

/** Google Business Profile: connect, performance, reviews, replies and posts (Sprint 46c, 46d). */
export const gbpRouter = Router();
const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
const GBP_STATE_COOKIE = 'adlens_gbp_state';

export type DraftFn = (system: string, prompt: string, ctx: { ws: string }) => Promise<string>;
const deps: { gbp: GbpDeps; draft: DraftFn | null } = { gbp: defaultGbpDeps(), draft: null };
export function setGbpTestDeps(d: { gbp?: GbpDeps; draft?: DraftFn } | null): void { deps.gbp = d?.gbp ?? defaultGbpDeps(); deps.draft = d?.draft ?? null; }

const cred = () => { const c = getServerConfig(); return { clientId: c.googleClientId, clientSecret: c.googleClientSecret }; };
const redirectUri = () => `${getServerConfig().appBaseUrl}/api/gbp/callback`;
const decodeEmail = (idToken: string | null): string | null => { try { const p = JSON.parse(Buffer.from(idToken!.split('.')[1]!, 'base64url').toString('utf8')) as { email?: string }; return typeof p.email === 'string' ? p.email : null; } catch { return null; } };

type OAuthState = { state: string; uid: string; ws: string; email: string | null };
function readState(raw: string, key: string): OAuthState | null { try { return JSON.parse(decryptPayload(raw, key)) as OAuthState; } catch { return null; } }

// The browser comes back from Google here, with no Authorization header: the signed state cookie proves who started it.
gbpRouter.get('/callback', requireGoogleConfigured, async (req: Request, res: Response) => {
  const cfg = getServerConfig();
  res.clearCookie(GBP_STATE_COOKIE, { httpOnly: true, secure: cfg.isProduction, sameSite: 'lax', path: '/' });
  const go = (q: string) => res.redirect(`/connections?${q}#gbp`);
  try {
    if (typeof req.query.error === 'string') return go('gbp=denied');
    const st = readState(String(req.cookies?.[GBP_STATE_COOKIE] ?? ''), cfg.tokenEncryptionKey);
    if (!st || typeof req.query.state !== 'string' || req.query.state !== st.state) return go('gbp=invalid_state');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return go('gbp=failed');
    const ws = await getFirestoreStore().getWorkspace(st.ws);
    if (!ws || !can(ws, st.uid, 'workspace.settings')) return go('gbp=not_allowed');
    if (!cfg.vaultReady) return go('gbp=vault');
    const t = await exchangeCode(deps.gbp, { code, ...cred(), redirectUri: redirectUri() });
    const store = getGbpStore();
    const cur = await store.get(st.ws);
    let refresh = t.refreshToken;
    if (!refresh && cur) { try { refresh = openRefresh(cur); } catch { refresh = null; } }
    if (!refresh) return go('gbp=no_refresh');
    const now = new Date(deps.gbp.now()).toISOString();
    let rec: GbpRecord = { id: st.ws, sealedRefresh: sealRefresh(refresh, st.uid, st.ws), googleEmail: decodeEmail(t.idToken), connectedBy: st.uid, connectedByEmail: st.email, connectedAt: now, locations: cur?.locations ?? [], links: cur?.links ?? {}, lastError: null, lastRunAt: cur?.lastRunAt ?? null };
    let outcome = 'connected';
    if (t.accessToken) {
      try { rec = { ...rec, locations: await listLocations(deps.gbp, t.accessToken) }; } catch (e) { rec = { ...rec, lastError: e instanceof GbpError ? e.message : 'Could not list locations.' }; outcome = e instanceof GbpError && e.code === 'GBP_NOT_APPROVED' ? 'pending_approval' : 'connected'; }
    }
    await store.put(rec);
    return go(`gbp=${outcome}`);
  } catch { return go('gbp=failed'); }
});

gbpRouter.use(requireUser);
gbpRouter.use(verifyGoogleSessionOwnership);
gbpRouter.use(loadProject);

interface Scope { plan: string | undefined; uid: string; email: string | null; ws: string; project: string; canEdit: boolean; canAdmin: boolean; canAi: boolean }
async function scope(req: Request, res: Response, need: 'view' | 'edit' | 'admin'): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const uid = req.user!.uid;
  const perm = need === 'admin' ? 'workspace.settings' : need === 'edit' ? 'content.edit' : 'reports.view';
  if (!ws || !can(ws, uid, perm)) { fail(res, 403, 'NOT_ALLOWED', need === 'admin' ? 'Only owners and admins can connect Google Business Profile.' : need === 'edit' ? 'You do not have permission to change this in this project.' : 'You do not have permission to see this project.'); return null; }
  return { plan: ws.plan, uid, email: req.user!.email ?? null, ws: project.workspaceId, project: project.id, canEdit: can(ws, uid, 'content.edit'), canAdmin: can(ws, uid, 'workspace.settings'), canAi: can(ws, uid, 'ai.use') };
}
const wrap = (code: string, fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
  try { await fn(req, res); } catch (e) { if (e instanceof GbpError) fail(res, e.status === 401 ? 409 : e.status >= 500 ? 502 : e.status, e.code, e.message); else fail(res, 500, code, 'Something went wrong.'); }
};
const idOk = z.string().regex(/^[A-Za-z0-9_-]{1,60}$/);

interface Linked { rec: GbpRecord; account: string; location: string; title: string; token: string }
async function linked(s: Scope, res: Response): Promise<Linked | null> {
  const rec = await getGbpStore().get(s.ws);
  if (!rec) { fail(res, 404, 'GBP_NOT_CONNECTED', 'Connect Google Business Profile first.'); return null; }
  const link = rec.links[s.project];
  if (!link) { fail(res, 404, 'GBP_NOT_LINKED', 'Choose which business location belongs to this project first.'); return null; }
  return { rec, account: link.account, location: link.location, title: link.title, token: await accessTokenFor(deps.gbp, rec, cred()) };
}

gbpRouter.get('/', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'view'); if (!s) return;
  const rec = await getGbpStore().get(s.ws);
  const cfg = getServerConfig();
  res.json({
    googleConfigured: cfg.googleConfigured, vaultReady: cfg.vaultReady, canAdmin: s.canAdmin, canEdit: s.canEdit, canAi: s.canAi, redirectUri: redirectUri(),
    connected: Boolean(rec), googleEmail: rec?.googleEmail ?? null, lastError: rec?.lastError ?? null, lastRunAt: rec?.lastRunAt ?? null,
    locations: rec?.locations ?? [], link: rec?.links[s.project] ?? null,
  });
}));

gbpRouter.post('/start', requireGoogleConfigured, wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'admin'); if (!s) return;
  const cfg = getServerConfig();
  if (!cfg.vaultReady) return fail(res, 503, 'VAULT_NOT_READY', 'Secure storage is not set up on this server yet.');
  const state = crypto.randomBytes(24).toString('base64url');
  res.cookie(GBP_STATE_COOKIE, encryptPayload(JSON.stringify({ state, uid: s.uid, ws: s.ws, email: s.email }), cfg.tokenEncryptionKey), getSessionCookieOptions(OAUTH_STATE_MAX_AGE_MS));
  const params = new URLSearchParams({ client_id: cfg.googleClientId, redirect_uri: redirectUri(), response_type: 'code', scope: `openid email ${GBP_SCOPE}`, access_type: 'offline', prompt: 'consent', state });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
}));

gbpRouter.post('/disconnect', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'admin'); if (!s) return;
  const rec = await getGbpStore().get(s.ws);
  if (rec) { try { await revokeToken(deps.gbp, openRefresh(rec)); } catch { /* best effort */ } await getGbpStore().delete(s.ws); }
  res.json({ ok: true });
}));

gbpRouter.post('/locations/refresh', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'admin'); if (!s) return;
  const rec = await getGbpStore().get(s.ws);
  if (!rec) return fail(res, 404, 'GBP_NOT_CONNECTED', 'Connect Google Business Profile first.');
  const token = await accessTokenFor(deps.gbp, rec, cred());
  try { const locations = await listLocations(deps.gbp, token); await getGbpStore().put({ ...rec, locations, lastError: null }); res.json({ locations }); }
  catch (e) { if (e instanceof GbpError) await getGbpStore().put({ ...rec, lastError: e.message }); throw e; }
}));

gbpRouter.put('/link', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'admin'); if (!s) return;
  const rec = await getGbpStore().get(s.ws);
  if (!rec) return fail(res, 404, 'GBP_NOT_CONNECTED', 'Connect Google Business Profile first.');
  const parsed = z.object({ location: z.string().refine(locationOk).nullable() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Choose a location.');
  const links = { ...rec.links };
  if (parsed.data.location === null) delete links[s.project];
  else { const l = rec.locations.find((x) => x.name === parsed.data.location); if (!l || !accountOk(l.account)) return fail(res, 404, 'NOT_FOUND', 'That location is not in your list. Refresh the list first.'); links[s.project] = { account: l.account, location: l.name, title: l.title }; }
  await getGbpStore().put({ ...rec, links });
  res.json({ link: links[s.project] ?? null });
}));

gbpRouter.get('/performance', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'view'); if (!s) return;
  const days = [7, 28, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
  const l = await linked(s, res); if (!l) return;
  res.json({ title: l.title, ...(await fetchPerformance(deps.gbp, l.token, l.location, days)) });
}));

// Save the daily numbers as an uploaded table, so dashboards and reports can use them.
gbpRouter.post('/performance/save-table', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'edit'); if (!s) return;
  const l = await linked(s, res); if (!l) return;
  const p = await fetchPerformance(deps.gbp, l.token, l.location, 90);
  const ds = await createDataset(getProjectDocsStore(), s.ws, s.project, s.uid, { name: `Google Business Profile: ${l.title || 'location'}`.slice(0, 80), csv: performanceCsv(p) }, getContentLimits(s.plan).maxDatasets);
  res.status(201).json({ datasetId: ds.id, name: ds.name, rows: ds.rowCount });
}));

const itemsOf = async (s: Scope) => (await getProjectDocsStore().list(s.ws, s.project, 'reviewItems')).map(toReviewItem).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

gbpRouter.get('/reviews', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'view'); if (!s) return;
  const l = await linked(s, res); if (!l) return;
  const rl = await checkRateLimit('gbp-reviews', s.ws, 60, 3_600_000);
  if (!rl.allowed) { res.json({ items: await itemsOf(s), averageRating: null, total: null, stale: true }); return; }
  const r = await syncReviews({ deps: deps.gbp, docs: getProjectDocsStore(), token: l.token, ws: s.ws, project: s.project, account: l.account, location: l.location });
  res.json({ items: r.items, averageRating: r.averageRating, total: r.total, stale: false });
}));

const getItem = async (s: Scope, id: string): Promise<ReviewItem | null> => { const d = await getProjectDocsStore().get(s.ws, s.project, 'reviewItems', id); return d ? toReviewItem(d) : null; };
const putItem = (s: Scope, it: ReviewItem) => getProjectDocsStore().put(s.ws, s.project, 'reviewItems', it as unknown as StoredDoc);

/** AI writes a first draft. Nothing is sent to Google: a person must read, edit and approve it. */
gbpRouter.post('/reviews/:id/draft', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'edit'); if (!s) return;
  if (!s.canAi) return fail(res, 403, 'NOT_ALLOWED', 'Your role in this workspace does not allow using the AI.');
  const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid review.');
  const it = await getItem(s, id.data); if (!it) return fail(res, 404, 'NOT_FOUND', 'That review was not found. Refresh the list.');
  if (it.replied) return fail(res, 409, 'ALREADY_REPLIED', 'This review already has a reply.');
  const rl = await checkRateLimit('gbp-draft', s.uid, 40, 3_600_000);
  if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', 'You have drafted a lot of replies. Try again in a while.');
  const rec = await getGbpStore().get(s.ws); const title = rec?.links[s.project]?.title || req.project!.name;
  const prompt = replyPrompt(it, title);
  let text: string;
  if (deps.draft) text = await deps.draft(REPLY_SYSTEM, prompt, { ws: s.ws });
  else {
    const cfg = getServerConfig();
    const keys = [cfg.geminiApiKey, cfg.geminiApiKey2].filter((k): k is string => Boolean(k));
    if (keys.length === 0 || !cfg.geminiModel) return fail(res, 503, 'CLOUD_NOT_CONFIGURED', 'The built-in AI is not set up on this server yet. You can still write the reply yourself.');
    const store = getFirestoreStore();
    const q = await store.consumeAiQuota(s.ws);
    if (!q.ok) return fail(res, 429, 'QUOTA_EXCEEDED', "You've used all AI questions for this month. You can still write the reply yourself.");
    try {
      const provider = createAgentProvider({ kind: 'gemini', model: cfg.geminiModel, apiKey: keys[0]!, agent: { id: 'review-reply', name: 'Review reply' }, temperature: 0.6 }, { request: getAiRequest() });
      text = (await provider.complete({ systemPrompt: REPLY_SYSTEM, messages: [{ role: 'user', content: prompt }], tools: [] })).text;
    } catch { await store.refundAiQuota(s.ws); return fail(res, 502, 'AI_FAILED', 'The AI could not be reached. You can still write the reply yourself.'); }
  }
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1500);
  if (!text) return fail(res, 502, 'AI_FAILED', 'The AI did not write a reply. Try again or write it yourself.');
  await putItem(s, { ...it, draft: text, status: 'drafted' });
  res.json({ draft: text });
}));

gbpRouter.put('/reviews/:id/draft', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'edit'); if (!s) return;
  const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid review.');
  const it = await getItem(s, id.data); if (!it) return fail(res, 404, 'NOT_FOUND', 'That review was not found.');
  const body = z.object({ text: z.string().max(4000) }).safeParse(req.body); if (!body.success) return fail(res, 400, 'INVALID_REQUEST', 'Replies can be up to 4,000 characters.');
  await putItem(s, { ...it, draft: body.data.text.trim(), status: it.replied ? 'replied' : body.data.text.trim() ? 'drafted' : 'new' });
  res.json({ ok: true });
}));

/** The only way a reply reaches Google: a person presses approve, and the exact text they send is what is posted. */
gbpRouter.post('/reviews/:id/approve', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'edit'); if (!s) return;
  const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid review.');
  const body = replyInputSchema.safeParse(req.body); if (!body.success) return fail(res, 400, 'INVALID_REQUEST', body.error.issues[0]?.message || 'Write the reply first.');
  const it = await getItem(s, id.data); if (!it) return fail(res, 404, 'NOT_FOUND', 'That review was not found. Refresh the list.');
  if (it.replied) return fail(res, 409, 'ALREADY_REPLIED', 'This review already has a reply.');
  const l = await linked(s, res); if (!l) return;
  await replyToReview(deps.gbp, l.token, l.account, l.location, it.reviewId, body.data.text);
  await putItem(s, { ...it, replied: true, replyText: body.data.text, draft: body.data.text, status: 'replied' });
  res.json({ ok: true });
}));

gbpRouter.post('/reviews/:id/dismiss', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'edit'); if (!s) return;
  const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid review.');
  const it = await getItem(s, id.data); if (!it) return fail(res, 404, 'NOT_FOUND', 'That review was not found.');
  await putItem(s, { ...it, status: it.replied ? 'replied' : 'dismissed' });
  res.json({ ok: true });
}));

// Posts
gbpRouter.get('/posts', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'view'); if (!s) return;
  const posts = (await getProjectDocsStore().list(s.ws, s.project, 'gbpPosts')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 60)
    .map((d) => ({ id: d.id, text: String(d.text ?? ''), url: String(d.url ?? ''), publishOn: String(d.publishOn ?? ''), status: String(d.status ?? 'scheduled'), error: String(d.error ?? ''), publishedAt: String(d.publishedAt ?? ''), createdAt: String(d.createdAt ?? '') }));
  res.json({ posts });
}));

gbpRouter.post('/posts', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'edit'); if (!s) return;
  const parsed = postInputSchema.safeParse(req.body); if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the post and try again.');
  if (parsed.data.url) { try { const u = new URL(parsed.data.url); if (u.protocol !== 'https:') throw new Error('x'); } catch { return fail(res, 400, 'INVALID_URL', 'The link must be a full https address.'); } }
  const l = await linked(s, res); if (!l) return;
  const docs = getProjectDocsStore();
  const now = new Date(deps.gbp.now()).toISOString();
  const today = now.slice(0, 10);
  const base = { id: newDocId(), text: parsed.data.text, url: parsed.data.url, createdAt: now, error: '', publishedAt: '' };
  if (!parsed.data.publishOn || parsed.data.publishOn <= today) {
    await createLocalPost(deps.gbp, l.token, l.account, l.location, { summary: parsed.data.text, ...(parsed.data.url ? { url: parsed.data.url } : {}) });
    await docs.put(s.ws, s.project, 'gbpPosts', { ...base, publishOn: today, status: 'published', publishedAt: now });
    res.status(201).json({ id: base.id, status: 'published' }); return;
  }
  if ((await docs.list(s.ws, s.project, 'gbpPosts')).filter((p) => p.status === 'scheduled').length >= 30) return fail(res, 409, 'LIMIT_REACHED', 'You have 30 posts waiting. Remove one first.');
  await docs.put(s.ws, s.project, 'gbpPosts', { ...base, publishOn: parsed.data.publishOn, status: 'scheduled' });
  res.status(201).json({ id: base.id, status: 'scheduled' });
}));

gbpRouter.delete('/posts/:id', wrap('GBP_FAILED', async (req, res) => {
  const s = await scope(req, res, 'edit'); if (!s) return;
  const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid post.');
  const d = await getProjectDocsStore().get(s.ws, s.project, 'gbpPosts', id.data);
  if (!d) return fail(res, 404, 'NOT_FOUND', 'That post was not found.');
  if (d.status === 'published') return fail(res, 409, 'PUBLISHED', 'This post is already live on Google. Remove it in Google Business Profile.');
  await getProjectDocsStore().delete(s.ws, s.project, 'gbpPosts', id.data);
  res.json({ ok: true });
}));
