import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getContentLimits } from '../config/plans.js';
import { requireGoogleConfigured } from '../config.js';
import { GoogleApiError } from '../lib/google.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore, newDocId } from '../lib/projectDocs.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import {
  clusterKeywords, getRankTrackingStore, joinTraffic, lastCompleteDay, listInputSchema, loadDays, loadLists, parseKeywords,
  refreshProject, summariseRank, toList, trackedKeywords, trackingId, MAX_KEYWORDS_PER_LIST, type ScQuery,
} from '../lib/rankTracking.js';
import { callSearchConsoleQuery } from '../lib/searchConsoleApi.js';
import { buildReportContext } from '../lib/reportContext.js';
import { mapVaultError } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import { ga4ExploreReport, searchConsoleExploreReport } from '../reports/exploreReports.js';

/** Rank tracking, keyword lists and organic traffic insights (Sprint 39). */
export const rankRouter = Router();

const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
const deps: { now: () => number; query: ((req: Request) => Promise<ScQuery>) | null } = { now: Date.now, query: null };
export function setRankTestDeps(d: Partial<{ now: () => number; query: ((req: Request) => Promise<ScQuery>) | null }> | null): void {
  deps.now = d?.now ?? Date.now; deps.query = d?.query ?? null;
}

rankRouter.use(requireUser);
rankRouter.use(verifyGoogleSessionOwnership);
rankRouter.use(loadProject);

interface Scope { plan: string | undefined; uid: string; ws: string; project: string; canEdit: boolean }
async function scope(req: Request, res: Response, write: boolean): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const uid = req.user!.uid;
  if (!ws || !can(ws, uid, write ? 'content.edit' : 'reports.view')) { fail(res, 403, 'NOT_ALLOWED', write ? 'You do not have permission to change keyword lists in this project.' : 'You do not have permission to see this project.'); return null; }
  return { plan: ws.plan, uid, ws: project.workspaceId, project: project.id, canEdit: can(ws, uid, 'content.edit') };
}
async function limited(res: Response, uid: string, name: string, limit: number, windowMs: number): Promise<boolean> {
  const r = await checkRateLimit(`rank-${name}`, uid, limit, windowMs);
  if (r.allowed) return false;
  fail(res, 429, 'RATE_LIMITED', `You have used this a lot. Try again in ${Math.ceil(r.retryAfterSeconds / 60)} minutes.`);
  return true;
}
function mapErr(res: Response, err: unknown): void {
  const mapped = mapVaultError(err) ?? (err instanceof GoogleApiError ? err : null);
  if (mapped) return fail(res, mapped.status, mapped.code, mapped.message);
  fail(res, 502, 'RANK_FAILED', 'Could not read your Search Console data right now.');
}
const scQueryFor = async (req: Request): Promise<ScQuery> => {
  if (deps.query) return deps.query(req);
  const token = await buildReportContext(req.user!.uid, req.project).getAccessToken();
  const site = req.project!.searchConsoleSite!;
  return (payload) => callSearchConsoleQuery(site, token, payload);
};

rankRouter.use(requireGoogleConfigured);

const idOk = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

async function settingsFor(s: Scope) {
  return getRankTrackingStore().get(trackingId(s.ws, s.project));
}

rankRouter.get('/lists', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const lim = getContentLimits(s.plan);
    const lists = await loadLists(getProjectDocsStore(), s.ws, s.project);
    const st = await settingsFor(s);
    res.json({ lists, limits: { lists: lim.maxKeywordLists, tracked: lim.maxTrackedKeywords }, trackedCount: trackedKeywords(lists).length, tracking: st ? { enabled: st.enabled, refreshedAt: st.refreshedAt, pausedReason: st.pausedReason } : null, canEdit: s.canEdit });
  } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});

async function saveList(req: Request, res: Response, existingId: string | null): Promise<void> {
  const s = await scope(req, res, true); if (!s) return;
  const parsed = listInputSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the list and try again.');
  const keywords = parseKeywords([...parsed.data.keywords, parsed.data.text ?? ''].join('\n'));
  const lim = getContentLimits(s.plan);
  const docs = getProjectDocsStore();
  const lists = await loadLists(docs, s.ws, s.project);
  if (!existingId && lists.length >= lim.maxKeywordLists) return fail(res, 409, 'LIMIT_REACHED', `Your plan allows ${lim.maxKeywordLists} keyword list${lim.maxKeywordLists === 1 ? '' : 's'}. Delete one or upgrade to add more.`);
  const before = existingId ? lists.find((l) => l.id === existingId) : undefined;
  if (existingId && !before) return fail(res, 404, 'NOT_FOUND', 'That list was not found.');
  const others = lists.filter((l) => l.id !== existingId);
  const nextTracked = trackedKeywords([...others, { ...(before ?? { id: 'new', createdBy: s.uid, createdAt: '', updatedAt: '' }), name: parsed.data.name, keywords, tracked: parsed.data.tracked }]).length;
  const nowTracked = trackedKeywords(lists).length;
  if (nextTracked > lim.maxTrackedKeywords && nextTracked > nowTracked) return fail(res, 409, 'LIMIT_REACHED', `Your plan tracks up to ${lim.maxTrackedKeywords} keywords every day. This would make ${nextTracked}. Remove some, untick "track daily" for this list, or upgrade.`);
  const now = new Date(deps.now()).toISOString();
  const doc = { id: existingId ?? newDocId(), name: parsed.data.name, keywords, tracked: parsed.data.tracked, createdBy: before?.createdBy ?? s.uid, createdAt: before?.createdAt || now, updatedAt: now };
  await docs.put(s.ws, s.project, 'keywordLists', doc);
  res.status(existingId ? 200 : 201).json({ list: toList(doc), capped: keywords.length >= MAX_KEYWORDS_PER_LIST });
}
rankRouter.post('/lists', async (req, res) => { try { await saveList(req, res, null); } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); } });
rankRouter.put('/lists/:id', async (req, res) => {
  try { if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That list was not found.'); await saveList(req, res, req.params.id!); } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});
rankRouter.delete('/lists/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That list was not found.');
    const ok = await getProjectDocsStore().delete(s.ws, s.project, 'keywordLists', req.params.id!);
    if (!ok) return fail(res, 404, 'NOT_FOUND', 'That list was not found.');
    res.json({ ok: true });
  } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});

rankRouter.post('/cluster', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const parsed = z.object({ text: z.string().max(60_000).optional(), keywords: z.array(z.string().max(120)).max(1000).default([]) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Send some keywords to group.');
    const list = parseKeywords([...parsed.data.keywords, parsed.data.text ?? ''].join('\n'), 1000);
    res.json({ clusters: clusterKeywords(list) });
  } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});

rankRouter.post('/tracking/start', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!req.project?.searchConsoleSite) return fail(res, 409, 'SC_NOT_SELECTED', 'Choose a Search Console site on the Connections page first.');
    if (await limited(res, s.uid, 'start', 6, 3_600_000)) return;
    const lists = await loadLists(getProjectDocsStore(), s.ws, s.project);
    if (trackedKeywords(lists).length === 0) return fail(res, 409, 'NO_KEYWORDS', 'Add a keyword list with "track daily" ticked first.');
    let result: { days: number; tracked: number };
    try { result = await refreshProject({ docs: getProjectDocsStore(), query: await scQueryFor(req), now: deps.now }, s.ws, s.project, 90); } catch (e) { return mapErr(res, e); }
    const now = new Date(deps.now()).toISOString();
    await getRankTrackingStore().put({ id: trackingId(s.ws, s.project), workspaceId: s.ws, projectId: s.project, ownerUid: s.uid, enabled: true, refreshedAt: now, pausedReason: null });
    res.json({ ...result, refreshedAt: now });
  } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});
rankRouter.post('/tracking/stop', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const st = await settingsFor(s);
    if (st) await getRankTrackingStore().put({ ...st, enabled: false, pausedReason: null });
    res.json({ ok: true });
  } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});
rankRouter.post('/refresh', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!req.project?.searchConsoleSite) return fail(res, 409, 'SC_NOT_SELECTED', 'Choose a Search Console site on the Connections page first.');
    if (await limited(res, s.uid, 'refresh', 6, 3_600_000)) return;
    let result: { days: number; tracked: number };
    try { result = await refreshProject({ docs: getProjectDocsStore(), query: await scQueryFor(req), now: deps.now }, s.ws, s.project, 10); } catch (e) { return mapErr(res, e); }
    const st = await settingsFor(s);
    const now = new Date(deps.now()).toISOString();
    if (st) await getRankTrackingStore().put({ ...st, refreshedAt: now });
    res.json({ ...result, refreshedAt: now });
  } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});

rankRouter.get('/history', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const days = req.query.days === '90' ? 90 : 28;
    const docs = getProjectDocsStore();
    const lists = await loadLists(docs, s.ws, s.project);
    const tracked = trackedKeywords(lists);
    const all = await loadDays(docs, s.ws, s.project);
    const summary = summariseRank(all.filter((d) => d.id >= new Date(Date.parse(lastCompleteDay(deps.now())) - (days + 14) * 86_400_000).toISOString().slice(0, 10)), tracked);
    const st = await settingsFor(s);
    res.json({ days, summary: { ...summary, series: summary.series.slice(-days) }, tracking: st ? { enabled: st.enabled, refreshedAt: st.refreshedAt, pausedReason: st.pausedReason } : null, daysStored: all.length });
  } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});

rankRouter.post('/traffic', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    if (!req.project?.searchConsoleSite) return fail(res, 409, 'SC_NOT_SELECTED', 'Choose a Search Console site on the Connections page first.');
    if (!req.project.ga4PropertyId) return fail(res, 409, 'GA4_NOT_SELECTED', 'Choose a Google Analytics property on the Connections page first.');
    if (await limited(res, s.uid, 'traffic', 20, 3_600_000)) return;
    const end = new Date(deps.now() - 3 * 86_400_000);
    const start = new Date(end.getTime() - 27 * 86_400_000);
    const range = { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
    const ctx = buildReportContext(s.uid, req.project);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    try {
      const [ga, pages, pq] = await Promise.all([
        ga4ExploreReport.run(ctx, { ...range, dimensions: ['landingPagePlusQueryString'], metrics: ['sessions'], filters: [{ field: 'sessionDefaultChannelGroup', op: 'equals', value: 'Organic Search' }], limit: 1000, orderBy: { field: 'sessions', desc: true } }),
        searchConsoleExploreReport.run(ctx, { ...range, dimensions: ['page'], metrics: ['clicks', 'impressions', 'position'], filters: [], limit: 1000, orderBy: { field: 'clicks', desc: true } }),
        searchConsoleExploreReport.run(ctx, { ...range, dimensions: ['page', 'query'], metrics: ['clicks'], filters: [], limit: 1000, orderBy: { field: 'clicks', desc: true } }),
      ]);
      const rows = joinTraffic(
        ga.rows.map((r) => ({ page: String(r.landingPagePlusQueryString ?? ''), sessions: num(r.sessions) })),
        pages.rows.map((r) => ({ page: String(r.page ?? ''), clicks: num(r.clicks), impressions: num(r.impressions), position: num(r.position) })),
        pq.rows.map((r) => ({ page: String(r.page ?? ''), query: String(r.query ?? ''), clicks: num(r.clicks) })),
      );
      const hidden = rows.reduce((a, r) => a + r.hiddenClicks, 0);
      const clicks = rows.reduce((a, r) => a + r.clicks, 0);
      res.json({ ...range, rows, totals: { sessions: rows.reduce((a, r) => a + r.sessions, 0), clicks, hiddenClicks: hidden, hiddenShare: clicks ? Math.round((hidden / clicks) * 1000) / 10 : 0 } });
    } catch (e) { return mapErr(res, e); }
  } catch { fail(res, 500, 'RANK_FAILED', 'Something went wrong.'); }
});
