/**
 * Workspace rule: "owners and admins must use two-step verification" (Sprint 25). Off by default; an owner or admin turns it on in
 * Settings → Security. While it is on, an owner or admin who has not set up two-step can still sign in and reach the Security page
 * to set it up, but cannot open the workspace's data or change anything in it until they have.
 */
import type { Request, Response } from 'express';
import { getFirestoreStore, type WorkspaceDoc } from './firestore.js';
import { roleIdOf } from './permissions.js';
import { twoStepStore } from './twoStep.js';

const ENFORCED_ROLES = new Set(['owner', 'admin']);

/** True when this workspace asks this person for two-step (rule is on and they are an owner or admin). */
export function twoStepAskedOf(ws: Pick<WorkspaceDoc, 'requireTwoStep' | 'members' | 'ownerId'>, uid: string): boolean {
  if (!ws.requireTwoStep) return false;
  const role = roleIdOf(ws, uid);
  return role !== null && ENFORCED_ROLES.has(role);
}

export async function hasTwoStepOn(uid: string): Promise<boolean> {
  try { return Boolean((await twoStepStore().get(uid))?.enabled); } catch { return false; } // cannot tell: treat as not set up
}

/** True when the person must set up two-step before using this workspace. */
export async function mustSetUpTwoStep(ws: Pick<WorkspaceDoc, 'requireTwoStep' | 'members' | 'ownerId'>, uid: string): Promise<boolean> {
  return twoStepAskedOf(ws, uid) && !(await hasTwoStepOn(uid));
}

export const SETUP_REQUIRED = { code: 'TWO_STEP_SETUP_REQUIRED', message: 'This workspace requires owners and admins to use two-step verification. Turn it on under Settings, Security, then try again.' } as const;

/** Is this person an owner/admin somewhere that requires two-step? Used to stop them from switching their own two-step off. */
export async function workspaceRequiringTwoStep(uid: string): Promise<WorkspaceDoc | null> {
  const list = await getFirestoreStore().listWorkspacesForUser(uid);
  return list.find((w) => twoStepAskedOf(w, uid)) ?? null;
}

/** Express guard for routes that start with /:wsId. Reading the workspace list is never blocked (so the page can explain); changes are. */
export async function guardWorkspaceParam(req: Request, res: Response, next: (e?: unknown) => void, wsId: string): Promise<void> {
  try {
    if (req.method === 'GET' || req.method === 'HEAD' || !req.user) return next();
    const ws = await getFirestoreStore().getWorkspace(wsId);
    if (ws && (await mustSetUpTwoStep(ws, req.user.uid))) {
      res.status(403).json({ error: { ...SETUP_REQUIRED } });
      return;
    }
    next();
  } catch (e) { next(e); }
}
