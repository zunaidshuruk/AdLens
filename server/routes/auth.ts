import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { getServerConfig, requireGoogleConfigured } from '../config.js';
import { decryptPayload, encryptPayload } from '../lib/crypto.js';
import { createOAuthClient, GOOGLE_OAUTH_SCOPES } from '../lib/google.js';
import { signLinkToken, verifyLinkToken } from '../lib/linkToken.js';
import {
  clearSession,
  getSessionCookieOptions,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_MAX_AGE_MS,
  readSession,
  writeSession,
} from '../lib/session.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

export const authRouter = Router();

function decodeEmailFromIdToken(idToken?: string | null): string | null {
  if (!idToken) return null;
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as { email?: string };
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

interface StoredOAuthState {
  state: string;
  uid: string;
}

function encodeOAuthStateCookie(state: string, uid: string, secret: string): string {
  return encryptPayload(JSON.stringify({ state, uid } satisfies StoredOAuthState), secret);
}

function decodeOAuthStateCookie(rawCookie: string | undefined, secret: string): StoredOAuthState | null {
  if (!rawCookie || typeof rawCookie !== 'string' || !secret) return null;
  try {
    const json = decryptPayload(rawCookie, secret);
    const parsed = JSON.parse(json) as Partial<StoredOAuthState>;
    if (
      parsed &&
      typeof parsed.state === 'string' &&
      parsed.state.length > 0 &&
      typeof parsed.uid === 'string' &&
      parsed.uid.length > 0
    ) {
      return { state: parsed.state, uid: parsed.uid };
    }
    return null;
  } catch {
    return null;
  }
}

// POST /api/auth/google/link-token (requireUser) -> 5-minute signed link token containing uid
authRouter.post(
  '/google/link-token',
  requireUser,
  requireGoogleConfigured,
  (req: Request, res: Response) => {
    const cfg = getServerConfig();
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required.',
        },
      });
      return;
    }

    const linkToken = signLinkToken(uid, cfg.tokenEncryptionKey);
    res.json({
      linkToken,
      expiresInSec: 300,
    });
  }
);

// GET /api/auth/google/start?lt=<token>
authRouter.get('/google/start', requireGoogleConfigured, (req: Request, res: Response) => {
  const cfg = getServerConfig();
  const lt = typeof req.query.lt === 'string' ? req.query.lt.trim() : '';

  let verifiedLink: { uid: string };
  try {
    verifiedLink = verifyLinkToken(lt, cfg.tokenEncryptionKey);
  } catch (err) {
    res.status(401).json({
      error: {
        code: 'INVALID_LINK_TOKEN',
        message:
          err instanceof Error
            ? err.message
            : 'A valid, non-expired Google link token is required.',
      },
    });
    return;
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const encryptedState = encodeOAuthStateCookie(state, verifiedLink.uid, cfg.tokenEncryptionKey);

  res.cookie(
    OAUTH_STATE_COOKIE_NAME,
    encryptedState,
    getSessionCookieOptions(OAUTH_STATE_MAX_AGE_MS)
  );

  const redirectUri = `${cfg.appBaseUrl}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

authRouter.get('/google/callback', requireGoogleConfigured, async (req: Request, res: Response) => {
  const cfg = getServerConfig();
  const rawStoredState = req.cookies?.[OAUTH_STATE_COOKIE_NAME];

  res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
    httpOnly: true,
    secure: cfg.isProduction,
    sameSite: 'lax',
    path: '/',
  });

  const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined;
  if (oauthError) {
    const code = oauthError === 'access_denied' ? 'access_denied' : 'token_exchange_failed';
    res.redirect(`/connections?error=${encodeURIComponent(code)}`);
    return;
  }

  const queryState = typeof req.query.state === 'string' ? req.query.state : '';
  const decodedState = decodeOAuthStateCookie(rawStoredState, cfg.tokenEncryptionKey);

  if (!queryState || !decodedState || queryState !== decodedState.state) {
    res.redirect('/connections?error=invalid_state');
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    res.redirect('/connections?error=token_exchange_failed');
    return;
  }

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);

    const existingSession = readSession(req);
    const sameOwner =
      existingSession.uid === decodedState.uid ||
      existingSession.google?.uid === decodedState.uid;
    const refreshToken =
      tokens.refresh_token || (sameOwner ? existingSession.google?.refreshToken : undefined);

    if (!refreshToken) {
      res.redirect('/connections?error=no_refresh_token');
      return;
    }

    if (!tokens.access_token) {
      res.redirect('/connections?error=token_exchange_failed');
      return;
    }

    let email = decodeEmailFromIdToken(tokens.id_token);
    if (!email && tokens.id_token) {
      try {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: cfg.googleClientId,
        });
        email = ticket.getPayload()?.email ?? null;
      } catch {
        // fallback already attempted via JWT payload decode
      }
    }

    const updatedSession = {
      uid: decodedState.uid,
      google: {
        uid: decodedState.uid,
        refreshToken,
        accessToken: tokens.access_token,
        accessTokenExpiry: tokens.expiry_date ?? Date.now() + 3600 * 1000,
        email: email ?? (sameOwner ? existingSession.google?.email : null) ?? null,
        ga4Property: sameOwner ? existingSession.google?.ga4Property : undefined,
        searchConsoleSite: sameOwner ? existingSession.google?.searchConsoleSite : undefined,
      },
    };

    writeSession(res, updatedSession);
    res.redirect('/connections?connected=google');
  } catch {
    res.redirect('/connections?error=token_exchange_failed');
  }
});

authRouter.post(
  '/google/disconnect',
  requireUser,
  verifyGoogleSessionOwnership,
  async (req: Request, res: Response) => {
    const session = readSession(req);
    const tokenToRevoke = session.google?.refreshToken || session.google?.accessToken;

    if (tokenToRevoke) {
      try {
        const body = new URLSearchParams({ token: tokenToRevoke });
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });
      } catch {
        // Ignore network/revoke errors and proceed with local session cleanup
      }
    }

    delete session.google;
    clearSession(res);
    res.json({ ok: true });
  }
);
