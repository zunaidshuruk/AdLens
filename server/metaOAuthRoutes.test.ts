import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { signLinkToken } from './lib/linkToken.js';
import { META_OAUTH_STATE_COOKIE_NAME } from './lib/session.js';
import {
  buildKeyring,
  createTokenVault,
  type ConnectionRecord,
  type VaultStore,
} from './lib/tokenVault.js';
import { setTestVault } from './lib/vault.js';

function createInMemoryVault(secret: string) {
  const map = new Map<string, ConnectionRecord>();
  const store: VaultStore = {
    async get(id) {
      const r = map.get(id);
      return r ? structuredClone(r) : null;
    },
    async set(id, record) {
      map.set(id, structuredClone(record));
    },
    async delete(id) {
      map.delete(id);
    },
  };
  const vault = createTokenVault({
    store,
    keyring: buildKeyring(secret),
    refreshers: {},
  });
  return { vault, map };
}

test('Sprint 9c-1 — Facebook Login /api/auth/meta/start, /api/auth/meta/callback, /api/health metaLoginConfigured, and secret non-disclosure', async () => {
  const ENCRYPTION_KEY = 'test-encryption-key-sprint-9c1-32chars!';
  const APP_ID = 'meta-app-id-12345';
  const APP_SECRET = 'meta-super-secret-value-999888';
  const CONFIG_ID = 'meta-login-config-777';
  const OAUTH_CODE = 'AQD-meta-oauth-auth-code-555';
  const SHORT_TOKEN = 'EAAB-short-lived-meta-token-111111';
  const LONG_TOKEN = 'EAAB-long-lived-meta-token-222222';

  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.META_APP_ID = APP_ID;
  process.env.META_APP_SECRET = APP_SECRET;
  delete process.env.META_LOGIN_CONFIG_ID;

  const { vault, map } = createInMemoryVault(ENCRYPTION_KEY);
  setTestVault(vault);

  const loggedLines: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]) => loggedLines.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => loggedLines.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => loggedLines.push(args.map(String).join(' '));

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init);
    }

    if (url.startsWith('https://graph.facebook.com/')) {
      const parsed = new URL(url);
      if (parsed.searchParams.get('grant_type') === 'fb_exchange_token') {
        assert.equal(parsed.searchParams.get('client_id'), APP_ID);
        assert.equal(parsed.searchParams.get('client_secret'), APP_SECRET);
        assert.equal(parsed.searchParams.get('fb_exchange_token'), SHORT_TOKEN);
        return new Response(
          JSON.stringify({
            access_token: LONG_TOKEN,
            expires_in: 60 * 86_400,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      assert.equal(parsed.searchParams.get('client_id'), APP_ID);
      assert.equal(parsed.searchParams.get('client_secret'), APP_SECRET);
      assert.equal(parsed.searchParams.get('code'), OAUTH_CODE);
      assert.equal(
        parsed.searchParams.get('redirect_uri'),
        'http://localhost:3000/api/auth/meta/callback'
      );
      return new Response(
        JSON.stringify({
          access_token: SHORT_TOKEN,
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected external fetch: ${url}`);
  };

  try {
    // 1. /api/health reports metaLoginConfigured false when META_LOGIN_CONFIG_ID is missing
    const healthBefore = await (await originalFetch(`${baseUrl}/api/health`)).json();
    assert.equal(healthBefore.metaLoginConfigured, false);

    // 2. Start without a valid link token gets 401
    const resStartNoToken = await originalFetch(`${baseUrl}/api/auth/meta/start`, {
      redirect: 'manual',
    });
    assert.equal(resStartNoToken.status, 401);

    const resStartBadToken = await originalFetch(`${baseUrl}/api/auth/meta/start?lt=invalid.token`, {
      redirect: 'manual',
    });
    assert.equal(resStartBadToken.status, 401);

    // 3. Start when Meta login is not configured redirects to /connections?error=meta_not_configured
    const validLt = signLinkToken('user_meta_1', ENCRYPTION_KEY);
    const resNotConfigured = await originalFetch(
      `${baseUrl}/api/auth/meta/start?lt=${encodeURIComponent(validLt)}`,
      { redirect: 'manual' }
    );
    assert.equal(resNotConfigured.status, 302);
    assert.equal(
      resNotConfigured.headers.get('location'),
      '/connections?error=meta_not_configured'
    );

    // Enable META_LOGIN_CONFIG_ID -> /api/health reports metaLoginConfigured: true
    process.env.META_LOGIN_CONFIG_ID = CONFIG_ID;
    const healthAfterRaw = await (await originalFetch(`${baseUrl}/api/health`)).text();
    const healthAfter = JSON.parse(healthAfterRaw);
    assert.equal(healthAfter.metaLoginConfigured, true);
    assert.ok(!healthAfterRaw.includes(APP_SECRET));
    assert.ok(!healthAfterRaw.includes(CONFIG_ID));

    // 4. Start with valid link token redirects to facebook.com with config_id and state, and sets cookie
    const resStart = await originalFetch(
      `${baseUrl}/api/auth/meta/start?lt=${encodeURIComponent(validLt)}`,
      { redirect: 'manual' }
    );
    assert.equal(resStart.status, 302);
    const location = resStart.headers.get('location') || '';
    const fbUrl = new URL(location);
    assert.equal(fbUrl.origin, 'https://www.facebook.com');
    assert.equal(fbUrl.searchParams.get('client_id'), APP_ID);
    assert.equal(fbUrl.searchParams.get('config_id'), CONFIG_ID);
    assert.equal(
      fbUrl.searchParams.get('redirect_uri'),
      'http://localhost:3000/api/auth/meta/callback'
    );
    const oauthState = fbUrl.searchParams.get('state') || '';
    assert.ok(oauthState.length >= 16);

    const setCookieHeader = resStart.headers.get('set-cookie') || '';
    assert.ok(setCookieHeader.includes(`${META_OAUTH_STATE_COOKIE_NAME}=`));
    assert.ok(setCookieHeader.toLowerCase().includes('httponly'));
    const cookiePair = setCookieHeader.split(';')[0];

    // 5. Callback with error=access_denied redirects to /connections?error=meta_denied and saves nothing
    const resDenied = await originalFetch(
      `${baseUrl}/api/auth/meta/callback?error=access_denied&error_reason=user_denied&state=${encodeURIComponent(oauthState)}`,
      {
        headers: { Cookie: cookiePair },
        redirect: 'manual',
      }
    );
    assert.equal(resDenied.status, 302);
    assert.equal(resDenied.headers.get('location'), '/connections?error=meta_denied');
    assert.equal(map.size, 0);

    // 6. Callback with wrong state is refused and saves nothing
    const resWrongState = await originalFetch(
      `${baseUrl}/api/auth/meta/callback?code=${encodeURIComponent(OAUTH_CODE)}&state=wrong-state-value`,
      {
        headers: { Cookie: cookiePair },
        redirect: 'manual',
      }
    );
    assert.equal(resWrongState.status, 302);
    assert.equal(resWrongState.headers.get('location'), '/connections?error=invalid_state');
    assert.equal(map.size, 0);

    // 7. Good callback saves exactly one meta connection for user_meta_1 and redirects to /connections?connected=meta
    const resGood = await originalFetch(
      `${baseUrl}/api/auth/meta/callback?code=${encodeURIComponent(OAUTH_CODE)}&state=${encodeURIComponent(oauthState)}`,
      {
        headers: { Cookie: cookiePair },
        redirect: 'manual',
      }
    );
    const goodRedirect = resGood.headers.get('location') || '';
    const goodBody = await resGood.text();
    assert.equal(resGood.status, 302);
    assert.equal(goodRedirect, '/connections?connected=meta');
    assert.equal(map.size, 1);
    assert.ok(map.has('user_meta_1_meta'));

    const savedSummary = await vault.getSummary('user_meta_1', 'meta');
    assert.equal(savedSummary?.connected, true);
    assert.equal(savedSummary?.provider, 'meta');
    assert.equal(await vault.getAccessToken('user_meta_1', 'meta'), LONG_TOKEN);

    const record = map.get('user_meta_1_meta')!;
    assert.ok(record.accessTokenExpiresAt && record.accessTokenExpiresAt > Date.now() + 50 * 86_400_000);

    // 8. App secret, code, and tokens never appear in any redirect URL, response body, or log line
    const combinedOutput = [
      location,
      goodRedirect,
      goodBody,
      resWrongState.headers.get('location') || '',
      resDenied.headers.get('location') || '',
      ...loggedLines,
    ].join('\n');
    for (const secretPiece of [APP_SECRET, OAUTH_CODE, SHORT_TOKEN, LONG_TOKEN]) {
      assert.ok(!combinedOutput.includes(secretPiece));
    }
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    globalThis.fetch = originalFetch;
    setTestVault(null);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.APP_BASE_URL;
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    delete process.env.META_LOGIN_CONFIG_ID;
    server.close();
  }
});
