import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  CONTENT_LIMITS, PLANS, PLAN_FEATURES, effectivePlan, getContentLimits, getPlanFeatures, getPlanLimits, historyCutoff, historyViolation, planStatus,
} from './config/plans.js';
import { app } from './app.js';
import { createInMemoryBillingStore, setTestBillingStore } from './lib/billingStore.js';
import { createInMemoryAuditStore, setTestAuditStore } from './lib/auditLog.js';
import { createInMemoryDigestStore, setTestDigestStore } from './lib/digestStore.js';
import { createInMemoryVaultStore, setTestConnectionStore } from './lib/connectionStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryMcpStore, setTestMcpStore } from './lib/mcpCredentials.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { getVault, resetVaultSingleton } from './lib/vault.js';
import { reportRegistry } from './reports/registry.js';

const NOW = new Date('2026-10-27T10:00:00Z');

test('Sprint 20 — the agreed Free limits, and plans only ever get bigger', () => {
  assert.deepEqual(getPlanLimits('free'), { maxProjects: 1, aiQuestionsPerMonth: 10 });
  assert.equal(getContentLimits('free').maxSavedReports, 2);
  assert.equal(getPlanFeatures('free').historyDays, 10);
  assert.equal(getPlanFeatures('free').emailSummaries, false);
  for (const [a, b] of [['free', 'pro'], ['pro', 'business']] as const) {
    assert.ok(PLANS[a].maxProjects <= PLANS[b].maxProjects && PLANS[a].aiQuestionsPerMonth <= PLANS[b].aiQuestionsPerMonth);
    for (const k of Object.keys(CONTENT_LIMITS[a]) as (keyof typeof CONTENT_LIMITS.free)[]) assert.ok(CONTENT_LIMITS[a][k] <= CONTENT_LIMITS[b][k], `${k} ${a}->${b}`);
    assert.ok(PLAN_FEATURES[a].maxMembers <= PLAN_FEATURES[b].maxMembers && PLAN_FEATURES[a].maxMcpKeys <= PLAN_FEATURES[b].maxMcpKeys);
  }
  // an unknown plan name never gets more than the old beta limits, and never crashes
  assert.deepEqual(getPlanLimits('mystery'), PLANS.beta);
  assert.deepEqual(getPlanLimits(undefined), PLANS.beta);
});

test('Sprint 20 — a paid plan runs out after a 7-day grace period and then falls back to Free', () => {
  const end = '2026-10-20T23:59:59.000Z';
  assert.equal(planStatus(end, new Date('2026-10-20T12:00:00Z')).status, 'active');
  assert.equal(planStatus(end, new Date('2026-10-23T12:00:00Z')).status, 'grace');
  assert.equal(planStatus(end, new Date('2026-10-27T23:59:58Z')).status, 'grace');
  assert.equal(planStatus(end, new Date('2026-10-28T00:00:01Z')).status, 'expired');
  assert.equal(planStatus(null, NOW).status, 'none');
  assert.equal(effectivePlan('pro', end, new Date('2026-10-23T12:00:00Z')), 'pro');
  assert.equal(effectivePlan('pro', end, new Date('2026-11-05T12:00:00Z')), 'free');
  assert.equal(effectivePlan('business', '2027-01-01T00:00:00Z', NOW), 'business');
  assert.equal(effectivePlan('beta', null, NOW), 'beta');
  assert.equal(effectivePlan('free', null, NOW), 'free');
  assert.equal(effectivePlan('garbage', null, NOW), 'beta');
  assert.equal(effectivePlan('pro', 'not a date', NOW), 'pro', 'an unreadable end date never locks anyone out');
});

test('Sprint 20 — history limit: Free may start up to 10 days back (plus one day of time-zone room)', () => {
  assert.equal(historyCutoff('free', NOW), '2026-10-16');
  assert.equal(historyViolation('free', '2026-10-17', NOW), null);
  assert.equal(historyViolation('free', '2026-10-16', NOW), null);
  assert.match(historyViolation('free', '2026-10-15', NOW) ?? '', /last 10 days/);
  assert.equal(historyViolation('beta', '2020-01-01', NOW), null, 'beta has no limit');
  assert.equal(historyViolation('pro', '2025-08-01', NOW), null);
  assert.ok(historyViolation('pro', '2024-01-01', NOW));
  assert.equal(historyViolation('free', undefined, NOW), null);
  assert.equal(historyViolation('free', 'garbage', NOW), null, 'bad dates are rejected elsewhere');
});

test('Sprint 20 — billing, operator plan changes, limits in routes and history limit', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-20-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.OPERATOR_EMAILS = 'owner@op.com';
  delete process.env.RESEND_API_KEY;
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestConnectionStore(createInMemoryVaultStore());
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  setTestMcpStore(createInMemoryMcpStore());
  setTestBillingStore(createInMemoryBillingStore());
  setTestDigestStore(createInMemoryDigestStore());
  const audit = createInMemoryAuditStore();
  setTestAuditStore(audit);
  resetVaultSingleton();

  const { workspace: wsA } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_op', email: 'owner@op.com', displayName: 'Op' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  await fs.addWorkspaceMember(wsA.id, 'uid_bob', 'member');
  const project = await fs.createProject(wsA.id, { name: 'P', domain: 'a.com', ga4PropertyId: '1001', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  setTestTokenVerifier(async (token: string) => {
    const who = token.replace('token-', '');
    return { uid: `uid_${who}`, email: who === 'op' ? 'owner@op.com' : `${who}@acme.com`, name: who, auth_time: Math.floor(Date.now() / 1000), email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  await getVault().saveConnection({ uid: 'uid_alice', provider: 'google', accountLabel: 'alice@acme.com', scopes: ['x'], refreshToken: 'rt', accessToken: 'tok', accessTokenExpiresAt: Date.now() + 3_600_000 });

  const seen: unknown[] = [];
  reportRegistry.register({
    id: 'test.planMock', title: 'Plan mock', description: 'mock', source: 'ga4',
    input: z.object({ startDate: z.string(), endDate: z.string() }),
    async run(_c, input) { seen.push(input); return { sessions: 1 }; },
  });

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = (path: string, token: string, init: { method?: string; body?: unknown; project?: boolean } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      headers: { Authorization: `Bearer token-${token}`, 'Content-Type': 'application/json', ...(init.project ? { 'X-AdLens-Project': `${wsA.id}/${project.id}` } : {}) },
    });
  const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const future = ymd(-60);
  const setPlan = (body: unknown, token = 'op') => api('/api/billing/admin/set-plan', token, { body });

  try {
    // --- who can do what
    assert.equal((await fetch(`${base}/api/billing`)).status, 401);
    assert.equal((await setPlan({ workspaceId: wsA.id, plan: 'pro', endsOn: future }, 'alice')).status, 403, 'a customer cannot change plans');
    assert.equal((await api('/api/billing/admin/workspaces', 'alice')).status, 403);
    assert.equal((await api('/api/billing/admin/invoices', 'alice', { body: {} })).status, 403);

    // --- the customer's own view
    const view0 = (await (await api(`/api/billing?workspaceId=${wsA.id}`, 'alice')).json()) as any;
    assert.equal(view0.current.plan, 'beta');
    assert.equal(view0.canRequestUpgrade, true);
    assert.equal(view0.isOperator, false);
    assert.equal(view0.usage.members, 2);
    assert.deepEqual(view0.plans.map((p: any) => p.id), ['free', 'pro', 'business']);
    assert.equal((await api(`/api/billing?workspaceId=${wsA.id}`, 'op')).status, 404, 'a stranger cannot read another workspace');
    assert.equal(((await (await api(`/api/billing?workspaceId=${wsA.id}`, 'bob')).json()) as any).canRequestUpgrade, false);

    // --- upgrade requests: owner yes, plain member no, one open request at a time
    assert.equal((await api('/api/billing/upgrade-request', 'bob', { body: { workspaceId: wsA.id, plan: 'pro' } })).status, 403);
    assert.equal((await api('/api/billing/upgrade-request', 'alice', { body: { workspaceId: wsA.id, plan: 'enterprise' } })).status, 400);
    const asked = await api('/api/billing/upgrade-request', 'alice', { body: { workspaceId: wsA.id, plan: 'pro', message: 'Please upgrade us' } });
    assert.equal(asked.status, 201);
    assert.equal(((await asked.json()) as any).emailed, false, 'no email service configured');
    await api('/api/billing/upgrade-request', 'alice', { body: { workspaceId: wsA.id, plan: 'business' } });
    const requests = ((await (await api('/api/billing/admin/requests', 'op')).json()) as any).requests;
    assert.equal(requests.length, 1);
    assert.equal(requests[0].plan, 'business');

    // --- operator sets a plan
    assert.equal((await setPlan({ workspaceId: wsA.id, plan: 'pro' })).status, 400, 'a paid plan needs an end date');
    assert.equal((await setPlan({ workspaceId: wsA.id, plan: 'platinum', endsOn: future })).status, 400);
    assert.equal((await setPlan({ workspaceId: 'nope', plan: 'pro', endsOn: future })).status, 404);
    assert.equal((await setPlan({ workspaceId: wsA.id, plan: 'pro', endsOn: future, note: 'Paid by bKash' })).status, 200);
    const view1 = (await (await api(`/api/billing?workspaceId=${wsA.id}`, 'alice')).json()) as any;
    assert.equal(view1.current.plan, 'pro');
    assert.equal(view1.current.status, 'active');
    assert.equal(view1.openRequest, null, 'giving the plan closes the request');
    assert.equal(((await (await api('/api/billing/admin/requests', 'op')).json()) as any).requests.length, 0);

    // --- invoices
    const inv = { workspaceId: wsA.id, number: 'AL-2026-001', amount: 1500, currency: 'BDT', plan: 'pro', periodStart: ymd(0), periodEnd: future };
    assert.equal((await api('/api/billing/admin/invoices', 'op', { body: { ...inv, amount: -5 } })).status, 400);
    assert.equal((await api('/api/billing/admin/invoices', 'op', { body: { ...inv, periodEnd: '2020-01-01' } })).status, 400);
    assert.equal((await api('/api/billing/admin/invoices', 'op', { body: inv })).status, 201);
    const view2 = (await (await api(`/api/billing?workspaceId=${wsA.id}`, 'alice')).json()) as any;
    assert.equal(view2.invoices.length, 1);
    assert.equal(view2.invoices[0].number, 'AL-2026-001');
    assert.ok(String(view2.refundPolicy).includes('3 days'));

    // --- a paid plan that has run out: 3 days late is still Pro, 10 days late is Free
    assert.equal((await setPlan({ workspaceId: wsA.id, plan: 'pro', endsOn: ymd(3) })).status, 200);
    let v = (await (await api(`/api/billing?workspaceId=${wsA.id}`, 'alice')).json()) as any;
    assert.equal(v.current.plan, 'pro');
    assert.equal(v.current.status, 'grace');
    assert.equal((await setPlan({ workspaceId: wsA.id, plan: 'pro', endsOn: ymd(10) })).status, 200);
    v = (await (await api(`/api/billing?workspaceId=${wsA.id}`, 'alice')).json()) as any;
    assert.equal(v.current.plan, 'free');
    assert.equal(v.current.storedPlan, 'pro');
    assert.equal(v.current.status, 'expired');
    assert.equal(v.current.limits.maxProjects, 1);

    // --- Free limits are enforced in the routes (workspace is on Free now)
    // history: 60 days back is refused before any report runs; 5 days back works
    const run = (startDate: string) => api('/api/reports/run', 'alice', { project: true, body: { id: 'test.planMock', startDate, endDate: ymd(1) } });
    const tooOld = await run(ymd(60));
    assert.equal(tooOld.status, 403);
    assert.equal(((await tooOld.json()) as any).error.code, 'PLAN_HISTORY_LIMIT');
    assert.equal(seen.length, 0);
    assert.equal((await run(ymd(5))).status, 200);
    assert.equal(seen.length, 1);

    // saved reports: only 2
    const spec = { dimensions: ['country'], metrics: ['sessions'], filters: [], limit: 50 };
    const save = (n: string) => api('/api/explore/saved', 'alice', { project: true, body: { name: n, source: 'ga4', spec } });
    assert.equal((await save('one')).status, 201);
    assert.equal((await save('two')).status, 201);
    const third = await save('three');
    assert.equal(third.status, 409);
    assert.match(((await third.json()) as any).error.message, /2 saved reports/);

    // agents: Free has none
    const agent = await api('/api/agents', 'alice', { project: true, body: { agent: { name: 'x', kind: 'gemini' }, apiKey: 'k', consent: true } });
    assert.ok([400, 409].includes(agent.status));

    // AI access keys: Free allows one
    const key = (n: string) => api('/api/mcp/keys', 'alice', { body: { name: n, projects: [{ workspaceId: wsA.id, projectId: project.id }] } });
    assert.equal((await key('one')).status, 201);
    const second = await key('two');
    assert.equal(second.status, 409);
    assert.match(((await second.json()) as any).error.message, /allows 1 active key/);

    // email summaries: not on Free
    const dig = await api('/api/digest', 'alice', { method: 'PUT', body: { workspaceId: wsA.id, projectId: project.id, weekly: true, alerts: false } });
    assert.equal(dig.status, 403);
    assert.equal(((await dig.json()) as any).error.code, 'PLAN_FEATURE');

    // --- upgrading again lifts the limits, with no data lost
    assert.equal((await setPlan({ workspaceId: wsA.id, plan: 'business', endsOn: future })).status, 200);
    assert.equal((await run(ymd(60))).status, 200);
    assert.equal((await save('three')).status, 201);
    assert.equal((await key('two')).status, 201);
    assert.equal((await api('/api/digest', 'alice', { method: 'PUT', body: { workspaceId: wsA.id, projectId: project.id, weekly: true, alerts: false } })).status, 200);

    // --- the audit trail records who changed what, and never stores the note's payment details beyond 200 characters
    const actions = audit.all().map((e) => e.action);
    assert.ok(actions.includes('plan.changed') && actions.includes('plan.requested') && actions.includes('invoice.recorded'));
    assert.ok(audit.all().every((e) => (e.detail ?? '').length <= 200));

    // --- operator lookup
    const found = ((await (await api(`/api/billing/admin/workspaces?q=${wsA.id}`, 'op')).json()) as any).workspaces;
    assert.equal(found[0].plan, 'business');
    assert.equal(found[0].status, 'active');
  } finally {
    server.closeAllConnections();
    server.close();
    reportRegistry.unregister('test.planMock');
  }
});
