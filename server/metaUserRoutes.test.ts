import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryVaultStore, setTestConnectionStore } from './lib/connectionStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { computeAppSecretProof } from './lib/meta.js';
import { AD_ACCOUNT_FIELDS } from './lib/metaOAuth.js';
import { RefreshRejectedError } from './lib/tokenVault.js';
import { getVault, refreshMeta, resetVaultSingleton } from './lib/vault.js';

test('Sprint 9c-2 — Meta user ad accounts, selection, disconnect, expired reconnect state, and secret non-disclosure', async () => {
  const ENCRYPTION_KEY = 'test-encryption-key-sprint-9c2-32chars!';
  const APP_ID = 'meta-app-id-9c2';
  const APP_SECRET = 'meta-secret-9c2-never-leak-this-value';
  const CONFIG_ID = 'meta-config-9c2';
  const ALICE_META_TOKEN = 'EAAB-alice-long-lived-meta-token-777777';
  const BOB_META_TOKEN = 'EAAB-bob-long-lived-meta-token-888888';
  const ALICE_PROOF = computeAppSecretProof(ALICE_META_TOKEN, APP_SECRET);
  const BOB_PROOF = computeAppSecretProof(BOB_META_TOKEN, APP_SECRET);

  // 1. refreshMeta always throws RefreshRejectedError with the exact message
  await assert.rejects(
    () => refreshMeta(),
    (err: unknown) =>
      err instanceof RefreshRejectedError &&
      err.message === 'Facebook access has expired. Reconnect Facebook.'
  );

  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.META_APP_ID = APP_ID;
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.META_LOGIN_CONFIG_ID = CONFIG_ID;
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.META_AD_ACCOUNT_ID;

  const fsStore = createInMemoryFirestoreStore();
  setTestFirestoreStore(fsStore);
  const connStore = createInMemoryVaultStore();
  setTestConnectionStore(connStore);
  resetVaultSingleton();

  // Bootstrap Alice with two projects in her workspace, and Bob in his own workspace
  const { workspace: aliceWs } = await fsStore.bootstrapUserAndWorkspace({
    uid: 'uid_alice',
    email: 'alice@acme.com',
    displayName: 'Alice',
  });
  const aliceProject1 = await fsStore.createProject(aliceWs.id, {
    name: 'Alice Main Store',
    domain: 'alice.com',
    ga4PropertyId: '1001',
    ga4PropertyName: 'Alice GA4',
    searchConsoleSite: 'sc-domain:alice.com',
    metaAdAccountId: null,
    timezone: 'UTC',
    currency: 'USD',
    createdBy: 'uid_alice',
  });
  const aliceProject2 = await fsStore.createProject(aliceWs.id, {
    name: 'Alice Second Store',
    domain: 'alice2.com',
    ga4PropertyId: '1002',
    ga4PropertyName: 'Alice GA4 #2',
    searchConsoleSite: null,
    metaAdAccountId: '99999999',
    timezone: 'UTC',
    currency: 'USD',
    createdBy: 'uid_alice',
  });

  await fsStore.bootstrapUserAndWorkspace({
    uid: 'uid_bob',
    email: 'bob@acme.com',
    displayName: 'Bob',
  });

  setTestTokenVerifier(async (token: string) => {
    if (token === 'token-alice') {
      return {
        uid: 'uid_alice',
        email: 'alice@acme.com',
        name: 'Alice',
        email_verified: true,
        firebase: { identities: { 'google.com': ['g1'] }, sign_in_provider: 'google.com' },
      } as never;
    }
    if (token === 'token-bob') {
      return {
        uid: 'uid_bob',
        email: 'bob@acme.com',
        name: 'Bob',
        email_verified: true,
        firebase: { identities: { 'google.com': ['g2'] }, sign_in_provider: 'google.com' },
      } as never;
    }
    throw new Error('Invalid token');
  });

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const originalFetch = globalThis.fetch;

  let simulateGraphErrorCode: number | null = null;
  let revokeCalls = 0;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init);
    }

    if (url.startsWith('https://graph.facebook.com/v26.0/me/permissions')) {
      revokeCalls += 1;
      assert.equal(init?.method, 'DELETE');
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('access_token'), ALICE_META_TOKEN);
      assert.equal(parsed.searchParams.get('appsecret_proof'), ALICE_PROOF);
      // Simulate revoke failure (network / 500 error) to verify DELETE still deletes vault record
      throw new Error(`Simulated Facebook revoke failure containing ${ALICE_META_TOKEN} and ${APP_SECRET}`);
    }

    if (url.startsWith('https://graph.facebook.com/v26.0/me/adaccounts')) {
      const parsed = new URL(url);
      const token = parsed.searchParams.get('access_token');
      const proof = parsed.searchParams.get('appsecret_proof');

      if (simulateGraphErrorCode !== null) {
        return new Response(
          JSON.stringify({
            error: {
              code: simulateGraphErrorCode,
              error_subcode: 463,
              message: `Raw Graph error leaking token=${token} secret=${APP_SECRET} proof=${proof}`,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (token === ALICE_META_TOKEN) {
        assert.equal(proof, ALICE_PROOF);
        const page = parsed.searchParams.get('page');
        if (!page) {
          assert.equal(parsed.searchParams.get('fields'), AD_ACCOUNT_FIELDS);
          assert.equal(parsed.searchParams.get('limit'), '100');
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'act_22222222',
                  account_id: '22222222',
                  name: 'Zeta Disabled Account',
                  currency: 'USD',
                  timezone_name: 'America/New_York',
                  account_status: 2,
                  business: { id: 'b1', name: 'Alice Biz' },
                },
                {
                  id: 'act_11111111',
                  account_id: '11111111',
                  name: 'Alpha Active Account',
                  currency: 'GBP',
                  timezone_name: 'Europe/London',
                  account_status: 1,
                  business: { id: 'b1', name: 'Alice Biz' },
                },
              ],
              paging: {
                next: 'https://graph.facebook.com/v26.0/me/adaccounts?page=2',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'act_33333333',
                account_id: '33333333',
                name: 'Beta Active Account',
                currency: 'EUR',
                timezone_name: 'Europe/Paris',
                account_status: 1,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (token === BOB_META_TOKEN) {
        assert.equal(proof, BOB_PROOF);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'act_44444444',
                account_id: '44444444',
                name: 'Bob Secret Ad Account',
                currency: 'USD',
                timezone_name: 'UTC',
                account_status: 1,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    throw new Error(`Unexpected external fetch: ${url}`);
  };

  try {
    const collectedResponses: string[] = [];

    // 1. Unauthenticated request to GET /api/connections/meta/ad-accounts returns 401
    const resUnauth = await originalFetch(`${baseUrl}/api/connections/meta/ad-accounts`);
    const rawUnauth = await resUnauth.text();
    collectedResponses.push(rawUnauth);
    assert.equal(resUnauth.status, 401);

    // 2. Not connected in vault returns 404 NOT_CONNECTED
    const resNotConn = await originalFetch(`${baseUrl}/api/connections/meta/ad-accounts`, {
      headers: { Authorization: 'Bearer token-alice' },
    });
    const rawNotConn = await resNotConn.text();
    collectedResponses.push(rawNotConn);
    assert.equal(resNotConn.status, 404);
    assert.equal(JSON.parse(rawNotConn).error.code, 'NOT_CONNECTED');

    // 3. Save Meta connections for Alice and Bob in the vault
    const vault = getVault();
    const futureExpiry = Date.now() + 45 * 86_400_000;
    await vault.saveConnection({
      uid: 'uid_alice',
      provider: 'meta',
      accountLabel: null,
      scopes: ['ads_read'],
      refreshToken: ALICE_META_TOKEN,
      accessToken: ALICE_META_TOKEN,
      accessTokenExpiresAt: futureExpiry,
    });
    await vault.saveConnection({
      uid: 'uid_bob',
      provider: 'meta',
      accountLabel: null,
      scopes: ['ads_read'],
      refreshToken: BOB_META_TOKEN,
      accessToken: BOB_META_TOKEN,
      accessTokenExpiresAt: futureExpiry,
    });

    // 4. GET /api/connections/meta/ad-accounts maps accounts across pages (usable first, then alphabetical)
    const resAccounts = await originalFetch(`${baseUrl}/api/connections/meta/ad-accounts`, {
      headers: { Authorization: 'Bearer token-alice' },
    });
    const rawAccounts = await resAccounts.text();
    collectedResponses.push(rawAccounts);
    assert.equal(resAccounts.status, 200);
    const accountsBody = JSON.parse(rawAccounts) as {
      accounts: Array<{
        accountId: string;
        name: string;
        currency: string;
        timezoneName: string;
        status: string;
        usable: boolean;
        businessName: string | null;
      }>;
    };
    assert.equal(accountsBody.accounts.length, 3);
    assert.deepEqual(
      accountsBody.accounts.map((a) => a.accountId),
      ['11111111', '33333333', '22222222']
    );
    assert.equal(accountsBody.accounts[0].name, 'Alpha Active Account');
    assert.equal(accountsBody.accounts[0].usable, true);
    assert.equal(accountsBody.accounts[2].usable, false);

    // 5. Graph API error returns diagnosed message, never raw Graph text or tokens
    simulateGraphErrorCode = 190;
    const resGraphErr = await originalFetch(`${baseUrl}/api/connections/meta/ad-accounts`, {
      headers: { Authorization: 'Bearer token-alice' },
    });
    const rawGraphErr = await resGraphErr.text();
    collectedResponses.push(rawGraphErr);
    assert.equal(resGraphErr.status, 401);
    const graphErrBody = JSON.parse(rawGraphErr);
    assert.equal(graphErrBody.error.code, 'META_TOKEN_INVALID');
    assert.ok(graphErrBody.error.message.includes('the connection expired'));
    simulateGraphErrorCode = null;

    // 6. Another user's ad account ID (Bob's 44444444) is refused for Alice
    const resSelectBob = await originalFetch(`${baseUrl}/api/connections/meta/selection`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice',
        'Content-Type': 'application/json',
        'X-AdLens-Project': `${aliceWs.id}/${aliceProject1.id}`,
      },
      body: JSON.stringify({ adAccountId: 'act_44444444' }),
    });
    const rawSelectBob = await resSelectBob.text();
    collectedResponses.push(rawSelectBob);
    assert.equal(resSelectBob.status, 400);
    assert.equal(JSON.parse(rawSelectBob).error.code, 'INVALID_AD_ACCOUNT');

    // Verify Alice's project 1 was NOT modified
    const unchangedP1 = await fsStore.getProject(aliceWs.id, aliceProject1.id);
    assert.equal(unchangedP1?.metaAdAccountId, null);

    // 7. Selecting an account in Alice's own list (with "act_" prefix) stores digits only on active project and nothing else
    const resSelectOwn = await originalFetch(`${baseUrl}/api/connections/meta/selection`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice',
        'Content-Type': 'application/json',
        'X-AdLens-Project': `${aliceWs.id}/${aliceProject1.id}`,
      },
      body: JSON.stringify({ adAccountId: 'act_11111111' }),
    });
    const rawSelectOwn = await resSelectOwn.text();
    collectedResponses.push(rawSelectOwn);
    assert.equal(resSelectOwn.status, 200);
    const selectOwnBody = JSON.parse(rawSelectOwn) as { ok: boolean; adAccountId: string };
    assert.equal(selectOwnBody.ok, true);
    assert.equal(selectOwnBody.adAccountId, '11111111');

    const updatedP1 = await fsStore.getProject(aliceWs.id, aliceProject1.id);
    const untouchedP2 = await fsStore.getProject(aliceWs.id, aliceProject2.id);
    assert.equal(updatedP1?.metaAdAccountId, '11111111');
    assert.equal(updatedP1?.metaAdAccountName, 'Alpha Active Account');
    assert.equal(updatedP1?.ga4PropertyId, '1001');
    assert.equal(updatedP1?.searchConsoleSite, 'sc-domain:alice.com');
    assert.equal(untouchedP2?.metaAdAccountId, '99999999');

    // 8. GET /api/connections returns the enriched meta block with active project's adAccountId and reconnect: "ok"
    const resConnOk = await originalFetch(`${baseUrl}/api/connections`, {
      headers: {
        Authorization: 'Bearer token-alice',
        'X-AdLens-Project': `${aliceWs.id}/${aliceProject1.id}`,
      },
    });
    const rawConnOk = await resConnOk.text();
    collectedResponses.push(rawConnOk);
    assert.equal(resConnOk.status, 200);
    const connOkBody = JSON.parse(rawConnOk);
    assert.equal(connOkBody.meta.loginConfigured, true);
    assert.equal(connOkBody.meta.connected, true);
    assert.equal(typeof connOkBody.meta.connectedAt, 'string');
    assert.equal(connOkBody.meta.expiresAt, new Date(futureExpiry).toISOString());
    assert.equal(connOkBody.meta.reconnect, 'ok');
    assert.equal(connOkBody.meta.adAccountId, '11111111');

    // 9. Expired token reads as reconnect: "expired"
    const pastExpiry = Date.now() - 10_000;
    await vault.saveConnection({
      uid: 'uid_alice',
      provider: 'meta',
      accountLabel: null,
      scopes: ['ads_read'],
      refreshToken: ALICE_META_TOKEN,
      accessToken: ALICE_META_TOKEN,
      accessTokenExpiresAt: pastExpiry,
    });

    const resConnExpired = await originalFetch(`${baseUrl}/api/connections`, {
      headers: {
        Authorization: 'Bearer token-alice',
        'X-AdLens-Project': `${aliceWs.id}/${aliceProject1.id}`,
      },
    });
    const rawConnExpired = await resConnExpired.text();
    collectedResponses.push(rawConnExpired);
    assert.equal(resConnExpired.status, 200);
    const connExpiredBody = JSON.parse(rawConnExpired);
    assert.equal(connExpiredBody.meta.reconnect, 'expired');

    // Calling /ad-accounts with an expired token triggers refreshMeta -> RefreshRejectedError -> 401 META_REAUTH_REQUIRED
    const resExpiredAccounts = await originalFetch(`${baseUrl}/api/connections/meta/ad-accounts`, {
      headers: { Authorization: 'Bearer token-alice' },
    });
    const rawExpiredAccounts = await resExpiredAccounts.text();
    collectedResponses.push(rawExpiredAccounts);
    assert.equal(resExpiredAccounts.status, 401);

    // 10. DELETE /api/connections/meta removes the vault record even when Facebook revoke call fails
    const resDelete = await originalFetch(`${baseUrl}/api/connections/meta`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-alice' },
    });
    const rawDelete = await resDelete.text();
    collectedResponses.push(rawDelete);
    assert.equal(resDelete.status, 204);
    assert.equal(revokeCalls, 1);
    assert.equal(await vault.getSummary('uid_alice', 'meta'), null);
    assert.equal(connStore.map.has('uid_alice_meta'), false);

    // 11. Tokens, app secret, and appsecret_proof never appear in any response or error
    const allText = collectedResponses.join('\n');
    for (const secretValue of [
      APP_SECRET,
      ALICE_META_TOKEN,
      BOB_META_TOKEN,
      ALICE_PROOF,
      BOB_PROOF,
    ]) {
      assert.ok(!allText.includes(secretValue), `Leaked secret value: ${secretValue}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
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
    server.close();
  }
});
