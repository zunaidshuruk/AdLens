import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCESS_TOKEN_TTL_MS,
  cleanProjects,
  createAccessKey,
  createAuthCode,
  createInMemoryMcpStore,
  exchangeAuthCode,
  hashSecret,
  isAllowedRedirectUri,
  listConnectedApps,
  pkceChallengeFor,
  refreshTokens,
  registerClient,
  resolveBearer,
  revokeAccessKey,
  revokeConnectedApp,
  MAX_KEYS_PER_USER,
} from './lib/mcpCredentials.js';

const P = [{ workspaceId: 'ws1', projectId: 'p1' }];
const VERIFIER = 'v'.repeat(50);

test('access keys: shown once, stored hashed, resolve to their owner and projects, revocable', async () => {
  const store = createInMemoryMcpStore();
  const { record, secret } = await createAccessKey(store, 'u1', ' Claude Code ', P);
  assert.match(secret, /^adl_[A-Za-z0-9_-]{40,}$/);
  assert.equal(record.name, 'Claude Code');
  assert.notEqual(record.hash, secret);
  assert.equal(record.hash, hashSecret(secret));
  assert.ok(!JSON.stringify(record).includes(secret), 'the secret itself is never stored');

  const principal = await resolveBearer(store, secret);
  assert.deepEqual({ uid: principal?.uid, projects: principal?.projects, via: principal?.via }, { uid: 'u1', projects: P, via: 'key' });
  assert.equal(await resolveBearer(store, secret + 'x'), null);
  assert.equal(await resolveBearer(store, 'adl_nonsense'), null);
  assert.equal(await resolveBearer(store, ''), null);

  assert.equal(await revokeAccessKey(store, 'u2', record.id), false, 'someone else cannot revoke it');
  assert.equal(await revokeAccessKey(store, 'u1', record.id), true);
  assert.equal(await resolveBearer(store, secret), null, 'a revoked key stops working at once');
  assert.equal(await revokeAccessKey(store, 'u1', record.id), false);
});

test('access keys need a name and a project, and are capped per person', async () => {
  const store = createInMemoryMcpStore();
  await assert.rejects(() => createAccessKey(store, 'u1', '  ', P), { code: 'INVALID_NAME' });
  await assert.rejects(() => createAccessKey(store, 'u1', 'x', []), { code: 'NO_PROJECTS' });
  for (let i = 0; i < MAX_KEYS_PER_USER; i++) await createAccessKey(store, 'u1', `k${i}`, P);
  await assert.rejects(() => createAccessKey(store, 'u1', 'one too many', P), { code: 'LIMIT_REACHED' });
  const keys = await store.listKeys('u1');
  await revokeAccessKey(store, 'u1', keys[0].id);
  await createAccessKey(store, 'u1', 'fits again', P);
});

test('cleanProjects drops junk, duplicates and path tricks', () => {
  assert.deepEqual(cleanProjects([{ workspaceId: 'a', projectId: 'b' }, { workspaceId: 'a', projectId: 'b' }, { workspaceId: 'a/../x', projectId: 'b' }, { workspaceId: 1, projectId: 'b' }, null, 'x']), [{ workspaceId: 'a', projectId: 'b' }]);
  assert.deepEqual(cleanProjects('nope'), []);
});

test('redirect addresses: https or loopback http only', () => {
  assert.ok(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback'));
  assert.ok(isAllowedRedirectUri('http://localhost:33418/callback'));
  assert.ok(isAllowedRedirectUri('http://127.0.0.1:8080/cb'));
  assert.ok(!isAllowedRedirectUri('http://evil.com/cb'));
  assert.ok(!isAllowedRedirectUri('javascript:alert(1)'));
  assert.ok(!isAllowedRedirectUri('https://a.com/cb#frag'));
  assert.ok(!isAllowedRedirectUri('https://user:pw@a.com/cb'));
  assert.ok(!isAllowedRedirectUri('myapp://cb'));
});

async function approvedClient(store = createInMemoryMcpStore()) {
  const client = await registerClient(store, { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] });
  const code = await createAuthCode(store, { clientId: client.clientId, uid: 'u1', redirectUri: 'https://claude.ai/cb', codeChallenge: pkceChallengeFor(VERIFIER), projects: P });
  return { store, client, code };
}

test('OAuth: registration validates addresses', async () => {
  const store = createInMemoryMcpStore();
  await assert.rejects(() => registerClient(store, { client_name: 'x', redirect_uris: [] }), { code: 'invalid_redirect_uri' });
  await assert.rejects(() => registerClient(store, { redirect_uris: ['http://evil.com/cb'] }), { code: 'invalid_redirect_uri' });
  const c = await registerClient(store, { redirect_uris: ['https://a.com/cb'] });
  assert.equal(c.clientName, 'MCP client');
  assert.match(c.clientId, /^adlc_/);
});

test('OAuth: a code can only be issued to a registered address and with a PKCE challenge', async () => {
  const store = createInMemoryMcpStore();
  const client = await registerClient(store, { client_name: 'C', redirect_uris: ['https://c.com/cb'] });
  const base = { clientId: client.clientId, uid: 'u1', projects: P, codeChallenge: pkceChallengeFor(VERIFIER) };
  await assert.rejects(() => createAuthCode(store, { ...base, redirectUri: 'https://c.com/other' }), { code: 'invalid_request' });
  await assert.rejects(() => createAuthCode(store, { ...base, redirectUri: 'https://c.com/cb', codeChallenge: 'short' }), { code: 'invalid_request' });
  await assert.rejects(() => createAuthCode(store, { ...base, clientId: 'unknown', redirectUri: 'https://c.com/cb' }), { code: 'invalid_request' });
  await assert.rejects(() => createAuthCode(store, { ...base, redirectUri: 'https://c.com/cb', projects: [] }), { code: 'NO_PROJECTS' });
});

test('OAuth: code + PKCE gives tokens that resolve, expire and can be revoked as a connected app', async () => {
  const { store, client, code } = await approvedClient();
  const tokens = await exchangeAuthCode(store, { code, clientId: client.clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: VERIFIER }, 1_000_000);
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 3600);
  const principal = await resolveBearer(store, tokens.access_token, 1_000_000 + 1000);
  assert.deepEqual({ uid: principal?.uid, via: principal?.via, label: principal?.label }, { uid: 'u1', via: 'oauth', label: 'Claude' });
  assert.equal(await resolveBearer(store, tokens.access_token, 1_000_000 + ACCESS_TOKEN_TTL_MS + 1), null, 'access tokens expire after an hour');
  assert.equal(await resolveBearer(store, tokens.refresh_token), null, 'a refresh token is not an access token');

  const apps = await listConnectedApps(store, 'u1', 1_000_000 + 1000);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].clientName, 'Claude');
  assert.equal(await revokeConnectedApp(store, 'u2', apps[0].familyId), false);
  assert.equal(await revokeConnectedApp(store, 'u1', apps[0].familyId, 1_000_000 + 1000), true);
  assert.equal(await resolveBearer(store, tokens.access_token, 1_000_000 + 2000), null, 'revoking an app cuts it off immediately');
  assert.deepEqual(await listConnectedApps(store, 'u1', 1_000_000 + 2000), []);
});

test('OAuth: wrong verifier, wrong client, wrong address, reuse and expiry are all refused', async () => {
  const run = async (mutate: Partial<{ clientId: string; redirectUri: string; codeVerifier: string }>, delayMs = 0) => {
    const { store, client, code } = await approvedClient();
    return exchangeAuthCode(store, { code, clientId: client.clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: VERIFIER, ...mutate }, Date.now() + delayMs);
  };
  await assert.rejects(() => run({ codeVerifier: 'w'.repeat(50) }), { code: 'invalid_grant' });
  await assert.rejects(() => run({ clientId: 'adlc_other' }), { code: 'invalid_grant' });
  await assert.rejects(() => run({ redirectUri: 'https://claude.ai/other' }), { code: 'invalid_grant' });
  await assert.rejects(() => run({ codeVerifier: 'short' }), { code: 'invalid_request' });
  await assert.rejects(() => run({}, 11 * 60 * 1000), { code: 'invalid_grant' });

  const { store, client, code } = await approvedClient();
  const args = { code, clientId: client.clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: VERIFIER };
  await exchangeAuthCode(store, args);
  await assert.rejects(() => exchangeAuthCode(store, args), { code: 'invalid_grant' }, 'a code works once');

  const second = await approvedClient();
  await assert.rejects(() => exchangeAuthCode(second.store, { code: second.code, clientId: second.client.clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: 'w'.repeat(50) }));
  await assert.rejects(() => exchangeAuthCode(second.store, { code: second.code, clientId: second.client.clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: VERIFIER }), { code: 'invalid_grant' }, 'a failed attempt burns the code');
});

test('OAuth: refresh tokens rotate, and reusing an old one revokes the whole approval', async () => {
  const { store, client, code } = await approvedClient();
  const t0 = await exchangeAuthCode(store, { code, clientId: client.clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: VERIFIER });
  const t1 = await refreshTokens(store, { refreshToken: t0.refresh_token, clientId: client.clientId });
  assert.notEqual(t1.access_token, t0.access_token);
  assert.ok(await resolveBearer(store, t1.access_token));
  await assert.rejects(() => refreshTokens(store, { refreshToken: t0.refresh_token, clientId: client.clientId }), { code: 'invalid_grant' });
  assert.equal(await resolveBearer(store, t1.access_token), null, 'reuse of an old refresh token revoked the newer tokens too');
  await assert.rejects(() => refreshTokens(store, { refreshToken: t1.refresh_token, clientId: client.clientId }), { code: 'invalid_grant' });
});

test('OAuth: a refresh token belongs to its client', async () => {
  const { store, client, code } = await approvedClient();
  const t = await exchangeAuthCode(store, { code, clientId: client.clientId, redirectUri: 'https://claude.ai/cb', codeVerifier: VERIFIER });
  await assert.rejects(() => refreshTokens(store, { refreshToken: t.refresh_token, clientId: 'adlc_other' }), { code: 'invalid_grant' });
  await assert.rejects(() => refreshTokens(store, { refreshToken: t.access_token, clientId: client.clientId }), { code: 'invalid_request' });
});
