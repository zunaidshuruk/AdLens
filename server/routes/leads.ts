import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getContentLimits } from '../config/plans.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore, newDocId, type StoredDoc } from '../lib/projectDocs.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { fetchFollowing, fetchOnce, normaliseInputUrl, type PageFetcher } from '../lib/seoFetch.js';
import { analyzeHtml, pageIssues, scoreFor } from '../lib/seoPage.js';
import { SsrfError } from '../lib/ssrfGuard.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** Simple lead list for agencies (Sprint 44): who you are talking to, where each deal stands, and a quick website check to open the conversation. */
export const leadsRouter = Router();

export const LEAD_STATUSES = ['new', 'contacted', 'meeting', 'proposal', 'won', 'lost'] as const;
export interface LeadAudit { url: string; score: number; at: string; issues: { title: string; severity: string }[] }
export interface Lead {
  id: string; name: string; website: string; email: string; phone: string; status: (typeof LEAD_STATUSES)[number]; value: number; followUp: string; notes: string;
  audit: LeadAudit | null; createdBy: string; createdAt: string; updatedAt: string;
}
const toLead = (d: StoredDoc): Lead => {
  const a = d.audit as Partial<LeadAudit> | null | undefined;
  return {
    id: d.id, name: String(d.name ?? ''), website: String(d.website ?? ''), email: String(d.email ?? ''), phone: String(d.phone ?? ''),
    status: (LEAD_STATUSES as readonly string[]).includes(String(d.status)) ? (d.status as Lead['status']) : 'new',
    value: typeof d.value === 'number' && Number.isFinite(d.value) ? d.value : 0, followUp: String(d.followUp ?? ''), notes: String(d.notes ?? ''),
    audit: a && typeof a.score === 'number' ? { url: String(a.url ?? ''), score: a.score, at: String(a.at ?? ''), issues: Array.isArray(a.issues) ? a.issues.slice(0, 8).map((i) => ({ title: String((i as { title?: unknown }).title ?? ''), severity: String((i as { severity?: unknown }).severity ?? '') })) : [] } : null,
    createdBy: String(d.createdBy ?? ''), createdAt: String(d.createdAt ?? ''), updatedAt: String(d.updatedAt ?? ''),
  };
};

const deps: { fetcher: PageFetcher; now: () => number } = { fetcher: fetchOnce, now: Date.now };
export function setLeadsTestDeps(d: Partial<typeof deps> | null): void { deps.fetcher = d?.fetcher ?? fetchOnce; deps.now = d?.now ?? Date.now; }

const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
leadsRouter.use(requireUser);
leadsRouter.use(verifyGoogleSessionOwnership);
leadsRouter.use(loadProject);

interface Scope { plan: string | undefined; uid: string; ws: string; project: string; canEdit: boolean }
async function scope(req: Request, res: Response, write: boolean): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const uid = req.user!.uid;
  if (!ws || !can(ws, uid, write ? 'content.edit' : 'reports.view')) { fail(res, 403, 'NOT_ALLOWED', write ? 'You do not have permission to change the lead list in this project.' : 'You do not have permission to see this project.'); return null; }
  return { plan: ws.plan, uid, ws: project.workspaceId, project: project.id, canEdit: can(ws, uid, 'content.edit') };
}
const idOk = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const fields = z.object({
  name: z.string().trim().min(1, 'Type a name for the lead').max(100),
  website: z.string().trim().max(200).default(''),
  email: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).default(''),
  status: z.enum(LEAD_STATUSES).default('new'),
  value: z.number().finite().min(0).max(1_000_000_000).default(0),
  followUp: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a date like 2026-11-30').default(''),
  notes: z.string().trim().max(2000).default(''),
});

// Edits send only what changed. (Zod 4 fills defaults even inside .partial(), which would wipe the other fields, so this schema has none.)
const patchFields = z.object({
  name: z.string().trim().min(1, 'Type a name for the lead').max(100), website: z.string().trim().max(200), email: z.string().trim().max(120), phone: z.string().trim().max(40),
  status: z.enum(LEAD_STATUSES), value: z.number().finite().min(0).max(1_000_000_000), followUp: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a date like 2026-11-30'), notes: z.string().trim().max(2000),
}).partial();

leadsRouter.get('/', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const leads = (await getProjectDocsStore().list(s.ws, s.project, 'leads')).map(toLead).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ leads, limit: getContentLimits(s.plan).maxLeads, canEdit: s.canEdit });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});

leadsRouter.post('/', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = fields.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the details and try again.');
    const docs = getProjectDocsStore();
    const existing = await docs.list(s.ws, s.project, 'leads');
    const limit = getContentLimits(s.plan).maxLeads;
    if (existing.length >= limit) return fail(res, 409, 'LIMIT_REACHED', `Your plan keeps up to ${limit} leads (${existing.length} used). Remove some or upgrade.`);
    const now = new Date(deps.now()).toISOString();
    const doc = { id: newDocId(), ...parsed.data, audit: null, createdBy: s.uid, createdAt: now, updatedAt: now };
    await docs.put(s.ws, s.project, 'leads', doc);
    res.status(201).json({ lead: toLead(doc) });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});

leadsRouter.put('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That lead was not found.');
    const parsed = patchFields.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the details and try again.');
    const docs = getProjectDocsStore();
    const cur = await docs.get(s.ws, s.project, 'leads', req.params.id!);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That lead was not found.');
    // A new website means the old check no longer describes it.
    const next = { ...cur, ...parsed.data, ...(parsed.data.website !== undefined && parsed.data.website !== cur.website ? { audit: null } : {}), updatedAt: new Date(deps.now()).toISOString() };
    await docs.put(s.ws, s.project, 'leads', next);
    res.json({ lead: toLead(next) });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});

leadsRouter.delete('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That lead was not found.');
    if (!(await getProjectDocsStore().delete(s.ws, s.project, 'leads', req.params.id!))) return fail(res, 404, 'NOT_FOUND', 'That lead was not found.');
    res.json({ ok: true });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});

// A quick public check of the lead's home page, so there is something useful to say in the first message.
leadsRouter.post('/:id/audit', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    if (!idOk.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'That lead was not found.');
    const rl = await checkRateLimit('lead-audit', s.uid, 30, 3_600_000);
    if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', `You have checked a lot of websites. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`);
    const docs = getProjectDocsStore();
    const cur = await docs.get(s.ws, s.project, 'leads', req.params.id!);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That lead was not found.');
    if (!String(cur.website ?? '')) return fail(res, 409, 'NO_WEBSITE', 'Add the lead\'s website first.');
    let start: URL;
    try { start = normaliseInputUrl(String(cur.website)); } catch (e) { return fail(res, 400, 'INVALID_URL', e instanceof SsrfError ? e.message : 'The website address is not valid.'); }
    const page = await fetchFollowing(start.toString(), deps.fetcher);
    if (page.error || page.status === 0) return fail(res, 502, 'FETCH_FAILED', page.error || 'The website could not be reached.');
    if (page.status >= 400) return fail(res, 422, 'PAGE_ERROR', `The website answered with an error (${page.status}).`);
    const facts = analyzeHtml(page.text, page.url, { status: page.status, contentType: page.contentType, xRobots: page.xRobots, ms: page.ms, bytes: page.bytes });
    const issues = pageIssues(facts);
    const order = { error: 0, warning: 1, info: 2 } as const;
    const audit: LeadAudit = { url: page.url, score: scoreFor(issues), at: new Date(deps.now()).toISOString(), issues: [...issues].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8).map((i) => ({ title: i.title, severity: i.severity })) };
    const next = { ...cur, audit, updatedAt: audit.at };
    await docs.put(s.ws, s.project, 'leads', next);
    res.json({ lead: toLead(next) });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong while checking the website.'); }
});
