import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryAdminSettingsStore, setTestAdminSettingsStore } from './lib/adminSettings.js';
import { createInMemoryAuditStore, setTestAuditStore } from './lib/auditLog.js';
import { createInMemoryBillingStore, setTestBillingStore } from './lib/billingStore.js';
import { setTestTokenVerifier, setTestTwoStepClaimSetter, setTestSessionRevoker } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryInviteStore, setTestInviteStore } from './lib/inviteStore.js';
import { base32Decode, base32Encode, generateBackupCodes, hashBackupCode, looksLikeBackupCode, totpAt, verifyTotp } from './lib/totp.js';
import { createInMemoryTwoStepStore, makeProof, proofIsValid, setTestTwoStepStore, twoStepStore } from './lib/twoStep.js';

test('Sprint 22 — authenticator codes match the RFC 6238 test values', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totpAt(secret, 59_000), '287082');
  assert.equal(totpAt(secret, 1111111109_000), '081804');
  assert.equal(totpAt(secret, 1234567890_000), '005924');
  assert.equal(totpAt(secret, 2000000000_000), '279037');
  assert.deepEqual(base32Decode(secret), Buffer.from('12345678901234567890'));
});

test('Sprint 22 — verifyTotp: drift window, replay, wrong and malformed codes', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const now = 1234567890_000;
  const code = totpAt(secret, now);
  const step = Math.floor(now / 30000);
  assert.equal(verifyTotp(secret, code, now), step);
  assert.equal(verifyTotp(secret, code, now + 30_000), step, 'one step of clock drift is accepted');
  assert.equal(verifyTotp(secret, code, now + 90_000), null, 'three steps away is refused');
  assert.equal(verifyTotp(secret, code, now, step), null, 'the same code cannot be used twice');
  assert.equal(verifyTotp(secret, '000000', now), null);
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5']) assert.equal(verifyTotp(secret, bad, now), null);
  assert.equal(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now), step, 'spaces typed by the person are ignored');
});

test('Sprint 22 — backup codes: shape, hashing, and telling them from 6-digit codes', () => {
  const codes = generateBackupCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) { assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/); assert.ok(looksLikeBackupCode(c)); }
  assert.equal(hashBackupCode(codes[0]), hashBackupCode(codes[0].toUpperCase().replace('-', ' ')), 'case and the dash do not matter');
  assert.notEqual(hashBackupCode(codes[0]), hashBackupCode(codes[1]));
  assert.ok(!looksLikeBackupCode('123456'));
});

test('Sprint 22 — the proof is tied to the person and to the sign-in, and expires', () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-22-32chars!!';
  const proof = makeProof('u1', 1000, 0);
  assert.equal(proofIsValid(proof, 'u1', 1000, 5_000), true);
  assert.equal(proofIsValid(proof, 'u2', 1000, 5_000), false, 'another person');
  assert.equal(proofIsValid(proof, 'u1', 1001, 5_000), false, 'a different sign-in');
  assert.equal(proofIsValid(proof, 'u1', 1000, 31 * 86400_000), false, 'expired');
  assert.equal(proofIsValid(`${proof.slice(0, -2)}xx`, 'u1', 1000, 5_000), false, 'tampered');
  assert.equal(proofIsValid(undefined, 'u1', 1000), false);
  assert.equal(proofIsValid('nonsense', 'u1', 1000), false);
});

test('Sprint 22 — two-step sign-in end to end, and the admin panel needs Google', async () => {
  process.env.OPERATOR_EMAILS = 'owner@op.com';
  process.env.GOOGLE_CLIENT_ID = 'x'; process.env.GOOGLE_CLIENT_SECRET = 'y';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-22-32chars!!';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestBillingStore(createInMemoryBillingStore());
  setTestInviteStore(createInMemoryInviteStore());
  const audit = createInMemoryAuditStore();
  setTestAuditStore(audit);
  setTestAdminSettingsStore(createInMemoryAdminSettingsStore());
  setTestTwoStepStore(createInMemoryTwoStepStore());
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_ann', email: 'ann@acme.com', displayName: 'Ann' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_op', email: 'owner@op.com', displayName: 'Op' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });

  // The sign-in token carries the twoStep flag once it is on (the real flag comes from Firebase; here a set stands in for it).
  const flagged = new Set<string>();
  setTestTwoStepClaimSetter(async (uid, on) => { if (on) flagged.add(uid); else flagged.delete(uid); });
  const revoked: string[] = [];
  setTestSessionRevoker(async (uid) => { revoked.push(uid); });
  const who: Record<string, { uid: string; email: string; provider: string; authTime: number }> = {
    ann: { uid: 'uid_ann', email: 'ann@acme.com', provider: 'password', authTime: 1_700_000_000 },
    annNew: { uid: 'uid_ann', email: 'ann@acme.com', provider: 'password', authTime: 1_700_005_000 },
    bob: { uid: 'uid_bob', email: 'bob@acme.com', provider: 'password', authTime: 1_700_000_000 },
    opPassword: { uid: 'uid_op', email: 'owner@op.com', provider: 'password', authTime: Math.floor(Date.now() / 1000) - 5 },
    opGoogle: { uid: 'uid_op', email: 'owner@op.com', provider: 'google.com', authTime: Math.floor(Date.now() / 1000) - 5 },
  };
  setTestTokenVerifier(async (token: string) => {
    const p = who[token.replace('token-', '')];
    if (!p) throw new Error('bad token');
    return {
      uid: p.uid, email: p.email, name: p.email, email_verified: true, iat: Math.floor(Date.now() / 1000), auth_time: p.authTime,
      ...(flagged.has(p.uid) ? { twoStep: true } : {}),
      firebase: { identities: { [p.provider]: ['x'] }, sign_in_provider: p.provider },
    } as never;
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = (path: string, user: string, body?: unknown, extra: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method: body !== undefined ? 'POST' : 'GET', body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer token-${user}`, 'Content-Type': 'application/json', ...extra },
  });
  const j = async (r: Response) => (await r.json()) as any;

  try {
    // Off by default: normal use, nothing asked.
    const s0 = await j(await api('/api/2fa/status', 'ann'));
    assert.deepEqual([s0.enabled, s0.proven], [false, true]);
    assert.notEqual((await api('/api/me', 'ann')).status, 403);

    // Set up: a secret and a QR address, not active yet.
    const start = await j(await api('/api/2fa/setup/start', 'ann', {}));
    assert.match(start.secret, /^[A-Z2-7]{32}$/);
    assert.match(start.otpauthUri, /^otpauth:\/\/totp\/AdLens:ann%40acme\.com\?secret=/);
    assert.equal((await j(await api('/api/2fa/status', 'ann'))).enabled, false);
    const stored = await twoStepStore().get('uid_ann');
    assert.ok(stored?.pendingEnc && !stored.pendingEnc.includes(start.secret), 'the secret is stored encrypted');

    // A wrong code does not turn it on.
    const wrong = await api('/api/2fa/setup/confirm', 'ann', { code: '000000' });
    assert.equal(wrong.status, 400);
    assert.equal((await j(wrong)).error.code, 'WRONG_CODE');
    assert.equal(flagged.has('uid_ann'), false);

    // The right code turns it on and shows ten backup codes once.
    const done = await j(await api('/api/2fa/setup/confirm', 'ann', { code: totpAt(start.secret, Date.now()) }));
    assert.equal(done.backupCodes.length, 10);
    assert.ok(done.proof);
    assert.equal(flagged.has('uid_ann'), true);
    assert.equal((await twoStepStore().get('uid_ann'))!.backupHashes.length, 10);
    assert.ok(!JSON.stringify(await twoStepStore().get('uid_ann')).includes(done.backupCodes[0]), 'backup codes are stored only as hashes');
    assert.equal((await api('/api/2fa/setup/start', 'ann', {})).status, 403, 'without the proof, nobody can touch the settings');
    assert.equal((await api('/api/2fa/setup/start', 'ann', {}, { 'x-adlens-2fa': done.proof })).status, 409, 'cannot start again while on');

    // From now on the app needs the proof.
    const blocked = await api('/api/me', 'ann');
    assert.equal(blocked.status, 403);
    assert.equal((await j(blocked)).error.code, 'TWO_STEP_REQUIRED');
    assert.notEqual((await api('/api/me', 'ann', undefined, { 'x-adlens-2fa': done.proof })).status, 403, 'the proof lets it through');
    assert.equal((await api('/api/me', 'annNew', undefined, { 'x-adlens-2fa': done.proof })).status, 403, 'a NEW sign-in needs its own code');
    assert.notEqual((await api('/api/me', 'bob', undefined, { 'x-adlens-2fa': done.proof })).status, 403, 'a person without two-step is never asked');

    // A new sign-in gives its code: status first, then verify.
    const st = await j(await api('/api/2fa/status', 'annNew'));
    assert.deepEqual([st.enabled, st.proven, st.backupCodesLeft], [true, false, 10]);
    assert.equal((await api('/api/2fa/verify', 'annNew', { code: '123456' })).status, 400);
    // The code used a moment ago for set-up cannot be used again (replay), so use a backup code for this sign-in.
    const v1 = await j(await api('/api/2fa/verify', 'annNew', { code: done.backupCodes[0] }));
    assert.equal(v1.usedBackupCode, true);
    assert.equal(v1.backupCodesLeft, 9);
    assert.notEqual((await api('/api/me', 'annNew', undefined, { 'x-adlens-2fa': v1.proof })).status, 403);
    assert.equal((await j(await api('/api/2fa/status', 'annNew', undefined, { 'x-adlens-2fa': v1.proof }))).proven, true);
    const again = await api('/api/2fa/verify', 'annNew', { code: done.backupCodes[0] });
    assert.equal(again.status, 400, 'a backup code works only once');

    // A fresh authenticator code (next time step) works, and cannot be replayed.
    const later = Date.now() + 30_000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      const code = totpAt(start.secret, later);
      assert.equal((await api('/api/2fa/verify', 'annNew', { code })).status, 200);
      assert.equal((await api('/api/2fa/verify', 'annNew', { code })).status, 400, 'same code twice is refused');
    } finally { Date.now = realNow; }

    // New backup codes replace the old ones; turning it off needs a code.
    const regen = await j(await api('/api/2fa/backup-codes', 'ann', { code: done.backupCodes[1] }, { 'x-adlens-2fa': done.proof }));
    assert.equal(regen.backupCodes.length, 10);
    assert.equal((await api('/api/2fa/verify', 'annNew', { code: done.backupCodes[2] })).status, 400, 'old backup codes stop working');
    assert.equal((await api('/api/2fa/disable', 'ann', { code: 'nope-nope1' }, { 'x-adlens-2fa': done.proof })).status, 400);
    assert.equal(flagged.has('uid_ann'), true);
    assert.equal((await api('/api/2fa/disable', 'ann', { code: regen.backupCodes[0] }, { 'x-adlens-2fa': done.proof })).status, 204);
    assert.equal(flagged.has('uid_ann'), false);
    assert.equal(await twoStepStore().get('uid_ann'), null);
    assert.notEqual((await api('/api/me', 'ann')).status, 403);
    assert.deepEqual(audit.all().filter((e) => e.action.startsWith('twostep.')).map((e) => e.action), ['twostep.enabled', 'twostep.backup_regenerated', 'twostep.disabled']);
    assert.ok(!JSON.stringify(audit.all()).includes(start.secret), 'the audit log never holds the secret');

    // Too many wrong tries are stopped.
    await api('/api/2fa/setup/start', 'bob', {});
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await api('/api/2fa/setup/confirm', 'bob', { code: '000000' })).status;
    assert.equal(last, 429);

    // Staff can switch someone's two-step off (lost phone). Only with Google sign-in and the right staff role.
    flagged.add('uid_bob');
    await twoStepStore().put({ uid: 'uid_bob', secretEnc: 'x', enabled: true, enabledAt: null, lastStep: -1, backupHashes: [] });
    assert.equal((await api('/api/billing/admin/users/uid_bob/two-step/reset', 'ann', {})).status, 403);
    assert.equal((await api('/api/billing/admin/users/uid_bob/two-step/reset', 'opPassword', {})).status, 403, 'a password sign-in cannot use the admin panel');
    assert.equal((await api('/api/billing/admin/users/uid_bob/two-step/reset', 'opGoogle', {})).status, 204);
    assert.equal(flagged.has('uid_bob'), false);
    assert.equal(await twoStepStore().get('uid_bob'), null);
    assert.deepEqual(revoked, ['uid_bob'], 'their other devices are signed out');

    // Admin panel: Google only.
    const pw = await api('/api/admin/settings', 'opPassword');
    assert.equal(pw.status, 403);
    assert.equal((await j(pw)).error.code, 'ADMIN_GOOGLE_ONLY');
    assert.equal((await api('/api/admin/settings', 'opGoogle')).status, 200);
    const sessPw = await j(await api('/api/admin/session', 'opPassword'));
    assert.deepEqual([sessPw.operator, sessPw.viaGoogle, sessPw.secondsLeft], [true, false, 0]);
    const sessG = await j(await api('/api/admin/session', 'opGoogle'));
    assert.deepEqual([sessG.viaGoogle, sessG.secondsLeft > 3000], [true, true]);
  } finally {
    server.close();
    setTestTwoStepClaimSetter(null);
    setTestSessionRevoker(null);
    setTestTwoStepStore(null);
  }
});

test('Security audit — a sign-in token made before two-step was turned on is still stopped (server-side note closes the stale-token window)', async () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-22-32chars!!';
  const { createMemoryStore, setTestSharedStore } = await import('./lib/sharedStore.js');
  const shared = createMemoryStore();
  setTestSharedStore(shared);
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestTwoStepStore(createInMemoryTwoStepStore());
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_stale', email: 'stale@acme.com', displayName: 'S' });
  setTestTokenVerifier(async () => ({ uid: 'uid_stale', email: 'stale@acme.com', name: 's', email_verified: true, iat: Math.floor(Date.now() / 1000), auth_time: 1_700_000_000, firebase: { identities: { password: ['x'] }, sign_in_provider: 'password' } }) as never);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const me = (extra: Record<string, string> = {}) => fetch(`${base}/api/me`, { headers: { Authorization: 'Bearer t', ...extra } });
  try {
    assert.notEqual((await me()).status, 403, 'two-step off: no second step asked');
    await shared.set('2fa:on:uid_stale', '1', 60_000);
    const blocked = await me();
    assert.equal(blocked.status, 403);
    assert.equal(((await blocked.json()) as { error: { code: string } }).error.code, 'TWO_STEP_REQUIRED');
    const { makeProof } = await import('./lib/twoStep.js');
    assert.notEqual((await me({ 'X-AdLens-2FA': makeProof('uid_stale', 1_700_000_000) })).status, 403, 'with the proof it works');
    await shared.del('2fa:on:uid_stale');
    assert.notEqual((await me()).status, 403, 'turned off again');
  } finally { setTestSharedStore(null); server.close(); }
});
