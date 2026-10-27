/**
 * Admin panel settings (Sprint 20e): plan limits, prices, custom plans, feature switches and operators.
 * Everything here needs an operator who signed in freshly on the admin login page (see middleware/operatorOnly.ts).
 */
import { getFirestoreStore } from '../lib/firestore.js';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PLAN_DEFAULTS, describePlans } from '../config/plans.js';
import { recordAudit } from '../lib/auditLog.js';
import { DEFAULT_FLAGS, getAdminSettings, refreshAdminSettings, saveAdminSettings } from '../lib/adminSettings.js';
import { ADMIN_SESSION_SECONDS, adminSecondsLeft, operatorOnly } from '../middleware/operatorOnly.js';
import { requireUser } from '../middleware/requireUser.js';
import { isOperator, ownerEmails } from './ops.js';

export const adminRouter = Router();
adminRouter.use(requireUser);

const fail = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });

// Used by the admin login page. Says whether this person may use the panel and how long the session has left. Reveals nothing else.
adminRouter.get('/session', async (req: Request, res: Response) => {
  await refreshAdminSettings();
  const operator = isOperator(req.user!.email);
  res.json({ operator, secondsLeft: operator ? adminSecondsLeft(req.user!.authTime) : 0, sessionMinutes: ADMIN_SESSION_SECONDS / 60, email: req.user!.email });
});

adminRouter.use(operatorOnly);

function view() {
  const s = getAdminSettings();
  const owners = ownerEmails();
  return {
    plans: describePlans(),
    defaults: {
      limits: PLAN_DEFAULTS.PLANS, content: PLAN_DEFAULTS.CONTENT_LIMITS, features: PLAN_DEFAULTS.PLAN_FEATURES, info: PLAN_DEFAULTS.PLAN_INFO,
    },
    saved: s.plans,
    flags: s.flags,
    defaultFlags: DEFAULT_FLAGS,
    operators: [
      ...owners.map((email) => ({ email, locked: true })),
      ...s.operators.filter((e) => !owners.includes(e)).map((email) => ({ email, locked: false })),
    ],
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

adminRouter.get('/settings', async (_req: Request, res: Response) => {
  await refreshAdminSettings(true);
  res.json(view());
});

const planSetting = z.object({
  label: z.string().optional(),
  priceUsd: z.number().optional(),
  priceBdt: z.number().optional(),
  limits: z.record(z.string(), z.number()).optional(),
  content: z.record(z.string(), z.number()).optional(),
  features: z.record(z.string(), z.union([z.number(), z.boolean(), z.null()])).optional(),
  custom: z.boolean().optional(),
}).strict();

const audit = (req: Request, detail: string) => void recordAudit({ uid: req.user!.uid, action: 'admin.settings_changed', detail: detail.slice(0, 200) });

// Replaces ALL saved plan changes with what is sent (the panel always sends the full picture).
adminRouter.put('/plans', async (req: Request, res: Response) => {
  const body = z.object({ plans: z.record(z.string(), planSetting) }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Those plan settings could not be read.');
  const removed = Object.keys(getAdminSettings().plans).filter((id) => !(id in body.data.plans) && !['beta', 'free', 'pro', 'business'].includes(id));
  if (removed.length) {
    const all = await getFirestoreStore().listWorkspacesForOperator('', 500);
    for (const id of removed) {
      const using = all.filter((w) => (w.storedPlan ?? w.plan) === id).length;
      if (using) return fail(res, 409, 'PLAN_IN_USE', `${using} workspace(s) are still on the plan "${id}". Move them to another plan first.`);
    }
  }
  try {
    const before = Object.keys(getAdminSettings().plans).sort().join(',');
    await saveAdminSettings({ plans: body.data.plans as never }, req.user!.email ?? req.user!.uid);
    audit(req, `plans edited (${Object.keys(body.data.plans).sort().join(', ') || 'back to defaults'}; before: ${before || 'defaults'})`);
    res.json(view());
  } catch (e) {
    fail(res, 400, 'VALIDATION_ERROR', e instanceof Error ? e.message : 'Could not save.');
  }
});

adminRouter.put('/flags', async (req: Request, res: Response) => {
  const body = z.object({ flags: z.object({
    signupsOpen: z.boolean(), maintenanceMode: z.boolean(), maintenanceMessage: z.string().max(200),
    explore: z.boolean(), dashboards: z.boolean(), agents: z.boolean(), mcp: z.boolean(), aiAnalyst: z.boolean(), team: z.boolean(),
  }).partial() }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Those switches could not be read.');
  try {
    await saveAdminSettings({ flags: body.data.flags }, req.user!.email ?? req.user!.uid);
    audit(req, `switches: ${Object.entries(body.data.flags).map(([k, v]) => `${k}=${typeof v === 'string' ? 'text' : v}`).join(', ')}`);
    res.json(view());
  } catch (e) {
    fail(res, 400, 'VALIDATION_ERROR', e instanceof Error ? e.message : 'Could not save.');
  }
});

// The extra operators (those not in OPERATOR_EMAILS). Sent as the full list.
adminRouter.put('/operators', async (req: Request, res: Response) => {
  const body = z.object({ operators: z.array(z.string().max(200)).max(50) }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Send a list of email addresses.');
  const me = (req.user!.email ?? '').toLowerCase();
  const next = body.data.operators.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!ownerEmails().includes(me) && !next.includes(me)) return fail(res, 409, 'WOULD_LOCK_OUT', 'You cannot remove your own access. Ask another operator to do it.');
  try {
    const before = getAdminSettings().operators;
    await saveAdminSettings({ operators: next }, req.user!.email ?? req.user!.uid);
    const added = next.filter((e) => !before.includes(e)); const removed = before.filter((e) => !next.includes(e));
    audit(req, `operators: +${added.join(',') || 'none'} -${removed.join(',') || 'none'}`);
    res.json(view());
  } catch (e) {
    fail(res, 400, 'VALIDATION_ERROR', e instanceof Error ? e.message : 'Could not save.');
  }
});
