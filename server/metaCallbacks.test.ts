import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryVaultStore, setTestConnectionStore } from './lib/connectionStore.js';
import { createInMemoryMetaDeletionStore, parseSignedRequest, setTestMetaDeletionStore, signRequestForTest } from './lib/metaDeletion.js';
import { getVault, resetVaultSingleton } from './lib/vault.js';

const SECRET = 'meta-app-secret-for-tests';

test('signed requests: valid ones verify; tampered, wrong-secret and malformed ones do not', () => {
  const good = signRequestForTest({ user_id: '1234567890' }, SECRET);
  assert.equal(parseSignedRequest(good, SECRET)?.user_id, '1234567890');
  assert.equal(parseSignedRequest(good, 'other-secret'), null);
  const [sig, body] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '999' })).toString('base64url');
  assert.equal(parseSignedRequest(`${sig}.${forged}`, SECRET), null, 'payload changed after signing');
  assert.equal(parseSignedRequest(`${sig}`, SECRET), null);
  assert.equal(parseSignedRequest(`.${body}`, SECRET), null);
  assert.equal(parseSignedRequest(undefined, SECRET), null);
  assert.equal(parseSignedRequest(good, ''), null, 'no secret configured means nothing verifies');
  const wrongAlg = signRequestForTest({ user_id: '1', algorithm: 'none' }, SECRET);
  assert.equal(parseSignedRequest(wrongAlg, SECRET), null);
  const badId = signRequestForTest({ user_id: 'abc; drop' }, SECRET);
  assert.equal(parseSignedRequest(badId, SECRET), null);
  const old = signRequestForTest({ user_id: '1', issued_at: 1000 }, SECRET);
  assert.equal(parseSignedRequest(old, SECRET), null, 'very old requests are replays');
});

test('Sprint 10 — Meta data-deletion callback removes the linked connection and gives a status page code', async () => {
  process.env.META_APP_SECRET = SECRET;
  process.env.GOOGLE_CLIENT_ID = 'x';
  process.env.GOOGLE_CLIENT_SECRET = 'y';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-10-32chars!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  setTestConnectionStore(createInMemoryVaultStore());
  resetVaultSingleton();
  const store = createInMemoryMetaDeletionStore();
  setTestMetaDeletionStore(store);
  await getVault().saveConnection({ uid: 'uid_a', provider: 'meta', accountLabel: null, scopes: ['ads_read'], refreshToken: 'rt', accessToken: 'at', accessTokenExpiresAt: Date.now() + 3_600_000 });
  await getVault().saveConnection({ uid: 'uid_b', provider: 'meta', accountLabel: null, scopes: ['ads_read'], refreshToken: 'rt', accessToken: 'bt', accessTokenExpiresAt: Date.now() + 3_600_000 });
  await store.link('111', 'uid_a');
  await store.link('222', 'uid_b');

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, signed: string | undefined) =>
    fetch(`${base}/api/platform${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: signed === undefined ? '' : `signed_request=${encodeURIComponent(signed)}` });
  try {
    assert.equal((await post('/meta/data-deletion', undefined)).status, 400);
    assert.equal((await post('/meta/data-deletion', signRequestForTest({ user_id: '111' }, 'wrong'))).status, 400);
    assert.equal((await getVault().getSummary('uid_a', 'meta'))?.connected, true, 'a bad request deletes nothing');

    const ok = await post('/meta/data-deletion', signRequestForTest({ user_id: '111' }, SECRET));
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { url: string; confirmation_code: string };
    assert.match(body.confirmation_code, /^[a-f0-9]{24}$/);
    assert.equal(body.url, `http://localhost:3000/data-deletion?code=${body.confirmation_code}`);
    assert.equal((await getVault().getSummary('uid_a', 'meta'))?.connected ?? false, false, 'the linked person is disconnected');
    assert.equal((await getVault().getSummary('uid_b', 'meta'))?.connected, true, 'other people are untouched');
    assert.equal(await store.findUid('111'), null);

    const status = await fetch(`${base}/api/platform/data-deletion/status?code=${body.confirmation_code}`);
    assert.equal(status.status, 200);
    assert.equal(((await status.json()) as { status: string }).status, 'completed');

    const unknown = await post('/meta/deauthorize', signRequestForTest({ user_id: '999' }, SECRET));
    assert.equal(unknown.status, 200, 'Meta must always get an answer');
    const unknownBody = (await unknown.json()) as { confirmation_code: string };
    const st2 = await fetch(`${base}/api/platform/data-deletion/status?code=${unknownBody.confirmation_code}`);
    assert.equal(((await st2.json()) as { status: string }).status, 'nothing_stored');

    assert.equal((await fetch(`${base}/api/platform/data-deletion/status?code=nope`)).status, 400);
    assert.equal((await fetch(`${base}/api/platform/data-deletion/status?code=${'a'.repeat(24)}`)).status, 404);
  } finally {
    server.close();
    setTestMetaDeletionStore(null);
    delete process.env.META_APP_SECRET;
  }
});
