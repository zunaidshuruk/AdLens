import express, { Router, type Request, type Response } from 'express';
import { getServerConfig } from '../config.js';
import {
  getMetaDeletionStore,
  newConfirmationCode,
  parseSignedRequest,
  type DeletionRequestRecord,
} from '../lib/metaDeletion.js';
import { getVault } from '../lib/vault.js';

/**
 * Public endpoints called by Meta (no sign-in; the signed request is the proof).
 *   POST /api/platform/meta/deauthorize     the person removed AdLens in Facebook settings
 *   POST /api/platform/meta/data-deletion   the person asked Facebook to delete their AdLens data
 *   GET  /api/platform/data-deletion/status?code=...   status page data
 */
export const metaCallbacksRouter = Router();
metaCallbacksRouter.use(express.urlencoded({ extended: false, limit: '16kb' }));

async function removeFacebookData(facebookUserId: string): Promise<'completed' | 'nothing_stored'> {
  const store = getMetaDeletionStore();
  const uid = await store.findUid(facebookUserId);
  if (!uid) return 'nothing_stored';
  try {
    await getVault().deleteConnection(uid, 'meta');
  } catch {
    // the connection may already be gone; the link is still removed below
  }
  await store.unlinkFacebookUser(facebookUserId);
  return 'completed';
}

async function handle(req: Request, res: Response, kind: DeletionRequestRecord['kind']): Promise<void> {
  const cfg = getServerConfig();
  const payload = parseSignedRequest((req.body as { signed_request?: unknown } | undefined)?.signed_request, cfg.metaAppSecret);
  if (!payload) {
    res.status(400).json({ error: { code: 'INVALID_SIGNED_REQUEST', message: 'The request could not be verified.' } });
    return;
  }
  try {
    const status = await removeFacebookData(payload.user_id);
    const now = new Date().toISOString();
    const code = newConfirmationCode();
    await getMetaDeletionStore().saveRequest({ code, kind, status, requestedAt: now, completedAt: now });
    res.json({ url: `${cfg.appBaseUrl}/data-deletion?code=${code}`, confirmation_code: code });
  } catch {
    res.status(500).json({ error: { code: 'DELETION_FAILED', message: 'The request could not be processed. Please try again.' } });
  }
}

metaCallbacksRouter.post('/meta/deauthorize', (req, res) => void handle(req, res, 'deauthorize'));
metaCallbacksRouter.post('/meta/data-deletion', (req, res) => void handle(req, res, 'data_deletion'));

metaCallbacksRouter.get('/data-deletion/status', async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!/^[a-f0-9]{24}$/.test(code)) {
    res.status(400).json({ error: { code: 'INVALID_CODE', message: 'That confirmation code is not valid.' } });
    return;
  }
  const rec = await getMetaDeletionStore().getRequest(code);
  if (!rec) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No request was found for that code.' } });
    return;
  }
  res.json({ status: rec.status, kind: rec.kind, requestedAt: rec.requestedAt, completedAt: rec.completedAt });
});
