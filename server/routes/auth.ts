import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { getServerConfig, requireGoogleConfigured } from '../config';
import { createOAuthClient, GOOGLE_OAUTH_SCOPES } from '../lib/google';
import {
  clearSession,
  getSessionCookieOptions,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_MAX_AGE_MS,
  readSession,
  writeSession,
} from '../lib/session';

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

authRouter.get('/google/start', requireGoogleConfigured, (_req: Request, res: Response) => {
  const cfg = getServerConfig();
  const state = crypto.randomBytes(24).toString('base64url');

  res.cookie(OAUTH_STATE_COOKIE_NAME, state, getSessionCookieOptions(OAUTH_STATE_MAX_AGE_MS));

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
  const { isProduction } = getServerConfig();
  const storedState = req.cookies?.[OAUTH_STATE_COOKIE_NAME];

  res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
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
  if (!queryState || !storedState || queryState !== storedState) {
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
    const refreshToken = tokens.refresh_token || existingSession.google?.refreshToken;

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
          audience: getServerConfig().googleClientId,
        });
        email = ticket.getPayload()?.email ?? null;
      } catch {
        // fallback already attempted via JWT payload decode
      }
    }

    const updatedSession = {
      ...existingSession,
      google: {
        refreshToken,
        accessToken: tokens.access_token,
        accessTokenExpiry: tokens.expiry_date ?? Date.now() + 3600 * 1000,
        email: email ?? existingSession.google?.email ?? null,
        ga4Property: existingSession.google?.ga4Property,
        searchConsoleSite: existingSession.google?.searchConsoleSite,
      },
    };

    writeSession(res, updatedSession);
    res.redirect('/connections?connected=google');
  } catch {
    res.redirect('/connections?error=token_exchange_failed');
  }
});

authRouter.post('/google/disconnect', async (req: Request, res: Response) => {
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
});
