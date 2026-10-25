import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RefreshRejectedError,
  VaultError,
  buildKeyring,
  connectionIdFor,
  createTokenVault,
  isPermanentRefreshError,
  openAgentSecret,
  openSecret,
  parsePreviousSecrets,
  sealAgentSecret,
  sealSecret,
  sealedKeyId,
  type ConnectionRecord,
  type RefreshResult,
  type VaultStore,
} from './tokenVault.js';

const SECRET_A = 'a'.repeat(32) + '-primary-secret-for-tests';
const SECRET_B = 'b'.repeat(32) + '-older-secret-for-tests';

const ctx = (uid: string, provider: 'google' | 'meta' = 'google') => ({
  uid,
  provider,
  connectionId: connectionIdFor(uid, provider),
});

function memoryStore() {
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
  return { store, map };
}

function setup(opts: { refresh?: (t: string) => Promise<RefreshResult>; keyring?: ReturnType<typeof buildKeyring> } = {}) {
  const { store, map } = memoryStore();
  let clock = 1_000_000;
  const calls: string[] = [];
  const refresh =
    opts.refresh ??
    (async (t: string) => {
      calls.push(t);
      return { accessToken: `access-${calls.length}`, expiresAt: clock + 3_600_000 };
    });
  const vault = createTokenVault({
    store,
    keyring: opts.keyring ?? buildKeyring(SECRET_A),
    refreshers: { google: async (t) => { if (!opts.refresh) return refresh(t); return opts.refresh(t); } },
    now: () => clock,
  });
  return { vault, map, calls, advance: (ms: number) => (clock += ms), now: () => clock, store };
}

test('seal/open round trip with versioned format and fresh IV each time', () => {
  const kr = buildKeyring(SECRET_A);
  const a = sealSecret('refresh-token-123', ctx('uid1'), kr);
  const b = sealSecret('refresh-token-123', ctx('uid1'), kr);
  assert.notEqual(a, b);
  assert.match(a, /^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+$/);
  assert.equal(openSecret(a, ctx('uid1'), kr), 'refresh-token-123');
  assert.equal(sealedKeyId(a), kr.primaryId);
  assert.ok(!a.includes('refresh-token-123'));
});

test('ciphertext is bound to its owner and provider', () => {
  const kr = buildKeyring(SECRET_A);
  const sealed = sealSecret('secret-value', ctx('alice'), kr);
  assert.throws(() => openSecret(sealed, ctx('bob'), kr), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_DECRYPT_FAILED');
  assert.throws(() => openSecret(sealed, ctx('alice', 'meta'), kr), /could not be read/);
});

test('tampering, truncation, unknown key id and garbage are rejected', () => {
  const kr = buildKeyring(SECRET_A);
  const sealed = sealSecret('secret-value', ctx('alice'), kr);
  const [v, id, body] = sealed.split('.');
  const flipped = body.slice(0, -2) + (body.endsWith('AA') ? 'BB' : 'AA');
  for (const bad of [`${v}.${id}.${flipped}`, `${v}.${id}.${body.slice(0, 10)}`, `${v}.deadbeef.${body}`, 'not-a-token', '', 'v2.x.y']) {
    assert.throws(() => openSecret(bad, ctx('alice'), kr), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_DECRYPT_FAILED');
  }
  const otherKey = buildKeyring(SECRET_B);
  assert.throws(() => openSecret(sealed, ctx('alice'), otherKey), /could not be read/);
});

test('invalid user ids and weak keys are refused', () => {
  const kr = buildKeyring(SECRET_A);
  assert.throws(() => sealSecret('x', { uid: '../evil', provider: 'google', connectionId: '../evil_google' }, kr), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_INVALID_INPUT');
  assert.throws(() => sealSecret('x', { uid: 'a/b', provider: 'google', connectionId: 'a/b_google' }, kr), /Invalid connection context/);
  assert.throws(() => sealSecret('x', { uid: 'alice', provider: 'google', connectionId: 'bob_google' }, kr), /Invalid connection context/);
  assert.throws(() => sealSecret('', ctx('alice'), kr), /empty/);
  assert.throws(() => buildKeyring('short'), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_KEY_INVALID');
  assert.throws(() => buildKeyring(SECRET_A, ['short']), /previous encryption key/);
  assert.deepEqual(parsePreviousSecrets(' a , ,b ,'), ['a', 'b']);
  assert.deepEqual(parsePreviousSecrets(undefined), []);
});

test('key rotation: old ciphertext opens with the previous key and is re-sealed on refresh', async () => {
  const oldRing = buildKeyring(SECRET_B);
  const { store, map } = memoryStore();
  let clock = 5_000_000;
  const oldVault = createTokenVault({ store, keyring: oldRing, refreshers: {}, now: () => clock });
  await oldVault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: 'a@x.com', scopes: ['s'], refreshToken: 'RT-1', accessToken: 'AT-1', accessTokenExpiresAt: clock + 10_000 });
  assert.equal(map.get('alice_google')!.keyId, oldRing.primaryId);

  const newRing = buildKeyring(SECRET_A, [SECRET_B]);
  const newVault = createTokenVault({
    store,
    keyring: newRing,
    refreshers: { google: async () => ({ accessToken: 'AT-2', expiresAt: clock + 3_600_000 }) },
    now: () => clock,
  });
  assert.equal(await newVault.getAccessToken('alice', 'google'), 'AT-2'); // AT-1 within skew → refresh
  const rec = map.get('alice_google')!;
  assert.equal(rec.keyId, newRing.primaryId);
  assert.equal(sealedKeyId(rec.encryptedRefreshToken), newRing.primaryId);
  assert.equal(await newVault.getRefreshToken('alice', 'google'), 'RT-1');
});

test('stored records contain no plaintext tokens; summaries never include tokens', async () => {
  const { vault, map } = setup();
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: 'alice@x.com', scopes: ['analytics.readonly'], refreshToken: 'SUPER-REFRESH', accessToken: 'SUPER-ACCESS', accessTokenExpiresAt: 9_999_999 });
  const raw = JSON.stringify([...map.values()]);
  assert.ok(!raw.includes('SUPER-REFRESH') && !raw.includes('SUPER-ACCESS'));
  const s = await vault.getSummary('alice', 'google');
  assert.deepEqual(s && { connected: s.connected, label: s.accountLabel, re: s.needsReconnect }, { connected: true, label: 'alice@x.com', re: false });
  assert.ok(!JSON.stringify(s).includes('SUPER'));
  assert.equal(await vault.getSummary('bob', 'google'), null);
});

test('uses a cached access token while valid, refreshes within 60 s of expiry, persists the result', async () => {
  const { vault, calls, advance, now, map } = setup();
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: null, scopes: [], refreshToken: 'RT', accessToken: 'AT-cached', accessTokenExpiresAt: now() + 3_600_000 });
  assert.equal(await vault.getAccessToken('alice', 'google'), 'AT-cached');
  assert.equal(calls.length, 0);

  advance(3_600_000 - 30_000); // 30 s left → inside the skew
  assert.equal(await vault.getAccessToken('alice', 'google'), 'access-1');
  assert.deepEqual(calls, ['RT']);
  assert.equal(await vault.getAccessToken('alice', 'google'), 'access-1'); // now cached
  assert.equal(calls.length, 1);
  assert.equal(map.get('alice_google')!.accessTokenExpiresAt, now() + 3_600_000);
});

test('a rotated refresh token replaces the old one', async () => {
  const seen: string[] = [];
  const { vault } = setup({
    refresh: async (t) => {
      seen.push(t);
      return { accessToken: 'AT-new', expiresAt: 9_000_000_000, refreshToken: 'RT-rotated' };
    },
  });
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: null, scopes: [], refreshToken: 'RT-original' });
  await vault.getAccessToken('alice', 'google');
  assert.equal(await vault.getRefreshToken('alice', 'google'), 'RT-rotated');
  assert.deepEqual(seen, ['RT-original']);
});

test('concurrent requests trigger a single refresh', async () => {
  let refreshes = 0;
  const { vault } = setup({
    refresh: async () => {
      refreshes++;
      await new Promise((r) => setTimeout(r, 20));
      return { accessToken: 'AT-once', expiresAt: 9_000_000_000 };
    },
  });
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: null, scopes: [], refreshToken: 'RT' });
  const results = await Promise.all(Array.from({ length: 8 }, () => vault.getAccessToken('alice', 'google')));
  assert.deepEqual(new Set(results), new Set(['AT-once']));
  assert.equal(refreshes, 1);
});

test('permanent refresh failure marks the connection revoked and stops calling the provider', async () => {
  let calls = 0;
  const { vault, map } = setup({
    refresh: async () => {
      calls++;
      throw new RefreshRejectedError();
    },
  });
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: 'a@x.com', scopes: [], refreshToken: 'RT' });
  await assert.rejects(vault.getAccessToken('alice', 'google'), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_REAUTH_REQUIRED' && e.status === 401);
  assert.equal(map.get('alice_google')!.status, 'revoked');
  assert.equal(map.get('alice_google')!.encryptedAccessToken, null);
  await assert.rejects(vault.getAccessToken('alice', 'google'), /reconnect/i);
  assert.equal(calls, 1);
  const s = await vault.getSummary('alice', 'google');
  assert.deepEqual([s?.connected, s?.needsReconnect], [false, true]);
});

test('temporary refresh failure keeps the connection active', async () => {
  const { vault, map } = setup({ refresh: async () => { throw new Error('ECONNRESET'); } });
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: null, scopes: [], refreshToken: 'RT' });
  await assert.rejects(vault.getAccessToken('alice', 'google'), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_REFRESH_FAILED' && e.status === 502);
  assert.equal(map.get('alice_google')!.status, 'active');
});

test('isPermanentRefreshError recognises Google revocation errors only', () => {
  assert.ok(isPermanentRefreshError(new RefreshRejectedError()));
  assert.ok(isPermanentRefreshError(new Error('invalid_grant')));
  assert.ok(isPermanentRefreshError({ message: 'Request failed', response: { data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } }));
  assert.ok(!isPermanentRefreshError(new Error('connect ETIMEDOUT')));
  assert.ok(!isPermanentRefreshError({ response: { data: { error: 'invalid_client' } } }));
  assert.ok(!isPermanentRefreshError(null));
});

test('users can only reach their own connection, and copied documents do not decrypt', async () => {
  const { vault, map } = setup();
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: null, scopes: [], refreshToken: 'ALICE-RT' });
  await assert.rejects(vault.getAccessToken('bob', 'google'), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_NOT_CONNECTED');
  await assert.rejects(vault.getAccessToken('alice', 'meta'), /not connected/);

  // Someone copies Alice's record into Bob's document id and rewrites userId.
  const stolen = structuredClone(map.get('alice_google')!);
  map.set('bob_google', { ...stolen, userId: 'bob' });
  await assert.rejects(vault.getAccessToken('bob', 'google'), (e: unknown) => e instanceof VaultError && (e.code === 'VAULT_DECRYPT_FAILED'));
  await assert.rejects(vault.getRefreshToken('bob', 'google'), /could not be read/);
});

test('reconnecting keeps createdAt and reactivates a revoked connection; delete removes it', async () => {
  const { vault, map, advance } = setup({ refresh: async () => { throw new RefreshRejectedError(); } });
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: 'old', scopes: [], refreshToken: 'RT-old' });
  const created = map.get('alice_google')!.createdAt;
  await assert.rejects(vault.getAccessToken('alice', 'google'));
  assert.equal(map.get('alice_google')!.status, 'revoked');

  advance(1000);
  await vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: 'new', scopes: ['s'], refreshToken: 'RT-new' });
  const rec = map.get('alice_google')!;
  assert.deepEqual([rec.status, rec.accountLabel, rec.createdAt], ['active', 'new', created]);

  await vault.deleteConnection('alice', 'google');
  assert.equal(map.has('alice_google'), false);
  assert.equal(await vault.getSummary('alice', 'google'), null);
  await assert.rejects(vault.getRefreshToken('alice', 'google'), /not connected/);
});

test('saving without a refresh token is refused', async () => {
  const { vault } = setup();
  await assert.rejects(vault.saveConnection({ uid: 'alice', provider: 'google', accountLabel: null, scopes: [], refreshToken: '' }), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_INVALID_INPUT');
});

test('agent secrets: round trip, bound to the user AND the agent, strict ids', () => {
  const kr = buildKeyring(SECRET_A);
  const sealed = sealAgentSecret('sk-user-own-key', 'alice', 'agent_1', kr);
  assert.ok(!sealed.includes('sk-user-own-key'));
  assert.equal(openAgentSecret(sealed, 'alice', 'agent_1', kr), 'sk-user-own-key');
  assert.throws(() => openAgentSecret(sealed, 'bob', 'agent_1', kr), /could not be read/); // other user
  assert.throws(() => openAgentSecret(sealed, 'alice', 'agent_2', kr), /could not be read/); // other agent
  assert.throws(() => sealAgentSecret('x', 'alice', '../evil', kr), (e: unknown) => e instanceof VaultError && e.code === 'VAULT_INVALID_INPUT');
  assert.throws(() => sealAgentSecret('x', 'alice', '', kr), /Invalid connection context/);
  assert.throws(() => sealAgentSecret('x', 'alice', 'a'.repeat(65), kr), /Invalid connection context/);
  // a Google connection secret cannot be opened as an agent secret and vice versa
  const googleSealed = sealSecret('google-refresh', ctx('alice'), kr);
  assert.throws(() => openAgentSecret(googleSealed, 'alice', 'google', kr), /could not be read/);
  assert.throws(() => sealSecret('x', { uid: 'alice', provider: 'google', connectionId: 'alice_google_extra', scope: 'extra' }, kr), /Invalid connection context/);
  assert.throws(() => sealSecret('x', { uid: 'alice', provider: 'agent', connectionId: 'alice_agent' }, kr), /Invalid connection context/);
  assert.equal(connectionIdFor('alice', 'google'), 'alice_google');
  assert.equal(connectionIdFor('alice', 'agent', 'a1'), 'alice_agent_a1');
});
