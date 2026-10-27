import { Router, type Request, type Response } from 'express';
import { getFirestoreStore } from '../lib/firestore.js';
import { getDigestStore, subscriptionId } from '../lib/digestStore.js';
import { mailConfigured } from '../lib/mailer.js';
import { requireUser } from '../middleware/requireUser.js';

export const digestRouter = Router();
digestRouter.use(requireUser);

// What is turned on for me, plus whether this installation can send email at all.
digestRouter.get('/', async (req: Request, res: Response) => {
  const subs = await getDigestStore().listForUid(req.user!.uid);
  res.json({
    emailConfigured: mailConfigured(),
    email: req.user!.email,
    subscriptions: subs.map((s) => ({ workspaceId: s.workspaceId, projectId: s.projectId, weekly: s.weekly, alerts: s.alerts })),
  });
});

// Turn the weekly summary and/or alerts on or off for one project. Mail always goes to the person's own sign-in address.
digestRouter.put('/', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const workspaceId = typeof b.workspaceId === 'string' ? b.workspaceId.trim() : '';
  const projectId = typeof b.projectId === 'string' ? b.projectId.trim() : '';
  if (!workspaceId || !projectId || typeof b.weekly !== 'boolean' || typeof b.alerts !== 'boolean') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a project and whether to turn each option on or off.' } });
    return;
  }
  const email = req.user!.email;
  if (!email) {
    res.status(400).json({ error: { code: 'NO_EMAIL', message: 'Your account has no email address to send to.' } });
    return;
  }
  const fs = getFirestoreStore();
  const ws = await fs.getWorkspace(workspaceId);
  const isMember = Boolean(ws?.members && Object.prototype.hasOwnProperty.call(ws.members, uid));
  const project = isMember ? await fs.getProject(workspaceId, projectId) : null;
  if (!project || project.isDemo) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } });
    return;
  }
  const store = getDigestStore();
  const id = subscriptionId(uid, workspaceId, projectId);
  if (!b.weekly && !b.alerts) {
    await store.delete(id);
    res.json({ workspaceId, projectId, weekly: false, alerts: false });
    return;
  }
  const existing = (await store.listForUid(uid)).find((s) => s.id === id);
  await store.put({
    ...(existing ?? { createdAt: new Date().toISOString() }),
    id, uid, email, workspaceId, projectId, weekly: b.weekly, alerts: b.alerts,
  });
  res.json({ workspaceId, projectId, weekly: b.weekly, alerts: b.alerts });
});
