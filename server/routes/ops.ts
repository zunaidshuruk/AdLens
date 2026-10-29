import { runRankTracking } from '../lib/rankRunner.js';
import { getFirestoreStore as getWatchFirestore } from '../lib/firestore.js';
import { getProjectDocsStore as getWatchDocs } from '../lib/projectDocs.js';
import { fetchOnce } from '../lib/seoFetch.js';
import { getWatchStore, runWatches } from '../lib/watches.js';
import { defaultGbpDeps, getGbpStore } from '../lib/gbp.js';
import { runGbp } from '../lib/gbpRunner.js';
import { timingSafeEqual, createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { productionDigestDeps } from '../lib/digestWiring.js';
import { runDigests } from '../lib/digestRunner.js';
import { getScheduleStore, productionScheduleContext, productionSnapshot, runEmailSchedules } from '../lib/emailSchedules.js';
import { sendMail } from '../lib/mailer.js';
import { refreshDueShares } from '../lib/shareWiring.js';
import { getShareStore } from '../lib/shares.js';
import { cleanOrphans } from '../lib/memberCleanup.js';
import { runAlertRules } from '../lib/alertRunner.js';
import { productionAlertDeps } from '../lib/alertWiring.js';
import { listAuditForUid } from '../lib/auditLog.js';
import { getSharedStore } from '../lib/sharedStore.js';
import { readUsage } from '../lib/usageMeter.js';
import { extraOperators, operatorRoleOf } from '../lib/adminSettings.js';
import { PLATFORM_ROLES, type PlatformPermission, type PlatformRoleId } from '../lib/platformRoles.js';
import { getServerConfig } from '../config.js';
import { buildHealthChecks } from '../lib/healthChecks.js';
import { getAdminFirestore } from '../lib/firestore.js';
import { requireUser } from '../middleware/requireUser.js';

export const opsRouter = Router();

/** The emails in OPERATOR_EMAILS. They are always operators and cannot be removed from the admin panel. */
export function ownerEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.OPERATOR_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Owners (OPERATOR_EMAILS) plus operators added in the admin panel. */
export function isOperator(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return ownerEmails(env).includes(e) || extraOperators().includes(e);
}

/** The staff role of an email: Super admin for the owners in OPERATOR_EMAILS, the saved role for other staff, or null. */
export function platformRoleOf(email: string | null | undefined, env: Record<string, string | undefined> = process.env): PlatformRoleId | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  if (ownerEmails(env).includes(e)) return 'super';
  return extraOperators().includes(e) ? operatorRoleOf(e) : null;
}

export const platformCan = (email: string | null | undefined, perm: PlatformPermission): boolean => {
  const r = platformRoleOf(email);
  return r !== null && PLATFORM_ROLES[r].permissions.includes(perm);
};

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

/** Turns a database error into a plain-language reason and the fix. Never includes keys or request data. */
export function explainDatabaseError(err: unknown): { code: string; reason: string } {
  const e = err as { code?: number | string; message?: string } | null;
  const code = String(e?.code ?? 'unknown');
  const msg = String(e?.message ?? '');
  if (code === '5' || /NOT_FOUND/.test(msg) || /database .* does not exist/i.test(msg)) return { code, reason: 'The Firestore database has not been created in this Firebase project. In the Firebase console open Build, Firestore Database, then Create database (Native mode, same project as FIREBASE_PROJECT_ID).' };
  if (code === '7' || /PERMISSION_DENIED/.test(msg)) return { code, reason: 'The server account is not allowed to use Firestore. In Google Cloud, IAM, give the service account the role "Cloud Datastore User" (or Firebase Admin), and check FIREBASE_PROJECT_ID is the same project as the database.' };
  if (/credential|could not load the default|invalid_grant|private key|PEM|client_email/i.test(msg)) return { code, reason: 'The server cannot sign in to Firebase. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (the key must keep its line breaks; paste it with \\n for each new line).' };
  if (code === '8' || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return { code, reason: 'Firestore daily free quota is used up or billing is needed. Check Firebase console, Usage.' };
  if (code === '9' || /FAILED_PRECONDITION|index/i.test(msg)) return { code, reason: 'Firestore needs an index for a query. Open the Firebase console, Firestore, Indexes, or follow the link in the server log.' };
  if (code === '14' || /UNAVAILABLE|ENOTFOUND|ETIMEDOUT/i.test(msg)) return { code, reason: 'The server cannot reach Firestore (network). Check the hosting network settings, then try again.' };
  return { code, reason: 'Unknown database error. Check the server log for the line starting with [firestore].' };
}

// Owner only: checks the live database (write, read, delete a scratch document) and says in plain words what is wrong.
opsRouter.get('/diagnose', requireUser, async (req: Request, res: Response) => {
  if (!isOperator(req.user!.email)) {
    res.status(403).json({ error: { code: 'NOT_ALLOWED', message: 'Only the owner of this AdLens installation can see this.' } });
    return;
  }
  const cfg = getServerConfig();
  const out: Record<string, unknown> = { firebaseConfigured: cfg.firebaseConfigured, firebaseMissing: cfg.firebaseMissing, checks: buildHealthChecks(cfg), checkedAt: new Date().toISOString() };
  try {
    const ref = getAdminFirestore().collection('_diagnostics').doc('ping');
    await ref.set({ at: new Date().toISOString() });
    const back = await ref.get();
    await ref.delete();
    out.firestore = { ok: back.exists };
  } catch (err) {
    console.error('[firestore] diagnose failed', explainDatabaseError(err).code);
    out.firestore = { ok: false, ...explainDatabaseError(err) };
  }
  res.json(out);
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
  // First delete links and scheduled emails whose owner or project is gone, so nothing stale is refreshed or sent.
  let cleaned: Awaited<ReturnType<typeof cleanOrphans>> | { error: string };
  try { cleaned = await cleanOrphans(); } catch { cleaned = { error: 'cleanup failed' }; }
  const digests = await runDigests(productionDigestDeps());
  // Alert rules are checked in the same daily call, so one scheduled job covers both.
  let alerts: Awaited<ReturnType<typeof runAlertRules>> | { error: string };
  try { alerts = await runAlertRules(productionAlertDeps()); } catch { alerts = { error: 'alerts failed' }; }
  let shares: Awaited<ReturnType<typeof refreshDueShares>> | { error: string };
  try { shares = await refreshDueShares(getShareStore()); } catch { shares = { error: 'shares failed' }; }
  let emails: Awaited<ReturnType<typeof runEmailSchedules>> | { error: string };
  try {
    emails = await runEmailSchedules({ store: getScheduleStore(), appUrl: getServerConfig().appBaseUrl, sendMail: (m) => sendMail(m), context: productionScheduleContext, snapshot: productionSnapshot });
  } catch { emails = { error: 'emails failed' }; }
  let rank: Awaited<ReturnType<typeof runRankTracking>> | { error: string };
  try { rank = await runRankTracking(); } catch { rank = { error: 'rank tracking failed' }; }
  let watch: Awaited<ReturnType<typeof runWatches>> | { error: string };
  try { watch = await runWatches({ store: getWatchStore(), docs: getWatchDocs(), fetcher: fetchOnce, now: Date.now, projectExists: async (ws, project) => Boolean(await getWatchFirestore().getProject(ws, project)) }); } catch { watch = { error: 'competitor watch failed' }; }
  let gbp: Awaited<ReturnType<typeof runGbp>> | { error: string };
  try {
    const cfg = getServerConfig();
    gbp = cfg.googleConfigured && cfg.vaultReady
      ? await runGbp({ store: getGbpStore(), docs: getWatchDocs(), gbp: defaultGbpDeps(), cred: { clientId: cfg.googleClientId, clientSecret: cfg.googleClientSecret }, projectInfo: async (ws, project) => { const p = await getWatchFirestore().getProject(ws, project); return p ? { name: p.name } : null; }, send: (m) => sendMail(m), appUrl: cfg.appBaseUrl })
      : { checked: 0, newLowStar: 0, emailed: 0, posted: 0, failed: 0 };
  } catch { gbp = { error: 'business profile check failed' }; }
  res.json({ ...digests, alerts, cleaned, shares, emails, rank, watch, gbp });
});
