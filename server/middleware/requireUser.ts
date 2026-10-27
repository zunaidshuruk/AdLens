import type { NextFunction, Request, Response } from 'express';
import { decideSignIn, domainOfEmail, lookupDomainRule } from '../lib/orgSso.js';
import { getSharedStore } from '../lib/sharedStore.js';
import { verifyIdToken } from '../lib/firebaseAdmin.js';
import { clearSession, readSession } from '../lib/session.js';
import { PROOF_HEADER, proofIsValid } from '../lib/twoStep.js';
import { ensureVaultFromCookie } from '../lib/vault.js';

export { ensureVaultFromCookie };

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  name?: string | null;
  picture?: string | null;
  emailVerified: boolean;
  providers: string[];
  authTime?: number;
  /** The Firebase sign-in method used for this token, e.g. "password", "google.com", "saml.okta". */
  signInProvider?: string;
  /** "totp" or "phone" when two-step verification was used for this sign-in. */
  secondFactor?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const SSO_VERIFIED_PROVIDERS = new Set(['google.com', 'microsoft.com']);

/**
 * Signed in, email verified, company rules met. When the person turned on two-step verification (the `twoStep` flag on their
 * sign-in token), a valid proof of their second step must also come with the request, except on the few calls that
 * let them give that proof (`skipSecondStep`).
 */
function buildRequireUser(skipSecondStep: boolean) {
  return async function requireUserMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    await authenticate(req, res, next, skipSecondStep);
  };
}

async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
  skipSecondStep: boolean
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication required. Please sign in to AdLens.',
      },
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication required. Please sign in to AdLens.',
      },
    });
    return;
  }

  try {
    const decoded = await verifyIdToken(token);
    const providerSet = new Set<string>();

    const identities = decoded.firebase?.identities;
    if (identities && typeof identities === 'object') {
      for (const key of Object.keys(identities)) {
        if (key) providerSet.add(key);
      }
    }

    const signInProvider = decoded.firebase?.sign_in_provider;
    if (
      typeof signInProvider === 'string' &&
      signInProvider &&
      signInProvider !== 'custom' &&
      signInProvider !== 'anonymous'
    ) {
      providerSet.add(signInProvider);
    }

    const providers = Array.from(providerSet);
    const isSsoVerified = providers.some((p) => SSO_VERIFIED_PROVIDERS.has(p));
    const emailVerified = Boolean(decoded.email_verified) || isSsoVerified;

    // "Sign out everywhere": tokens issued before the person asked are refused (they would otherwise live up to an hour).
    const revokedAt = Number((await getSharedStore().get(`sess:revoked:${decoded.uid}`).catch(() => null)) ?? 0);
    if (revokedAt > 0 && (typeof decoded.iat !== 'number' || decoded.iat * 1000 < revokedAt)) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'You were signed out on all devices. Please sign in again.' } });
      return;
    }

    // Company single sign-on rules (Sprint 19). Free-mail and unknown domains cost nothing here.
    const ssoProvider = typeof decoded.firebase?.sign_in_provider === 'string' ? decoded.firebase.sign_in_provider : null;
    const secondFactor = typeof (decoded.firebase as { sign_in_second_factor?: unknown } | undefined)?.sign_in_second_factor === 'string'
      ? ((decoded.firebase as { sign_in_second_factor?: string }).sign_in_second_factor as string)
      : null;
    const email = typeof decoded.email === 'string' ? decoded.email : null;
    // If the rules cannot be read, ordinary sign-ins carry on (an outage must not lock everyone out), but company SSO tokens are refused.
    const rule = await lookupDomainRule(domainOfEmail(email)).catch(() => null);
    const decision = decideSignIn({ email, signInProvider: ssoProvider, secondFactor }, rule);
    if (!decision.allow) {
      res.status(403).json({ error: { code: decision.code, message: decision.message } });
      return;
    }

    if (!emailVerified && !decision.viaSso) {
      res.status(403).json({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email address before accessing AdLens data.',
        },
      });
      return;
    }

    const authTime =
      typeof decoded.auth_time === 'number' && Number.isFinite(decoded.auth_time)
        ? decoded.auth_time
        : undefined;

    if (!skipSecondStep && (decoded as { twoStep?: unknown }).twoStep === true) {
      const proof = req.headers[PROOF_HEADER];
      let ok = false;
      try {
        ok = proofIsValid(Array.isArray(proof) ? proof[0] : proof, decoded.uid, authTime);
      } catch {
        ok = false; // no encryption key configured: treat as not proven
      }
      if (!ok) {
        res.status(403).json({ error: { code: 'TWO_STEP_REQUIRED', message: 'Enter the 6-digit code from your authenticator app to continue.' } });
        return;
      }
    }

    req.user = {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : null,
      name: typeof decoded.name === 'string' && decoded.name.trim() ? decoded.name.trim() : null,
      picture:
        typeof decoded.picture === 'string' && decoded.picture.trim()
          ? decoded.picture.trim()
          : null,
      emailVerified: true,
      providers,
      authTime,
      ...(ssoProvider ? { signInProvider: ssoProvider } : {}),
      ...(secondFactor ? { secondFactor } : {}),
    };

    next();
  } catch {
    res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Invalid or expired authentication token. Please sign in again.',
      },
    });
  }
}

export const requireUser = buildRequireUser(false);
/** For the two-step calls themselves (status, give the code): everything except the second-step proof. */
export const requireUserFirstStep = buildRequireUser(true);

/**
 * Ensures that if an encrypted adlens_session cookie has Google data, its bound uid matches req.user.uid.
 * If the cookie's uid !== req.user.uid, clears Google data from the cookie and rejects with 401 GOOGLE_SESSION_MISMATCH.
 * Otherwise, lazily migrates any legacy cookie refresh/access tokens into the server-side vault once per request.
 */
export async function verifyGoogleSessionOwnership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const session = readSession(req);
  const cookieUid = session.google?.uid ?? session.uid;

  if (session.google && (!cookieUid || cookieUid !== req.user?.uid)) {
    clearSession(res);
    res.status(401).json({
      error: {
        code: 'GOOGLE_SESSION_MISMATCH',
        message:
          'The connected Google session belongs to a different user and has been cleared.',
      },
    });
    return;
  }

  try {
    await ensureVaultFromCookie(req, res);
    next();
  } catch (err) {
    next(err);
  }
}
