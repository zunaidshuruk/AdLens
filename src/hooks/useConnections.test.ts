import assert from 'node:assert/strict';
import test from 'node:test';
import { apiClient, startMetaLogin } from '../api/client.js';
import type { ConnectionsResponse } from '../types/index.js';
import { isMetaUserConnected, parseMetaReturnParams, resolveMetaAdsLiveMode } from './useConnections.js';

function makeConnections(
  metaOverrides: Partial<ConnectionsResponse['meta']> = {}
): ConnectionsResponse {
  return {
    google: {
      configured: true,
      connected: false,
      email: null,
      ga4Property: null,
      searchConsoleSite: null,
    },
    meta: {
      configured: false,
      loginConfigured: false,
      connected: false,
      connectedAt: null,
      expiresAt: null,
      reconnect: 'no_expiry',
      adAccountId: null,
      notAvailable: true,
      ...metaOverrides,
    },
  };
}

test('Task 9d-1 — parseMetaReturnParams maps URL query params to metaReturnStatus, message, and cleaned search string', () => {
  const connected = parseMetaReturnParams('?connected=meta');
  assert.equal(connected.status, 'connected');
  assert.equal(connected.message, 'Facebook connected. Now choose your ad account.');
  assert.equal(connected.cleanedSearch, '');

  const denied = parseMetaReturnParams('?error=meta_denied&foo=bar');
  assert.equal(denied.status, 'denied');
  assert.equal(denied.message, 'You cancelled Facebook sign-in. Nothing was connected.');
  assert.equal(denied.cleanedSearch, '?foo=bar');

  const invalidState = parseMetaReturnParams('?error=invalid_state');
  assert.equal(invalidState.status, 'failed');
  assert.equal(invalidState.message, 'Facebook sign-in did not finish. Please try again.');
  assert.equal(invalidState.cleanedSearch, '');

  const exchangeFailed = parseMetaReturnParams('?error=meta_exchange_failed');
  assert.equal(exchangeFailed.status, 'failed');
  assert.equal(exchangeFailed.message, 'Facebook sign-in did not finish. Please try again.');
  assert.equal(exchangeFailed.cleanedSearch, '');

  // Unrelated Google params are left untouched
  const googleConnected = parseMetaReturnParams('?connected=google');
  assert.equal(googleConnected.status, null);
  assert.equal(googleConnected.message, null);
  assert.equal(googleConnected.cleanedSearch, '?connected=google');
});

test('Task 9d-1 — resolveMetaAdsLiveMode enables live mode for user Facebook connection and preserves fallback rules', () => {
  // User connected their own Facebook account -> live mode is true even if system-user notAvailable is true
  const userConn = makeConnections({
    loginConfigured: true,
    connected: true,
    connectedAt: '2026-10-26T00:00:00.000Z',
    reconnect: 'ok',
    adAccountId: '12345678',
    notAvailable: true,
  });
  assert.equal(resolveMetaAdsLiveMode(userConn, null, false), true);

  // Demo mode always disables live mode
  assert.equal(resolveMetaAdsLiveMode(userConn, null, true), false);

  // Not connected with user login, system token disallowed -> false
  const blockedSystem = makeConnections({
    configured: true,
    loginConfigured: true,
    connected: false,
    notAvailable: true,
  });
  assert.equal(resolveMetaAdsLiveMode(blockedSystem, null, false), false);

  // Allowed system token fallback -> true
  const allowedSystem = makeConnections({
    configured: true,
    loginConfigured: false,
    connected: true,
    notAvailable: false,
  });
  assert.equal(resolveMetaAdsLiveMode(allowedSystem, null, false), true);
});

test('Task 9d-1 — apiClient Meta endpoints (getMetaAdAccounts, selectMetaAdAccount, disconnectMeta 204 empty body, startMetaLogin)', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  const mockLocation = {
    pathname: '/connections',
    search: '',
    hash: '',
    href: 'http://localhost:3000/connections',
  };
  (globalThis as { window?: unknown }).window = {
    location: mockLocation,
    history: { pushState: () => {}, replaceState: () => {} },
    dispatchEvent: () => true,
  };

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body });

    if (url === '/api/connections/meta/ad-accounts' && method === 'GET') {
      return new Response(
        JSON.stringify({
          accounts: [
            {
              accountId: '11223344',
              name: 'Acme Ads',
              currency: 'USD',
              status: 'Active',
              usable: true,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url === '/api/connections/meta/selection' && method === 'POST') {
      const parsed = JSON.parse(body ?? '{}') as { adAccountId: string };
      return new Response(
        JSON.stringify({
          ok: true,
          adAccountId: parsed.adAccountId.replace(/^act_/, ''),
          adAccountName: 'Acme Ads',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url === '/api/connections/meta' && method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    if (url === '/api/auth/google/link-token' && method === 'POST') {
      return new Response(
        JSON.stringify({ linkToken: 'lt-meta-signed-123', expiresInSec: 300 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  try {
    const accountsRes = await apiClient.getMetaAdAccounts();
    assert.equal(accountsRes.accounts.length, 1);
    assert.equal(accountsRes.accounts[0].accountId, '11223344');

    const selectRes = await apiClient.selectMetaAdAccount('act_11223344');
    assert.equal(selectRes.ok, true);
    assert.equal(selectRes.adAccountId, '11223344');
    assert.equal(selectRes.adAccountName, 'Acme Ads');

    // 204 No Content with empty body resolves cleanly without throwing
    const disconnectRes = await apiClient.disconnectMeta();
    assert.equal(disconnectRes, undefined);

    await startMetaLogin();
    assert.equal(mockLocation.href, '/api/auth/meta/start?lt=lt-meta-signed-123');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

test('isMetaUserConnected ignores the shared company connection (so Disconnect really switches the card back)', () => {
  // Shared company token keeps meta.connected true, but there is no personal connection.
  assert.equal(isMetaUserConnected({ loginConfigured: true, connectedAt: null }), false);
  assert.equal(isMetaUserConnected({ loginConfigured: false, connectedAt: '2026-10-26T00:00:00.000Z' }), false);
  assert.equal(isMetaUserConnected({ loginConfigured: true, connectedAt: '2026-10-26T00:00:00.000Z' }), true);
  assert.equal(isMetaUserConnected(undefined), false);
});
