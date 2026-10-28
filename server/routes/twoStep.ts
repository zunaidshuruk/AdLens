/**
 * Two-step verification with an authenticator app (Sprint 22). See lib/twoStep.ts for how it works.
 *
 *   GET  /api/2fa/status            is it on, how many backup codes are left, has this sign-in already given its code
 *   POST /api/2fa/setup/start       makes a secret and the QR address (not active yet)
 *   POST /api/2fa/setup/confirm     first code from the app turns it on; returns the backup codes ONCE
 *   POST /api/2fa/verify            gives the code (or a backup code) for this sign-in; returns the proof
 *   POST /api/2fa/backup-codes      new set of backup codes (needs a code)
 *   POST /api/2fa/disable           turns it off (needs a code)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { recordAudit } from '../lib/auditLog.js';
import { setTwoStepClaim } from '../lib/firebaseAdmin.js';
import { getSharedStore } from '../lib/sharedStore.js';
import {
  PROOF_HEADER, checkSecondStep, makeProof, openSecret, proofIsValid, sealSecret, twoStepStore, type TwoStepDoc,
} from '../lib/twoStep.js';
import { generateBackupCodes, generateSecret, hashBackupCode, otpauthUri, verifyTotp } from '../lib/totp.js';
import { requireUser, requireUserFirstStep } from '../middleware/requireUser.js';

export const twoStepRouter = Router();

const ISSUER = 'AdLens';
const PENDING_MS = 15 * 60 * 1000;
/** Longer than a sign-in token lives (1 hour), so no token made before two-step was turned on can slip through. */
const TWO_STEP_NOTE_MS = 2 * 60 * 60 * 1000;
const fail = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });
const codeBody = z.object({ code: z.string().trim().min(6).max(20) });

const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const failKey = (req: Request) => `2fa:fail:${req.user!.uid}`;

/** A few wrong tries per person: a 6-digit code must not be guessable by trying all of them. Only WRONG tries count. */
async function allowAttempt(req: Request, res: Response): Promise<boolean> {
  const used = Number((await getSharedStore().get(failKey(req)).catch(() => null)) ?? 0);
  if (used < MAX_FAILS) return true;
  res.setHeader('Retry-After', String(FAIL_WINDOW_MS / 1000));
  fail(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes. Please wait 15 minutes and try again.');
  return false;
}
const noteWrong = (req: Request) => getSharedStore().incr(failKey(req), FAIL_WINDOW_MS).catch(() => 0);
const noteRight = (req: Request) => getSharedStore().del(failKey(req)).catch(() => undefined);

function proofFor(req: Request): string {
  return makeProof(req.user!.uid, req.user!.authTime ?? 0);
}

twoStepRouter.get('/status', requireUserFirstStep, async (req: Request, res: Response) => {
  const doc = await twoStepStore().get(req.user!.uid).catch(() => null);
  const proof = req.headers[PROOF_HEADER];
  let proven = false;
  try { proven = proofIsValid(Array.isArray(proof) ? proof[0] : proof, req.user!.uid, req.user!.authTime); } catch { proven = false; }
  res.json({ enabled: Boolean(doc?.enabled), backupCodesLeft: doc?.enabled ? doc.backupHashes.length : 0, enabledAt: doc?.enabledAt ?? null, proven: doc?.enabled ? proven : true });
});

twoStepRouter.post('/setup/start', requireUser, async (req: Request, res: Response) => {
  const store = twoStepStore();
  const doc = await store.get(req.user!.uid);
  if (doc?.enabled) return fail(res, 409, 'ALREADY_ENABLED', 'Two-step verification is already on. Turn it off first to set it up again.');
  const secret = generateSecret();
  const next: TwoStepDoc = { uid: req.user!.uid, secretEnc: '', enabled: false, enabledAt: null, lastStep: -1, backupHashes: [], pendingEnc: sealSecret(secret), pendingAt: Date.now() };
  await store.put(next);
  res.json({ secret, otpauthUri: otpauthUri(ISSUER, req.user!.email ?? req.user!.uid, secret) });
});

twoStepRouter.post('/setup/confirm', requireUser, async (req: Request, res: Response) => {
  const body = codeBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Enter the 6-digit code from your app.');
  if (!(await allowAttempt(req, res))) return;
  const store = twoStepStore();
  const doc = await store.get(req.user!.uid);
  if (!doc || doc.enabled || !doc.pendingEnc || !doc.pendingAt || Date.now() - doc.pendingAt > PENDING_MS) {
    return fail(res, 409, 'SETUP_EXPIRED', 'This setup has expired. Please start again.');
  }
  const step = verifyTotp(openSecret(doc.pendingEnc), body.data.code, Date.now());
  if (step === null) { await noteWrong(req); return fail(res, 400, 'WRONG_CODE', 'That code is not right. Check the code in your app and try again.'); }
  await noteRight(req);
  const backupCodes = generateBackupCodes();
  await store.put({ uid: doc.uid, secretEnc: doc.pendingEnc, enabled: true, enabledAt: new Date().toISOString(), lastStep: step, backupHashes: backupCodes.map(hashBackupCode) });
  await setTwoStepClaim(doc.uid, true);
  await getSharedStore().set(`2fa:on:${doc.uid}`, '1', TWO_STEP_NOTE_MS).catch(() => undefined);
  void recordAudit({ uid: doc.uid, action: 'twostep.enabled' });
  res.json({ backupCodes, proof: proofFor(req) });
});

twoStepRouter.post('/verify', requireUserFirstStep, async (req: Request, res: Response) => {
  const body = codeBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Enter the 6-digit code from your app.');
  if (!(await allowAttempt(req, res))) return;
  const result = await checkSecondStep(req.user!.uid, body.data.code);
  if (result === 'not_enabled') return res.json({ proof: proofFor(req), backupCodesLeft: 0 });
  if (result === 'wrong') { await noteWrong(req); return fail(res, 400, 'WRONG_CODE', 'That code is not right. Codes change every 30 seconds, so try the newest one.'); }
  await noteRight(req);
  const doc = await twoStepStore().get(req.user!.uid);
  res.json({ proof: proofFor(req), backupCodesLeft: doc?.backupHashes.length ?? 0, usedBackupCode: result === 'backup' });
});

twoStepRouter.post('/backup-codes', requireUser, async (req: Request, res: Response) => {
  const body = codeBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a code from your app.');
  if (!(await allowAttempt(req, res))) return;
  const result = await checkSecondStep(req.user!.uid, body.data.code);
  if (result === 'not_enabled') return fail(res, 409, 'NOT_ENABLED', 'Two-step verification is not on.');
  if (result === 'wrong') { await noteWrong(req); return fail(res, 400, 'WRONG_CODE', 'That code is not right. Wait for the next code in your app and try again.'); }
  await noteRight(req);
  const store = twoStepStore();
  const doc = (await store.get(req.user!.uid))!;
  const backupCodes = generateBackupCodes();
  await store.put({ ...doc, backupHashes: backupCodes.map(hashBackupCode) });
  void recordAudit({ uid: req.user!.uid, action: 'twostep.backup_regenerated' });
  res.json({ backupCodes });
});

twoStepRouter.post('/disable', requireUser, async (req: Request, res: Response) => {
  const body = codeBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a code from your app.');
  if (!(await allowAttempt(req, res))) return;
  const result = await checkSecondStep(req.user!.uid, body.data.code);
  if (result === 'not_enabled') return res.status(204).end();
  if (result === 'wrong') { await noteWrong(req); return fail(res, 400, 'WRONG_CODE', 'That code is not right. Wait for the next code in your app and try again.'); }
  await noteRight(req);
  await twoStepStore().delete(req.user!.uid);
  await setTwoStepClaim(req.user!.uid, false);
  await getSharedStore().del(`2fa:on:${req.user!.uid}`).catch(() => undefined);
  void recordAudit({ uid: req.user!.uid, action: 'twostep.disabled' });
  res.status(204).end();
});
