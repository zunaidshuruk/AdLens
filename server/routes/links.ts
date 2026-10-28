import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getContentLimits } from '../config/plans.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore, newDocId, type StoredDoc } from '../lib/projectDocs.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { fetchFollowing, fetchOnce, normaliseInputUrl, type PageFetcher } from '../lib/seoFetch.js';
import { analyzeHtml } from '../lib/seoPage.js';
import { SsrfError } from '../lib/ssrfGuard.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** Link building list (Sprint 41): sites you want a link from, where each one stands, and a check that a link is live. */
export const linksRouter = Router();

export const PROSPECT_STATUSES = ['new', 'contacted', 'replied', 'won', 'lost'] as const;
export interface LinkProspect {
  id: string; domain: string; pageUrl: string; targetUrl: string; status: (typeof PROSPECT_STATUSES)[number]; contactEmail: string; notes: string;
  linkLive: boolean | null; checkedAt: string | null; createdBy: string; createdAt: string; updatedAt: string;
}
const toProspect = (d: StoredDoc): LinkProspect => ({
  id: d.id, domain: String(d.domain ?? ''), pageUrl: String(d.pageUrl ?? ''), targetUrl: String(d.targetUrl ?? ''),
  status: (PROSPECT_STATUSES as readonly string[]).includes(String(d.status)) ? (d.status as LinkProspect['status']) : 'new',
  contactEmail: String(d.contactEmail ?? ''), notes: String(d.notes ?? ''), linkLive: typeof d.linkLive === 'boolean' ? d.linkLive : null,
  checkedAt: d.checkedAt ? String(d.checkedAt) : null, createdBy: String(d.createdBy ?? ''), createdAt: String(d.createdAt ?? ''), updatedAt: String(d.updatedAt ?? ''),
});

const deps: { fetcher: PageFetcher; now: () => number } = { fetcher: fetchOnce, now: Date.now };
export function setLinksTestDeps(d: Partial<typeof deps> | null): void { deps.fetcher = d?.fetcher ?? fetchOnce; deps.now = d?.now ?? Date.now; }

const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
linksRouter.use(requireUser);
linksRouter.use(verifyGoogleSessionOwnership);
linksRouter.use(loadProject);

interface Scope { plan: string | undefined; uid: string; ws: string; project: string; canEdit: boolean }
async function scope(req: Request, res: Response, write: boolean): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const uid = req.user!.uid;
  if (!ws || !can(ws, uid, write ? 'content.edit' : 'reports.view')) { fail(res, 403, 'NOT_ALLOWED', write ? 'You do not have permission to change the link list in this project.' : 'You do not have permission to see this project.'); return null; }
  return { plan: ws.plan, uid, ws: project.workspaceId, project: project.id, canEdit: can(ws, uid, 'content.edit') };
}
const idOk = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const hostKey = (h: string) => h.toLowerCase().replace(/^www\./, '');
function projectHosts(req: Request): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => { if (!v) return; try { out.add(hostKey(new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`).hostname)); } catch { /* ignore */ } };
  add(req.project?.domain);
  const sc = req.project?.searchConsoleSite;
  if (sc) add(sc.startsWith('sc-domain:') ? sc.slice('sc-domain:'.length) : sc);
  return [...out];
}
const cleanDomain = (v: string): string | null => {
  try { const h = hostKey(new URL(/^[a-z]+:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`).hostname); return h.includes('.') && h.length <= 100 ? h : null; } catch { return null; }
};

const fields = z.object({
  pageUrl: z.string().trim().max(500).default(''),
  targetUrl: z.string().trim().max(500).default(''),
  status: z.enum(PROSPECT_STATUSES).default('new'),
  contactEmail: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(1000).default(''),
});

linksRouter.get('/prospects', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const list = (await getProjectDocsStore().list(s.ws, s.project, 'linkProspects')).map(toProspect).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ prospects: list, limit: getContentLimits(s.plan).maxLinkProspects, canEdit: s.canEdit });
  } catch { fail(res, 500, 'LINKS_FAILED', 'Something went wrong.'); }
});

linksRouter.post('/prospects', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = z.object({ domains: z.array(z.string().max(300)).min(1, 'Add at least one site').max(200) }).and(fields.partial()).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the sites and try again.');
    const docs = getProjectDocsStore();
    const existing = (await docs.list(s.ws, s.project, 'linkProspects')).map(toProspect);
    const have = new Set(existing.map((p) => p.domain));
    const own = new Set(projectHosts(req));
    const fresh: string[] = [];
    for (const raw of parsed.data.domains) { const d = cleanDomain(raw); if (d && !have.has(d) && !own.has(d) && !fresh.includes(d)) fresh.push(d); }
    const limit = getContentLimits(s.plan).maxLinkProspects;
    if (existing.length + fresh.length > limit) return fail(res, 409, 'LIMIT_REACHED', `Your plan keeps up to ${limit} sites in the link list (${existing.length} used). Remove some or upgrade.`);
    const now = new Date(deps.now()).toISOString();
    const made: LinkProspect[] = [];
    for (const domain of fresh) {
      const doc = { id: newDocId(), domain, pageUrl: parsed.data.pageUrl ?? '', targetUrl: parsed.data.targetUrl ?? '', status: parsed.data.status ?? 'new', contactEmail: '', notes: parsed.data.notes ?? '', linkLive: null, checkedAt: null, createdBy: s.uid, createdAt: now, updatedAt: now };
      await docs.put(s.ws, s.project, 'linkProspects', doc);
      made.push(toProspect(doc));
    }
    res.status(201).json({ added: made.length, skipped: parsed.data.domains.length - made.length, prospects: made });
  } catch { fail(res, 500, 'LINKS_FAILED', 'Something went wrong.'); }
});

linksRouter.put('/prospects/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That site was not found.');
    const parsed = fields.partial().safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Check the details and try again.');
    const docs = getProjectDocsStore();
    const cur = await docs.get(s.ws, s.project, 'linkProspects', req.params.id!);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That site was not found.');
    const next = { ...cur, ...parsed.data, updatedAt: new Date(deps.now()).toISOString() };
    await docs.put(s.ws, s.project, 'linkProspects', next);
    res.json({ prospect: toProspect(next) });
  } catch { fail(res, 500, 'LINKS_FAILED', 'Something went wrong.'); }
});

linksRouter.delete('/prospects/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That site was not found.');
    if (!(await getProjectDocsStore().delete(s.ws, s.project, 'linkProspects', req.params.id!))) return fail(res, 404, 'NOT_FOUND', 'That site was not found.');
    res.json({ ok: true });
  } catch { fail(res, 500, 'LINKS_FAILED', 'Something went wrong.'); }
});

// Opens the page where the link should be and looks for a link to this project's website.
linksRouter.post('/prospects/:id/check', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That site was not found.');
    const r = await checkRateLimit('links-check', s.uid, 60, 3_600_000);
    if (!r.allowed) return fail(res, 429, 'RATE_LIMITED', `You have checked a lot of links. Try again in ${Math.ceil(r.retryAfterSeconds / 60)} minutes.`);
    const docs = getProjectDocsStore();
    const cur = await docs.get(s.ws, s.project, 'linkProspects', req.params.id!);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That site was not found.');
    const pageUrl = String(cur.pageUrl ?? '');
    if (!pageUrl) return fail(res, 409, 'NO_PAGE', 'Add the address of the page where your link should appear first.');
    const hosts = projectHosts(req);
    if (hosts.length === 0) return fail(res, 409, 'NO_SITE', 'Add your website address to the project first.');
    let start: URL;
    try { start = normaliseInputUrl(pageUrl); } catch (e) { return fail(res, 400, 'INVALID_URL', e instanceof SsrfError ? e.message : 'The page address is not valid.'); }
    const page = await fetchFollowing(start.toString(), deps.fetcher);
    if (page.error || page.status === 0) return fail(res, 502, 'FETCH_FAILED', page.error || 'The page could not be reached.');
    if (page.status >= 400) return fail(res, 422, 'PAGE_ERROR', `The page answered with an error (${page.status}).`);
    const facts = analyzeHtml(page.text, page.url, { status: page.status, contentType: page.contentType, xRobots: page.xRobots, ms: page.ms, bytes: page.bytes });
    const mine = facts.links.filter((l) => { try { return hosts.includes(hostKey(new URL(l.href).hostname)); } catch { return false; } });
    const next = { ...cur, linkLive: mine.length > 0, checkedAt: new Date(deps.now()).toISOString() };
    await docs.put(s.ws, s.project, 'linkProspects', next);
    res.json({ prospect: toProspect(next), links: mine.slice(0, 5).map((l) => ({ href: l.href, text: l.text, nofollow: l.nofollow })) });
  } catch { fail(res, 500, 'LINKS_FAILED', 'Something went wrong.'); }
});
