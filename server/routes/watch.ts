import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getContentLimits } from '../config/plans.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore, newDocId } from '../lib/projectDocs.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { fetchOnce, normaliseInputUrl, type PageFetcher } from '../lib/seoFetch.js';
import { SsrfError } from '../lib/ssrfGuard.js';
import { checkWatch, getWatchStore, removeWatchData, watchInputSchema, type WatchRecord } from '../lib/watches.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** EyeOn competitor watch (Sprint 43). */
export const watchRouter = Router();
const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
const deps: { fetcher: PageFetcher; now: () => number } = { fetcher: fetchOnce, now: Date.now };
export function setWatchTestDeps(d: Partial<typeof deps> | null): void { deps.fetcher = d?.fetcher ?? fetchOnce; deps.now = d?.now ?? Date.now; }

watchRouter.use(requireUser);
watchRouter.use(verifyGoogleSessionOwnership);
watchRouter.use(loadProject);

interface Scope { plan: string | undefined; uid: string; ws: string; project: string; canEdit: boolean }
async function scope(req: Request, res: Response, write: boolean): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const uid = req.user!.uid;
  if (!ws || !can(ws, uid, write ? 'content.edit' : 'reports.view')) { fail(res, 403, 'NOT_ALLOWED', write ? 'You do not have permission to change competitor watches in this project.' : 'You do not have permission to see this project.'); return null; }
  return { plan: ws.plan, uid, ws: project.workspaceId, project: project.id, canEdit: can(ws, uid, 'content.edit') };
}
const idOk = z.string().regex(/^[A-Za-z0-9_-]{1,60}$/);
const mine = async (s: Scope) => (await getWatchStore().listAll()).filter((w) => w.workspaceId === s.ws && w.projectId === s.project).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const urlMsg = (e: unknown) => (e instanceof SsrfError ? e.message : 'Enter a valid web address, for example competitor.com.');

watchRouter.get('/', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const events = (await getProjectDocsStore().list(s.ws, s.project, 'watchEvents'))
      .sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 150)
      .map((d) => ({ id: d.id, watchId: String(d.watchId), at: String(d.at), type: String(d.type), url: String(d.url ?? ''), detail: String(d.detail ?? '') }));
    res.json({ watches: await mine(s), events, limit: getContentLimits(s.plan).maxWatches, canEdit: s.canEdit });
  } catch { fail(res, 500, 'WATCH_FAILED', 'Something went wrong.'); }
});

watchRouter.post('/', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = watchInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the website and try again.');
    let host: string; let sitemapUrl: string | null = null; const pages: string[] = [];
    try {
      host = normaliseInputUrl(parsed.data.domain).hostname.toLowerCase();
      if (parsed.data.sitemapUrl) sitemapUrl = normaliseInputUrl(parsed.data.sitemapUrl).toString();
      for (const p of parsed.data.pages) pages.push(normaliseInputUrl(p).toString());
    } catch (e) { return fail(res, 400, 'INVALID_URL', urlMsg(e)); }
    const existing = await mine(s);
    if (existing.some((w) => w.domain === host)) return fail(res, 409, 'DUPLICATE', 'You are already watching that website.');
    const limit = getContentLimits(s.plan).maxWatches;
    if (existing.length >= limit) return fail(res, 409, 'LIMIT_REACHED', `Your plan allows ${limit} watched websites. Remove one or upgrade.`);
    const w: WatchRecord = { id: newDocId(), workspaceId: s.ws, projectId: s.project, domain: host, sitemapUrl, pages, enabled: true, createdBy: s.uid, createdAt: new Date(deps.now()).toISOString(), lastCheckedAt: null, lastError: null };
    await getWatchStore().put(w);
    res.status(201).json({ watch: w });
  } catch { fail(res, 500, 'WATCH_FAILED', 'Something went wrong.'); }
});

watchRouter.put('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success || !idOk.safeParse(req.params.id).success) return fail(res, 400, 'INVALID_REQUEST', 'Choose on or off.');
    const w = await getWatchStore().get(req.params.id!);
    if (!w || w.workspaceId !== s.ws || w.projectId !== s.project) return fail(res, 404, 'NOT_FOUND', 'That watch was not found.');
    const next = { ...w, enabled: parsed.data.enabled };
    await getWatchStore().put(next);
    res.json({ watch: next });
  } catch { fail(res, 500, 'WATCH_FAILED', 'Something went wrong.'); }
});

watchRouter.delete('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That watch was not found.');
    const w = await getWatchStore().get(req.params.id!);
    if (!w || w.workspaceId !== s.ws || w.projectId !== s.project) return fail(res, 404, 'NOT_FOUND', 'That watch was not found.');
    await getWatchStore().delete(w.id);
    await removeWatchData(getProjectDocsStore(), w);
    res.json({ ok: true });
  } catch { fail(res, 500, 'WATCH_FAILED', 'Something went wrong.'); }
});

watchRouter.post('/:id/check', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That watch was not found.');
    const w = await getWatchStore().get(req.params.id!);
    if (!w || w.workspaceId !== s.ws || w.projectId !== s.project) return fail(res, 404, 'NOT_FOUND', 'That watch was not found.');
    const rl = await checkRateLimit('watch-check', s.uid, 20, 3_600_000);
    if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', `You have checked a lot. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`);
    const r = await checkWatch({ docs: getProjectDocsStore(), fetcher: deps.fetcher, now: deps.now }, w);
    const next = { ...w, lastCheckedAt: new Date(deps.now()).toISOString(), lastError: r.error ?? null };
    await getWatchStore().put(next);
    if (r.error) return fail(res, 502, 'FETCH_FAILED', r.error);
    res.json({ result: r, watch: next });
  } catch { fail(res, 500, 'WATCH_FAILED', 'Something went wrong while checking.'); }
});
