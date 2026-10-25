import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './app.js';
import { setTestConnectionStore } from './lib/connectionStore.js';
import { setTestTokenVerifier, setTestUserDeleter } from './lib/firebaseAdmin.js';
import {
  createInMemoryFirestoreStore,
  setTestFirestoreStore,
  type FirestoreStoreAdapter,
} from './lib/firestore.js';
import { GOOGLE_OAUTH_SCOPES } from './lib/google.js';
import { OAUTH_STATE_COOKIE_NAME, SESSION_COOKIE_NAME } from './lib/session.js';
import {
  buildKeyring,
  createTokenVault,
  type ConnectionRecord,
  type VaultStore,
} from './lib/tokenVault.js';
import { resetVaultSingleton, setTestVault } from './lib/vault.js';

function createMemoryVaultStore(): VaultStore & { map: Map<string, ConnectionRecord> } {
  const map = new Map<string, ConnectionRecord>();
  return {
    map,
    async get(id: string) {
      const rec = map.get(id);
      return rec ? structuredClone(rec) : null;
    },
    async set(id: string, record: ConnectionRecord) {
      map.set(id, structuredClone(record));
    },
    async delete(id: string) {
      map.delete(id);
    },
  };
}

const VALID_AVATAR_ASSET = {
  dataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  mimeType: 'image/webp' as const,
  width: 128,
  height: 128,
};

test('AdLens 7C-3 — POST /api/me/delete: stale auth_time, step ordering, retry idempotency, ownership block, and isolation', async () => {
  process.env.TOKEN_ENCRYPTION_KEY = '7c3-delete-account-encryption-secret-32chars!';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.APP_BASE_URL = 'http://localhost:3000';

  const vaultStore = createMemoryVaultStore();
  setTestConnectionStore(vaultStore);
  resetVaultSingleton();

  const baseFirestore = createInMemoryFirestoreStore();
  const stepLog: string[] = [];
  let failOnDeleteUserOnce = false;

  const instrumentedFirestore: FirestoreStoreAdapter = {
    ...baseFirestore,
    async deleteWorkspaceRecursive(wsId: string) {
      stepLog.push(`firestore:deleteWorkspaceRecursive:${wsId}`);
      return baseFirestore.deleteWorkspaceRecursive(wsId);
    },
    async removeWorkspaceMember(wsId: string, uid: string) {
      stepLog.push(`firestore:removeWorkspaceMember:${wsId}:${uid}`);
      return baseFirestore.removeWorkspaceMember(wsId, uid);
    },
    async deleteUserRecursive(uid: string) {
      stepLog.push(`firestore:deleteUserRecursive:${uid}`);
      if (failOnDeleteUserOnce) {
        failOnDeleteUserOnce = false;
        throw new Error('Simulated transient Firestore failure during deleteUserRecursive');
      }
      return baseFirestore.deleteUserRecursive(uid);
    },
  };
  setTestFirestoreStore(instrumentedFirestore);

  const baseVault = createTokenVault({
    store: vaultStore,
    keyring: buildKeyring(process.env.TOKEN_ENCRYPTION_KEY),
    refreshers: {},
  });

  const instrumentedVault = {
    ...baseVault,
    async getRefreshToken(uid: string, provider: 'google' | 'meta') {
      stepLog.push(`vault:getRefreshToken:${uid}:${provider}`);
      return baseVault.getRefreshToken(uid, provider);
    },
    async deleteConnection(uid: string, provider: 'google' | 'meta') {
      stepLog.push(`vault:deleteConnection:${uid}:${provider}`);
      return baseVault.deleteConnection(uid, provider);
    },
  };
  setTestVault(instrumentedVault);

  const authUsers = new Set<string>(['uid_alice', 'uid_bob', 'uid_owner_team']);
  setTestUserDeleter(async (uid: string) => {
    stepLog.push(`auth:deleteUser:${uid}`);
    if (!authUsers.has(uid)) {
      const notFoundErr = new Error('There is no user record corresponding to the provided identifier. (auth/user-not-found)');
      (notFoundErr as { code?: string }).code = 'auth/user-not-found';
      throw notFoundErr;
    }
    authUsers.delete(uid);
  });

  const nowSec = Math.floor(Date.now() / 1000);
  setTestTokenVerifier(async (token: string) => {
    if (token === 'token-alice-stale') {
      return {
        uid: 'uid_alice',
        email: 'alice@acme.com',
        email_verified: true,
        auth_time: nowSec - 600, // 10 minutes old (> 5 minutes)
        firebase: { identities: { password: ['alice@acme.com'] }, sign_in_provider: 'password' },
      } as never;
    }
    if (token === 'token-alice-fresh') {
      return {
        uid: 'uid_alice',
        email: 'alice@acme.com',
        email_verified: true,
        auth_time: nowSec - 30, // 30 seconds old
        firebase: { identities: { password: ['alice@acme.com'] }, sign_in_provider: 'password' },
      } as never;
    }
    if (token === 'token-team-owner-fresh') {
      return {
        uid: 'uid_owner_team',
        email: 'owner@acme.com',
        email_verified: true,
        auth_time: nowSec - 15,
        firebase: { identities: { 'google.com': ['go'] }, sign_in_provider: 'google.com' },
      } as never;
    }
    if (token === 'token-bob-fresh') {
      return {
        uid: 'uid_bob',
        email: 'bob@acme.com',
        email_verified: true,
        auth_time: nowSec - 20,
        firebase: { identities: { 'google.com': ['gb'] }, sign_in_provider: 'google.com' },
      } as never;
    }
    throw new Error('Invalid token');
  });

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  const originalConsoleError = console.error;
  const capturedLogs: string[] = [];

  console.info = (...args: unknown[]) => {
    capturedLogs.push(JSON.stringify(args));
  };
  console.error = (...args: unknown[]) => {
    capturedLogs.push(JSON.stringify(args));
  };

  try {
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }
      if (urlStr === 'https://oauth2.googleapis.com/revoke') {
        const params = new URLSearchParams(String(init?.body ?? ''));
        stepLog.push(`google:revoke:${params.get('token') ?? ''}`);
        return new Response('', { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    };

    // Seed Alice, Bob, and Team Owner data
    await baseFirestore.bootstrapUserAndWorkspace({
      uid: 'uid_alice',
      email: 'alice@acme.com',
      displayName: 'Alice',
    });
    await baseFirestore.setUserAvatar('uid_alice', VALID_AVATAR_ASSET);
    await baseFirestore.setWorkspaceLogo('ws_uid_alice', VALID_AVATAR_ASSET);
    await baseFirestore.createProject('ws_uid_alice', {
      name: 'Alice Project',
      domain: 'alice.example.com',
      timezone: 'UTC',
      currency: 'USD',
      createdBy: 'uid_alice',
    });

    await baseFirestore.bootstrapUserAndWorkspace({
      uid: 'uid_bob',
      email: 'bob@acme.com',
      displayName: 'Bob',
    });
    await baseFirestore.setUserAvatar('uid_bob', VALID_AVATAR_ASSET);
    await baseFirestore.setWorkspaceLogo('ws_uid_bob', VALID_AVATAR_ASSET);
    await baseFirestore.createProject('ws_uid_bob', {
      name: 'Bob Project',
      domain: 'bob.example.com',
      timezone: 'UTC',
      currency: 'USD',
      createdBy: 'uid_bob',
    });
    // Add Alice as a non-owner member in Bob's workspace
    await baseFirestore.updateWorkspace('ws_uid_bob', {
      members: { uid_bob: 'owner', uid_alice: 'member' },
      memberIds: ['uid_bob', 'uid_alice'],
    });

    // Seed Team Owner workspace with another member (Bob)
    await baseFirestore.bootstrapUserAndWorkspace({
      uid: 'uid_owner_team',
      email: 'owner@acme.com',
      displayName: 'Team Owner',
    });
    await baseFirestore.updateWorkspace('ws_uid_owner_team', {
      members: { uid_owner_team: 'owner', uid_bob: 'admin' },
      memberIds: ['uid_owner_team', 'uid_bob'],
    });

    // Save vault connections for Alice and Bob
    await baseVault.saveConnection({
      uid: 'uid_alice',
      provider: 'google',
      accountLabel: 'alice@acme.com',
      scopes: GOOGLE_OAUTH_SCOPES,
      refreshToken: 'RT_SECRET_ALICE_GOOGLE',
      accessToken: 'AT_SECRET_ALICE_GOOGLE',
      accessTokenExpiresAt: Date.now() + 3600_000,
    });
    await baseVault.saveConnection({
      uid: 'uid_alice',
      provider: 'meta',
      accountLabel: 'alice-meta',
      scopes: ['ads_read'],
      refreshToken: 'RT_SECRET_ALICE_META',
    });
    await baseVault.saveConnection({
      uid: 'uid_bob',
      provider: 'google',
      accountLabel: 'bob@acme.com',
      scopes: GOOGLE_OAUTH_SCOPES,
      refreshToken: 'RT_SECRET_BOB_GOOGLE',
      accessToken: 'AT_SECRET_BOB_GOOGLE',
      accessTokenExpiresAt: Date.now() + 3600_000,
    });

    // 1. Missing/invalid confirm body -> 400
    const badBodyRes = await originalFetch(`${baseUrl}/api/me/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice-fresh',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: 'NOPE' }),
    });
    assert.equal(badBodyRes.status, 400);

    // 2. Stale auth_time (> 5 minutes) -> 401 REAUTH_REQUIRED, nothing touched
    stepLog.length = 0;
    const staleRes = await originalFetch(`${baseUrl}/api/me/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice-stale',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    assert.equal(staleRes.status, 401);
    const staleBody = (await staleRes.json()) as { error: { code: string; message: string } };
    assert.equal(staleBody.error.code, 'REAUTH_REQUIRED');
    assert.equal(staleBody.error.message, 'Please sign in again to delete your account');
    assert.equal(stepLog.length, 0);

    // 3. Owner with other members -> 409 TRANSFER_OWNERSHIP_REQUIRED, nothing after step 2b runs
    stepLog.length = 0;
    const teamOwnerRes = await originalFetch(`${baseUrl}/api/me/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-team-owner-fresh',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    assert.equal(teamOwnerRes.status, 409);
    const teamOwnerBody = (await teamOwnerRes.json()) as { error: { code: string } };
    assert.equal(teamOwnerBody.error.code, 'TRANSFER_OWNERSHIP_REQUIRED');
    // Team owner's workspace, user doc, and auth user still exist
    assert.ok(await baseFirestore.getWorkspace('ws_uid_owner_team'));
    assert.ok(await baseFirestore.getUser('uid_owner_team'));
    assert.equal(authUsers.has('uid_owner_team'), true);

    // 4. Partial failure on Alice's first delete attempt, followed by a second call that completes the job
    stepLog.length = 0;
    failOnDeleteUserOnce = true;

    const firstAttemptRes = await originalFetch(`${baseUrl}/api/me/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice-fresh',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    assert.equal(firstAttemptRes.status, 500);

    // Verify steps ran in order up to the simulated failure at deleteUserRecursive
    assert.deepEqual(stepLog, [
      'vault:getRefreshToken:uid_alice:google',
      'google:revoke:RT_SECRET_ALICE_GOOGLE',
      'vault:deleteConnection:uid_alice:google',
      'vault:deleteConnection:uid_alice:meta',
      'firestore:deleteWorkspaceRecursive:ws_uid_alice',
      'firestore:removeWorkspaceMember:ws_uid_bob:uid_alice',
      'firestore:deleteUserRecursive:uid_alice',
    ]);

    // Second call (retry) after partial failure completes cleanly
    stepLog.length = 0;
    const secondAttemptRes = await originalFetch(`${baseUrl}/api/me/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice-fresh',
        'Content-Type': 'application/json',
        Cookie: `${OAUTH_STATE_COOKIE_NAME}=dummy; ${SESSION_COOKIE_NAME}=dummy`,
      },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    assert.equal(secondAttemptRes.status, 200);
    const secondAttemptBody = (await secondAttemptRes.json()) as { ok: boolean };
    assert.equal(secondAttemptBody.ok, true);

    // Verify retry ran remaining steps in order and cleared cookies
    assert.deepEqual(stepLog, [
      'vault:getRefreshToken:uid_alice:google',
      'vault:deleteConnection:uid_alice:google',
      'vault:deleteConnection:uid_alice:meta',
      'firestore:deleteUserRecursive:uid_alice',
      'auth:deleteUser:uid_alice',
    ]);

    const setCookieHeader = secondAttemptRes.headers.get('set-cookie') ?? '';
    assert.ok(setCookieHeader.includes(`${OAUTH_STATE_COOKIE_NAME}=;`));
    assert.ok(setCookieHeader.includes(`${SESSION_COOKIE_NAME}=;`));

    // A third call when auth user is already deleted (auth/user-not-found) also succeeds idempotently
    const thirdAttemptRes = await originalFetch(`${baseUrl}/api/me/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-alice-fresh',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    assert.equal(thirdAttemptRes.status, 200);

    // 5. Verify Alice's data, workspaces, projects, avatars, logos, vault docs, and Auth user are gone
    assert.equal(await baseFirestore.getUser('uid_alice'), null);
    assert.equal(await baseFirestore.getUserAvatar('uid_alice'), null);
    assert.equal(await baseFirestore.getWorkspace('ws_uid_alice'), null);
    assert.equal(await baseFirestore.getWorkspaceLogo('ws_uid_alice'), null);
    assert.deepEqual(await baseFirestore.listProjects('ws_uid_alice'), []);
    assert.equal(vaultStore.map.has('uid_alice_google'), false);
    assert.equal(vaultStore.map.has('uid_alice_meta'), false);
    assert.equal(authUsers.has('uid_alice'), false);

    // 6. Verify Bob's data is completely untouched (and Alice was removed from Bob's workspace members)
    const bobUser = await baseFirestore.getUser('uid_bob');
    assert.ok(bobUser);
    assert.equal(bobUser.email, 'bob@acme.com');
    assert.ok(await baseFirestore.getUserAvatar('uid_bob'));
    const bobWs = await baseFirestore.getWorkspace('ws_uid_bob');
    assert.ok(bobWs);
    assert.deepEqual(bobWs.members, { uid_bob: 'owner' });
    assert.deepEqual(bobWs.memberIds, ['uid_bob']);
    assert.ok(await baseFirestore.getWorkspaceLogo('ws_uid_bob'));
    const bobProjects = await baseFirestore.listProjects('ws_uid_bob');
    assert.equal(bobProjects.length, 1);
    assert.equal(bobProjects[0]?.name, 'Bob Project');
    assert.equal(vaultStore.map.has('uid_bob_google'), true);
    assert.equal(authUsers.has('uid_bob'), true);

    // 7. Verify logs never contain tokens or emails
    const allLogs = capturedLogs.join('\n');
    assert.ok(allLogs.includes('uid_alice'));
    assert.ok(!allLogs.includes('alice@acme.com'));
    assert.ok(!allLogs.includes('RT_SECRET_ALICE_GOOGLE'));
    assert.ok(!allLogs.includes('AT_SECRET_ALICE_GOOGLE'));
    assert.ok(!allLogs.includes('RT_SECRET_ALICE_META'));
  } finally {
    console.info = originalConsoleInfo;
    console.error = originalConsoleError;
    globalThis.fetch = originalFetch;
    setTestVault(null);
    setTestConnectionStore(null);
    setTestFirestoreStore(null);
    setTestTokenVerifier(null);
    setTestUserDeleter(null);
    resetVaultSingleton();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.APP_BASE_URL;
    server.close();
  }
});
