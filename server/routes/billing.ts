/**
 * Plan and billing (Sprint 20). No payment provider yet: people ask for an upgrade, the operator (OPERATOR_EMAILS)
 * receives the payment by hand, then records the invoice and sets the workspace's plan and end date.
 * A future payment webhook only has to do the same two things (record an invoice, set the plan).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PAID_PLAN_IDS, PLAN_IDS, PLAN_INFO, getContentLimits, getPlanFeatures, getPlanLimits, isKnownPlan, planStatus,
} from '../config/plans.js';
import { recordAudit } from '../lib/auditLog.js';
import { getBillingStore, newBillingId, type PlanRequest } from '../lib/billingStore.js';
import { getFirestoreStore, getUtcMonthPeriod, type WorkspaceDoc } from '../lib/firestore.js';
import { mailConfigured, sendMail } from '../lib/mailer.js';
import { requireUser } from '../middleware/requireUser.js';
import { isOperator } from './ops.js';

export const billingRouter = Router();
billingRouter.use(requireUser);

const fail = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function roleIn(ws: WorkspaceDoc | null, uid: string): string | null {
  return ws && Object.prototype.hasOwnProperty.call(ws.members, uid) ? ws.members[uid] : null;
}

function planSummary(ws: WorkspaceDoc, now = new Date()) {
  const stored = ws.storedPlan ?? ws.plan;
  const st = planStatus(ws.planExpiresAt ?? null, now);
  return {
    plan: ws.plan,
    label: isKnownPlan(ws.plan) ? PLAN_INFO[ws.plan].label : ws.plan,
    storedPlan: stored,
    status: stored === 'free' ? 'none' : st.status,
    expiresAt: ws.planExpiresAt ?? null,
    graceEndsAt: st.graceEndsAt,
    limits: getPlanLimits(ws.plan),
    content: getContentLimits(ws.plan),
    features: getPlanFeatures(ws.plan),
  };
}

const catalog = () => PLAN_IDS.filter((p) => p !== 'beta').map((id) => ({
  id, label: PLAN_INFO[id].label, priceUsd: PLAN_INFO[id].priceUsd, priceBdt: PLAN_INFO[id].priceBdt,
  limits: getPlanLimits(id), content: getContentLimits(id), features: getPlanFeatures(id),
}));

// ---------------------------------------------------------------------------
// The signed-in person's own workspace
// ---------------------------------------------------------------------------

async function pickWorkspace(req: Request, res: Response): Promise<WorkspaceDoc | null> {
  const store = getFirestoreStore();
  const wanted = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : typeof (req.body as Record<string, unknown> | undefined)?.workspaceId === 'string' ? String((req.body as Record<string, unknown>).workspaceId).trim() : '';
  if (wanted) {
    const ws = await store.getWorkspace(wanted);
    if (!ws || !roleIn(ws, req.user!.uid)) { fail(res, 404, 'NOT_FOUND', 'Workspace not found.'); return null; }
    return ws;
  }
  const mine = await store.listWorkspacesForUser(req.user!.uid);
  const owned = mine.find((w) => w.ownerId === req.user!.uid) ?? mine[0];
  if (!owned) { fail(res, 404, 'NOT_FOUND', 'No workspace found.'); return null; }
  return owned;
}

billingRouter.get('/', async (req: Request, res: Response) => {
  try {
    const ws = await pickWorkspace(req, res);
    if (!ws) return;
    const store = getFirestoreStore();
    const [projects, usage, invoices, requests] = await Promise.all([
      store.listProjects(ws.id),
      store.getUsage(ws.id, getUtcMonthPeriod()),
      getBillingStore().listInvoices(ws.id),
      getBillingStore().listRequests({ workspaceId: ws.id }),
    ]);
    const role = roleIn(ws, req.user!.uid);
    res.json({
      workspaceId: ws.id,
      workspaceName: ws.name,
      role,
      canRequestUpgrade: role === 'owner' || role === 'admin',
      isOperator: isOperator(req.user!.email),
      current: planSummary(ws),
      usage: {
        projects: projects.filter((p) => !p.isDemo).length,
        members: Object.keys(ws.members).length,
        aiQuestions: typeof usage?.aiQuestions === 'number' ? usage.aiQuestions : 0,
      },
      plans: catalog(),
      invoices: invoices.map(({ id, number, amount, currency, plan, periodStart, periodEnd, createdAt }) => ({ id, number, amount, currency, plan, periodStart, periodEnd, createdAt })),
      openRequest: requests.find((r) => r.status === 'open') ? { plan: requests.find((r) => r.status === 'open')!.plan, createdAt: requests.find((r) => r.status === 'open')!.createdAt } : null,
      refundPolicy: 'Refunds are not available after 3 days from the payment date.',
    });
  } catch (e) {
    fail(res, 500, 'BILLING_FAILED', e instanceof Error ? e.message : 'Could not load billing.');
  }
});

const requestSchema = z.object({
  workspaceId: z.string().min(1).max(120),
  plan: z.enum(['pro', 'business']),
  message: z.string().trim().max(500).optional().default(''),
});

billingRouter.post('/upgrade-request', async (req: Request, res: Response) => {
  const body = requestSchema.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Choose the Pro or Business plan, and keep the message under 500 characters.');
  const ws = await getFirestoreStore().getWorkspace(body.data.workspaceId);
  const role = roleIn(ws, req.user!.uid);
  if (!ws || (role !== 'owner' && role !== 'admin')) return fail(res, 403, 'NOT_ALLOWED', 'Only a workspace owner or admin can ask for an upgrade.');
  const email = req.user!.email;
  if (!email) return fail(res, 400, 'NO_EMAIL', 'Your account has no email address we can reply to.');

  const store = getBillingStore();
  const open = (await store.listRequests({ workspaceId: ws.id, status: 'open' }))[0];
  const record: PlanRequest = { id: open?.id ?? newBillingId(), workspaceId: ws.id, uid: req.user!.uid, email, plan: body.data.plan, message: body.data.message, status: 'open', createdAt: new Date().toISOString() };
  await store.putRequest(record);
  void recordAudit({ uid: req.user!.uid, action: 'plan.requested', workspaceId: ws.id, detail: body.data.plan });

  let emailed = false;
  const to = process.env.SUPPORT_EMAIL?.trim();
  if (to && mailConfigured()) {
    const info = PLAN_INFO[body.data.plan];
    const text = `Upgrade request\nWorkspace: ${ws.name} (${ws.id})\nFrom: ${email}\nPlan: ${info.label} (USD ${info.priceUsd} / BDT ${info.priceBdt} a month)\nMessage: ${body.data.message || '(none)'}`;
    emailed = (await sendMail({ to, subject: `AdLens upgrade request: ${info.label}`, text, html: `<pre style="font-family:inherit">${esc(text)}</pre>` })).ok;
  }
  res.status(201).json({ requested: true, emailed });
});

// ---------------------------------------------------------------------------
// Operator only (OPERATOR_EMAILS)
// ---------------------------------------------------------------------------

const operatorOnly = (req: Request, res: Response, next: () => void) => {
  if (!isOperator(req.user!.email)) return fail(res, 403, 'NOT_ALLOWED', 'Only the owner of this AdLens installation can do this.');
  next();
};
const admin = Router();
admin.use(operatorOnly);
billingRouter.use('/admin', admin);

admin.get('/workspaces', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const list = await getFirestoreStore().listWorkspacesForOperator(q, 50);
  res.json({
    workspaces: list.map((w) => ({
      id: w.id, name: w.name, ownerId: w.ownerId, members: Object.keys(w.members).length,
      plan: w.plan, storedPlan: w.storedPlan ?? w.plan, planExpiresAt: w.planExpiresAt ?? null,
      status: (w.storedPlan ?? w.plan) === 'free' ? 'none' : planStatus(w.planExpiresAt ?? null).status,
    })),
  });
});

admin.get('/requests', async (_req: Request, res: Response) => {
  const open = await getBillingStore().listRequests({ status: 'open' });
  res.json({ requests: open.map((r) => ({ id: r.id, workspaceId: r.workspaceId, email: r.email, plan: r.plan, message: r.message, createdAt: r.createdAt })) });
});

admin.post('/requests/:id/close', async (req: Request, res: Response) => {
  const store = getBillingStore();
  const r = await store.getRequest(String(req.params.id));
  if (!r) return fail(res, 404, 'NOT_FOUND', 'Request not found.');
  await store.putRequest({ ...r, status: 'done' });
  res.status(204).end();
});

const endOfDay = (d: string) => `${d}T23:59:59.000Z`;
const setPlanSchema = z.object({
  workspaceId: z.string().min(1).max(120),
  plan: z.enum(PLAN_IDS),
  /** YYYY-MM-DD, the last day the plan is paid for. Required for Pro and Business. */
  endsOn: z.string().regex(DAY_RE).nullable().optional(),
  note: z.string().trim().max(200).optional().default(''),
});

admin.post('/set-plan', async (req: Request, res: Response) => {
  const body = setPlanSchema.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', body.error.issues[0]?.message || 'Check the workspace, plan and end date.');
  const { workspaceId, plan, endsOn, note } = body.data;
  const paid = (PAID_PLAN_IDS as readonly string[]).includes(plan);
  if (paid && !endsOn) return fail(res, 400, 'END_DATE_REQUIRED', 'Choose the last day this plan is paid for.');
  if (endsOn && Number.isNaN(Date.parse(endOfDay(endsOn)))) return fail(res, 400, 'VALIDATION_ERROR', 'That end date is not a real date.');
  const store = getFirestoreStore();
  const before = await store.getWorkspace(workspaceId);
  if (!before) return fail(res, 404, 'NOT_FOUND', 'Workspace not found.');
  const updated = await store.setWorkspacePlan(workspaceId, plan, paid && endsOn ? endOfDay(endsOn) : null);
  if (!updated) return fail(res, 404, 'NOT_FOUND', 'Workspace not found.');
  void recordAudit({ uid: req.user!.uid, action: 'plan.changed', workspaceId, detail: `${before.storedPlan ?? before.plan} to ${plan}${paid && endsOn ? ` until ${endsOn}` : ''}${note ? `: ${note}` : ''}`.slice(0, 200) });
  if (paid) {
    const billing = getBillingStore();
    for (const r of await billing.listRequests({ workspaceId, status: 'open' })) await billing.putRequest({ ...r, status: 'done' });
  }
  res.json({ workspaceId, plan: updated.plan, storedPlan: updated.storedPlan, planExpiresAt: updated.planExpiresAt ?? null });
});

const invoiceSchema = z.object({
  workspaceId: z.string().min(1).max(120),
  number: z.string().trim().min(1).max(40),
  amount: z.number().positive().max(10_000_000),
  currency: z.enum(['USD', 'BDT']),
  plan: z.enum(['pro', 'business']),
  periodStart: z.string().regex(DAY_RE),
  periodEnd: z.string().regex(DAY_RE),
  note: z.string().trim().max(200).optional().default(''),
});

admin.post('/invoices', async (req: Request, res: Response) => {
  const body = invoiceSchema.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', body.error.issues[0]?.message || 'Check the invoice details.');
  if (body.data.periodStart > body.data.periodEnd) return fail(res, 400, 'VALIDATION_ERROR', 'The period must end on or after the day it starts.');
  const ws = await getFirestoreStore().getWorkspace(body.data.workspaceId);
  if (!ws) return fail(res, 404, 'NOT_FOUND', 'Workspace not found.');
  const invoice = { id: newBillingId(), ...body.data, createdAt: new Date().toISOString() };
  await getBillingStore().addInvoice(invoice);
  void recordAudit({ uid: req.user!.uid, action: 'invoice.recorded', workspaceId: ws.id, detail: `${invoice.number}: ${invoice.currency} ${invoice.amount}` });
  res.status(201).json({ invoice });
});

admin.get('/invoices', async (req: Request, res: Response) => {
  const ws = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  if (!ws) return fail(res, 400, 'VALIDATION_ERROR', 'Choose a workspace.');
  res.json({ invoices: await getBillingStore().listInvoices(ws) });
});
