import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSIONS, BUILTIN_ROLES, cleanPermissions, isSubset, permissionsOf, roleDef } from './lib/permissions.js';
import { app } from './app.js';
import { createInMemoryAdminSettingsStore, setTestAdminSettingsStore } from './lib/adminSettings.js';
import { createInMemoryAuditStore, setTestAuditStore } from './lib/auditLog.js';
import { createInMemoryBillingStore, setTestBillingStore } from './lib/billingStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryInviteStore, setTestInviteStore } from './lib/inviteStore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';

test('Sprint 21 — permission rules: starter roles, cleaning, and the "never more than you have" check', () => {
  assert.equal(BUILTIN_ROLES.owner.permissions.length, PERMISSIONS.length);
  assert.ok(isSubset(BUILTIN_ROLES.member.permissions, new Set(BUILTIN_ROLES.moderator.permissions)), 'member is inside moderator');
  assert.ok(isSubset(BUILTIN_ROLES.moderator.permissions, new Set(BUILTIN_ROLES.admin.permissions)), 'moderator is inside admin');
  assert.ok(!isSubset(BUILTIN_ROLES.admin.permissions, new Set(BUILTIN_ROLES.moderator.permissions)));
  assert.deepEqual(cleanPermissions([]), ['reports.view'], 'viewing is always included');
  assert.deepEqual(cleanPermissions(['ai.use', 'ai.use', 'hack.everything', 7]), ['reports.view', 'ai.use']);
  const ws = { ownerId: 'o', members: { o: 'owner', a: 'c_gone', b: 'c_ok' }, customRoles: { c_ok: { name: 'Ok', permissions: ['ai.use'], createdAt: '' } } };
  assert.equal(permissionsOf(ws, 'o').size, PERMISSIONS.length);
  assert.deepEqual([...permissionsOf(ws, 'a')], ['reports.view'], 'a deleted role can only view');
  assert.deepEqual([...permissionsOf(ws, 'b')].sort(), ['ai.use', 'reports.view']);
  assert.equal(permissionsOf(ws, 'stranger').size, 0);
  assert.equal(roleDef(ws, 'c_gone'), null);
});

test('Sprint 21 — workspace roles: starter roles, custom roles, no handing out more than you have, and staff roles in the admin panel', async () => {
  process.env.OPERATOR_EMAILS = 'root@adlens.test';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestInviteStore(createInMemoryInviteStore());
  setTestBillingStore(createInMemoryBillingStore());
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  setTestAdminSettingsStore(createInMemoryAdminSettingsStore());
  setTestAuditStore(createInMemoryAuditStore());

  const names = ['boss', 'adm', 'mod', 'mem', 'stranger', 'root', 'bill', 'sup', 'cfg', 'sup2'];
  setTestTokenVerifier(async (token: string) => {
    const n = token.replace('token-', '');
    if (!names.includes(n)) throw new Error('bad token');
    return { uid: `uid_${n}`, email: n === 'root' ? 'root@adlens.test' : `${n}@acme.test`, name: n, auth_time: Math.floor(Date.now() / 1000), email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  const { workspace: ws } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_boss', email: 'boss@acme.test', displayName: 'Boss' });
  for (const n of names.filter((x) => x !== 'boss')) await fs.bootstrapUserAndWorkspace({ uid: `uid_${n}`, email: n === 'root' ? 'root@adlens.test' : `${n}@acme.test`, displayName: n });
  await fs.setWorkspacePlan(ws.id, 'business', '2099-01-01T00:00:00.000Z');
  const project = await fs.createProject(ws.id, { name: 'P', domain: 'a.com', ga4PropertyId: '1', timezone: 'UTC', currency: 'USD', createdBy: 'uid_boss' });

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = (path: string, who: string, body?: unknown, method?: string, withProject = false) => fetch(`${base}${path}`, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'), body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer token-${who}`, 'Content-Type': 'application/json', ...(withProject ? { 'X-AdLens-Project': `${ws.id}/${project.id}` } : {}) },
  });
  const j = async (r: Response) => (await r.json()) as any;
  const T = `/api/team/${ws.id}`;
  const dash = (who: string) => api('/api/dashboards', who, {}, 'POST', true).then((r) => r.status); // 400 = allowed to try, 403 = refused

  try {
    // the owner sees the four starter roles and the full permission list
    const v0 = await j(await api(T, 'boss'));
    assert.deepEqual(v0.roles.map((r: any) => r.id), ['owner', 'admin', 'moderator', 'member']);
    assert.equal(v0.permissionList.length, PERMISSIONS.length);
    assert.equal(v0.roles.find((r: any) => r.id === 'owner').assignable, false, 'nobody hands out Owner');

    // give people starter roles
    assert.equal((await api(`${T}/members`, 'boss', { email: 'adm@acme.test', role: 'admin' })).status, 201);
    assert.equal((await api(`${T}/members`, 'boss', { email: 'mod@acme.test', role: 'moderator' })).status, 201);
    assert.equal((await api(`${T}/members`, 'boss', { email: 'mem@acme.test', role: 'member' })).status, 201);
    assert.equal((await api(`${T}/members`, 'boss', { email: 'x@y.test', role: 'owner' })).status, 403, 'owner cannot be given');
    assert.equal((await api(`${T}/members`, 'boss', { email: 'x@y.test', role: 'nonsense' })).status, 403, 'unknown role');
    const me = await j(await api('/api/me', 'mod'));
    const myWs = me.workspaces.find((w: any) => w.id === ws.id);
    assert.equal(myWs.role, 'moderator'); assert.equal(myWs.roleName, 'Moderator');
    assert.ok(myWs.permissions.includes('agents.manage') && !myWs.permissions.includes('roles.manage'));

    // what each starter role can and cannot do
    assert.equal(await dash('mem'), 400, 'a member may edit dashboards');
    assert.equal(await dash('stranger'), 404, 'strangers see nothing');
    assert.equal((await api(`/api/workspaces/${ws.id}`, 'mem', { name: 'Hacked' }, 'PATCH')).status, 403, 'member cannot change settings');
    assert.equal((await api(`/api/workspaces/${ws.id}`, 'mod', { name: 'Hacked' }, 'PATCH')).status, 403, 'moderator cannot change settings');
    assert.equal((await api(`/api/workspaces/${ws.id}`, 'adm', { name: 'Acme Ltd' }, 'PATCH')).status, 200, 'admin can');
    assert.equal((await api(`/api/workspaces/${ws.id}/projects/${project.id}`, 'mod', undefined, 'DELETE')).status, 403, 'moderator cannot delete projects');
    assert.equal((await api(`${T}/members`, 'mem', { email: 'q@q.test' })).status, 403);
    assert.equal((await api(`${T}/roles`, 'mod', { name: 'Mine', permissions: [] })).status, 403, 'moderator cannot create roles');
    assert.equal((await api(`${T}/members/uid_mem`, 'mod', { role: 'moderator' }, 'PATCH')).status, 403, 'moderator cannot assign roles');
    assert.equal((await api(`${T}/members`, 'mod', { email: 'adm2@acme.test', role: 'admin' })).status, 403, 'moderator cannot hand out admin');
    assert.equal((await api(`${T}/members/uid_adm`, 'mod', undefined, 'DELETE')).status, 403, 'moderator cannot remove an admin');
    assert.equal((await api(`${T}/members/uid_boss`, 'adm', undefined, 'DELETE')).status, 403, 'nobody removes the owner');
    assert.equal((await api(`${T}/members/uid_boss`, 'adm', { role: 'member' }, 'PATCH')).status, 409, "nobody changes the owner's role");

    // an admin makes custom roles
    const mk = (who: string, name: string, permissions: string[], description = '') => api(`${T}/roles`, who, { name, permissions, description });
    const viewerRes = await mk('adm', 'Viewer', []);
    assert.equal(viewerRes.status, 201);
    const viewerId = (await j(viewerRes)).roleId as string;
    assert.match(viewerId, /^c_[0-9a-f]{8}$/);
    const afterViewer = await j(await api(T, 'adm'));
    assert.deepEqual(afterViewer.roles.find((r: any) => r.id === viewerId).permissions, ['reports.view'], 'viewing is always there');
    assert.equal((await mk('adm', 'viewer', ['ai.use'])).status, 409, 'names are unique, ignoring case');
    assert.equal((await mk('adm', 'Admin', [])).status, 409, 'cannot reuse a starter name');
    assert.equal((await mk('adm', 'X', [])).status, 400, 'name too short');
    const billerId = (await j(await mk('adm', 'Biller', ['billing.manage', 'audit.view']))).roleId as string;
    const keeperId = (await j(await mk('adm', 'Role keeper', ['roles.manage', 'team.manage']))).roleId as string;

    // assigning a custom role changes what someone can do straight away
    assert.equal((await api(`${T}/members/uid_mem`, 'adm', { role: viewerId }, 'PATCH')).status, 200);
    assert.equal(await dash('mem'), 403, 'a viewer cannot edit');
    assert.equal((await api('/api/dashboards', 'mem', undefined, 'GET', true)).status, 200, 'but can still look');
    assert.equal((await api('/api/ai/usage', 'mem', undefined, 'GET', true)).status === 403, false, 'viewing the AI quota is fine');

    // nobody gives out more than they have
    assert.equal((await api(`${T}/members/uid_mem`, 'mod', { role: billerId }, 'PATCH')).status, 403);
    assert.equal((await api(`${T}/members`, 'mod', { email: 'b@acme.test', role: billerId })).status, 403, 'moderator lacks billing.manage');
    assert.equal((await api(`${T}/members/uid_mod`, 'adm', { role: keeperId }, 'PATCH')).status, 200);
    assert.equal((await mk('mod', 'Boss2', ['workspace.settings'])).status, 403, 'a role keeper cannot create a role with settings access they lack');
    assert.equal((await mk('mod', 'Keeper2', ['roles.manage'])).status, 201, 'but can make one inside their own access');
    assert.equal((await api(`${T}/members/uid_adm`, 'mod', { role: viewerId }, 'PATCH')).status, 403, 'cannot demote someone mightier');
    assert.equal((await api(`${T}/members/uid_mod`, 'adm', { role: 'moderator' }, 'PATCH')).status, 200);

    // editing and deleting custom roles; starter roles cannot be touched
    const edit = await api(`${T}/roles/${viewerId}`, 'adm', { name: 'Reader', permissions: ['ai.use'] }, 'PUT');
    assert.equal(edit.status, 200);
    assert.deepEqual((await j(edit)).roles.find((r: any) => r.id === viewerId).permissions, ['reports.view', 'ai.use']);
    assert.equal((await api(`${T}/roles/admin`, 'adm', { name: 'Admin2', permissions: [] }, 'PUT')).status, 404);
    assert.equal((await api(`${T}/roles/member`, 'adm', undefined, 'DELETE')).status, 404);
    await api(`${T}/members`, 'adm', { email: 'late@acme.test', role: viewerId }); // pending invite that uses the role
    const del = await api(`${T}/roles/${viewerId}`, 'adm', undefined, 'DELETE');
    assert.equal(del.status, 200);
    const afterDel = await j(del);
    assert.equal(afterDel.members.find((m: any) => m.uid === 'uid_mem').role, 'member', 'people on a deleted role become Members');
    assert.ok(afterDel.invites.every((i: any) => i.role !== viewerId));
    assert.equal(await dash('mem'), 400, 'and can edit again');

    // a role id that no longer exists (damaged data) can only view
    await fs.updateWorkspace(ws.id, { members: { ...(await fs.getWorkspace(ws.id))!.members, uid_mem: 'c_gone' } });
    assert.equal(await dash('mem'), 403);
    assert.equal((await api('/api/dashboards', 'mem', undefined, 'GET', true)).status, 200);

    // the activity log records role work
    const trail = (await j(await api(`/api/sso/workspaces/${ws.id}/audit`, 'adm'))).events.map((e: any) => e.action);
    assert.ok(trail.includes('role.created') && trail.includes('role.updated') && trail.includes('role.deleted'));
    assert.equal((await api(`/api/sso/workspaces/${ws.id}/audit`, 'boss')).status, 200);
    assert.equal((await api(`/api/sso/workspaces/${ws.id}/audit`, 'stranger')).status, 403);

    // --- AdLens staff roles in the admin panel
    const staff = async (list: { email: string; role: string }[], who = 'root') => api('/api/admin/operators', who, { operators: list }, 'PUT');
    assert.equal((await staff([{ email: 'bill@acme.test', role: 'billing' }, { email: 'sup@acme.test', role: 'support' }, { email: 'cfg@acme.test', role: 'settings' }, { email: 'sup2@acme.test', role: 'super' }])).status, 200);
    assert.equal((await staff([{ email: 'bill@acme.test', role: 'wizard' }])).status, 400, 'unknown staff role');
    const root = await j(await api('/api/admin/session', 'root'));
    assert.equal(root.role, 'super'); assert.equal(root.permissions.length, 6);
    const billS = await j(await api('/api/admin/session', 'bill'));
    assert.equal(billS.roleName, 'Billing manager'); assert.ok(billS.permissions.includes('billing.manage') && !billS.permissions.includes('settings.manage'));

    const setPlan = (who: string) => api('/api/billing/admin/set-plan', who, { workspaceId: ws.id, plan: 'free' });
    // billing manager: payments yes, settings no, staff no, sees no staff list
    assert.equal((await setPlan('bill')).status, 200);
    assert.equal((await api('/api/admin/flags', 'bill', { flags: { signupsOpen: false } }, 'PUT')).status, 403);
    assert.equal((await api('/api/admin/plans', 'bill', { plans: {} }, 'PUT')).status, 403);
    assert.equal((await staff([], 'bill')).status, 403);
    const billSettings = await j(await api('/api/admin/settings', 'bill'));
    assert.deepEqual(billSettings.operators, [], 'only people who manage staff see the staff list');
    assert.ok(billSettings.plans.length >= 4, 'but they can see plans to assign them');
    // support: looks and manages people, no plans
    assert.equal((await api('/api/billing/admin/workspaces', 'sup')).status, 200);
    assert.equal((await setPlan('sup')).status, 403);
    assert.equal((await api('/api/billing/admin/requests', 'sup')).status, 403);
    assert.equal((await api(`/api/billing/admin/workspaces/${ws.id}/members/uid_adm/role`, 'sup', { role: 'moderator' })).status, 204);
    assert.equal((await api(`/api/billing/admin/workspaces/${ws.id}/members/uid_adm/role`, 'sup', { role: 'not-a-role' })).status, 400);
    assert.equal((await api(`/api/billing/admin/workspaces/${ws.id}/members/uid_adm/role`, 'sup', { role: keeperId })).status, 204, 'staff can use the workspace\'s custom roles');
    // settings manager: plans and switches, not payments or people
    assert.equal((await api('/api/admin/flags', 'cfg', { flags: { explore: true } }, 'PUT')).status, 200);
    assert.equal((await setPlan('cfg')).status, 403);
    assert.equal((await api('/api/billing/admin/users', 'cfg')).status, 403);
    assert.equal((await api('/api/billing/admin/overview', 'cfg')).status, 200);
    // customers are still refused everywhere
    assert.equal((await api('/api/admin/settings', 'mem')).status, 403);
    assert.equal((await api('/api/billing/admin/overview', 'mem')).status, 403);
    // a non-owner super admin cannot lock themselves out of staff management
    assert.equal((await staff([{ email: 'sup2@acme.test', role: 'billing' }, { email: 'bill@acme.test', role: 'billing' }], 'sup2')).status, 409);
    assert.equal((await staff([{ email: 'sup2@acme.test', role: 'super' }, { email: 'bill@acme.test', role: 'support' }], 'sup2')).status, 200);
    assert.equal((await setPlan('bill')).status, 403, 'role changes apply at once');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    setTestAdminSettingsStore(null);
  }
});
