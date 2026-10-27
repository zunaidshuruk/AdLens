import assert from 'node:assert/strict';
import test from 'node:test';
import { PLANS, PLAN_IDS, PLAN_INFO, applyPlanConfig, getPlanFeatures, getPlanLimits } from './config/plans.js';
import { app } from './app.js';
import { createInMemoryAdminSettingsStore, setTestAdminSettingsStore } from './lib/adminSettings.js';
import { createInMemoryAuditStore, setTestAuditStore } from './lib/auditLog.js';
import { createInMemoryBillingStore, setTestBillingStore } from './lib/billingStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryInviteStore, setTestInviteStore } from './lib/inviteStore.js';

test('Sprint 20e — plan settings: edit, add a custom plan, and go back to defaults', () => {
  applyPlanConfig({ pro: { priceUsd: 25, limits: { maxProjects: 7 }, features: { historyDays: null } }, convay: { label: 'Convay', limits: { maxProjects: 9 }, features: { maxMembers: 12 } } });
  assert.equal(PLANS.pro.maxProjects, 7);
  assert.equal(PLAN_INFO.pro.priceUsd, 25);
  assert.equal(getPlanFeatures('pro').historyDays, null);
  assert.equal(getPlanLimits('convay').maxProjects, 9);
  assert.equal(getPlanFeatures('convay').maxMembers, 12);
  assert.equal(PLAN_INFO.convay.label, 'Convay');
  assert.ok(PLAN_IDS.includes('convay'));
  applyPlanConfig({});
  assert.equal(PLANS.pro.maxProjects, 5);
  assert.equal(getPlanFeatures('pro').historyDays, 487);
  assert.ok(!PLAN_IDS.includes('convay'));
  assert.equal(getPlanLimits('convay').maxProjects, PLANS.beta.maxProjects, 'an unknown plan falls back to beta limits');
});

test('Sprint 20e — admin panel: fresh sign-in, settings, switches, operators, custom plan for one customer', async () => {
  process.env.OPERATOR_EMAILS = 'owner@op.com';
  process.env.GOOGLE_CLIENT_ID = 'x'; process.env.GOOGLE_CLIENT_SECRET = 'y';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-20-32chars!!';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestBillingStore(createInMemoryBillingStore());
  setTestInviteStore(createInMemoryInviteStore());
  setTestAuditStore(createInMemoryAuditStore());
  setTestAdminSettingsStore(createInMemoryAdminSettingsStore());
  const { workspace: ws } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_cust', email: 'cust@acme.com', displayName: 'Cust' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_op', email: 'owner@op.com', displayName: 'Op' });

  const who: Record<string, { email: string; age: number }> = {
    op: { email: 'owner@op.com', age: 5 }, oldop: { email: 'owner@op.com', age: 4000 },
    helper: { email: 'helper@x.com', age: 5 }, cust: { email: 'cust@acme.com', age: 5 }, fresh: { email: 'new@person.com', age: 5 },
  };
  setTestTokenVerifier(async (token: string) => {
    const p = who[token.replace('token-', '')];
    if (!p) throw new Error('bad token');
    return { uid: `uid_${token.replace('token-', '')}`, email: p.email, name: token, email_verified: true, auth_time: Math.floor(Date.now() / 1000) - p.age, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = (path: string, who: string, body?: unknown, method?: string) => fetch(`${base}${path}`, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'), body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer token-${who}`, 'Content-Type': 'application/json' },
  });
  const j = async (r: Response) => (await r.json()) as any;

  try {
    // who may enter, and the one-hour session
    assert.equal((await api('/api/admin/settings', 'cust')).status, 403);
    assert.equal((await api('/api/admin/settings', 'helper')).status, 403);
    const stale = await api('/api/admin/settings', 'oldop');
    assert.equal(stale.status, 403);
    assert.equal((await j(stale)).error.code, 'ADMIN_REAUTH');
    assert.equal((await api('/api/billing/admin/overview', 'oldop')).status, 403, 'the older billing admin calls need the fresh sign-in too');
    const sess = await j(await api('/api/admin/session', 'op'));
    assert.equal(sess.operator, true); assert.ok(sess.secondsLeft > 3000);
    const sessStale = await j(await api('/api/admin/session', 'oldop'));
    assert.equal(sessStale.operator, true); assert.equal(sessStale.secondsLeft, 0);
    assert.equal((await j(await api('/api/admin/session', 'cust'))).operator, false);

    // plans and prices
    const s0 = await j(await api('/api/admin/settings', 'op'));
    assert.deepEqual(s0.plans.map((p: any) => p.id), ['beta', 'free', 'pro', 'business']);
    assert.deepEqual(s0.operators, [{ email: 'owner@op.com', locked: true }]);
    const put = await api('/api/admin/plans', 'op', { plans: { pro: { priceUsd: 29, priceBdt: 2500, limits: { maxProjects: 8 } }, 'convay-team': { label: 'Convay team', features: { maxMembers: 12, historyDays: null }, limits: { maxProjects: 10, aiQuestionsPerMonth: 800 } } } }, 'PUT');
    assert.equal(put.status, 200);
    assert.equal(PLAN_INFO.pro.priceUsd, 29);
    assert.equal(getPlanLimits('pro').maxProjects, 8);
    const bad = await api('/api/admin/plans', 'op', { plans: { 'Bad Id!': { label: 'x' } } }, 'PUT');
    assert.equal(bad.status, 400);
    assert.equal((await api('/api/admin/plans', 'op', { plans: { pro: { limits: { maxProjects: -4 } } } }, 'PUT')).status, 400);
    assert.equal(getPlanLimits('pro').maxProjects, 8, 'a refused change changes nothing');

    // customers see the new price, but not the private plan
    const bill = await j(await api(`/api/billing?workspaceId=${ws.id}`, 'cust'));
    assert.deepEqual(bill.plans.map((p: any) => p.id), ['free', 'pro', 'business']);
    assert.equal(bill.plans.find((p: any) => p.id === 'pro').priceUsd, 29);

    // give that private plan to one customer (no end date needed)
    assert.equal((await api('/api/billing/admin/set-plan', 'op', { workspaceId: ws.id, plan: 'nope' })).status, 400);
    assert.equal((await api('/api/billing/admin/set-plan', 'op', { workspaceId: ws.id, plan: 'convay-team' })).status, 200);
    const after = await j(await api(`/api/billing?workspaceId=${ws.id}`, 'cust'));
    assert.equal(after.current.plan, 'convay-team');
    assert.equal(after.current.features.maxMembers, 12);
    assert.equal(after.current.label, 'Convay team');
    assert.equal((await api('/api/billing/admin/set-plan', 'op', { workspaceId: ws.id, plan: 'pro' })).status, 400, 'pro still needs an end date');

    // a custom plan that a workspace is using cannot be deleted
    const keepPro = { pro: { priceUsd: 29, priceBdt: 2500, limits: { maxProjects: 8 } } };
    const inUse = await api('/api/admin/plans', 'op', { plans: keepPro }, 'PUT');
    assert.equal(inUse.status, 409); assert.equal((await j(inUse)).error.code, 'PLAN_IN_USE');
    await api('/api/billing/admin/set-plan', 'op', { workspaceId: ws.id, plan: 'free' });
    assert.equal((await api('/api/admin/plans', 'op', { plans: keepPro }, 'PUT')).status, 200);
    assert.ok(!PLAN_IDS.includes('convay-team'));

    // operators from the panel
    assert.equal((await api('/api/admin/operators', 'op', { operators: ['not an email'] }, 'PUT')).status, 400);
    assert.equal((await api('/api/admin/operators', 'op', { operators: ['Helper@X.com'] }, 'PUT')).status, 200);
    assert.equal((await api('/api/admin/settings', 'helper')).status, 200, 'the new operator can enter');
    assert.equal((await api('/api/admin/operators', 'helper', { operators: [] }, 'PUT')).status, 409, 'an added operator cannot lock themselves out');
    assert.equal((await api('/api/admin/operators', 'op', { operators: [] }, 'PUT')).status, 200);
    assert.equal((await api('/api/admin/settings', 'helper')).status, 403, 'removed');
    assert.equal((await api('/api/admin/settings', 'op')).status, 200, 'owners in OPERATOR_EMAILS stay');

    // feature switches
    assert.equal((await api('/api/dashboards', 'cust')).status === 503, false);
    assert.equal((await api('/api/admin/flags', 'op', { flags: { dashboards: false, agents: false } }, 'PUT')).status, 200);
    const off = await api('/api/dashboards', 'cust');
    assert.equal(off.status, 503); assert.equal((await j(off)).error.code, 'FEATURE_OFF');
    assert.equal((await api('/api/agents', 'cust')).status, 503);
    { const ex = await api('/api/explore', 'cust'); const b = await j(ex); assert.notEqual(b?.error?.code, 'FEATURE_OFF', JSON.stringify(b)); }
    await api('/api/admin/flags', 'op', { flags: { dashboards: true, agents: true } }, 'PUT');
    assert.notEqual((await api('/api/dashboards', 'cust')).status, 503);

    // sign-ups closed: newcomers refused, existing people and operators fine
    await api('/api/admin/flags', 'op', { flags: { signupsOpen: false } }, 'PUT');
    assert.equal((await j(await fetch(`${base}/api/public-config`))).status.signupsOpen, false);
    const closed = await api('/api/me/bootstrap', 'fresh', {});
    assert.equal(closed.status, 403); assert.equal((await j(closed)).error.code, 'SIGNUPS_CLOSED');
    assert.equal((await api('/api/me/bootstrap', 'cust', {})).status, 200);
    await api('/api/admin/flags', 'op', { flags: { signupsOpen: true } }, 'PUT');
    assert.equal((await api('/api/me/bootstrap', 'fresh', {})).status, 200);

    // maintenance: everyone is paused, the panel and checks keep working
    await api('/api/admin/flags', 'op', { flags: { maintenanceMode: true, maintenanceMessage: 'Back at 6pm' } }, 'PUT');
    const m = await api('/api/me', 'cust');
    assert.equal(m.status, 503); assert.equal((await j(m)).error.message, 'Back at 6pm');
    assert.equal((await fetch(`${base}/api/public-config`)).status, 200);
    assert.equal((await api('/api/admin/settings', 'op')).status, 200);
    await api('/api/admin/flags', 'op', { flags: { maintenanceMode: false } }, 'PUT');
    assert.equal((await api('/api/me', 'cust')).status, 200);

    // everything above was written to the audit trail
    const trail = (await j(await api('/api/billing/admin/audit', 'op'))).events.filter((e: any) => e.action === 'admin.settings_changed');
    assert.ok(trail.length >= 6);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    setTestAdminSettingsStore(null);
  }
});
