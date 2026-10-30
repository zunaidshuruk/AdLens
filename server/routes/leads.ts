import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getContentLimits } from '../config/plans.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { duplicateOf, captureKeyMatches, hashCaptureKey, newCaptureKey, normaliseIncoming, type IncomingLead } from '../lib/leadIntake.js';
import { sendMail } from '../lib/mailer.js';
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
  audit: LeadAudit | null; assigneeId: string; source: 'manual' | 'import' | 'capture'; createdBy: string; createdAt: string; updatedAt: string;
}
const toLead = (d: StoredDoc): Lead => {
  const a = d.audit as Partial<LeadAudit> | null | undefined;
  return {
    id: d.id, name: String(d.name ?? ''), website: String(d.website ?? ''), email: String(d.email ?? ''), phone: String(d.phone ?? ''),
    status: (LEAD_STATUSES as readonly string[]).includes(String(d.status)) ? (d.status as Lead['status']) : 'new',
    value: typeof d.value === 'number' && Number.isFinite(d.value) ? d.value : 0, followUp: String(d.followUp ?? ''), notes: String(d.notes ?? ''),
    audit: a && typeof a.score === 'number' ? { url: String(a.url ?? ''), score: a.score, at: String(a.at ?? ''), issues: Array.isArray(a.issues) ? a.issues.slice(0, 8).map((i) => ({ title: String((i as { title?: unknown }).title ?? ''), severity: String((i as { severity?: unknown }).severity ?? '') })) : [] } : null,
    assigneeId: String(d.assigneeId ?? ''), source: d.source === 'import' || d.source === 'capture' ? d.source : 'manual',
    createdBy: String(d.createdBy ?? ''), createdAt: String(d.createdAt ?? ''), updatedAt: String(d.updatedAt ?? ''),
  };
};

const idOk = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
type Mailer = (m: { to: string; subject: string; text: string; html: string }) => Promise<unknown>;
const deps: { fetcher: PageFetcher; now: () => number; mail: Mailer } = { fetcher: fetchOnce, now: Date.now, mail: (m) => sendMail(m) };
export function setLeadsTestDeps(d: Partial<typeof deps> | null): void { deps.fetcher = d?.fetcher ?? fetchOnce; deps.now = d?.now ?? Date.now; deps.mail = d?.mail ?? ((m) => sendMail(m)); }


const failEarly = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
const inboxDocs = () => getProjectDocsStore();
const INBOX_ID = 'main';

// PUBLIC: Google Ads lead forms, Zapier, Make and similar tools post new leads here. The secret key is checked, never the login.
// Google sends the key inside the body as "google_key"; other tools can use ?key= or a "key" field.
leadsRouter.post('/capture/:ws/:project', express.urlencoded({ extended: false, limit: '64kb' }), async (req, res) => {
  try {
    const wsId = String(req.params.ws ?? ''); const projectId = String(req.params.project ?? '');
    if (!idOk.safeParse(wsId).success || !idOk.safeParse(projectId).success) return failEarly(res, 404, 'NOT_FOUND', 'This lead link is not valid.');
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const given = String(req.query.key ?? body.google_key ?? body.key ?? '');
    const rl = await checkRateLimit('lead-capture', `${wsId}/${projectId}`, 300, 3_600_000);
    if (!rl.allowed) return failEarly(res, 429, 'RATE_LIMITED', 'Too many leads at once. Try again later.');
    const docs = inboxDocs();
    const inbox = await docs.get(wsId, projectId, 'leadInbox', INBOX_ID);
    if (!inbox || inbox.enabled !== true || !captureKeyMatches(given, String(inbox.keyHash ?? ''))) return failEarly(res, 404, 'NOT_FOUND', 'This lead link is not valid.');
    if (body.is_test === true || body.is_test === 'true') return void res.json({ ok: true, test: true });
    const incoming = normaliseIncoming(body);
    if (!incoming) return failEarly(res, 400, 'NO_LEAD', 'No name, email or phone was found in what was sent.');
    const ws = await getFirestoreStore().getWorkspace(wsId);
    if (!ws) return failEarly(res, 404, 'NOT_FOUND', 'This lead link is not valid.');
    const existing = (await docs.list(wsId, projectId, 'leads')).map(toLead);
    if (duplicateOf(incoming, existing)) return void res.json({ ok: true, duplicate: true });
    const limit = getContentLimits(ws.plan).maxLeads;
    if (existing.length >= limit) return failEarly(res, 409, 'LIMIT_REACHED', 'The lead list is full for this plan.');
    const now = new Date(deps.now()).toISOString();
    const defaultAssignee = typeof inbox.defaultAssigneeId === 'string' && Object.prototype.hasOwnProperty.call(ws.members ?? {}, inbox.defaultAssigneeId) ? inbox.defaultAssigneeId : '';
    const doc = { id: newDocId(), ...incoming, status: 'new', followUp: '', audit: null, assigneeId: defaultAssignee, source: 'capture', createdBy: '', createdAt: now, updatedAt: now };
    await docs.put(wsId, projectId, 'leads', doc);
    if (defaultAssignee) void notifyAssignee(defaultAssignee, '', doc as never, 'New lead from your lead link').catch(() => undefined);
    res.status(201).json({ ok: true });
  } catch { failEarly(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});

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

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Tell the person a lead was given to them. Best effort: a mail problem never blocks the change. */
async function notifyAssignee(assigneeId: string, byUid: string, lead: Pick<Lead, 'name' | 'email' | 'phone' | 'website'>, subject: string): Promise<void> {
  if (!assigneeId || assigneeId === byUid) return;
  const store = getFirestoreStore();
  const [to, by] = await Promise.all([store.getUser(assigneeId), byUid ? store.getUser(byUid) : Promise.resolve(null)]);
  if (!to?.email) return;
  const who = by?.displayName ? `${by.displayName} gave you` : 'You have';
  const link = `${(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')}/leads`;
  const lines = [`${who} a lead: ${lead.name}`, [lead.email, lead.phone, lead.website].filter(Boolean).join(' · '), `Open your leads: ${link}`].filter(Boolean);
  await deps.mail({ to: to.email, subject: `${subject}: ${lead.name}`.slice(0, 150), text: lines.join('\n'), html: lines.map((l) => `<p>${esc(l)}</p>`).join('') });
}
const isMember = (ws: { members?: Record<string, unknown> }, uid: string): boolean => !uid || Object.prototype.hasOwnProperty.call(ws.members ?? {}, uid);

const fields = z.object({
  name: z.string().trim().min(1, 'Type a name for the lead').max(100),
  website: z.string().trim().max(200).default(''),
  email: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).default(''),
  status: z.enum(LEAD_STATUSES).default('new'),
  value: z.number().finite().min(0).max(1_000_000_000).default(0),
  followUp: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a date like 2026-11-30').default(''),
  notes: z.string().trim().max(2000).default(''),
  assigneeId: z.string().regex(/^[A-Za-z0-9_-]{0,128}$/).default(''),
});

// Edits send only what changed. (Zod 4 fills defaults even inside .partial(), which would wipe the other fields, so this schema has none.)
const patchFields = z.object({
  name: z.string().trim().min(1, 'Type a name for the lead').max(100), website: z.string().trim().max(200), email: z.string().trim().max(120), phone: z.string().trim().max(40),
  status: z.enum(LEAD_STATUSES), value: z.number().finite().min(0).max(1_000_000_000), followUp: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a date like 2026-11-30'), notes: z.string().trim().max(2000), assigneeId: z.string().regex(/^[A-Za-z0-9_-]{0,128}$/),
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
    const wsDoc = await getFirestoreStore().getWorkspace(s.ws);
    if (!wsDoc || !isMember(wsDoc, parsed.data.assigneeId)) return fail(res, 400, 'INVALID_ASSIGNEE', 'That person is not a member of this workspace.');
    const existing = await docs.list(s.ws, s.project, 'leads');
    const limit = getContentLimits(s.plan).maxLeads;
    if (existing.length >= limit) return fail(res, 409, 'LIMIT_REACHED', `Your plan keeps up to ${limit} leads (${existing.length} used). Remove some or upgrade.`);
    const now = new Date(deps.now()).toISOString();
    const doc = { id: newDocId(), ...parsed.data, audit: null, source: 'manual', createdBy: s.uid, createdAt: now, updatedAt: now };
    await docs.put(s.ws, s.project, 'leads', doc);
    if (doc.assigneeId) void notifyAssignee(doc.assigneeId, s.uid, doc, 'A lead was assigned to you').catch(() => undefined);
    res.status(201).json({ lead: toLead(doc) });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});


// Who can a lead be given to: the people in this workspace.
leadsRouter.get('/members', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const ws = await getFirestoreStore().getWorkspace(s.ws);
    const store = getFirestoreStore();
    const members = (await Promise.all(Object.keys(ws?.members ?? {}).slice(0, 200).map(async (uid) => { const u = await store.getUser(uid); return { uid, name: u?.displayName || u?.email || 'Team member', email: u?.email ?? '' }; })))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ members, me: s.uid });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});

// Lead link settings. The secret key is only shown once, when it is made; only a fingerprint is stored.
const captureUrl = (ws: string, project: string) => `${(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')}/api/leads/capture/${ws}/${project}`;
leadsRouter.get('/capture', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const inbox = await getProjectDocsStore().get(s.ws, s.project, 'leadInbox', INBOX_ID);
    res.json({ enabled: inbox?.enabled === true, url: captureUrl(s.ws, s.project), defaultAssigneeId: String(inbox?.defaultAssigneeId ?? '') });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});
leadsRouter.post('/capture/key', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const docs = getProjectDocsStore();
    const cur = await docs.get(s.ws, s.project, 'leadInbox', INBOX_ID);
    const key = newCaptureKey();
    await docs.put(s.ws, s.project, 'leadInbox', { ...(cur ?? {}), id: INBOX_ID, enabled: true, keyHash: hashCaptureKey(key), updatedAt: new Date(deps.now()).toISOString() });
    res.json({ key, url: captureUrl(s.ws, s.project) });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});
leadsRouter.put('/capture', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = z.object({ enabled: z.boolean().optional(), defaultAssigneeId: z.string().regex(/^[A-Za-z0-9_-]{0,128}$/).optional() }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Check the details and try again.');
    const docs = getProjectDocsStore();
    const cur = await docs.get(s.ws, s.project, 'leadInbox', INBOX_ID);
    if (!cur) return fail(res, 409, 'NO_KEY', 'Make a secret key first.');
    if (parsed.data.defaultAssigneeId !== undefined) {
      const wsDoc = await getFirestoreStore().getWorkspace(s.ws);
      if (!wsDoc || !isMember(wsDoc, parsed.data.defaultAssigneeId)) return fail(res, 400, 'INVALID_ASSIGNEE', 'That person is not a member of this workspace.');
    }
    await docs.put(s.ws, s.project, 'leadInbox', { ...cur, ...parsed.data, updatedAt: new Date(deps.now()).toISOString() });
    res.json({ ok: true });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});

// CSV import: the page reads the file and sends the rows. Repeats are skipped and the plan limit is respected.
leadsRouter.post('/import', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = z.object({ rows: z.array(z.record(z.string().max(100), z.union([z.string().max(2000), z.number()]))).min(1).max(500) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'The file has no rows, or has more than 500. Split it and try again.');
    const docs = getProjectDocsStore();
    const existing = (await docs.list(s.ws, s.project, 'leads')).map(toLead);
    const limit = getContentLimits(s.plan).maxLeads;
    const seen: Pick<Lead, 'name' | 'email' | 'phone' | 'website'>[] = [...existing];
    const now = new Date(deps.now()).toISOString();
    let added = 0; let duplicates = 0; let unreadable = 0; let overLimit = 0;
    for (const row of parsed.data.rows) {
      const lead: IncomingLead | null = normaliseIncoming(row);
      if (!lead) { unreadable++; continue; }
      if (duplicateOf(lead, seen)) { duplicates++; continue; }
      if (existing.length + added >= limit) { overLimit++; continue; }
      await docs.put(s.ws, s.project, 'leads', { id: newDocId(), ...lead, status: 'new', followUp: '', audit: null, assigneeId: '', source: 'import', createdBy: s.uid, createdAt: now, updatedAt: now });
      seen.push(lead); added++;
    }
    res.json({ added, duplicates, unreadable, overLimit, limit });
  } catch { fail(res, 500, 'LEADS_FAILED', 'Something went wrong.'); }
});


// Delete many at once: a list of ids (up to 1000) or every lead in the project. Only people who can edit may do this.
leadsRouter.post('/bulk-delete', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = z.union([z.object({ ids: z.array(idOk).min(1).max(1000) }), z.object({ all: z.literal(true) })]).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Choose the leads to delete.');
    const docs = getProjectDocsStore();
    const ids = 'all' in parsed.data ? (await docs.list(s.ws, s.project, 'leads')).map((d) => d.id) : [...new Set(parsed.data.ids)];
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 25) deleted += (await Promise.all(ids.slice(i, i + 25).map((id) => docs.delete(s.ws, s.project, 'leads', id)))).filter(Boolean).length;
    res.json({ deleted });
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
    if (parsed.data.assigneeId !== undefined) {
      const wsDoc = await getFirestoreStore().getWorkspace(s.ws);
      if (!wsDoc || !isMember(wsDoc, parsed.data.assigneeId)) return fail(res, 400, 'INVALID_ASSIGNEE', 'That person is not a member of this workspace.');
    }
    // A new website means the old check no longer describes it.
    const next = { ...cur, ...parsed.data, ...(parsed.data.website !== undefined && parsed.data.website !== cur.website ? { audit: null } : {}), updatedAt: new Date(deps.now()).toISOString() };
    await docs.put(s.ws, s.project, 'leads', next);
    if (parsed.data.assigneeId && parsed.data.assigneeId !== String(cur.assigneeId ?? '')) void notifyAssignee(parsed.data.assigneeId, s.uid, toLead(next), 'A lead was assigned to you').catch(() => undefined);
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
