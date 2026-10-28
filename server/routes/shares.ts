import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { getContentLimits } from '../config/plans.js';
import { getServerConfig } from '../config.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { pdfName } from '../lib/emailSchedules.js';
import { snapshotToPdf } from '../lib/pdf.js';
import { ShareSourceError, refreshShare, snapshotForTarget } from '../lib/shareWiring.js';
import { getShareStore, hashPassword, hashToken, newToken, publicShare, shareInputSchema, type StoredShare } from '../lib/shares.js';
import { openAgentSecret, sealAgentSecret } from '../lib/tokenVault.js';
import { getAgentKeyring } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** Owner side of share links: make, list, refresh and turn off. */
export const sharesRouter = Router();

const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };

sharesRouter.use(requireUser);
sharesRouter.use(verifyGoogleSessionOwnership);
sharesRouter.use(loadProject);

interface Scope { ws: string; project: string; plan: string | undefined; uid: string }
async function scope(req: Request, res: Response): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  // Share links hand data to people outside the workspace, so only people who can edit content may manage them.
  if (!ws || !can(ws, req.user!.uid, 'content.edit')) { fail(res, 403, 'NOT_ALLOWED', 'You do not have permission to share in this project.'); return null; }
  return { ws: project.workspaceId, project: project.id, plan: ws.plan, uid: req.user!.uid };
}

const urlFor = (s: StoredShare): string | null => {
  try { return `${getServerConfig().appBaseUrl.replace(/\/+$/, '')}/s/${openAgentSecret(s.sealedToken, s.createdBy, s.id, getAgentKeyring())}`; } catch { return null; }
};
const withUrl = (s: StoredShare) => ({ ...publicShare(s), url: urlFor(s) });

sharesRouter.get('/', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const list = (await getShareStore().listForProject(s.ws, s.project)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ shares: list.map(withUrl), limit: getContentLimits(s.plan).maxShareLinks });
  } catch { fail(res, 500, 'SHARE_FAILED', 'Something went wrong with share links.'); }
});

sharesRouter.post('/', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const parsed = shareInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_SHARE', parsed.error.issues[0]?.message || 'The share settings are not valid.');
    const input = parsed.data;
    const store = getShareStore();
    const limit = getContentLimits(s.plan).maxShareLinks;
    const live = (await store.listForProject(s.ws, s.project)).filter((x) => !x.revokedAt);
    if (live.length >= limit) return fail(res, 409, 'LIMIT_REACHED', `Your plan allows ${limit} share ${limit === 1 ? 'link' : 'links'} per project. Turn one off or upgrade to add more.`);
    let built;
    try { built = await snapshotForTarget({ kind: input.kind, targetId: input.targetId, workspaceId: s.ws, projectId: s.project, ownerUid: s.uid, rangeDays: input.rangeDays }); }
    catch (e) { if (e instanceof ShareSourceError) return fail(res, 404, 'NOT_FOUND', e.message); throw e; }
    const id = randomBytes(9).toString('base64url');
    const token = newToken();
    const now = new Date();
    const pw = input.password ? hashPassword(input.password) : null;
    const share: StoredShare = {
      id, workspaceId: s.ws, projectId: s.project, createdBy: s.uid, createdAt: now.toISOString(),
      kind: input.kind, targetId: input.targetId, title: built.title, rangeDays: input.rangeDays, autoRefresh: input.autoRefresh,
      tokenHash: hashToken(token), sealedToken: sealAgentSecret(token, s.uid, id, getAgentKeyring()),
      ...(pw ? { passwordSalt: pw.salt, passwordHash: pw.hash } : {}),
      ...(input.expiresInDays ? { expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000).toISOString() } : {}),
      views: 0, refreshedAt: now.toISOString(), snapshot: built.snapshot,
    };
    const failed = built.snapshot.widgets.filter((w) => w.error).length;
    if (failed > 0) share.refreshError = `${failed} ${failed === 1 ? 'panel' : 'panels'} could not be loaded. Check your connections.`;
    await store.put(share);
    res.status(201).json({ share: withUrl(share) });
  } catch { fail(res, 500, 'SHARE_FAILED', 'Could not make the link.'); }
});

/** A PDF of a dashboard or saved report, made now from live numbers. Nothing is stored. */
sharesRouter.post('/pdf', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const parsed = shareInputSchema.pick({ kind: true, targetId: true, rangeDays: true }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_SHARE', parsed.error.issues[0]?.message || 'The settings are not valid.');
    let built;
    try { built = await snapshotForTarget({ ...parsed.data, workspaceId: s.ws, projectId: s.project, ownerUid: s.uid }); }
    catch (e) { if (e instanceof ShareSourceError) return fail(res, 404, 'NOT_FOUND', e.message); throw e; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfName(built.title, built.snapshot)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(snapshotToPdf(built.snapshot, req.project?.name));
  } catch { fail(res, 500, 'SHARE_FAILED', 'Could not make the PDF.'); }
});

async function load(req: Request, res: Response, s: Scope): Promise<StoredShare | null> {
  const share = await getShareStore().get(String(req.params.id));
  if (!share || share.workspaceId !== s.ws || share.projectId !== s.project) { fail(res, 404, 'NOT_FOUND', 'That link was not found.'); return null; }
  return share;
}

sharesRouter.post('/:id/refresh', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const share = await load(req, res, s);
    if (!share) return;
    if (share.revokedAt) return fail(res, 409, 'TURNED_OFF', 'This link is turned off.');
    const next = await refreshShare(share);
    await getShareStore().put(next);
    res.json({ share: withUrl(next) });
  } catch { fail(res, 500, 'SHARE_FAILED', 'Could not refresh the link.'); }
});

/** Turns a link off for good: the record and its snapshot are deleted, so the address stops working at once. */
sharesRouter.delete('/:id', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const share = await load(req, res, s);
    if (!share) return;
    await getShareStore().delete(share.id);
    res.status(204).end();
  } catch { fail(res, 500, 'SHARE_FAILED', 'Could not delete the link.'); }
});
