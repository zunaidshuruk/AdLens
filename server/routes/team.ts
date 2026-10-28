/**
 * Team (Sprint 20, roles in Sprint 21): who belongs to a workspace and what each person may do.
 * People with the "Add and remove people" permission add people by email; someone with no AdLens account yet
 * gets a pending invitation that is accepted when they sign in with that (verified) email.
 * People with "Create roles and assign them" make custom roles and change who has which role.
 * Nobody can hand out, or take away, more than they have themselves. The owner is always fixed.
 * Everyone brings their OWN Google and Meta connection: adding a person never shares the owner's connections.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getPlanFeatures } from '../config/plans.js';
import { recordAudit } from '../lib/auditLog.js';
import { getFirestoreStore, type WorkspaceDoc, type WorkspaceRole } from '../lib/firestore.js';
import { domainOfEmail, isFreeMailDomain } from '../lib/orgSso.js';
import { getInviteStore, newInviteId } from '../lib/inviteStore.js';
import {
  MAX_CUSTOM_ROLES, PERMISSIONS, PERMISSION_INFO, allRoles, can, cleanPermissions, isSubset, newRoleId, permissionsOf, roleDef, roleIdOf, roleLabel,
} from '../lib/permissions.js';
import { guardWorkspaceParam } from '../lib/twoStepPolicy.js';
import { requireUser } from '../middleware/requireUser.js';

export const teamRouter = Router();
teamRouter.use(requireUser);
teamRouter.param('wsId', guardWorkspaceParam);

const fail = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Adds the people who were invited by email, now that this person has signed in with a verified address. Never throws. */
export async function acceptPendingInvites(uid: string, email: string | null | undefined): Promise<number> {
  if (!email) return 0;
  let accepted = 0;
  try {
    const invites = getInviteStore();
    const store = getFirestoreStore();
    for (const inv of await invites.listForEmail(email)) {
      const ws = await store.getWorkspace(inv.workspaceId);
      if (!ws) { await invites.delete(inv.id); continue; }
      const already = Object.prototype.hasOwnProperty.call(ws.members, uid);
      if (!already && Object.keys(ws.members).length >= getPlanFeatures(ws.plan).maxMembers) continue; // keep waiting: the plan is full
      if (!already) {
        const role = inv.role !== 'owner' && roleDef(ws, inv.role) ? inv.role : 'member'; // a deleted role becomes Member
        await store.addWorkspaceMember(ws.id, uid, role);
        void recordAudit({ uid, action: 'member.added', workspaceId: ws.id, detail: `joined as ${roleLabel(ws, role)} by invitation` });
        accepted++;
      }
      await invites.delete(inv.id);
    }
  } catch {
    // a failed invitation lookup must never break sign-in
  }
  return accepted;
}

/** The roles of a workspace as the screens need them, with how many people hold each and which ones this person may hand out. */
export function rolesView(ws: WorkspaceDoc, actorUid: string | null) {
  const mine = actorUid ? permissionsOf(ws, actorUid) : new Set<never>();
  const counts = new Map<string, number>();
  for (const r of Object.values(ws.members)) counts.set(r, (counts.get(r) ?? 0) + 1);
  return allRoles(ws).map((r) => ({
    id: r.id, name: r.name, description: r.description, builtin: r.builtin, permissions: r.permissions, memberCount: counts.get(r.id) ?? 0,
    assignable: r.id !== 'owner' && isSubset(r.permissions, mine as Set<never>),
    editable: !r.builtin && isSubset(r.permissions, mine as Set<never>),
  }));
}

async function team(ws: WorkspaceDoc, actorUid: string) {
  const store = getFirestoreStore();
  const members = await Promise.all(Object.entries(ws.members).map(async ([uid, role]) => {
    const u = await store.getUser(uid);
    const id = roleIdOf(ws, uid) ?? role;
    return { uid, role: id, roleName: roleLabel(ws, id), email: u?.email ?? '', displayName: u?.displayName ?? 'AdLens User' };
  }));
  const order = { owner: 0, admin: 1, moderator: 2, member: 3 } as Record<string, number>;
  members.sort((a, b) => (order[a.role] ?? 4) - (order[b.role] ?? 4) || a.displayName.localeCompare(b.displayName));
  const invites = (await getInviteStore().listForWorkspace(ws.id)).map((i) => ({ id: i.id, email: i.email, role: i.role, roleName: roleLabel(ws, i.role), createdAt: i.createdAt }));
  const mine = permissionsOf(ws, actorUid);
  const myRole = roleIdOf(ws, actorUid) ?? 'member';
  return {
    members, invites, limit: getPlanFeatures(ws.plan).maxMembers, plan: ws.plan, joinDomain: ws.joinDomain ?? null,
    roles: rolesView(ws, actorUid),
    permissionList: PERMISSIONS.map((id) => ({ id, ...PERMISSION_INFO[id] })),
    maxCustomRoles: MAX_CUSTOM_ROLES,
    yourRole: myRole, yourRoleName: roleLabel(ws, myRole), yourPermissions: [...mine],
    canManage: mine.has('team.manage'), canManageRoles: mine.has('roles.manage'),
  };
}

async function load(req: Request, res: Response): Promise<{ ws: WorkspaceDoc; role: WorkspaceRole; perms: Set<string> } | null> {
  const ws = await getFirestoreStore().getWorkspace(String(req.params.wsId || '').trim());
  const role = ws ? roleIdOf(ws, req.user!.uid) : null;
  if (!ws || !role) { fail(res, 404, 'NOT_FOUND', 'Workspace not found.'); return null; }
  return { ws, role, perms: permissionsOf(ws, req.user!.uid) };
}

teamRouter.get('/:wsId', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  res.json(await team(ctx.ws, req.user!.uid));
});

/** Why a person may not give out this role, or null when it is fine. */
function assignProblem(ws: WorkspaceDoc, actorPerms: Set<string>, roleId: string): string | null {
  const def = roleDef(ws, roleId);
  if (roleId === 'owner') return 'The owner role cannot be given to anyone.';
  if (!def) return 'That role does not exist.';
  if (!isSubset(def.permissions, actorPerms as never)) return 'You cannot give someone a role with more access than you have.';
  return null;
}

const addSchema = z.object({ email: z.string().trim().toLowerCase().max(254), role: z.string().trim().max(40).default('member') });

teamRouter.post('/:wsId/members', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (!ctx.perms.has('team.manage')) return fail(res, 403, 'NOT_ALLOWED', 'Your role does not allow adding people.');
  const body = addSchema.safeParse(req.body);
  if (!body.success || !EMAIL.test(body.data.email)) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a valid email address.');
  const { email, role } = body.data;
  const problem = assignProblem(ctx.ws, ctx.perms, role);
  if (problem) return fail(res, 403, 'NOT_ALLOWED', problem);

  const store = getFirestoreStore();
  const invites = getInviteStore();
  const pending = await invites.listForWorkspace(ctx.ws.id);
  if (pending.some((i) => i.email === email)) return fail(res, 409, 'ALREADY_INVITED', 'That email already has a pending invitation.');
  const existing = await store.findUserByEmail(email);
  if (existing && Object.prototype.hasOwnProperty.call(ctx.ws.members, existing.uid)) return fail(res, 409, 'ALREADY_MEMBER', 'That person is already in this workspace.');
  const limit = getPlanFeatures(ctx.ws.plan).maxMembers;
  if (Object.keys(ctx.ws.members).length + pending.length >= limit) {
    return fail(res, 403, 'PLAN_MEMBER_LIMIT', `Your plan allows ${limit} ${limit === 1 ? 'person' : 'people'} in a workspace, including pending invitations. Upgrade to add more.`);
  }

  if (existing) {
    await store.addWorkspaceMember(ctx.ws.id, existing.uid, role);
    void recordAudit({ uid: req.user!.uid, action: 'member.added', workspaceId: ctx.ws.id, detail: `${roleLabel(ctx.ws, role)}: ${existing.displayName}` });
    return void res.status(201).json({ added: true, invited: false, ...(await team((await store.getWorkspace(ctx.ws.id))!, req.user!.uid)) });
  }
  await invites.put({ id: newInviteId(), workspaceId: ctx.ws.id, email, role, invitedBy: req.user!.uid, createdAt: new Date().toISOString() });
  void recordAudit({ uid: req.user!.uid, action: 'member.invited', workspaceId: ctx.ws.id, detail: `${roleLabel(ctx.ws, role)}: ${email}` });
  res.status(201).json({ added: false, invited: true, ...(await team(ctx.ws, req.user!.uid)) });
});

teamRouter.delete('/:wsId/invites/:id', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (!ctx.perms.has('team.manage')) return fail(res, 403, 'NOT_ALLOWED', 'Your role does not allow cancelling invitations.');
  const inv = await getInviteStore().get(String(req.params.id));
  if (!inv || inv.workspaceId !== ctx.ws.id) return fail(res, 404, 'NOT_FOUND', 'Invitation not found.');
  await getInviteStore().delete(inv.id);
  res.status(204).end();
});

/** Shared by the workspace screen and the operator's: remove one member, never the owner. */
export async function removeMember(ws: WorkspaceDoc, targetUid: string): Promise<'ok' | 'owner' | 'missing'> {
  if (!Object.prototype.hasOwnProperty.call(ws.members, targetUid)) return 'missing';
  if (ws.members[targetUid] === 'owner' || ws.ownerId === targetUid) return 'owner';
  await getFirestoreStore().removeWorkspaceMember(ws.id, targetUid);
  return 'ok';
}

teamRouter.delete('/:wsId/members/:uid', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  const target = String(req.params.uid);
  const self = target === req.user!.uid;
  if (!self && roleIdOf(ctx.ws, target) === 'owner') return fail(res, 403, 'NOT_ALLOWED', 'The owner cannot be removed.');
  const targetPerms = permissionsOf(ctx.ws, target);
  const allowed = self || (ctx.perms.has('team.manage') && isSubset([...targetPerms], ctx.perms as never));
  if (!allowed) return fail(res, 403, 'NOT_ALLOWED', 'You cannot remove this person. Their role has more access than yours.');
  const result = await removeMember(ctx.ws, target);
  if (result === 'owner') return fail(res, 409, 'OWNER_CANNOT_BE_REMOVED', 'The owner cannot be removed. Delete the workspace instead.');
  if (result === 'missing') return fail(res, 404, 'NOT_FOUND', 'That person is not in this workspace.');
  void recordAudit({ uid: req.user!.uid, action: 'member.removed', workspaceId: ctx.ws.id, detail: self ? 'left' : 'removed' });
  res.status(204).end();
});

teamRouter.patch('/:wsId/members/:uid', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (!ctx.perms.has('roles.manage')) return fail(res, 403, 'NOT_ALLOWED', 'Your role does not allow changing roles.');
  const body = z.object({ role: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Choose a role.');
  const target = String(req.params.uid);
  const current = roleIdOf(ctx.ws, target);
  if (!current) return fail(res, 404, 'NOT_FOUND', 'That person is not in this workspace.');
  if (current === 'owner') return fail(res, 409, 'OWNER_ROLE_FIXED', "The owner's role cannot be changed.");
  const problem = assignProblem(ctx.ws, ctx.perms, body.data.role);
  if (problem) return fail(res, 403, 'NOT_ALLOWED', problem);
  if (!isSubset([...permissionsOf(ctx.ws, target)], ctx.perms as never)) return fail(res, 403, 'NOT_ALLOWED', 'You cannot change the role of someone who has more access than you.');
  await getFirestoreStore().updateWorkspace(ctx.ws.id, { members: { ...ctx.ws.members, [target]: body.data.role } });
  void recordAudit({ uid: req.user!.uid, action: 'member.role_changed', workspaceId: ctx.ws.id, detail: `to ${roleLabel(ctx.ws, body.data.role)}` });
  res.json(await team((await getFirestoreStore().getWorkspace(ctx.ws.id))!, req.user!.uid));
});

// ---------------------------------------------------------------------------
// Custom roles
// ---------------------------------------------------------------------------

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Give the role a name of at least 2 characters.').max(30, 'Keep the role name under 30 characters.'),
  description: z.string().trim().max(120).optional().default(''),
  permissions: z.array(z.string()).max(40),
});

function nameTaken(ws: WorkspaceDoc, name: string, exceptId?: string): boolean {
  const n = name.trim().toLowerCase();
  return allRoles(ws).some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === n);
}

teamRouter.post('/:wsId/roles', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (!ctx.perms.has('roles.manage')) return fail(res, 403, 'NOT_ALLOWED', 'Your role does not allow creating roles.');
  const body = roleSchema.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', body.error.issues[0]?.message || 'Check the role name and permissions.');
  const permissions = cleanPermissions(body.data.permissions);
  if (!isSubset(permissions, ctx.perms as never)) return fail(res, 403, 'NOT_ALLOWED', 'You can only give a role permissions that you have yourself.');
  if (nameTaken(ctx.ws, body.data.name)) return fail(res, 409, 'ROLE_NAME_TAKEN', 'A role with that name already exists.');
  const existing = ctx.ws.customRoles ?? {};
  if (Object.keys(existing).length >= MAX_CUSTOM_ROLES) return fail(res, 403, 'ROLE_LIMIT', `A workspace can have up to ${MAX_CUSTOM_ROLES} custom roles.`);
  const id = newRoleId();
  await getFirestoreStore().updateWorkspace(ctx.ws.id, { customRoles: { ...existing, [id]: { name: body.data.name, ...(body.data.description ? { description: body.data.description } : {}), permissions, createdAt: new Date().toISOString() } } });
  void recordAudit({ uid: req.user!.uid, action: 'role.created', workspaceId: ctx.ws.id, detail: `${body.data.name}: ${permissions.length} permissions` });
  res.status(201).json({ roleId: id, ...(await team((await getFirestoreStore().getWorkspace(ctx.ws.id))!, req.user!.uid)) });
});

teamRouter.put('/:wsId/roles/:roleId', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (!ctx.perms.has('roles.manage')) return fail(res, 403, 'NOT_ALLOWED', 'Your role does not allow changing roles.');
  const id = String(req.params.roleId);
  const existing = ctx.ws.customRoles?.[id];
  if (!existing) return fail(res, 404, 'NOT_FOUND', id in { owner: 1, admin: 1, moderator: 1, member: 1 } ? 'The built-in roles cannot be changed.' : 'Role not found.');
  const body = roleSchema.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', body.error.issues[0]?.message || 'Check the role name and permissions.');
  const permissions = cleanPermissions(body.data.permissions);
  if (!isSubset(cleanPermissions(existing.permissions), ctx.perms as never) || !isSubset(permissions, ctx.perms as never)) {
    return fail(res, 403, 'NOT_ALLOWED', 'You can only change roles whose permissions you have yourself.');
  }
  if (nameTaken(ctx.ws, body.data.name, id)) return fail(res, 409, 'ROLE_NAME_TAKEN', 'A role with that name already exists.');
  await getFirestoreStore().updateWorkspace(ctx.ws.id, { customRoles: { ...(ctx.ws.customRoles ?? {}), [id]: { ...existing, name: body.data.name, ...(body.data.description ? { description: body.data.description } : {}), permissions } } });
  void recordAudit({ uid: req.user!.uid, action: 'role.updated', workspaceId: ctx.ws.id, detail: `${body.data.name}: ${permissions.length} permissions` });
  res.json(await team((await getFirestoreStore().getWorkspace(ctx.ws.id))!, req.user!.uid));
});

teamRouter.delete('/:wsId/roles/:roleId', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (!ctx.perms.has('roles.manage')) return fail(res, 403, 'NOT_ALLOWED', 'Your role does not allow deleting roles.');
  const id = String(req.params.roleId);
  const existing = ctx.ws.customRoles?.[id];
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Role not found. The built-in roles cannot be deleted.');
  if (!isSubset(cleanPermissions(existing.permissions), ctx.perms as never)) return fail(res, 403, 'NOT_ALLOWED', 'You can only delete roles whose permissions you have yourself.');
  const rest = { ...(ctx.ws.customRoles ?? {}) };
  delete rest[id];
  const members = Object.fromEntries(Object.entries(ctx.ws.members).map(([uid, r]) => [uid, r === id ? 'member' : r]));
  await getFirestoreStore().updateWorkspace(ctx.ws.id, { customRoles: rest, members });
  const invites = getInviteStore();
  for (const inv of await invites.listForWorkspace(ctx.ws.id)) if (inv.role === id) await invites.put({ ...inv, role: 'member' });
  void recordAudit({ uid: req.user!.uid, action: 'role.deleted', workspaceId: ctx.ws.id, detail: `${existing.name}: people moved to Member` });
  res.json(await team((await getFirestoreStore().getWorkspace(ctx.ws.id))!, req.user!.uid));
});

// ---------------------------------------------------------------------------
// "Same company email": colleagues are offered the chance to join (never added silently)
// ---------------------------------------------------------------------------

/** The owner's own email domain, if it is a company domain that can be offered. */
async function ownerOfferDomain(ws: WorkspaceDoc): Promise<string | null> {
  const owner = await getFirestoreStore().getUser(ws.ownerId);
  const domain = domainOfEmail(owner?.email);
  return domain && !isFreeMailDomain(domain) ? domain : null;
}

// Owner only. The domain is always the owner's own email domain, so nobody can aim the offer at a domain that is not theirs.
teamRouter.put('/:wsId/domain-join', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (ctx.role !== 'owner') return fail(res, 403, 'NOT_ALLOWED', 'Only the owner can change this.');
  const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
  if (typeof enabled !== 'boolean') return fail(res, 400, 'VALIDATION_ERROR', 'Choose on or off.');
  let domain: string | null = null;
  if (enabled) {
    const myDomain = domainOfEmail(req.user!.email);
    if (!req.user!.emailVerified || !myDomain || isFreeMailDomain(myDomain)) {
      return fail(res, 400, 'NO_COMPANY_DOMAIN', 'This needs a verified company email address. Personal addresses such as Gmail cannot be offered to others.');
    }
    domain = myDomain;
  }
  const updated = await getFirestoreStore().setWorkspaceJoinDomain(ctx.ws.id, domain);
  res.json(await team(updated ?? ctx.ws, req.user!.uid));
});

// Workspaces that would welcome this signed-in person because their verified email is on the same company domain.
teamRouter.get('/offers/mine', async (req: Request, res: Response) => {
  const domain = domainOfEmail(req.user!.email);
  if (!req.user!.emailVerified || !domain || isFreeMailDomain(domain)) return void res.json({ offers: [] });
  const store = getFirestoreStore();
  const found = await store.listWorkspacesByJoinDomain(domain);
  const offers = [];
  for (const ws of found) {
    if (Object.prototype.hasOwnProperty.call(ws.members, req.user!.uid)) continue;
    if (Object.keys(ws.members).length >= getPlanFeatures(ws.plan).maxMembers) continue;
    if ((await ownerOfferDomain(ws)) !== domain) continue; // the owner's address must still be on that domain
    const owner = await store.getUser(ws.ownerId);
    offers.push({ workspaceId: ws.id, workspaceName: ws.name, ownerName: owner?.displayName ?? 'the owner', domain });
  }
  res.json({ offers });
});

teamRouter.post('/offers/:wsId/accept', async (req: Request, res: Response) => {
  const store = getFirestoreStore();
  const ws = await store.getWorkspace(String(req.params.wsId || '').trim());
  const domain = domainOfEmail(req.user!.email);
  if (!ws || !req.user!.emailVerified || !domain || isFreeMailDomain(domain) || ws.joinDomain !== domain || (await ownerOfferDomain(ws)) !== domain) {
    return fail(res, 404, 'NOT_FOUND', 'This invitation is no longer available.');
  }
  if (Object.prototype.hasOwnProperty.call(ws.members, req.user!.uid)) return void res.json({ joined: true, workspaceId: ws.id });
  const limit = getPlanFeatures(ws.plan).maxMembers;
  if (Object.keys(ws.members).length >= limit) return fail(res, 403, 'PLAN_MEMBER_LIMIT', 'This team is full on its current plan. Ask the workspace owner to upgrade.');
  await store.addWorkspaceMember(ws.id, req.user!.uid, 'member');
  void recordAudit({ uid: req.user!.uid, action: 'member.added', workspaceId: ws.id, detail: 'joined by company email' });
  res.json({ joined: true, workspaceId: ws.id });
});
