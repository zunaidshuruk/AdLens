/**
 * Team (Sprint 20): who belongs to a workspace. Owners and admins add people by email; someone with no AdLens account yet
 * gets a pending invitation that is accepted when they sign in with that (verified) email.
 * Everyone brings their OWN Google and Meta connection: adding a person never shares the owner's connections.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getPlanFeatures } from '../config/plans.js';
import { recordAudit } from '../lib/auditLog.js';
import { getFirestoreStore, type WorkspaceDoc, type WorkspaceRole } from '../lib/firestore.js';
import { domainOfEmail, isFreeMailDomain } from '../lib/orgSso.js';
import { getInviteStore, newInviteId } from '../lib/inviteStore.js';
import { requireUser } from '../middleware/requireUser.js';

export const teamRouter = Router();
teamRouter.use(requireUser);

const fail = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const roleOf = (ws: WorkspaceDoc | null, uid: string): WorkspaceRole | null =>
  ws && Object.prototype.hasOwnProperty.call(ws.members, uid) ? ws.members[uid] : null;

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
        await store.addWorkspaceMember(ws.id, uid, inv.role);
        void recordAudit({ uid, action: 'member.added', workspaceId: ws.id, detail: `joined as ${inv.role} by invitation` });
        accepted++;
      }
      await invites.delete(inv.id);
    }
  } catch {
    // a failed invitation lookup must never break sign-in
  }
  return accepted;
}

async function team(ws: WorkspaceDoc) {
  const store = getFirestoreStore();
  const members = await Promise.all(Object.entries(ws.members).map(async ([uid, role]) => {
    const u = await store.getUser(uid);
    return { uid, role, email: u?.email ?? '', displayName: u?.displayName ?? 'AdLens User' };
  }));
  const order = { owner: 0, admin: 1, member: 2 } as Record<string, number>;
  members.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || a.displayName.localeCompare(b.displayName));
  const invites = (await getInviteStore().listForWorkspace(ws.id)).map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt }));
  return { members, invites, limit: getPlanFeatures(ws.plan).maxMembers, plan: ws.plan, joinDomain: ws.joinDomain ?? null };
}

async function load(req: Request, res: Response): Promise<{ ws: WorkspaceDoc; role: WorkspaceRole } | null> {
  const ws = await getFirestoreStore().getWorkspace(String(req.params.wsId || '').trim());
  const role = roleOf(ws, req.user!.uid);
  if (!ws || !role) { fail(res, 404, 'NOT_FOUND', 'Workspace not found.'); return null; }
  return { ws, role };
}

teamRouter.get('/:wsId', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  res.json({ ...(await team(ctx.ws)), yourRole: ctx.role, canManage: ctx.role === 'owner' || ctx.role === 'admin' });
});

const addSchema = z.object({ email: z.string().trim().toLowerCase().max(254), role: z.enum(['admin', 'member']).default('member') });

teamRouter.post('/:wsId/members', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (ctx.role !== 'owner' && ctx.role !== 'admin') return fail(res, 403, 'NOT_ALLOWED', 'Only the owner or an admin can add people.');
  const body = addSchema.safeParse(req.body);
  if (!body.success || !EMAIL.test(body.data.email)) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a valid email address.');
  const { email, role } = body.data;
  if (role === 'admin' && ctx.role !== 'owner') return fail(res, 403, 'NOT_ALLOWED', 'Only the owner can make someone an admin.');

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
    void recordAudit({ uid: req.user!.uid, action: 'member.added', workspaceId: ctx.ws.id, detail: `${role}: ${existing.displayName}` });
    return void res.status(201).json({ added: true, invited: false, ...(await team((await store.getWorkspace(ctx.ws.id))!)) });
  }
  await invites.put({ id: newInviteId(), workspaceId: ctx.ws.id, email, role, invitedBy: req.user!.uid, createdAt: new Date().toISOString() });
  void recordAudit({ uid: req.user!.uid, action: 'member.invited', workspaceId: ctx.ws.id, detail: `${role}: ${email}` });
  res.status(201).json({ added: false, invited: true, ...(await team(ctx.ws)) });
});

teamRouter.delete('/:wsId/invites/:id', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (ctx.role !== 'owner' && ctx.role !== 'admin') return fail(res, 403, 'NOT_ALLOWED', 'Only the owner or an admin can cancel invitations.');
  const inv = await getInviteStore().get(String(req.params.id));
  if (!inv || inv.workspaceId !== ctx.ws.id) return fail(res, 404, 'NOT_FOUND', 'Invitation not found.');
  await getInviteStore().delete(inv.id);
  res.status(204).end();
});

/** Shared by the owner's screen and the operator's: remove one member, never the owner. */
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
  const targetRole = roleOf(ctx.ws, target);
  const self = target === req.user!.uid;
  const allowed = self || ctx.role === 'owner' || (ctx.role === 'admin' && targetRole === 'member');
  if (!allowed) return fail(res, 403, 'NOT_ALLOWED', 'You cannot remove this person.');
  const result = await removeMember(ctx.ws, target);
  if (result === 'owner') return fail(res, 409, 'OWNER_CANNOT_BE_REMOVED', 'The owner cannot be removed. Delete the workspace instead.');
  if (result === 'missing') return fail(res, 404, 'NOT_FOUND', 'That person is not in this workspace.');
  void recordAudit({ uid: req.user!.uid, action: 'member.removed', workspaceId: ctx.ws.id, detail: self ? 'left' : 'removed' });
  res.status(204).end();
});

teamRouter.patch('/:wsId/members/:uid', async (req: Request, res: Response) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  if (ctx.role !== 'owner') return fail(res, 403, 'NOT_ALLOWED', 'Only the owner can change roles.');
  const body = z.object({ role: z.enum(['admin', 'member']) }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Choose admin or member.');
  const target = String(req.params.uid);
  const current = roleOf(ctx.ws, target);
  if (!current) return fail(res, 404, 'NOT_FOUND', 'That person is not in this workspace.');
  if (current === 'owner') return fail(res, 409, 'OWNER_ROLE_FIXED', "The owner's role cannot be changed.");
  await getFirestoreStore().updateWorkspace(ctx.ws.id, { members: { ...ctx.ws.members, [target]: body.data.role } });
  void recordAudit({ uid: req.user!.uid, action: 'member.role_changed', workspaceId: ctx.ws.id, detail: `to ${body.data.role}` });
  res.json(await team((await getFirestoreStore().getWorkspace(ctx.ws.id))!));
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
  res.json(await team(updated ?? ctx.ws));
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
