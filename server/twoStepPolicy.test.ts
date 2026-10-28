import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryAuditStore, setTestAuditStore } from './lib/auditLog.js';
import { createInMemoryBillingStore, setTestBillingStore } from './lib/billingStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryInviteStore, setTestInviteStore } from './lib/inviteStore.js';
import { createInMemoryTwoStepStore, setTestTwoStepStore } from './lib/twoStep.js';
import { createMemoryStore, setTestSharedStore } from './lib/sharedStore.js';
import { resetProtectionState } from './middleware/protect.js';

test('Sprint 25 — "require two-step for owners and admins": switch on, enforcement, lock-out protection, switch off', async () => {
  resetProtectionState();
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-25-32chars!!';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestBillingStore(createInMemoryBillingStore());
  setTestInviteStore(createInMemoryInviteStore());
  const audit = createInMemoryAuditStore();
  setTestAuditStore(audit);
  setTestSharedStore(createMemoryStore());
  const twoStep = createInMemoryTwoStepStore();
  setTestTwoStepStore(twoStep);
  const turnOn = (uid: string) => twoStep.put({ uid, secretEnc: 'x', enabled: true, enabledAt: new Date().toISOString(), lastStep: -1, backupHashes: [] });

  const { workspace: ws } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_boss', email: 'boss@acme.com', displayName: 'Boss' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_adm', email: 'adm@acme.com', displayName: 'Adm' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_mem', email: 'mem@acme.com', displayName: 'Mem' });
  await fs.setWorkspacePlan(ws.id, 'pro', '2099-01-01T00:00:00.000Z');
  const project = await fs.createProject(ws.id, { name: 'Site', domain: 'site.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_boss' });
  await fs.updateWorkspace(ws.id, { members: { uid_boss: 'owner', uid_adm: 'admin', uid_mem: 'member' }, memberIds: ['uid_boss', 'uid_adm', 'uid_mem'] });

  setTestTokenVerifier(async (token: string) => {
    const uid = `uid_${token}`;
    return { uid, email: `${token}@acme.com`, name: token, auth_time: Math.floor(Date.now() / 1000), iat: Math.floor(Date.now() / 1000), email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, who: string, init: { method?: string; body?: unknown; project?: boolean } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      headers: { Authorization: `Bearer ${who}`, 'Content-Type': 'application/json', ...(init.project ? { 'X-AdLens-Project': `${ws.id}/${project.id}` } : {}) },
    });
  const code = async (r: Response) => ((await r.json()) as { error?: { code: string } }).error?.code;
  const WS = `/api/workspaces/${ws.id}`;

  try {
    // Switching it on needs your own two-step first, so nobody locks themselves out.
    const early = await call(WS, 'boss', { method: 'PATCH', body: { requireTwoStep: true } });
    assert.equal(early.status, 409);
    assert.equal(await code(early), 'TWO_STEP_SETUP_FIRST');
    await turnOn('uid_boss');
    assert.equal((await call(WS, 'adm', { method: 'PATCH', body: { requireTwoStep: true } })).status, 409, 'an admin also needs their own two-step first');
    const on = await call(WS, 'boss', { method: 'PATCH', body: { requireTwoStep: true } });
    assert.equal(on.status, 200);
    assert.equal(((await on.json()) as { workspace: { requireTwoStep: boolean } }).workspace.requireTwoStep, true);

    // The people list shows the rule to everyone.
    const me = (await (await call('/api/me', 'mem')).json()) as { workspaces: { requireTwoStep: boolean }[] };
    assert.equal(me.workspaces[0].requireTwoStep, true);

    // An admin without two-step: can look, cannot use data or change anything.
    assert.equal(await code(await call('/api/dashboards', 'adm', { project: true })), 'TWO_STEP_SETUP_REQUIRED');
    assert.equal((await call(`/api/team/${ws.id}`, 'adm')).status, 200, 'the team list can still be read');
    const blockedAdd = await call(`/api/team/${ws.id}/members`, 'adm', { body: { email: 'mem@acme.com' } });
    assert.equal(blockedAdd.status, 403);
    assert.equal(await code(blockedAdd), 'TWO_STEP_SETUP_REQUIRED');
    assert.equal(await code(await call(`${WS}/projects`, 'adm', { body: { name: 'x', domain: 'x.com' } })), 'TWO_STEP_SETUP_REQUIRED');

    // Members are not asked, and the owner (who has two-step) is not blocked.
    assert.notEqual(await code(await call('/api/dashboards', 'mem', { project: true })), 'TWO_STEP_SETUP_REQUIRED');
    assert.notEqual(await code(await call('/api/dashboards', 'boss', { project: true })), 'TWO_STEP_SETUP_REQUIRED');

    // Once the admin sets up two-step, access returns, and they cannot switch it off while the rule is on.
    await turnOn('uid_adm');
    assert.notEqual(await code(await call('/api/dashboards', 'adm', { project: true })), 'TWO_STEP_SETUP_REQUIRED');
    const noOff = await call('/api/2fa/disable', 'adm', { body: { code: '000000' } });
    assert.equal(noOff.status, 409);
    assert.equal(await code(noOff), 'REQUIRED_BY_WORKSPACE');
    assert.equal((await twoStep.get('uid_adm'))?.enabled, true);

    // Switching the rule off lifts everything.
    await twoStep.delete('uid_adm');
    assert.equal(await code(await call('/api/dashboards', 'adm', { project: true })), 'TWO_STEP_SETUP_REQUIRED');
    assert.equal((await call(WS, 'boss', { method: 'PATCH', body: { requireTwoStep: false } })).status, 200);
    assert.notEqual(await code(await call('/api/dashboards', 'adm', { project: true })), 'TWO_STEP_SETUP_REQUIRED');
  } finally { setTestSharedStore(null); server.close(); }
});
