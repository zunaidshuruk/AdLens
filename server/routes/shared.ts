import { Router, type Request, type Response } from 'express';
import { pdfName } from '../lib/emailSchedules.js';
import { snapshotToPdf } from '../lib/pdf.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { checkPassword, getShareStore, hashToken, isLive, type StoredShare } from '../lib/shares.js';

/**
 * Public side of share links. No sign-in: the secret link is the key. Everything returned is the saved snapshot,
 * never anything live. Unknown, expired and turned-off links all look the same (404) so nobody can probe.
 */
export const sharedRouter = Router();

const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
sharedRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

async function find(token: string): Promise<StoredShare | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const share = await getShareStore().getByTokenHash(hashToken(token));
  return share && isLive(share) ? share : null;
}
const notAvailable = (res: Response) => fail(res, 404, 'NOT_AVAILABLE', 'This link is not available. It may have expired or been turned off.');

sharedRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const rl = await checkRateLimit('share-meta', req.ip ?? 'x', 120, 60_000);
    if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.');
    const share = await find(String(req.params.token));
    if (!share) return notAvailable(res);
    res.json({ title: share.title, kind: share.kind, needsPassword: Boolean(share.passwordHash) });
  } catch { fail(res, 500, 'SHARE_FAILED', 'Something went wrong.'); }
});

sharedRouter.post('/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    // Password guessing is slowed per link and per visitor.
    const [a, b] = await Promise.all([
      checkRateLimit('share-pw-link', hashToken(token).slice(0, 16), 30, 15 * 60_000),
      checkRateLimit('share-pw-ip', req.ip ?? 'x', 20, 15 * 60_000),
    ]);
    if (!a.allowed || !b.allowed) return fail(res, 429, 'RATE_LIMITED', 'Too many tries. Please wait a few minutes.');
    const share = await find(token);
    if (!share) return notAvailable(res);
    const password = typeof req.body?.password === 'string' ? req.body.password : undefined;
    if (share.passwordHash && !checkPassword(share, password)) {
      return fail(res, 401, password ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED', password ? 'That password is not right.' : 'This page needs a password.');
    }
    const store = getShareStore();
    await store.put({ ...share, views: share.views + 1, lastViewedAt: new Date().toISOString() }).catch(() => undefined);
    res.json({ snapshot: share.snapshot, expiresAt: share.expiresAt ?? null });
  } catch { fail(res, 500, 'SHARE_FAILED', 'Something went wrong.'); }
});

/** The saved snapshot as a PDF. Same password and rate rules as opening the page. */
sharedRouter.post('/:token/pdf', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const [a, b] = await Promise.all([
      checkRateLimit('share-pw-link', hashToken(token).slice(0, 16), 30, 15 * 60_000),
      checkRateLimit('share-pw-ip', req.ip ?? 'x', 20, 15 * 60_000),
    ]);
    if (!a.allowed || !b.allowed) return fail(res, 429, 'RATE_LIMITED', 'Too many tries. Please wait a few minutes.');
    const share = await find(token);
    if (!share) return notAvailable(res);
    const password = typeof req.body?.password === 'string' ? req.body.password : undefined;
    if (share.passwordHash && !checkPassword(share, password)) return fail(res, 401, password ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED', password ? 'That password is not right.' : 'This page needs a password.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfName(share.snapshot.title, share.snapshot)}"`);
    res.send(snapshotToPdf(share.snapshot));
  } catch { fail(res, 500, 'SHARE_FAILED', 'Something went wrong.'); }
});
