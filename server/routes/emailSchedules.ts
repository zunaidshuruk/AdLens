import { Router, type Request, type Response } from 'express';
import { getContentLimits, getPlanFeatures } from '../config/plans.js';
import { getServerConfig } from '../config.js';
import { buildScheduleEmail, emailScheduleInputSchema, getScheduleStore, newScheduleId, productionSnapshot, type StoredSchedule } from '../lib/emailSchedules.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { sendMail } from '../lib/mailer.js';
import { can } from '../lib/permissions.js';
import { ShareSourceError } from '../lib/shareWiring.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** Scheduled snapshot emails for a dashboard or saved report. Sent by the daily job. */
export const emailSchedulesRouter = Router();
const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };

emailSchedulesRouter.use(requireUser);
emailSchedulesRouter.use(verifyGoogleSessionOwnership);
emailSchedulesRouter.use(loadProject);

interface Scope { ws: string; project: string; plan: string | undefined; uid: string }
async function scope(req: Request, res: Response): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  if (!ws || !can(ws, req.user!.uid, 'content.edit')) { fail(res, 403, 'NOT_ALLOWED', 'You do not have permission to schedule emails in this project.'); return null; }
  return { ws: project.workspaceId, project: project.id, plan: ws.plan, uid: req.user!.uid };
}
const emailsOk = (res: Response, s: Scope): boolean => {
  if (getPlanFeatures(s.plan).emailSummaries) return true;
  fail(res, 403, 'EMAIL_NOT_IN_PLAN', 'Scheduled emails are not part of your plan. Upgrade to use them.');
  return false;
};

emailSchedulesRouter.get('/', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const list = (await getScheduleStore().listForProject(s.ws, s.project)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ schedules: list, limit: getContentLimits(s.plan).maxEmailSchedules, emailAllowed: getPlanFeatures(s.plan).emailSummaries, userEmail: req.user!.email ?? null });
  } catch { fail(res, 500, 'SCHEDULE_FAILED', 'Something went wrong with scheduled emails.'); }
});

emailSchedulesRouter.post('/', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s || !emailsOk(res, s)) return;
    const parsed = emailScheduleInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_SCHEDULE', parsed.error.issues[0]?.message || 'The schedule is not valid.');
    const store = getScheduleStore();
    const limit = getContentLimits(s.plan).maxEmailSchedules;
    if ((await store.listForProject(s.ws, s.project)).length >= limit) return fail(res, 409, 'LIMIT_REACHED', `Your plan allows ${limit} scheduled ${limit === 1 ? 'email' : 'emails'} per project. Delete one or upgrade to add more.`);
    // Reading the target now proves it exists and gives the title.
    let title: string;
    try { title = (await productionSnapshot({ ...parsed.data, id: 'x', workspaceId: s.ws, projectId: s.project, createdBy: s.uid, createdAt: '', title: '' }, new Date())).title; }
    catch (e) { if (e instanceof ShareSourceError) return fail(res, 404, 'NOT_FOUND', e.message); throw e; }
    const now = new Date().toISOString();
    const rec: StoredSchedule = { ...parsed.data, id: newScheduleId(), workspaceId: s.ws, projectId: s.project, createdBy: s.uid, createdAt: now, title };
    await store.put(rec);
    res.status(201).json({ schedule: rec });
  } catch { fail(res, 500, 'SCHEDULE_FAILED', 'Could not save this schedule.'); }
});

async function load(req: Request, res: Response, s: Scope): Promise<StoredSchedule | null> {
  const r = await getScheduleStore().get(String(req.params.id));
  if (!r || r.workspaceId !== s.ws || r.projectId !== s.project) { fail(res, 404, 'NOT_FOUND', 'That schedule was not found.'); return null; }
  return r;
}

emailSchedulesRouter.put('/:id', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s || !emailsOk(res, s)) return;
    const cur = await load(req, res, s);
    if (!cur) return;
    const parsed = emailScheduleInputSchema.safeParse({ ...cur, ...(typeof req.body === 'object' && req.body ? req.body : {}), kind: cur.kind, targetId: cur.targetId });
    if (!parsed.success) return fail(res, 400, 'INVALID_SCHEDULE', parsed.error.issues[0]?.message || 'The schedule is not valid.');
    const next: StoredSchedule = { ...cur, ...parsed.data };
    await getScheduleStore().put(next);
    res.json({ schedule: next });
  } catch { fail(res, 500, 'SCHEDULE_FAILED', 'Could not save this schedule.'); }
});

emailSchedulesRouter.delete('/:id', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const cur = await load(req, res, s);
    if (!cur) return;
    await getScheduleStore().delete(cur.id);
    res.status(204).end();
  } catch { fail(res, 500, 'SCHEDULE_FAILED', 'Could not delete this schedule.'); }
});

/** Sends one test email to the signed-in person only (never to the other addresses). */
emailSchedulesRouter.post('/:id/test', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s || !emailsOk(res, s)) return;
    const cur = await load(req, res, s);
    if (!cur) return;
    const to = req.user!.email;
    if (!to) return fail(res, 400, 'NO_EMAIL', 'Your account has no email address.');
    const { title, snapshot } = await productionSnapshot(cur, new Date());
    const mail = buildScheduleEmail({ ...cur, title }, snapshot, req.project!.name, getServerConfig().appBaseUrl, to, true);
    const r = await sendMail({ ...mail, to });
    res.json({ sent: r.ok, to, ...(r.ok ? {} : { reason: r.reason === 'not_configured' ? 'Email sending is not set up yet on this server.' : 'The email could not be sent.' }) });
  } catch { fail(res, 500, 'SCHEDULE_FAILED', 'Could not send the test email.'); }
});
