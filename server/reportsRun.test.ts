import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { app } from './app.js';
import { createInMemoryVaultStore, setTestConnectionStore } from './lib/connectionStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { getVault, resetVaultSingleton } from './lib/vault.js';
import { reportRegistry } from './reports/registry.js';

test('Sprint 15b — POST /api/reports/run returns raw report numbers for the on-device analyst', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-15b-32chars!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestConnectionStore(createInMemoryVaultStore());
  resetVaultSingleton();
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const project = await fs.createProject(workspace.id, { name: 'P', domain: 'a.com', ga4PropertyId: '1001', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async () => ({ uid: 'uid_alice', email: 'alice@acme.com', name: 'a', email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  await getVault().saveConnection({ uid: 'uid_alice', provider: 'google', accountLabel: 'alice@acme.com', scopes: ['x'], refreshToken: 'rt', accessToken: 'tok', accessTokenExpiresAt: Date.now() + 3_600_000 });

  const seen: unknown[] = [];
  reportRegistry.register({
    id: 'test.runMock',
    title: 'Run mock',
    description: 'mock',
    source: 'ga4',
    input: z.object({ startDate: z.string(), endDate: z.string(), limit: z.number().int().max(10).optional() }),
    async run(ctx, input) { seen.push({ input, property: ctx.ga4PropertyId }); return { sessions: 123 }; },
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: unknown, auth = true) =>
    fetch(`${baseUrl}/api/reports/run`, { method: 'POST', body: JSON.stringify(body), headers: { ...(auth ? { Authorization: 'Bearer t' } : {}), 'Content-Type': 'application/json', 'X-AdLens-Project': `${project.workspaceId}/${project.id}` } });
  try {
    assert.equal((await post({}, false)).status, 401);
    const ok = await post({ id: 'test.runMock', args: { limit: 5, startDate: '1999-01-01' }, startDate: '2026-10-01', endDate: '2026-10-07' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { id: 'test.runMock', result: { sessions: 123 } });
    assert.deepEqual(seen[0], { input: { limit: 5, startDate: '2026-10-01', endDate: '2026-10-07' }, property: '1001' }, 'the dates come from the screen, not from the arguments');
    assert.equal((await post({ id: 'nope', startDate: '2026-10-01', endDate: '2026-10-07' })).status, 404);
    assert.equal((await post({ id: 'test.runMock', args: { limit: 99 }, startDate: '2026-10-01', endDate: '2026-10-07' })).status, 400);
    assert.equal((await post({ id: 'test.runMock', startDate: 'yesterday', endDate: '2026-10-07' })).status, 400);
  } finally {
    server.close();
    reportRegistry.unregister('test.runMock');
  }
});
