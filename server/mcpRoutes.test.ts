import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryMcpStore, pkceChallengeFor, setTestMcpStore } from './lib/mcpCredentials.js';
import { createMemoryStore, setTestSharedStore } from './lib/sharedStore.js';
import { reportRegistry } from './reports/registry.js';

const VERIFIER = 'q'.repeat(60);

async function setup() {
  process.env.APP_BASE_URL = 'https://adlens.example';
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestMcpStore(createInMemoryMcpStore());
  setTestSharedStore(createMemoryStore());
  const a = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const b = await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  const pa = await fs.createProject(a.workspace.id, { name: 'Alice Site', domain: 'alice.com', ga4PropertyId: '1', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  const pb = await fs.createProject(b.workspace.id, { name: 'Bob Site', domain: 'bob.com', timezone: 'UTC', currency: 'USD', createdBy: 'uid_bob' });
  setTestTokenVerifier(async (token: string) => {
    const uid = token === 'bob' ? 'uid_bob' : 'uid_alice';
    return { uid, email: `${uid}@acme.com`, name: uid, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  reportRegistry.register({
    id: 'test.mcp',
    title: 'MCP test report',
    description: 'test',
    source: 'ga4',
    input: z.object({ startDate: z.string(), endDate: z.string(), compareStartDate: z.string().optional(), compareEndDate: z.string().optional(), limit: z.number().int().max(5).optional() }),
    async run(_ctx, input) {
      return { sessions: 4242, range: `${input.startDate}..${input.endDate}`, compare: input.compareStartDate ?? null };
    },
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { fs, a, b, pa, pb, server, base };
}

const rpc = (base: string, key: string | null, body: unknown) =>
  fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
const call = async (base: string, key: string, name: string, args: unknown, id = 1) => {
  const r = await rpc(base, key, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  return (await r.json()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { code: number; message: string } };
};
const api = (base: string, token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  fetch(`${base}/api/mcp${path}`, { method: init.method ?? 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });

test('Sprint 17A — access keys: create, use through the MCP endpoint, scope to projects, revoke', async () => {
  const { a, b, pa, pb, server, base } = await setup();
  try {
    // no credential
    const none = await rpc(base, null, { jsonrpc: '2.0', id: 1, method: 'ping' });
    assert.equal(none.status, 401);
    assert.match(none.headers.get('www-authenticate') ?? '', /resource_metadata="https:\/\/adlens\.example\/\.well-known\/oauth-protected-resource"/);
    assert.equal((await rpc(base, 'adl_wrong', { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
    assert.equal((await fetch(`${base}/mcp`)).status, 405);

    // a person cannot put someone else's project on a key
    const stolen = await api(base, 'alice', '/keys', { method: 'POST', body: { name: 'sneaky', projects: [{ workspaceId: b.workspace.id, projectId: pb.id }] } });
    assert.equal(stolen.status, 400);
    assert.equal(((await stolen.json()) as { error: { code: string } }).error.code, 'NO_PROJECTS');

    const created = await api(base, 'alice', '/keys', { method: 'POST', body: { name: 'Claude Code', projects: [{ workspaceId: a.workspace.id, projectId: pa.id }, { workspaceId: b.workspace.id, projectId: pb.id }] } });
    assert.equal(created.status, 201);
    const { key, secret } = (await created.json()) as { key: { id: string; projects: unknown[] }; secret: string };
    assert.match(secret, /^adl_/);
    assert.equal(key.projects.length, 1, 'only her own project stayed on the key');

    const list = (await (await api(base, 'alice', '/keys')).json()) as { keys: Record<string, unknown>[] };
    assert.equal(list.keys.length, 1);
    assert.ok(!JSON.stringify(list).includes(secret) && !('hash' in list.keys[0]), 'the secret and its hash are never listed again');
    assert.equal(((await (await api(base, 'bob', '/keys')).json()) as { keys: unknown[] }).keys.length, 0, 'keys are private to their owner');

    // protocol
    const init = (await (await rpc(base, secret, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json()) as { result: { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: unknown } } };
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'adlens');
    assert.ok(init.result.capabilities.tools);
    assert.equal((await rpc(base, secret, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const tools = (await (await rpc(base, secret, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    assert.deepEqual(tools.result.tools.map((t) => t.name), ['list_projects', 'list_reports', 'run_report']);
    assert.ok(tools.result.tools.every((t) => t.annotations.readOnlyHint), 'every tool is read-only');
    const unknownMethod = (await (await rpc(base, secret, { jsonrpc: '2.0', id: 3, method: 'resources/list' })).json()) as { error: { code: number } };
    assert.equal(unknownMethod.error.code, -32601);
    const batch = (await (await rpc(base, secret, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }])).json()) as unknown[];
    assert.equal(batch.length, 2);

    // tools
    const projects = JSON.parse((await call(base, secret, 'list_projects', {})).result!.content[0].text) as { projects: { project_id: string; name: string; google_analytics: boolean; search_console: boolean }[] };
    assert.deepEqual(projects.projects.map((p) => [p.project_id, p.name, p.google_analytics, p.search_console]), [[`${a.workspace.id}/${pa.id}`, 'Alice Site', true, false]]);
    const reports = JSON.parse((await call(base, secret, 'list_reports', { source: 'search_console' })).result!.content[0].text) as { reports: { report_id: string }[] };
    assert.ok(reports.reports.length > 0 && reports.reports.every((r) => r.report_id.startsWith('searchConsole.')));
    assert.equal((await call(base, secret, 'list_reports', { source: 'nonsense' })).result!.isError, true);

    const run = await call(base, secret, 'run_report', { report_id: 'test.mcp', start_date: '2026-10-01', end_date: '2026-10-07', args: { limit: 3, startDate: '1999-01-01' } });
    assert.equal(run.result!.isError, undefined);
    assert.match(run.result!.content[0].text, /4242/);
    assert.match(run.result!.content[0].text, /2026-10-01\.\.2026-10-07/, 'dates come from the call, not from args');

    const wrongProject = await call(base, secret, 'run_report', { report_id: 'test.mcp', project_id: `${b.workspace.id}/${pb.id}`, start_date: '2026-10-01', end_date: '2026-10-07' });
    assert.equal(wrongProject.result!.isError, true);
    assert.match(wrongProject.result!.content[0].text, /not available/);
    for (const bad of [
      { report_id: 'nope', start_date: '2026-10-01', end_date: '2026-10-07' },
      { report_id: 'test.mcp', start_date: 'yesterday', end_date: '2026-10-07' },
      { report_id: 'test.mcp', start_date: '2026-10-09', end_date: '2026-10-07' },
      { report_id: 'test.mcp', start_date: '2026-10-01', end_date: '2026-10-07', compare_start_date: '2026-09-01' },
      { report_id: 'test.mcp', start_date: '2026-10-01', end_date: '2026-10-07', args: { limit: 99 } },
      { start_date: '2026-10-01', end_date: '2026-10-07' },
    ]) {
      assert.equal((await call(base, secret, 'run_report', bad)).result!.isError, true, JSON.stringify(bad));
    }
    assert.equal((await call(base, secret, 'delete_everything', {})).error!.code, -32602);

    // membership is checked at every call
    await fs_removeMember(a.workspace.id);
    assert.deepEqual(JSON.parse((await call(base, secret, 'list_projects', {})).result!.content[0].text), { projects: [] });
    const gone = await call(base, secret, 'run_report', { report_id: 'test.mcp', start_date: '2026-10-01', end_date: '2026-10-07' });
    assert.equal(gone.result!.isError, true);

    // revoke
    assert.equal((await api(base, 'bob', `/keys/${key.id}`, { method: 'DELETE' })).status, 404, 'someone else cannot revoke it');
    assert.equal((await api(base, 'alice', `/keys/${key.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await rpc(base, secret, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401, 'a revoked key stops working at once');
  } finally {
    server.close();
  }

  async function fs_removeMember(wsId: string) {
    const { getFirestoreStore } = await import('./lib/firestore.js');
    await getFirestoreStore().removeWorkspaceMember(wsId, 'uid_alice');
  }
});

test('Sprint 17B — OAuth 2.1: discovery, registration, approval, tokens, refresh, revoke', async () => {
  const { a, pa, server, base } = await setup();
  try {
    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as { resource: string; authorization_servers: string[] };
    assert.equal(prm.resource, 'https://adlens.example/mcp');
    const meta = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none']);
    assert.equal(meta.registration_endpoint, 'https://adlens.example/oauth/register');
    assert.equal((await fetch(`${base}/oauth/token`, { method: 'OPTIONS' })).status, 204);

    // registration
    const bad = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.com/cb'] }) });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: string }).error, 'invalid_redirect_uri');
    const reg = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] }) });
    assert.equal(reg.status, 201);
    const client = (await reg.json()) as { client_id: string };

    // authorize: unknown client shows an error and never redirects; a good one goes to the consent screen
    const noRedirect = await fetch(`${base}/oauth/authorize?client_id=nope&redirect_uri=https://evil.com/cb&response_type=code`, { redirect: 'manual' });
    assert.equal(noRedirect.status, 400);
    const wrongUri = await fetch(`${base}/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://evil.com/cb')}&response_type=code`, { redirect: 'manual' });
    assert.equal(wrongUri.status, 400);
    const noPkce = await fetch(`${base}/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://claude.ai/cb')}&response_type=code&state=s1`, { redirect: 'manual' });
    assert.equal(noPkce.status, 302);
    assert.match(noPkce.headers.get('location')!, /^https:\/\/claude\.ai\/cb\?error=invalid_request.*state=s1/);
    const challenge = pkceChallengeFor(VERIFIER);
    const ok = await fetch(`${base}/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://claude.ai/cb')}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=s2`, { redirect: 'manual' });
    assert.equal(ok.status, 302);
    assert.match(ok.headers.get('location')!, /^\/mcp-access\/authorize\?/);

    // consent (signed in)
    assert.equal((await fetch(`${base}/api/mcp/oauth/authorize-info?client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://claude.ai/cb')}`)).status, 401);
    const info = (await (await api(base, 'alice', `/oauth/authorize-info?client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://claude.ai/cb')}`)).json()) as { clientName: string; redirectHost: string; projects: { projectId: string }[] };
    assert.deepEqual([info.clientName, info.redirectHost, info.projects.map((p) => p.projectId)], ['Claude', 'claude.ai', [pa.id]]);

    const denied = (await (await api(base, 'alice', '/oauth/approve', { method: 'POST', body: { client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', state: 's3', approve: false } })).json()) as { redirect: string };
    assert.match(denied.redirect, /error=access_denied/);
    assert.equal((await api(base, 'alice', '/oauth/approve', { method: 'POST', body: { client_id: client.client_id, redirect_uri: 'https://evil.com/cb', approve: true, code_challenge: challenge, projects: [{ workspaceId: a.workspace.id, projectId: pa.id }] } })).status, 400);
    const approved = (await (await api(base, 'alice', '/oauth/approve', { method: 'POST', body: { client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', state: 's2', approve: true, code_challenge: challenge, projects: [{ workspaceId: a.workspace.id, projectId: pa.id }] } })).json()) as { redirect: string };
    const redirect = new URL(approved.redirect);
    assert.equal(redirect.origin + redirect.pathname, 'https://claude.ai/cb');
    assert.equal(redirect.searchParams.get('state'), 's2');
    const code = redirect.searchParams.get('code')!;

    // token
    const token = (form: Record<string, string>) => fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    const wrongVerifier = await token({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', code_verifier: 'z'.repeat(60) });
    assert.equal(wrongVerifier.status, 400);
    assert.equal(((await wrongVerifier.json()) as { error: string }).error, 'invalid_grant');
    assert.equal((await token({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', code_verifier: VERIFIER })).status, 400, 'a code that failed once is burned');

    const code2 = new URL(((await (await api(base, 'alice', '/oauth/approve', { method: 'POST', body: { client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', approve: true, code_challenge: challenge, projects: [{ workspaceId: a.workspace.id, projectId: pa.id }] } })).json()) as { redirect: string }).redirect).searchParams.get('code')!;
    const good = await token({ grant_type: 'authorization_code', code: code2, client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', code_verifier: VERIFIER });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('cache-control'), 'no-store');
    const t = (await good.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number };
    assert.equal(t.token_type, 'Bearer');

    const viaOauth = await call(base, t.access_token, 'list_projects', {});
    assert.equal(JSON.parse(viaOauth.result!.content[0].text).projects[0].name, 'Alice Site');

    const apps = (await (await api(base, 'alice', '/apps')).json()) as { apps: { familyId: string; clientName: string }[] };
    assert.equal(apps.apps.length, 1);
    assert.equal(apps.apps[0].clientName, 'Claude');
    assert.equal(((await (await api(base, 'bob', '/apps')).json()) as { apps: unknown[] }).apps.length, 0);

    const refreshed = (await (await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id })).json()) as { access_token: string; refresh_token: string };
    assert.notEqual(refreshed.access_token, t.access_token);
    assert.equal((await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id })).status, 400, 'old refresh token is dead');
    assert.equal((await rpc(base, refreshed.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401, 'and reusing it revoked the whole approval');
    assert.equal((await token({ grant_type: 'password' })).status, 400);

    // fresh approval, then the person revokes the app
    const code3 = new URL(((await (await api(base, 'alice', '/oauth/approve', { method: 'POST', body: { client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', approve: true, code_challenge: challenge, projects: [{ workspaceId: a.workspace.id, projectId: pa.id }] } })).json()) as { redirect: string }).redirect).searchParams.get('code')!;
    const t3 = (await (await token({ grant_type: 'authorization_code', code: code3, client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', code_verifier: VERIFIER })).json()) as { access_token: string };
    assert.equal((await rpc(base, t3.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200);
    const fam = ((await (await api(base, 'alice', '/apps')).json()) as { apps: { familyId: string }[] }).apps[0].familyId;
    assert.equal((await api(base, 'bob', `/apps/${fam}`, { method: 'DELETE' })).status, 404);
    assert.equal((await api(base, 'alice', `/apps/${fam}`, { method: 'DELETE' })).status, 204);
    assert.equal((await rpc(base, t3.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  } finally {
    server.close();
  }
});

test('Sprint 17 — the MCP endpoint is rate limited per credential', async () => {
  const { a, pa, server, base } = await setup();
  try {
    const { secret } = (await (await api(base, 'alice', '/keys', { method: 'POST', body: { name: 'k', projects: [{ workspaceId: a.workspace.id, projectId: pa.id }] } })).json()) as { secret: string };
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await rpc(base, secret, { jsonrpc: '2.0', id: i, method: 'ping' })).status;
    assert.equal(last, 429);
    const limited = await rpc(base, secret, { jsonrpc: '2.0', id: 1, method: 'ping' });
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  } finally {
    server.close();
  }
});

test('Security audit — MCP keys follow the role: no "Use the AI Analyst" permission means no key, and existing keys stop at once', async () => {
  const { fs, a, pa, server, base } = await setup();
  try {
    await fs.updateWorkspace(a.workspace.id, { customRoles: { c_view: { name: 'Viewer', permissions: ['reports.view'], createdAt: '' }, c_ai: { name: 'Ai', permissions: ['reports.view', 'ai.use'], createdAt: '' } } });
    // alice is the owner, so she keeps full power: a key works
    const mk = await api(base, 'alice', '/keys', { method: 'POST', body: { name: 'k', projects: [{ workspaceId: a.workspace.id, projectId: pa.id }] } });
    const { secret } = (await mk.json()) as { secret: string };
    assert.equal(JSON.parse((await call(base, secret, 'list_projects', {})).result!.content[0].text).projects.length, 1);
    // bob joins alice's workspace with a view-only role
    await fs.updateWorkspace(a.workspace.id, { members: { ...(await fs.getWorkspace(a.workspace.id))!.members, uid_bob: 'c_view' } });
    assert.equal(((await (await api(base, 'bob', '/projects')).json()) as { projects: { workspaceId: string }[] }).projects.some((p) => p.workspaceId === a.workspace.id), false, 'not offered');
    const denied = await api(base, 'bob', '/keys', { method: 'POST', body: { name: 'x', projects: [{ workspaceId: a.workspace.id, projectId: pa.id }] } });
    assert.equal(denied.status, 400, 'cannot create a key for a workspace where the role has no AI permission');
    // with the permission he can; taking it away stops his key at the next call
    await fs.updateWorkspace(a.workspace.id, { members: { ...(await fs.getWorkspace(a.workspace.id))!.members, uid_bob: 'c_ai' } });
    const ok = await api(base, 'bob', '/keys', { method: 'POST', body: { name: 'x', projects: [{ workspaceId: a.workspace.id, projectId: pa.id }] } });
    assert.equal(ok.status, 201);
    const bobSecret = ((await ok.json()) as { secret: string }).secret;
    assert.equal(JSON.parse((await call(base, bobSecret, 'list_projects', {})).result!.content[0].text).projects.length, 1);
    await fs.updateWorkspace(a.workspace.id, { members: { ...(await fs.getWorkspace(a.workspace.id))!.members, uid_bob: 'c_view' } });
    assert.deepEqual(JSON.parse((await call(base, bobSecret, 'list_projects', {})).result!.content[0].text), { projects: [] });
    assert.equal((await call(base, bobSecret, 'run_report', { report_id: 'test.mcp', project_id: `${a.workspace.id}/${pa.id}`, start_date: '2026-10-01', end_date: '2026-10-07' })).result!.isError, true);
  } finally { server.close(); }
});
