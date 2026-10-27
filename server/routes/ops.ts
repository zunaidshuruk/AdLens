import { timingSafeEqual, createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { productionDigestDeps } from '../lib/digestWiring.js';
import { runDigests } from '../lib/digestRunner.js';
import { listAuditForUid } from '../lib/auditLog.js';
import { getSharedStore } from '../lib/sharedStore.js';
import { readUsage } from '../lib/usageMeter.js';
import { requireUser } from '../middleware/requireUser.js';

export const opsRouter = Router();

export function isOperator(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  const list = (env.OPERATOR_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

// Public: for uptime monitors. Proves the server is up and its cache store answers. Reveals nothing else.
opsRouter.get('/ready', async (_req: Request, res: Response) => {
  const key = `ready:${Date.now()}`;
  try {
    const store = getSharedStore();
    await store.set(key, '1', 10_000);
    const ok = (await store.get(key)) === '1';
    await store.del(key);
    res.status(ok ? 200 : 503).json({ ok });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// The signed-in person's own security history.
opsRouter.get('/audit', requireUser, async (req: Request, res: Response) => {
  const events = await listAuditForUid(req.user!.uid, 100);
  res.json({ events: events.map((e) => ({ id: e.id, at: e.at, action: e.action, detail: e.detail ?? null })) });
});

// Owner only (OPERATOR_EMAILS): how many calls AdLens has made to Google and Meta today and on the previous days.
opsRouter.get('/usage', requireUser, async (req: Request, res: Response) => {
  if (!isOperator(req.user!.email)) {
    res.status(403).json({ error: { code: 'NOT_ALLOWED', message: 'Only the owner of this AdLens installation can see this.' } });
    return;
  }
  res.json({
    sharedStore: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ? 'upstash' : 'memory',
    errorAlertsConfigured: Boolean(process.env.ERROR_WEBHOOK_URL),
    days: await readUsage(3),
  });
});

const sameSecret = (given: string, expected: string): boolean => {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
};

// Called once a day by a scheduler (Cloud Scheduler, GitHub Actions cron...) with "Authorization: Bearer <CRON_SECRET>".
opsRouter.post('/run-digests', async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) {
    res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'CRON_SECRET is not set (use at least 16 characters).' } });
    return;
  }
  const header = req.header('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !sameSecret(given, secret)) {
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Not allowed.' } });
    return;
  }
  res.json(await runDigests(productionDigestDeps()));
});
