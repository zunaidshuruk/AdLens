import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryVaultStore, setTestConnectionStore } from './lib/connectionStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { computeAppSecretProof } from './lib/meta.js';
import { getVault, resetVaultSingleton } from './lib/vault.js';
import { clearMetaCache } from './routes/meta.js';

test('Sprint 9c-3 — /api/meta/* per-user Facebook token resolution, 409/401/404 handling, system fallback, cache isolation, and secret non-disclosure', async () => {
  const ENCRYPTION_KEY = 'test-encryption-key-sprint-9c3-32chars!';
  const APP_SECRET = 'meta-app-secret-9c3-do-not-expose';
  const SYSTEM_TOKEN = 'EAAB-system-shared-token-000000';
  const ALICE_TOKEN = 'EAAB-alice-personal-token-111111';
  const BOB_TOKEN = 'EAAB-bob-personal-token-222222';
  const SYSTEM_PROOF = computeAppSecretProof(SYSTEM_TOKEN, APP_SECRET);
  const ALICE_PROOF = computeAppSecretProof(ALICE_TOKEN, APP_SECRET);
  const BOB_PROOF = computeAppSecretProof(BOB_TOKEN, APP_SECRET);

  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.META_APP_ID = 'meta-app-id-9c3';
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.META_LOGIN_CONFIG_ID = 'meta-config-9c3';
  process.env.META_ACCESS_TOKEN = SYSTEM_TOKEN;
  process.env.META_AD_ACCOUNT_ID = 'act_99001122';
  process.env.META_SYSTEM_USER_ALLOWED_EMAILS = 'sysadmin@acme.com';

  clearMetaCache();
  const fsStore = createInMemoryFirestoreStore();
  setTestFirestoreStore(fsStore);
  const connStore = createInMemoryVaultStore();
  setTestConnectionStore(connStore);
  resetVaultSingleton();

  // Bootstrap Alice, Bob, Charlie (no connection, not allowlisted), and SysAdmin (no connection, allowlisted)
  const { workspace: aliceWs } = await fsStore.bootstrapUserAndWorkspace({
    uid: 'uid_alice',
    email: 'alice@example.com',
    displayName: 'Alice',
  });
  const aliceProjectWithAccount = await fsStore.createProject(aliceWs.id, {
    name: 'Alice Connected Project',
    domain: 'alice.com',
    metaAdAccountId: 'act_55551111',
    timezone: 'UTC',
    currency: 'USD',
    createdBy: 'uid_alice',
  });
  const aliceProjectNoAccount = await fsStore.createProject(aliceWs.id, {
    name: 'Alice Unselected Project',
    domain: 'alice-no-meta.com',
    metaAdAccountId: null,
    timezone: 'UTC',
    currency: 'USD',
    createdBy: 'uid_alice',
  });

  const { workspace: bobWs } = await fsStore.bootstrapUserAndWorkspace({
    uid: 'uid_bob',
    email: 'bob@example.com',
    displayName: 'Bob',
  });
  // Bob selects the SAME adAccountId (55551111) to verify cache is isolated per uid
  const bobProject = await fsStore.createProject(bobWs.id, {
    name: 'Bob Project',
    domain: 'bob.com',
    metaAdAccountId: '55551111',
    timezone: 'UTC',
    currency: 'USD',
    createdBy: 'uid_bob',
  });

  await fsStore.bootstrapUserAndWorkspace({
    uid: 'uid_charlie',
    email: 'charlie@example.com',
    displayName: 'Charlie',
  });

  await fsStore.bootstrapUserAndWorkspace({
    uid: 'uid_sysadmin',
    email: 'sysadmin@acme.com',
    displayName: 'SysAdmin',
  });

  setTestTokenVerifier(async (token: string) => {
    switch (token) {
      case 'token-alice':
        return {
          uid: 'uid_alice',
          email: 'alice@example.com',
          email_verified: true,
          firebase: { identities: { 'google.com': ['g1'] }, sign_in_provider: 'google.com' },
        } as never;
      case 'token-bob':
        return {
          uid: 'uid_bob',
          email: 'bob@example.com',
          email_verified: true,
          firebase: { identities: { 'google.com': ['g2'] }, sign_in_provider: 'google.com' },
        } as never;
      case 'token-charlie':
        return {
          uid: 'uid_charlie',
          email: 'charlie@example.com',
          email_verified: true,
          firebase: { identities: { 'google.com': ['g3'] }, sign_in_provider: 'google.com' },
        } as never;
      case 'token-sysadmin':
        return {
          uid: 'uid_sysadmin',
          email: 'sysadmin@acme.com',
          email_verified: true,
          firebase: { identities: { 'google.com': ['g4'] }, sign_in_provider: 'google.com' },
        } as never;
      default:
        throw new Error('Invalid token');
    }
  });

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const originalFetch = globalThis.fetch;

  const observedCalls: Array<{
    pathname: string;
    accessToken: string | null;
    proof: string | null;
  }> = [];
  let simulateUpstream190 = false;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init);
    }

    if (url.startsWith('https://graph.facebook.com/v26.0/')) {
      const parsed = new URL(url);
      const token = parsed.searchParams.get('access_token');
      const proof = parsed.searchParams.get('appsecret_proof');
      observedCalls.push({
        pathname: parsed.pathname,
        accessToken: token,
        proof,
      });

      if (simulateUpstream190) {
        return new Response(
          JSON.stringify({
            error: {
              code: 190,
              error_subcode: 463,
              message: `Error validating access token ${token} with secret ${APP_SECRET} and proof ${proof}`,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (parsed.pathname.endsWith('/insights')) {
        const spendForToken =
          token === ALICE_TOKEN ? '250.00' : token === BOB_TOKEN ? '775.00' : '999.00';
        return new Response(
          JSON.stringify({
            data: [
              {
                spend: spendForToken,
                impressions: '10000',
                reach: '8000',
                inline_link_clicks: '200',
                actions: [{ action_type: 'lead', value: '10' }],
                account_currency: 'USD',
                date_start: '2026-10-01',
                date_stop: '2026-10-07',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          id: parsed.pathname.split('/').pop(),
          name: token === ALICE_TOKEN ? 'Alice Ad Account' : token === BOB_TOKEN ? 'Bob Ad Account' : 'System Ad Account',
          currency: 'USD',
          timezone_name: 'UTC',
          account_status: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected external fetch: ${url}`);
  };

  try {
    const allResponses: string[] = [];
    const vault = getVault();
    const futureExpiry = Date.now() + 30 * 86_400_000;

    await vault.saveConnection({
      uid: 'uid_alice',
      provider: 'meta',
      accountLabel: null,
      scopes: ['ads_read'],
      refreshToken: ALICE_TOKEN,
      accessToken: ALICE_TOKEN,
      accessTokenExpiresAt: futureExpiry,
    });

    await vault.saveConnection({
      uid: 'uid_bob',
      provider: 'meta',
      accountLabel: null,
      scopes: ['ads_read'],
      refreshToken: BOB_TOKEN,
      accessToken: BOB_TOKEN,
      accessTokenExpiresAt: futureExpiry,
    });

    // (a) User with own token + project account -> upstream call uses user's token (NOT system token)
    const resAliceOv = await originalFetch(
      `${baseUrl}/api/meta/overview?startDate=2026-10-01&endDate=2026-10-07`,
      {
        headers: {
          Authorization: 'Bearer token-alice',
          'X-AdLens-Project': `${aliceWs.id}/${aliceProjectWithAccount.id}`,
        },
      }
    );
    const rawAliceOv = await resAliceOv.text();
    allResponses.push(rawAliceOv);
    assert.equal(resAliceOv.status, 200);
    assert.equal(resAliceOv.headers.get('x-adlens-cache'), 'false');
    const aliceOvBody = JSON.parse(rawAliceOv) as { spend: { value: number } };
    assert.equal(aliceOvBody.spend.value, 250);
    assert.equal(observedCalls.length, 1);
    assert.equal(observedCalls[0].pathname, '/v26.0/act_55551111/insights');
    assert.equal(observedCalls[0].accessToken, ALICE_TOKEN);
    assert.equal(observedCalls[0].proof, ALICE_PROOF);

    // (f) Cache is NOT shared between two different users even on the same accountId (55551111) and dates
    const resBobOv = await originalFetch(
      `${baseUrl}/api/meta/overview?startDate=2026-10-01&endDate=2026-10-07`,
      {
        headers: {
          Authorization: 'Bearer token-bob',
          'X-AdLens-Project': `${bobWs.id}/${bobProject.id}`,
        },
      }
    );
    const rawBobOv = await resBobOv.text();
    allResponses.push(rawBobOv);
    assert.equal(resBobOv.status, 200);
    assert.equal(resBobOv.headers.get('x-adlens-cache'), 'false');
    const bobOvBody = JSON.parse(rawBobOv) as { spend: { value: number } };
    assert.equal(bobOvBody.spend.value, 775);
    assert.equal(observedCalls.length, 2);
    assert.equal(observedCalls[1].accessToken, BOB_TOKEN);
    assert.equal(observedCalls[1].proof, BOB_PROOF);

    // Second request from Alice hits Alice's own cache
    const resAliceCached = await originalFetch(
      `${baseUrl}/api/meta/overview?startDate=2026-10-01&endDate=2026-10-07`,
      {
        headers: {
          Authorization: 'Bearer token-alice',
          'X-AdLens-Project': `${aliceWs.id}/${aliceProjectWithAccount.id}`,
        },
      }
    );
    const rawAliceCached = await resAliceCached.text();
    allResponses.push(rawAliceCached);
    assert.equal(resAliceCached.status, 200);
    assert.equal(resAliceCached.headers.get('x-adlens-cache'), 'true');
    assert.equal(JSON.parse(rawAliceCached).spend.value, 250);
    assert.equal(observedCalls.length, 2);

    // (b) Connected user without project account -> 409 META_NO_AD_ACCOUNT
    const resNoProjectAccount = await originalFetch(
      `${baseUrl}/api/meta/overview?startDate=2026-10-01&endDate=2026-10-07`,
      {
        headers: {
          Authorization: 'Bearer token-alice',
          'X-AdLens-Project': `${aliceWs.id}/${aliceProjectNoAccount.id}`,
        },
      }
    );
    const rawNoProjectAccount = await resNoProjectAccount.text();
    allResponses.push(rawNoProjectAccount);
    assert.equal(resNoProjectAccount.status, 409);
    const noAccErr = JSON.parse(rawNoProjectAccount).error;
    assert.equal(noAccErr.code, 'META_NO_AD_ACCOUNT');
    assert.equal(noAccErr.message, 'Choose a Facebook ad account first.');

    // (c) Re-auth required -> 401 META_REAUTH_REQUIRED
    await vault.saveConnection({
      uid: 'uid_alice',
      provider: 'meta',
      accountLabel: null,
      scopes: ['ads_read'],
      refreshToken: ALICE_TOKEN,
      accessToken: ALICE_TOKEN,
      accessTokenExpiresAt: Date.now() - 10_000, // expired -> triggers refreshMeta -> RefreshRejectedError -> VAULT_REAUTH_REQUIRED
    });

    const resReauth = await originalFetch(
      `${baseUrl}/api/meta/overview?startDate=2026-10-01&endDate=2026-10-07`,
      {
        headers: {
          Authorization: 'Bearer token-alice',
          'X-AdLens-Project': `${aliceWs.id}/${aliceProjectWithAccount.id}`,
        },
      }
    );
    const rawReauth = await resReauth.text();
    allResponses.push(rawReauth);
    assert.equal(resReauth.status, 401);
    const reauthErr = JSON.parse(rawReauth).error;
    assert.equal(reauthErr.code, 'META_REAUTH_REQUIRED');
    assert.equal(reauthErr.message, 'Facebook access has expired. Reconnect Facebook.');

    // (d) No connection + not allow-listed -> 404 NOT_CONNECTED
    const resCharlie = await originalFetch(
      `${baseUrl}/api/meta/overview?startDate=2026-10-01&endDate=2026-10-07`,
      {
        headers: { Authorization: 'Bearer token-charlie' },
      }
    );
    const rawCharlie = await resCharlie.text();
    allResponses.push(rawCharlie);
    assert.equal(resCharlie.status, 404);
    const charlieErr = JSON.parse(rawCharlie).error;
    assert.equal(charlieErr.code, 'NOT_CONNECTED');
    assert.equal(charlieErr.message, 'Facebook account is not connected.');

    // (e) No connection + allow-listed + system configured -> still works with system token
    const resSysAdmin = await originalFetch(`${baseUrl}/api/meta/account`, {
      headers: { Authorization: 'Bearer token-sysadmin' },
    });
    const rawSysAdmin = await resSysAdmin.text();
    allResponses.push(rawSysAdmin);
    assert.equal(resSysAdmin.status, 200);
    const sysAdminBody = JSON.parse(rawSysAdmin) as { accountId: string; name: string };
    assert.equal(sysAdminBody.accountId, '99001122');
    assert.equal(sysAdminBody.name, 'System Ad Account');
    assert.equal(observedCalls.length, 3);
    assert.equal(observedCalls[2].pathname, '/v26.0/act_99001122');
    assert.equal(observedCalls[2].accessToken, SYSTEM_TOKEN);
    assert.equal(observedCalls[2].proof, SYSTEM_PROOF);

    // Upstream Graph 190 error with user token returns 401 META_TOKEN_INVALID without leaking token
    clearMetaCache();
    simulateUpstream190 = true;
    const resBob190 = await originalFetch(
      `${baseUrl}/api/meta/overview?startDate=2026-10-01&endDate=2026-10-07`,
      {
        headers: {
          Authorization: 'Bearer token-bob',
          'X-AdLens-Project': `${bobWs.id}/${bobProject.id}`,
        },
      }
    );
    const rawBob190 = await resBob190.text();
    allResponses.push(rawBob190);
    assert.equal(resBob190.status, 401);
    assert.equal(JSON.parse(rawBob190).error.code, 'META_TOKEN_INVALID');

    // (g) Responses never contain the token string, app secret, or appsecret_proof
    const joined = allResponses.join('\n');
    for (const secretPiece of [
      APP_SECRET,
      SYSTEM_TOKEN,
      ALICE_TOKEN,
      BOB_TOKEN,
      SYSTEM_PROOF,
      ALICE_PROOF,
      BOB_PROOF,
    ]) {
      assert.ok(!joined.includes(secretPiece), `Leaked secret in response: ${secretPiece}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    clearMetaCache();
    setTestTokenVerifier(null);
    setTestFirestoreStore(null);
    setTestConnectionStore(null);
    resetVaultSingleton();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.APP_BASE_URL;
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    delete process.env.META_LOGIN_CONFIG_ID;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_AD_ACCOUNT_ID;
    delete process.env.META_SYSTEM_USER_ALLOWED_EMAILS;
    server.close();
  }
});
