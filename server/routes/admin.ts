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
import { ADMIN_SESSION_SECONDS, adminSecondsLeft, operatorOnly, requirePlatform, signedInWithGoogle } from '../middleware/operatorOnly.js';
import { requireUser } from '../middleware/requireUser.js';
import { PLATFORM_PERMISSION_INFO, PLATFORM_PERMISSIONS, PLATFORM_ROLES, isPlatformRoleId, type PlatformRoleId } from '../lib/platformRoles.js';
import { isOperator, ownerEmails, platformCan, platformRoleOf } from './ops.js';

export const adminRouter = Router();
adminRouter.use(requireUser);

const fail = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });

// Used by the admin login page. Says whether this person may use the panel and how long the session has left. Reveals nothing else.
adminRouter.get('/session', async (req: Request, res: Response) => {
  await refreshAdminSettings();
  const operator = isOperator(req.user!.email);
  const role = platformRoleOf(req.user!.email);
  const viaGoogle = signedInWithGoogle(req);
  res.json({
    operator, viaGoogle, secondsLeft: operator && viaGoogle ? adminSecondsLeft(req.user!.authTime) : 0, sessionMinutes: ADMIN_SESSION_SECONDS / 60, email: req.user!.email,
    role, roleName: role ? PLATFORM_ROLES[role].name : null, permissions: role ? PLATFORM_ROLES[role].permissions : [],
  });
});

adminRouter.use(operatorOnly);

function view(email: string | null | undefined) {
  const s = getAdminSettings();
  const owners = ownerEmails();
  const staffVisible = platformCan(email, 'operators.manage');
  return {
    plans: describePlans(),
    defaults: {
      limits: PLAN_DEFAULTS.PLANS, content: PLAN_DEFAULTS.CONTENT_LIMITS, features: PLAN_DEFAULTS.PLAN_FEATURES, info: PLAN_DEFAULTS.PLAN_INFO,
    },
    saved: s.plans,
    flags: s.flags,
    defaultFlags: DEFAULT_FLAGS,
    operators: staffVisible ? [
      ...owners.map((email) => ({ email, locked: true, role: 'super' as PlatformRoleId })),
      ...s.operators.filter((e) => !owners.includes(e)).map((email) => ({ email, locked: false, role: (s.operatorRoles[email] ?? 'super') as PlatformRoleId })),
    ] : [],
    staffRoles: Object.entries(PLATFORM_ROLES).map(([id, r]) => ({ id, name: r.name, description: r.description, permissions: r.permissions })),
    staffPermissions: PLATFORM_PERMISSIONS.map((id) => ({ id, label: PLATFORM_PERMISSION_INFO[id] })),
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

adminRouter.get('/settings', async (req: Request, res: Response) => {
  await refreshAdminSettings(true);
  res.json(view(req.user!.email));
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
adminRouter.put('/plans', requirePlatform('settings.manage'), async (req: Request, res: Response) => {
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
    res.json(view(req.user!.email));
  } catch (e) {
    fail(res, 400, 'VALIDATION_ERROR', e instanceof Error ? e.message : 'Could not save.');
  }
});

adminRouter.put('/flags', requirePlatform('settings.manage'), async (req: Request, res: Response) => {
  const body = z.object({ flags: z.object({
    signupsOpen: z.boolean(), maintenanceMode: z.boolean(), maintenanceMessage: z.string().max(200),
    explore: z.boolean(), dashboards: z.boolean(), agents: z.boolean(), mcp: z.boolean(), aiAnalyst: z.boolean(), team: z.boolean(),
  }).partial() }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Those switches could not be read.');
  try {
    await saveAdminSettings({ flags: body.data.flags }, req.user!.email ?? req.user!.uid);
    audit(req, `switches: ${Object.entries(body.data.flags).map(([k, v]) => `${k}=${typeof v === 'string' ? 'text' : v}`).join(', ')}`);
    res.json(view(req.user!.email));
  } catch (e) {
    fail(res, 400, 'VALIDATION_ERROR', e instanceof Error ? e.message : 'Could not save.');
  }
});

// The extra staff (those not in OPERATOR_EMAILS), each with a role. Sent as the full list. A plain email counts as Super admin.
adminRouter.put('/operators', requirePlatform('operators.manage'), async (req: Request, res: Response) => {
  const body = z.object({ operators: z.array(z.union([z.string().max(200), z.object({ email: z.string().max(200), role: z.string() })])).max(50) }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Send a list of staff with their roles.');
  const owners = ownerEmails();
  const me = (req.user!.email ?? '').toLowerCase();
  const next = body.data.operators
    .map((o) => (typeof o === 'string' ? { email: o, role: 'super' } : o))
    .map((o) => ({ email: o.email.trim().toLowerCase(), role: o.role }))
    .filter((o) => o.email && !owners.includes(o.email));
  if (next.some((o) => !isPlatformRoleId(o.role))) return fail(res, 400, 'VALIDATION_ERROR', 'Choose a role for each staff member.');
  const mine = next.find((o) => o.email === me);
  if (!owners.includes(me) && !(mine && PLATFORM_ROLES[mine.role as PlatformRoleId].permissions.includes('operators.manage'))) {
    return fail(res, 409, 'WOULD_LOCK_OUT', 'You cannot remove your own access to staff management. Ask another Super admin to do it.');
  }
  try {
    const before = getAdminSettings();
    await saveAdminSettings({ operators: next as { email: string; role: PlatformRoleId }[] }, req.user!.email ?? req.user!.uid);
    const added = next.filter((o) => !before.operators.includes(o.email));
    const removed = before.operators.filter((e) => !next.some((o) => o.email === e));
    const changed = next.filter((o) => before.operators.includes(o.email) && (before.operatorRoles[o.email] ?? 'super') !== o.role);
    audit(req, `staff: +${added.map((o) => `${o.email}(${o.role})`).join(',') || 'none'} -${removed.join(',') || 'none'} role changes ${changed.map((o) => `${o.email}->${o.role}`).join(',') || 'none'}`);
    res.json(view(req.user!.email));
  } catch (e) {
    fail(res, 400, 'VALIDATION_ERROR', e instanceof Error ? e.message : 'Could not save.');
  }
});
