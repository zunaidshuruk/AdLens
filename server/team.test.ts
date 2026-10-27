import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryAuditStore, setTestAuditStore } from './lib/auditLog.js';
import { createInMemoryBillingStore, setTestBillingStore } from './lib/billingStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryInviteStore, setTestInviteStore } from './lib/inviteStore.js';

test('Sprint 20 — team: add by email, pending invites, same-company offers, roles, limits, and the admin panel', async () => {
  process.env.OPERATOR_EMAILS = 'boss@synesisit.com.bd';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestInviteStore(createInMemoryInviteStore());
  setTestBillingStore(createInMemoryBillingStore());
  const audit = createInMemoryAuditStore();
  setTestAuditStore(audit);

  const people: Record<string, { uid: string; email: string; verified: boolean }> = {
    boss: { uid: 'uid_boss', email: 'boss@synesisit.com.bd', verified: true },
    mate: { uid: 'uid_mate', email: 'mate@synesisit.com.bd', verified: true },
    unverified: { uid: 'uid_unv', email: 'late@synesisit.com.bd', verified: false },
    gmail: { uid: 'uid_gm', email: 'someone@gmail.com', verified: true },
    outsider: { uid: 'uid_out', email: 'out@other.com', verified: true },
    newbie: { uid: 'uid_new', email: 'newbie@client.com', verified: true },
  };
  setTestTokenVerifier(async (token: string) => {
    const p = people[token.replace('token-', '')];
    if (!p) throw new Error('bad token');
    return { uid: p.uid, email: p.email, name: token, email_verified: p.verified, firebase: p.verified ? { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } : { identities: { email: [p.email] }, sign_in_provider: 'password' } } as never;
  });
  const { workspace: ws } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_boss', email: people.boss.email, displayName: 'Boss' });
  for (const k of ['mate', 'gmail', 'outsider'] as const) await fs.bootstrapUserAndWorkspace({ uid: people[k].uid, email: people[k].email, displayName: k });
  await fs.setWorkspacePlan(ws.id, 'pro', '2099-01-01T00:00:00.000Z'); // 3 people

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = (path: string, who: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      headers: { Authorization: `Bearer token-${who}`, 'Content-Type': 'application/json' },
    });
  const json = async (r: Response) => (await r.json()) as any;
  const T = `/api/team/${ws.id}`;

  try {
    // only members can look
    assert.equal((await api(T, 'outsider')).status, 404);
    const v0 = await json(await api(T, 'boss'));
    assert.equal(v0.members.length, 1);
    assert.equal(v0.limit, 3);
    assert.equal(v0.canManage, true);

    // add by email: an existing account joins at once, a stranger gets a pending invitation
    assert.equal((await api(`${T}/members`, 'boss', { body: { email: 'not-an-email' } })).status, 400);
    const added = await json(await api(`${T}/members`, 'boss', { body: { email: 'MATE@synesisit.com.bd' } }));
    assert.equal(added.added, true);
    assert.equal(added.members.length, 2);
    assert.equal((await api(`${T}/members`, 'boss', { body: { email: 'mate@synesisit.com.bd' } })).status, 409, 'already a member');
    const inv = await json(await api(`${T}/members`, 'boss', { body: { email: 'newbie@client.com', role: 'member' } }));
    assert.equal(inv.invited, true);
    assert.equal(inv.invites.length, 1);
    assert.equal((await api(`${T}/members`, 'boss', { body: { email: 'newbie@client.com' } })).status, 409, 'already invited');

    // the plan counts pending invitations too: 2 members + 1 invitation = 3 = full
    const full = await api(`${T}/members`, 'boss', { body: { email: 'another@x.com' } });
    assert.equal(full.status, 403);
    assert.equal((await json(full)).error.code, 'PLAN_MEMBER_LIMIT');

    // a plain member cannot manage, an admin cannot make admins
    assert.equal((await api(`${T}/members`, 'mate', { body: { email: 'z@x.com' } })).status, 403);
    assert.equal((await api(`${T}/members/uid_mate`, 'boss', { method: 'PATCH', body: { role: 'admin' } })).status, 200);
    assert.equal((await api(`${T}/members`, 'mate', { body: { email: 'z@x.com', role: 'admin' } })).status, 403, 'only the owner makes admins');
    assert.equal((await api(`${T}/members/uid_mate`, 'mate', { method: 'PATCH', body: { role: 'member' } })).status, 403, 'only the owner changes roles');
    assert.equal((await api(`${T}/members/uid_boss`, 'boss', { method: 'PATCH', body: { role: 'member' } })).status, 409, 'the owner stays owner');

    // the invitation is accepted when the person signs in with that verified address
    const before = await fs.getWorkspace(ws.id);
    assert.equal(Object.keys(before!.members).length, 2);
    await fs.bootstrapUserAndWorkspace({ uid: 'uid_new', email: people.newbie.email, displayName: 'Newbie' });
    assert.equal((await api('/api/me/bootstrap', 'newbie', { method: 'POST', body: {} })).status, 200);
    assert.equal((await fs.getWorkspace(ws.id))!.members.uid_new, 'member');
    assert.equal((await json(await api(T, 'boss'))).invites.length, 0);

    // removing people: owner can, a member can only leave, the owner can never be removed
    assert.equal((await api(`${T}/members/uid_boss`, 'mate', { method: 'DELETE' })).status, 403, 'an admin cannot remove the owner');
    assert.equal((await api(`${T}/members/uid_boss`, 'boss', { method: 'DELETE' })).status, 409, 'the owner cannot leave their own workspace');
    assert.equal((await api(`${T}/members/uid_boss`, 'newbie', { method: 'DELETE' })).status, 403);
    assert.equal((await api(`${T}/members/uid_new`, 'newbie', { method: 'DELETE' })).status, 204, 'leaving');
    assert.equal((await api(`${T}/members/uid_mate`, 'boss', { method: 'DELETE' })).status, 204);
    assert.equal(Object.keys((await fs.getWorkspace(ws.id))!.members).length, 1);

    // --- same company email: offered, never added silently, owner opt-in
    assert.deepEqual((await json(await api('/api/team/offers/mine', 'mate'))).offers, [], 'nothing is offered until the owner turns it on');
    const on = await json(await api(`${T}/domain-join`, 'boss', { method: 'PUT', body: { enabled: true } }));
    assert.equal(on.joinDomain, 'synesisit.com.bd');
    const offers = (await json(await api('/api/team/offers/mine', 'mate'))).offers;
    assert.equal(offers.length, 1);
    assert.equal(offers[0].workspaceId, ws.id);
    assert.equal(Object.keys((await fs.getWorkspace(ws.id))!.members).length, 1, 'an offer alone does not add anyone');
    assert.deepEqual((await json(await api('/api/team/offers/mine', 'outsider'))).offers, [], 'other companies see nothing');
    assert.deepEqual((await json(await api('/api/team/offers/mine', 'gmail'))).offers, [], 'free-mail never matches');
    assert.equal((await api('/api/team/offers/mine', 'unverified')).status, 403, 'an unverified address cannot use AdLens at all');
    assert.equal((await api(`/api/team/offers/${ws.id}/accept`, 'outsider', { body: {} })).status, 404);
    assert.equal((await api(`/api/team/offers/${ws.id}/accept`, 'unverified', { body: {} })).status, 403);
    assert.equal((await api(`/api/team/offers/${ws.id}/accept`, 'mate', { body: {} })).status, 200);
    assert.equal((await fs.getWorkspace(ws.id))!.members.uid_mate, 'member');
    assert.deepEqual((await json(await api('/api/team/offers/mine', 'mate'))).offers, [], 'no offer once joined');
    assert.equal((await api(`${T}/domain-join`, 'mate', { method: 'PUT', body: { enabled: false } })).status, 403, 'only the owner can change it');

    // the owner can turn it off again; a free-mail owner cannot turn it on
    assert.equal((await json(await api(`${T}/domain-join`, 'boss', { method: 'PUT', body: { enabled: false } }))).joinDomain, null);
    const gm = (await fs.bootstrapUserAndWorkspace({ uid: 'uid_gm', email: people.gmail.email, displayName: 'G' })).workspace;
    assert.equal((await api(`/api/team/${gm.id}/domain-join`, 'gmail', { method: 'PUT', body: { enabled: true } })).status, 400);

    // --- admin panel (operator only)
    assert.equal((await api('/api/billing/whoami', 'boss').then(json)).isOperator, true);
    assert.equal((await api('/api/billing/whoami', 'mate').then(json)).isOperator, false);
    for (const path of ['/overview', '/users', '/audit', `/workspaces/${ws.id}`]) assert.equal((await api(`/api/billing/admin${path}`, 'mate')).status, 403, path);

    const ov = await json(await api('/api/billing/admin/overview', 'boss'));
    assert.ok(ov.counts.workspaces >= 3);
    assert.equal(ov.byPlan.pro, 1);
    assert.ok(Array.isArray(ov.checks) && ov.checks.length > 5);
    assert.equal(typeof ov.health.emailConfigured, 'boolean');

    const detail = await json(await api(`/api/billing/admin/workspaces/${ws.id}`, 'boss'));
    assert.equal(detail.current.plan, 'pro');
    assert.equal(detail.members.length, 2);
    assert.ok(detail.members.some((m: any) => m.email === 'mate@synesisit.com.bd'));
    assert.equal((await api('/api/billing/admin/workspaces/nope', 'boss')).status, 404);

    assert.equal((await api(`/api/billing/admin/workspaces/${ws.id}/members/uid_mate/role`, 'boss', { body: { role: 'admin' } })).status, 204);
    assert.equal((await fs.getWorkspace(ws.id))!.members.uid_mate, 'admin');
    assert.equal((await api(`/api/billing/admin/workspaces/${ws.id}/members/uid_boss`, 'boss', { method: 'DELETE' })).status, 409, 'not even the operator can remove an owner');
    assert.equal((await api(`/api/billing/admin/workspaces/${ws.id}/members/uid_mate`, 'boss', { method: 'DELETE' })).status, 204);

    const users = (await json(await api('/api/billing/admin/users?q=mate', 'boss'))).users;
    assert.equal(users.length, 1);
    assert.equal(users[0].email, 'mate@synesisit.com.bd');
    assert.ok(users[0].workspaces.length >= 1);

    const trail = (await json(await api(`/api/billing/admin/audit?workspaceId=${ws.id}`, 'boss'))).events;
    const actions = trail.map((e: any) => e.action);
    for (const a of ['member.added', 'member.invited', 'member.role_changed', 'member.removed']) assert.ok(actions.includes(a), a);
    assert.ok(trail.every((e: any) => typeof e.who === 'string'));
    assert.ok((await json(await api('/api/billing/admin/audit', 'boss'))).events.length > 0);
    assert.ok(audit.all().every((e) => (e.detail ?? '').length <= 200));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
