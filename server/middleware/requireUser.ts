import type { NextFunction, Request, Response } from 'express';
import { verifyIdToken } from '../lib/firebaseAdmin.js';
import { clearSession, readSession } from '../lib/session.js';

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  name?: string | null;
  picture?: string | null;
  emailVerified: boolean;
  providers: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const SSO_VERIFIED_PROVIDERS = new Set(['google.com', 'microsoft.com']);

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction
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

    if (!emailVerified) {
      res.status(403).json({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email address before accessing AdLens data.',
        },
      });
      return;
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

/**
 * Ensures that if an encrypted adlens_session cookie has Google data, its bound uid matches req.user.uid.
 * If the cookie's uid !== req.user.uid, clears Google data from the cookie and rejects with 401 GOOGLE_SESSION_MISMATCH.
 */
export function verifyGoogleSessionOwnership(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const session = readSession(req);
  const cookieUid = session.uid ?? session.google?.uid;

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

  next();
}
