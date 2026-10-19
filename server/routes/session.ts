import { Router, type Request, type Response } from 'express';
import { clearSession } from '../lib/session.js';
import { requireUser } from '../middleware/requireUser.js';

export const sessionRouter = Router();

sessionRouter.use(requireUser);

// POST /api/session/clear (requireUser) clears the cookie's Google data without revoking; called on sign-out.
sessionRouter.post('/clear', (_req: Request, res: Response) => {
  clearSession(res);
  res.json({ ok: true });
});
