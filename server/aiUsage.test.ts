import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import {
  createInMemoryFirestoreStore,
  getUtcMonthPeriod,
  setTestFirestoreStore,
} from './lib/firestore.js';
import { clearAiRateLimit } from './routes/ai.js';

test('Sprint 15a-3a — GET /api/ai/usage returns used 0 for a new workspace, 1 after consumeAiQuota, 401 when signed out, and never leaks keys', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-15a3a-32c!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY_2;
  delete process.env.GEMINI_MODEL;

  const store = createInMemoryFirestoreStore();
  setTestFirestoreStore(store);
  clearAiRateLimit();

  const { workspace } = await store.bootstrapUserAndWorkspace({
    uid: 'uid_usage_user',
    email: 'usage@acme.com',
    displayName: 'Usage User',
  });
  const wsId = workspace.id;
  const project = await store.createProject(wsId, {
    name: 'Usage Project',
    domain: 'usage.example',
    timezone: 'UTC',
    currency: 'USD',
    createdBy: 'uid_usage_user',
  });

  setTestTokenVerifier(async (token: string) => {
    if (token === 'valid-usage-token') {
      return {
        uid: 'uid_usage_user',
        email: 'usage@acme.com',
        email_verified: true,
        firebase: { identities: { 'google.com': ['g-usage'] }, sign_in_provider: 'google.com' },
      } as never;
    }
    throw new Error('Invalid token');
  });

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const period = getUtcMonthPeriod();
  const SECRET_KEY_1 = 'AIzaUsageSecretPrimary111';
  const SECRET_KEY_2 = 'AIzaUsageSecretFallback222';

  try {
    // 1. Signed-out request gets 401
    const resUnauth = await fetch(`${baseUrl}/api/ai/usage`);
    assert.equal(resUnauth.status, 401);

    // 2. New workspace returns used: 0, limit: 100, period, aiConfigured: false
    const resNew = await fetch(`${baseUrl}/api/ai/usage`, {
      headers: {
        Authorization: 'Bearer valid-usage-token',
        'X-AdLens-Project': `${wsId}/${project.id}`,
      },
    });
    assert.equal(resNew.status, 200);
    const bodyNew = (await resNew.json()) as {
      used: number;
      limit: number;
      period: string;
      aiConfigured: boolean;
    };
    assert.deepEqual(bodyNew, {
      used: 0,
      limit: 100,
      period,
      aiConfigured: false,
    });

    // 3. After one consumeAiQuota and configuring Gemini keys -> used: 1, aiConfigured: true, no keys leaked
    process.env.GEMINI_API_KEY = SECRET_KEY_1;
    process.env.GEMINI_API_KEY_2 = SECRET_KEY_2;
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    await store.consumeAiQuota(wsId, period);

    const resAfterRaw = await (
      await fetch(`${baseUrl}/api/ai/usage`, {
        headers: {
          Authorization: 'Bearer valid-usage-token',
        },
      })
    ).text();
    const bodyAfter = JSON.parse(resAfterRaw) as {
      used: number;
      limit: number;
      period: string;
      aiConfigured: boolean;
    };
    assert.deepEqual(bodyAfter, {
      used: 1,
      limit: 100,
      period,
      aiConfigured: true,
    });
    assert.ok(!resAfterRaw.includes(SECRET_KEY_1));
    assert.ok(!resAfterRaw.includes(SECRET_KEY_2));
    assert.ok(!resAfterRaw.includes('gemini-2.5-flash'));
  } finally {
    setTestFirestoreStore(null);
    setTestTokenVerifier(null);
    clearAiRateLimit();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.APP_BASE_URL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY_2;
    delete process.env.GEMINI_MODEL;
    server.close();
  }
});
