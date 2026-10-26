import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { fetchGA4StreamUris } from './lib/google.js';
import { VaultError, type TokenVault } from './lib/tokenVault.js';
import { setTestVault } from './lib/vault.js';
import { clearGoogleRateLimit } from './routes/connections.js';

test('Sprint 9a — fetchGA4StreamUris paginates up to 3 pages, returns WEB_DATA_STREAM defaultUris, and never leaks access token', async () => {
  const originalFetch = globalThis.fetch;
  const SECRET_TOKEN = 'ya29.super-secret-stream-token-999';
  let callCount = 0;

  try {
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      callCount += 1;
      if (url.includes('pageToken=p2')) {
        return new Response(
          JSON.stringify({
            dataStreams: [
              { type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://blog.acme.com' } },
              { type: 'IOS_APP_DATA_STREAM' },
            ],
            nextPageToken: 'p3',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('pageToken=p3')) {
        return new Response(
          JSON.stringify({
            dataStreams: [
              { type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://shop.acme.com' } },
            ],
            nextPageToken: 'p4-should-not-fetch',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          dataStreams: [
            { type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://www.acme.com' } },
            { type: 'ANDROID_APP_DATA_STREAM' },
          ],
          nextPageToken: 'p2',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const uris = await fetchGA4StreamUris(SECRET_TOKEN, 'properties/1001');
    assert.equal(callCount, 3);
    assert.deepEqual(uris, [
      'https://www.acme.com',
      'https://blog.acme.com',
      'https://shop.acme.com',
    ]);

    // Empty property streams -> []
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    assert.deepEqual(await fetchGA4StreamUris(SECRET_TOKEN, '1002'), []);

    // Error never includes token
    globalThis.fetch = async () => new Response('Server error', { status: 500 });
    await assert.rejects(
      () => fetchGA4StreamUris(SECRET_TOKEN, '1003'),
      (err: Error) => {
        assert.ok(!err.message.includes(SECRET_TOKEN));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Sprint 9a — GET /api/google/discover suggests best GA4 + GSC, tolerates stream failures, enforces auth/vault, caps stream lookups at 20, and is read-only', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-9a-32chars!';
  process.env.APP_BASE_URL = 'http://localhost:3000';

  const store = createInMemoryFirestoreStore();
  setTestFirestoreStore(store);
  clearGoogleRateLimit();

  const { workspace } = await store.bootstrapUserAndWorkspace({
    uid: 'uid_discover_connected',
    email: 'connected@acme.com',
    displayName: 'Connected User',
  });
  const project = await store.createProject(workspace.id, {
    name: 'Acme Store',
    domain: 'acme.com',
    timezone: 'UTC',
    currency: 'USD',
    createdBy: 'uid_discover_connected',
  });

  await store.bootstrapUserAndWorkspace({
    uid: 'uid_discover_unconnected',
    email: 'unconnected@acme.com',
    displayName: 'Unconnected User',
  });

  setTestTokenVerifier(async (token: string) => {
    if (token === 'token-connected') {
      return {
        uid: 'uid_discover_connected',
        email: 'connected@acme.com',
        email_verified: true,
        firebase: { identities: { 'google.com': ['g-conn'] }, sign_in_provider: 'google.com' },
      } as never;
    }
    if (token === 'token-unconnected') {
      return {
        uid: 'uid_discover_unconnected',
        email: 'unconnected@acme.com',
        email_verified: true,
        firebase: { identities: { 'google.com': ['g-unconn'] }, sign_in_provider: 'google.com' },
      } as never;
    }
    throw new Error('Invalid token');
  });

  const SECRET_ACCESS_TOKEN = 'ya29.secret-google-discover-token-xyz123';

  const mockVault: TokenVault = {
    async saveConnection() {},
    async getSummary(uid: string) {
      if (uid === 'uid_discover_connected') {
        return {
          provider: 'google',
          connected: true,
          status: 'active',
          accountLabel: 'connected@acme.com',
          scopes: [],
          updatedAt: Date.now(),
          needsReconnect: false,
        };
      }
      return null;
    },
    async getAccessToken(uid: string) {
      if (uid === 'uid_discover_connected') {
        return SECRET_ACCESS_TOKEN;
      }
      throw new VaultError('VAULT_NOT_CONNECTED', 'Not connected', 401);
    },
    async getRefreshToken() {
      return 'refresh-token';
    },
    async deleteConnection() {},
  };
  setTestVault(mockVault);

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const originalFetch = globalThis.fetch;
  const checkedStreamPropertyIds: string[] = [];
  let scenario: 'normal' | 'many_properties' = 'normal';

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Pass through local test server requests
    if (url.startsWith(baseUrl)) {
      return originalFetch(input, init);
    }

    if (url.startsWith('https://analyticsadmin.googleapis.com/v1beta/accountSummaries')) {
      if (scenario === 'many_properties') {
        // 25 properties; property #24 has "acme" in its name so it must be prioritized in the top 20
        const summaries = Array.from({ length: 25 }, (_, i) => {
          const id = `${2000 + i}`;
          const isAcme = i === 24;
          return {
            property: `properties/${id}`,
            displayName: isAcme ? 'Acme Flagship Web' : `Other Brand ${i}`,
          };
        });
        return new Response(
          JSON.stringify({
            accountSummaries: [
              {
                name: 'accounts/1',
                displayName: 'Portfolio Account',
                propertySummaries: summaries,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          accountSummaries: [
            {
              name: 'accounts/1',
              displayName: 'Acme Corp',
              propertySummaries: [
                { property: 'properties/111', displayName: 'Acme Main Store' },
                { property: 'properties/222', displayName: 'Failing Stream Property' },
                { property: 'properties/333', displayName: 'Unrelated Store' },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.startsWith('https://www.googleapis.com/webmasters/v3/sites')) {
      return new Response(
        JSON.stringify({
          siteEntry: [
            { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' },
            { siteUrl: 'https://other.example/', permissionLevel: 'siteFullUser' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const streamMatch = url.match(/\/v1beta\/properties\/([^/]+)\/dataStreams/);
    if (streamMatch) {
      const propId = decodeURIComponent(streamMatch[1]);
      checkedStreamPropertyIds.push(propId);
      if (propId === '222') {
        return new Response('Stream API Error', { status: 500 });
      }
      if (propId === '111' || propId === '2024') {
        return new Response(
          JSON.stringify({
            dataStreams: [
              {
                type: 'WEB_DATA_STREAM',
                webStreamData: { defaultUri: 'https://www.acme.com' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          dataStreams: [
            {
              type: 'WEB_DATA_STREAM',
              webStreamData: { defaultUri: `https://prop-${propId}.example.org` },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    // 1. Signed-out request gets 401
    const resUnauth = await originalFetch(`${baseUrl}/api/google/discover?domain=acme.com`);
    assert.equal(resUnauth.status, 401);

    // 2. User without a Google connection gets the same 401 GOOGLE_NOT_CONNECTED as other /api/google routes
    const resNoConn = await originalFetch(`${baseUrl}/api/google/discover?domain=acme.com`, {
      headers: { Authorization: 'Bearer token-unconnected' },
    });
    const noConnText = await resNoConn.text();
    assert.equal(resNoConn.status, 401);
    assert.equal(JSON.parse(noConnText).error.code, 'GOOGLE_NOT_CONNECTED');
    assert.ok(!noConnText.includes(SECRET_ACCESS_TOKEN));

    // 3. Domain validation (empty or >253 chars -> 400 INVALID_DOMAIN)
    const resEmptyDomain = await originalFetch(`${baseUrl}/api/google/discover?domain=%20%20`, {
      headers: { Authorization: 'Bearer token-connected' },
    });
    assert.equal(resEmptyDomain.status, 400);
    assert.equal((await resEmptyDomain.json()).error.code, 'INVALID_DOMAIN');

    const longDomain = `${'a'.repeat(250)}.com`;
    const resLongDomain = await originalFetch(
      `${baseUrl}/api/google/discover?domain=${encodeURIComponent(longDomain)}`,
      { headers: { Authorization: 'Bearer token-connected' } }
    );
    assert.equal(resLongDomain.status, 400);
    assert.equal((await resLongDomain.json()).error.code, 'INVALID_DOMAIN');

    // 4. Connected user: returns right suggested GA4 property + GSC site even when property 222 stream lookup fails
    checkedStreamPropertyIds.length = 0;
    const resDiscover = await originalFetch(`${baseUrl}/api/google/discover?domain=acme.com`, {
      headers: {
        Authorization: 'Bearer token-connected',
        'X-AdLens-Project': `${workspace.id}/${project.id}`,
      },
    });
    const discoverRaw = await resDiscover.text();
    assert.equal(resDiscover.status, 200);
    assert.ok(!discoverRaw.includes(SECRET_ACCESS_TOKEN));

    const discoverBody = JSON.parse(discoverRaw) as {
      domain: string;
      suggested: { ga4PropertyId: string | null; searchConsoleSiteUrl: string | null };
      checkedProperties: number;
      totalProperties: number;
      ga4: { propertyId: string; score: number }[];
      searchConsole: { siteUrl: string; score: number }[];
    };
    assert.equal(discoverBody.domain, 'acme.com');
    assert.equal(discoverBody.suggested.ga4PropertyId, '111');
    assert.equal(discoverBody.suggested.searchConsoleSiteUrl, 'sc-domain:acme.com');
    assert.equal(discoverBody.checkedProperties, 3);
    assert.equal(discoverBody.totalProperties, 3);
    assert.equal(discoverBody.ga4.length, 3);

    // Confirm read-only: project's saved selection is untouched
    const unchangedProject = await store.getProject(workspace.id, project.id);
    assert.equal(unchangedProject?.ga4PropertyId, null);
    assert.equal(unchangedProject?.searchConsoleSite, null);

    // 5. More than 20 properties only checks 20, prioritizing domain/name match first
    scenario = 'many_properties';
    checkedStreamPropertyIds.length = 0;
    const resMany = await originalFetch(`${baseUrl}/api/google/discover?domain=acme.com`, {
      headers: { Authorization: 'Bearer token-connected' },
    });
    assert.equal(resMany.status, 200);
    const manyBody = (await resMany.json()) as {
      suggested: { ga4PropertyId: string | null };
      checkedProperties: number;
      totalProperties: number;
    };
    assert.equal(manyBody.checkedProperties, 20);
    assert.equal(manyBody.totalProperties, 25);
    assert.equal(checkedStreamPropertyIds.length, 20);
    assert.ok(checkedStreamPropertyIds.includes('2024'));
    assert.equal(manyBody.suggested.ga4PropertyId, '2024');
  } finally {
    globalThis.fetch = originalFetch;
    setTestVault(null);
    setTestFirestoreStore(null);
    setTestTokenVerifier(null);
    clearGoogleRateLimit();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.APP_BASE_URL;
    server.close();
  }
});
