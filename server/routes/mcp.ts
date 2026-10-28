import { getPlanFeatures } from '../config/plans.js';
import { recordAudit } from '../lib/auditLog.js';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { getServerConfig } from '../config.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import {
  cleanProjects,
  createAccessKey,
  createAuthCode,
  exchangeAuthCode,
  getMcpStore,
  isAllowedRedirectUri,
  listConnectedApps,
  McpCredentialError,
  refreshTokens,
  registerClient,
  resolveBearer,
  revokeAccessKey,
  revokeConnectedApp,
  type ProjectAccess,
} from '../lib/mcpCredentials.js';
import { mcpBackend } from '../lib/mcpBackend.js';
import { handleRpcBody } from '../lib/mcpProtocol.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { requireUser } from '../middleware/requireUser.js';

/** Where this server is reached from (for the OAuth documents). APP_BASE_URL when set, otherwise the address of the request. */
export function publicBaseUrl(req: Request): string {
  const cfg = getServerConfig();
  return cfg.appBaseUrl || `${req.protocol}://${req.get('host')}`;
}

const MCP_PER_MINUTE = 60;

// ---------------------------------------------------------------------------
// POST /mcp  (the MCP endpoint itself)
// ---------------------------------------------------------------------------

export const mcpRouter = Router();

mcpRouter.post('/', async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  const secret = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const principal = secret ? await resolveBearer(getMcpStore(), secret).catch(() => null) : null;
  if (!principal) {
    res
      .status(401)
      .set('WWW-Authenticate', `Bearer resource_metadata="${publicBaseUrl(req)}/.well-known/oauth-protected-resource"`)
      .json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Authentication required. Use an AdLens access key or connect through OAuth.' } });
    return;
  }
  const limit = await checkRateLimit('mcp', principal.credentialId, MCP_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    res.status(429).set('Retry-After', String(limit.retryAfterSeconds)).json({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Too many requests. Please slow down.' } });
    return;
  }
  const out = await handleRpcBody(req.body, principal, mcpBackend);
  if (out === null) {
    res.status(202).end();
    return;
  }
  res.json(out);
});

// This endpoint answers each request on its own; it has no streams to open or sessions to end.
mcpRouter.all('/', (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } });
});

// ---------------------------------------------------------------------------
// OAuth 2.1 (Phase B): public documents and endpoints, served from the site root
// ---------------------------------------------------------------------------

export const oauthRouter = Router();

oauthRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (!(req.path.startsWith('/oauth/') || req.path.startsWith('/.well-known/oauth-'))) return next();
  // These carry no cookies; browser-based MCP tools need to read them.
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' });
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

oauthRouter.get('/.well-known/oauth-protected-resource', (req, res) => {
  const base = publicBaseUrl(req);
  res.json({ resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: ['mcp:read'], resource_name: 'AdLens' });
});

oauthRouter.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = publicBaseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:read'],
  });
});

const oauthError = (res: Response, status: number, error: string, description: string) => res.status(status).json({ error, error_description: description });
const clientIp = (req: Request) => req.ip || 'unknown';

oauthRouter.post('/oauth/register', express.json({ limit: '16kb' }), async (req, res) => {
  const limit = await checkRateLimit('oauth-register', clientIp(req), 20, 60 * 60_000);
  if (!limit.allowed) return oauthError(res, 429, 'rate_limited', 'Too many registrations. Try again later.');
  try {
    const client = await registerClient(getMcpStore(), (req.body ?? {}) as Record<string, unknown>);
    res.status(201).json({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  } catch (e) {
    if (e instanceof McpCredentialError) return oauthError(res, 400, e.code === 'invalid_redirect_uri' ? 'invalid_redirect_uri' : 'invalid_client_metadata', e.message);
    return oauthError(res, 500, 'server_error', 'Registration failed.');
  }
});

// The person is sent to AdLens' own consent screen. Invalid client or address: show an error here and never redirect.
oauthRouter.get('/oauth/authorize', async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const clientId = typeof q.client_id === 'string' ? q.client_id : '';
  const redirectUri = typeof q.redirect_uri === 'string' ? q.redirect_uri : '';
  const client = clientId ? await getMcpStore().getClient(clientId).catch(() => null) : null;
  if (!client || !client.redirectUris.includes(redirectUri)) {
    res.status(400).type('text/plain').send('This connection request is not valid: unknown application or redirect address.');
    return;
  }
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', description);
    if (typeof q.state === 'string') u.searchParams.set('state', q.state);
    res.redirect(u.toString());
  };
  if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  if (q.code_challenge_method !== 'S256' || typeof q.code_challenge !== 'string') return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  const target = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, code_challenge: q.code_challenge });
  if (typeof q.state === 'string') target.set('state', q.state.slice(0, 500));
  res.redirect(`/mcp-access/authorize?${target.toString()}`);
});

oauthRouter.post('/oauth/token', express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' }), async (req, res) => {
  const limit = await checkRateLimit('oauth-token', clientIp(req), 60, 60_000);
  if (!limit.allowed) return oauthError(res, 429, 'rate_limited', 'Too many requests.');
  const b = (req.body ?? {}) as Record<string, unknown>;
  try {
    if (b.grant_type === 'authorization_code') {
      return void res.json(await exchangeAuthCode(getMcpStore(), { code: b.code, clientId: b.client_id, redirectUri: b.redirect_uri, codeVerifier: b.code_verifier }));
    }
    if (b.grant_type === 'refresh_token') {
      return void res.json(await refreshTokens(getMcpStore(), { refreshToken: b.refresh_token, clientId: b.client_id }));
    }
    return oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  } catch (e) {
    if (e instanceof McpCredentialError) return oauthError(res, 400, e.code === 'invalid_grant' || e.code === 'invalid_request' ? e.code : 'invalid_request', e.message);
    return oauthError(res, 500, 'server_error', 'Token request failed.');
  }
});

// ---------------------------------------------------------------------------
// Signed-in screens: keys, connected apps, consent  (/api/mcp)
// ---------------------------------------------------------------------------

export const mcpAccountRouter = Router();
mcpAccountRouter.use(requireUser);

interface ProjectOption {
  workspaceId: string;
  projectId: string;
  workspaceName: string;
  name: string;
  domain: string;
}

async function projectsOf(uid: string): Promise<ProjectOption[]> {
  const store = getFirestoreStore();
  const out: ProjectOption[] = [];
  for (const ws of await store.listWorkspacesForUser(uid)) {
    if (!ws.members || !Object.prototype.hasOwnProperty.call(ws.members, uid)) continue;
    // Connecting an AI tool follows the "Use the AI Analyst" permission of the person's role in that workspace.
    if (!can(ws, uid, 'ai.use')) continue;
    for (const p of await store.listProjects(ws.id)) {
      if (p.isDemo) continue;
      out.push({ workspaceId: ws.id, projectId: p.id, workspaceName: ws.name, name: p.name, domain: p.domain });
    }
  }
  return out;
}

/** Keeps only projects the person can really see, so nobody can hand a key to someone else's project. */
async function onlyMine(uid: string, wanted: ProjectAccess[]): Promise<ProjectAccess[]> {
  const mine = await projectsOf(uid);
  return wanted.filter((w) => mine.some((m) => m.workspaceId === w.workspaceId && m.projectId === w.projectId));
}

const fail = (res: Response, e: unknown) => {
  if (e instanceof McpCredentialError) return void res.status(e.status).json({ error: { code: e.code, message: e.message } });
  res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
};

mcpAccountRouter.get('/projects', async (req, res) => {
  res.json({ projects: await projectsOf(req.user!.uid) });
});

mcpAccountRouter.get('/keys', async (req, res) => {
  const keys = await getMcpStore().listKeys(req.user!.uid);
  res.json({
    keys: keys
      .filter((k) => !k.revokedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, projects: k.projects, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
  });
});

/** A person's key allowance is the best one among the workspaces they belong to. */
async function maxKeysFor(uid: string): Promise<number> {
  try {
    const list = await getFirestoreStore().listWorkspacesForUser(uid);
    if (list.length === 0) return getPlanFeatures('free').maxMcpKeys;
    return Math.max(...list.map((w) => getPlanFeatures(w.plan).maxMcpKeys));
  } catch {
    return getPlanFeatures('free').maxMcpKeys;
  }
}

mcpAccountRouter.post('/keys', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; projects?: unknown };
    const projects = await onlyMine(req.user!.uid, cleanProjects(body.projects));
    const { record, secret } = await createAccessKey(getMcpStore(), req.user!.uid, typeof body.name === 'string' ? body.name : '', projects, new Date(), await maxKeysFor(req.user!.uid));
    void recordAudit({ uid: req.user!.uid, action: 'mcp.key_created', detail: record.name });
    res.status(201).json({ key: { id: record.id, name: record.name, prefix: record.prefix, projects: record.projects, createdAt: record.createdAt, lastUsedAt: null }, secret });
  } catch (e) {
    fail(res, e);
  }
});

mcpAccountRouter.delete('/keys/:id', async (req, res) => {
  const ok = await revokeAccessKey(getMcpStore(), req.user!.uid, req.params.id);
  if (!ok) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Key not found.' } });
  void recordAudit({ uid: req.user!.uid, action: 'mcp.key_revoked' });
  res.status(204).end();
});

mcpAccountRouter.get('/apps', async (req, res) => {
  res.json({ apps: await listConnectedApps(getMcpStore(), req.user!.uid) });
});

mcpAccountRouter.delete('/apps/:familyId', async (req, res) => {
  const ok = await revokeConnectedApp(getMcpStore(), req.user!.uid, req.params.familyId);
  if (!ok) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'App not found.' } });
  void recordAudit({ uid: req.user!.uid, action: 'mcp.app_revoked' });
  res.status(204).end();
});

mcpAccountRouter.get('/oauth/authorize-info', async (req, res) => {
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
  const redirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : '';
  const client = clientId ? await getMcpStore().getClient(clientId) : null;
  if (!client || !client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) {
    return void res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'This connection request is not valid.' } });
  }
  res.json({ clientName: client.clientName, redirectHost: new URL(redirectUri).host, projects: await projectsOf(req.user!.uid) });
});

mcpAccountRouter.post('/oauth/approve', async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const clientId = typeof b.client_id === 'string' ? b.client_id : '';
  const redirectUri = typeof b.redirect_uri === 'string' ? b.redirect_uri : '';
  const client = clientId ? await getMcpStore().getClient(clientId) : null;
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return void res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'This connection request is not valid.' } });
  }
  const target = new URL(redirectUri);
  if (typeof b.state === 'string') target.searchParams.set('state', b.state.slice(0, 500));
  if (b.approve !== true) {
    target.searchParams.set('error', 'access_denied');
    return void res.json({ redirect: target.toString() });
  }
  try {
    const projects = await onlyMine(req.user!.uid, cleanProjects(b.projects));
    const code = await createAuthCode(getMcpStore(), { clientId, uid: req.user!.uid, redirectUri, codeChallenge: typeof b.code_challenge === 'string' ? b.code_challenge : '', projects });
    target.searchParams.set('code', code);
    void recordAudit({ uid: req.user!.uid, action: 'mcp.app_approved', detail: client.clientName });
    res.json({ redirect: target.toString() });
  } catch (e) {
    fail(res, e);
  }
});
