import type { NextFunction, Request, Response } from 'express';
import { isOperator } from '../routes/ops.js';

/** An admin session lasts one hour from the last fresh sign-in on the admin login page. */
export const ADMIN_SESSION_SECONDS = 60 * 60;

/** Seconds left in the admin session for this request's sign-in, or 0 when it is over (or the sign-in time is unknown). */
export function adminSecondsLeft(authTime: number | undefined, nowMs = Date.now()): number {
  if (typeof authTime !== 'number') return 0;
  return Math.max(0, Math.floor(authTime + ADMIN_SESSION_SECONDS - nowMs / 1000));
}

/**
 * Only operators, and only within an hour of a fresh sign-in. After that the admin panel asks for the password again.
 * Uses 403 (not 401) so the normal app does not treat it as "signed out".
 */
export function operatorOnly(req: Request, res: Response, next: NextFunction): void {
  if (!isOperator(req.user?.email)) {
    res.status(403).json({ error: { code: 'NOT_ALLOWED', message: 'Only an operator of this AdLens installation can do this.' } });
    return;
  }
  if (adminSecondsLeft(req.user?.authTime) <= 0) {
    res.status(403).json({ error: { code: 'ADMIN_REAUTH', message: 'For safety, please sign in again on the admin login page.' } });
    return;
  }
  next();
}
