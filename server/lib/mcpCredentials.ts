/**
 * Credentials for the MCP endpoint (Sprint 17).
 *
 *  Phase A: personal access keys   "adl_<random>"    a person creates one in AdLens and pastes it into Claude Code, Cursor, Codex or Gemini CLI.
 *  Phase B: OAuth 2.1              "adlo_<random>"   Claude.ai and ChatGPT connectors register themselves (dynamic client registration),
 *                                                    send the person to approve (PKCE, S256 only), then exchange the code for tokens.
 *
 * Only a SHA-256 hash of any secret is stored, so a database leak does not expose working credentials. Everything is read-only,
 * and every credential carries the list of projects it may see (chosen by the person), checked again at every call.
 * Storage is server-only (Firestore rules deny all browser access): mcpKeys, mcpClients, mcpAuthCodes, mcpTokens.
 */
import crypto from 'node:crypto';
import { getAdminFirestore } from './firestore.js';

export interface ProjectAccess {
  workspaceId: string;
  projectId: string;
}

export interface McpKeyRecord {
  id: string;
  uid: string;
  name: string;
  /** First characters of the key, shown so people can tell keys apart. */
  prefix: string;
  hash: string;
  projects: ProjectAccess[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
}

export interface AuthCodeRecord {
  hash: string;
  clientId: string;
  uid: string;
  redirectUri: string;
  codeChallenge: string;
  projects: ProjectAccess[];
  expiresAt: number;
}

export interface McpTokenRecord {
  id: string;
  hash: string;
  kind: 'access' | 'refresh';
  /** All tokens issued from one approval share a family, so reuse of an old refresh token can revoke the lot. */
  familyId: string;
  clientId: string;
  clientName: string;
  uid: string;
  projects: ProjectAccess[];
  createdAt: string;
  expiresAt: number;
  revokedAt: string | null;
  usedAt: string | null;
}

export interface McpStore {
  putKey(rec: McpKeyRecord): Promise<void>;
  getKeyByHash(hash: string): Promise<McpKeyRecord | null>;
  listKeys(uid: string): Promise<McpKeyRecord[]>;
  putClient(rec: OAuthClientRecord): Promise<void>;
  getClient(clientId: string): Promise<OAuthClientRecord | null>;
  putCode(rec: AuthCodeRecord): Promise<void>;
  /** Returns the code and removes it, so it can be used once. */
  takeCode(hash: string): Promise<AuthCodeRecord | null>;
  putToken(rec: McpTokenRecord): Promise<void>;
  getTokenByHash(hash: string): Promise<McpTokenRecord | null>;
  listTokens(uid: string): Promise<McpTokenRecord[]>;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const fs = () => getAdminFirestore();
const firestoreMcpStore: McpStore = {
  async putKey(rec) { await fs().collection('mcpKeys').doc(rec.hash).set(rec); },
  async getKeyByHash(hash) { const s = await fs().collection('mcpKeys').doc(hash).get(); return s.exists ? (s.data() as McpKeyRecord) : null; },
  async listKeys(uid) { const s = await fs().collection('mcpKeys').where('uid', '==', uid).get(); return s.docs.map((d) => d.data() as McpKeyRecord); },
  async putClient(rec) { await fs().collection('mcpClients').doc(rec.clientId).set(rec); },
  async getClient(id) { const s = await fs().collection('mcpClients').doc(id).get(); return s.exists ? (s.data() as OAuthClientRecord) : null; },
  async putCode(rec) { await fs().collection('mcpAuthCodes').doc(rec.hash).set(rec); },
  async takeCode(hash) {
    const ref = fs().collection('mcpAuthCodes').doc(hash);
    return fs().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return null;
      tx.delete(ref);
      return s.data() as AuthCodeRecord;
    });
  },
  async putToken(rec) { await fs().collection('mcpTokens').doc(rec.hash).set(rec); },
  async getTokenByHash(hash) { const s = await fs().collection('mcpTokens').doc(hash).get(); return s.exists ? (s.data() as McpTokenRecord) : null; },
  async listTokens(uid) { const s = await fs().collection('mcpTokens').where('uid', '==', uid).get(); return s.docs.map((d) => d.data() as McpTokenRecord); },
};

export function createInMemoryMcpStore(): McpStore {
  const keys = new Map<string, McpKeyRecord>();
  const clients = new Map<string, OAuthClientRecord>();
  const codes = new Map<string, AuthCodeRecord>();
  const tokens = new Map<string, McpTokenRecord>();
  const c = <T>(v: T | undefined): T | null => (v ? structuredClone(v) : null);
  return {
    async putKey(r) { keys.set(r.hash, structuredClone(r)); },
    async getKeyByHash(h) { return c(keys.get(h)); },
    async listKeys(uid) { return [...keys.values()].filter((k) => k.uid === uid).map((k) => structuredClone(k)); },
    async putClient(r) { clients.set(r.clientId, structuredClone(r)); },
    async getClient(id) { return c(clients.get(id)); },
    async putCode(r) { codes.set(r.hash, structuredClone(r)); },
    async takeCode(h) { const r = codes.get(h); codes.delete(h); return c(r); },
    async putToken(r) { tokens.set(r.hash, structuredClone(r)); },
    async getTokenByHash(h) { return c(tokens.get(h)); },
    async listTokens(uid) { return [...tokens.values()].filter((t) => t.uid === uid).map((t) => structuredClone(t)); },
  };
}

let override: McpStore | null = null;
export function setTestMcpStore(store: McpStore | null): void { override = store; }
export function getMcpStore(): McpStore { return override ?? firestoreMcpStore; }

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export const KEY_PREFIX = 'adl_';
export const OAUTH_TOKEN_PREFIX = 'adlo_';
export const OAUTH_REFRESH_PREFIX = 'adlr_';
export const MAX_KEYS_PER_USER = 10;
export const MAX_PROJECTS_PER_CREDENTIAL = 20;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}
const randomSecret = (prefix: string) => `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
const newId = () => crypto.randomBytes(8).toString('hex');

export class McpCredentialError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export function cleanProjects(input: unknown): ProjectAccess[] {
  if (!Array.isArray(input)) return [];
  const out: ProjectAccess[] = [];
  const seen = new Set<string>();
  for (const p of input) {
    if (!p || typeof p !== 'object') continue;
    const { workspaceId, projectId } = p as Record<string, unknown>;
    if (typeof workspaceId !== 'string' || typeof projectId !== 'string' || !workspaceId || !projectId || workspaceId.length > 100 || projectId.length > 100 || workspaceId.includes('/') || projectId.includes('/')) continue;
    const k = `${workspaceId}/${projectId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ workspaceId, projectId });
  }
  return out.slice(0, MAX_PROJECTS_PER_CREDENTIAL);
}

// ---------------------------------------------------------------------------
// Phase A: access keys
// ---------------------------------------------------------------------------

export async function createAccessKey(store: McpStore, uid: string, name: string, projects: ProjectAccess[], now = new Date()): Promise<{ record: McpKeyRecord; secret: string }> {
  const cleanName = name.trim().slice(0, 60);
  if (!cleanName) throw new McpCredentialError('INVALID_NAME', 'Give the key a name, for example the tool you will use it in.');
  if (projects.length === 0) throw new McpCredentialError('NO_PROJECTS', 'Choose at least one project this key may read.');
  const active = (await store.listKeys(uid)).filter((k) => !k.revokedAt);
  if (active.length >= MAX_KEYS_PER_USER) throw new McpCredentialError('LIMIT_REACHED', `You can have up to ${MAX_KEYS_PER_USER} active keys. Revoke one first.`, 409);
  const secret = randomSecret(KEY_PREFIX);
  const record: McpKeyRecord = { id: newId(), uid, name: cleanName, prefix: secret.slice(0, KEY_PREFIX.length + 4), hash: hashSecret(secret), projects, createdAt: now.toISOString(), lastUsedAt: null, revokedAt: null };
  await store.putKey(record);
  return { record, secret };
}

export async function revokeAccessKey(store: McpStore, uid: string, id: string, now = new Date()): Promise<boolean> {
  const rec = (await store.listKeys(uid)).find((k) => k.id === id);
  if (!rec || rec.revokedAt) return false;
  await store.putKey({ ...rec, revokedAt: now.toISOString() });
  return true;
}

// ---------------------------------------------------------------------------
// Resolving a bearer secret
// ---------------------------------------------------------------------------

export interface McpPrincipal {
  uid: string;
  projects: ProjectAccess[];
  via: 'key' | 'oauth';
  /** Stable id used for rate limits and the audit trail. */
  credentialId: string;
  label: string;
}

export async function resolveBearer(store: McpStore, secret: string, nowMs = Date.now()): Promise<McpPrincipal | null> {
  if (!secret || secret.length > 200) return null;
  const hash = hashSecret(secret);
  if (secret.startsWith(KEY_PREFIX)) {
    const k = await store.getKeyByHash(hash);
    if (!k || k.revokedAt) return null;
    // Record use at most once a minute, so reads stay cheap.
    if (!k.lastUsedAt || nowMs - Date.parse(k.lastUsedAt) > 60_000) await store.putKey({ ...k, lastUsedAt: new Date(nowMs).toISOString() }).catch(() => undefined);
    return { uid: k.uid, projects: k.projects, via: 'key', credentialId: `key:${k.id}`, label: k.name };
  }
  if (secret.startsWith(OAUTH_TOKEN_PREFIX)) {
    const t = await store.getTokenByHash(hash);
    if (!t || t.kind !== 'access' || t.revokedAt || t.expiresAt <= nowMs) return null;
    return { uid: t.uid, projects: t.projects, via: 'oauth', credentialId: `tok:${t.familyId}`, label: t.clientName };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase B: OAuth 2.1 (public clients, PKCE S256)
// ---------------------------------------------------------------------------

/** https anywhere, or http on the loopback address (desktop tools). No fragments, no credentials in the address. */
export function isAllowedRedirectUri(uri: string): boolean {
  if (typeof uri !== 'string' || uri.length > 500) return false;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
}

export async function registerClient(store: McpStore, input: { client_name?: unknown; redirect_uris?: unknown }, now = new Date()): Promise<OAuthClientRecord> {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every(isAllowedRedirectUri)) {
    throw new McpCredentialError('invalid_redirect_uri', 'redirect_uris must be 1 to 10 https addresses (or http on localhost).');
  }
  const name = typeof input.client_name === 'string' ? input.client_name.trim().slice(0, 80) : '';
  const rec: OAuthClientRecord = { clientId: `adlc_${crypto.randomBytes(16).toString('base64url')}`, clientName: name || 'MCP client', redirectUris: [...new Set(uris)], createdAt: now.toISOString() };
  await store.putClient(rec);
  return rec;
}

export function pkceChallengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

const isChallenge = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
const isVerifier = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(s);

export async function createAuthCode(
  store: McpStore,
  p: { clientId: string; uid: string; redirectUri: string; codeChallenge: string; projects: ProjectAccess[] },
  nowMs = Date.now(),
): Promise<string> {
  const client = await store.getClient(p.clientId);
  if (!client || !client.redirectUris.includes(p.redirectUri)) throw new McpCredentialError('invalid_request', 'Unknown application or redirect address.');
  if (!isChallenge(p.codeChallenge)) throw new McpCredentialError('invalid_request', 'A PKCE code_challenge (S256) is required.');
  if (p.projects.length === 0) throw new McpCredentialError('NO_PROJECTS', 'Choose at least one project to share.');
  const code = randomSecret('adlcode_');
  await store.putCode({ hash: hashSecret(code), clientId: p.clientId, uid: p.uid, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge, projects: p.projects, expiresAt: nowMs + AUTH_CODE_TTL_MS });
  return code;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: 'mcp:read';
}

async function issueTokens(store: McpStore, p: { clientId: string; clientName: string; uid: string; projects: ProjectAccess[]; familyId: string }, nowMs: number): Promise<TokenResponse> {
  const access = randomSecret(OAUTH_TOKEN_PREFIX);
  const refresh = randomSecret(OAUTH_REFRESH_PREFIX);
  const base = { familyId: p.familyId, clientId: p.clientId, clientName: p.clientName, uid: p.uid, projects: p.projects, createdAt: new Date(nowMs).toISOString(), revokedAt: null, usedAt: null };
  await store.putToken({ ...base, id: newId(), hash: hashSecret(access), kind: 'access', expiresAt: nowMs + ACCESS_TOKEN_TTL_MS });
  await store.putToken({ ...base, id: newId(), hash: hashSecret(refresh), kind: 'refresh', expiresAt: nowMs + REFRESH_TOKEN_TTL_MS });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: refresh, scope: 'mcp:read' };
}

export async function exchangeAuthCode(store: McpStore, p: { code: unknown; clientId: unknown; redirectUri: unknown; codeVerifier: unknown }, nowMs = Date.now()): Promise<TokenResponse> {
  const bad = (msg: string) => new McpCredentialError('invalid_grant', msg);
  if (typeof p.code !== 'string' || typeof p.clientId !== 'string' || typeof p.redirectUri !== 'string') throw new McpCredentialError('invalid_request', 'code, client_id and redirect_uri are required.');
  if (!isVerifier(p.codeVerifier)) throw new McpCredentialError('invalid_request', 'code_verifier is required.');
  const rec = await store.takeCode(hashSecret(p.code)); // single use, even when the checks below fail
  if (!rec || rec.expiresAt <= nowMs) throw bad('The code is invalid or has expired.');
  if (rec.clientId !== p.clientId || rec.redirectUri !== p.redirectUri) throw bad('The code was issued to a different application or address.');
  const challenge = Buffer.from(pkceChallengeFor(p.codeVerifier));
  const expected = Buffer.from(rec.codeChallenge);
  if (challenge.length !== expected.length || !crypto.timingSafeEqual(challenge, expected)) throw bad('The code_verifier does not match.');
  const client = await store.getClient(rec.clientId);
  return issueTokens(store, { clientId: rec.clientId, clientName: client?.clientName ?? 'MCP client', uid: rec.uid, projects: rec.projects, familyId: newId() }, nowMs);
}

async function revokeFamily(store: McpStore, uid: string, familyId: string, nowMs: number): Promise<void> {
  for (const t of await store.listTokens(uid)) {
    if (t.familyId === familyId && !t.revokedAt) await store.putToken({ ...t, revokedAt: new Date(nowMs).toISOString() });
  }
}

/** Refresh tokens rotate: each one works once. Presenting an already-used one means it leaked, so the whole approval is revoked. */
export async function refreshTokens(store: McpStore, p: { refreshToken: unknown; clientId: unknown }, nowMs = Date.now()): Promise<TokenResponse> {
  if (typeof p.refreshToken !== 'string' || typeof p.clientId !== 'string' || !p.refreshToken.startsWith(OAUTH_REFRESH_PREFIX)) throw new McpCredentialError('invalid_request', 'refresh_token and client_id are required.');
  const t = await store.getTokenByHash(hashSecret(p.refreshToken));
  if (!t || t.kind !== 'refresh' || t.clientId !== p.clientId) throw new McpCredentialError('invalid_grant', 'The refresh token is not valid.');
  if (t.revokedAt || t.expiresAt <= nowMs) throw new McpCredentialError('invalid_grant', 'The refresh token is no longer valid.');
  if (t.usedAt) {
    await revokeFamily(store, t.uid, t.familyId, nowMs);
    throw new McpCredentialError('invalid_grant', 'The refresh token was already used. Approve the connection again.');
  }
  await store.putToken({ ...t, usedAt: new Date(nowMs).toISOString() });
  return issueTokens(store, { clientId: t.clientId, clientName: t.clientName, uid: t.uid, projects: t.projects, familyId: t.familyId }, nowMs);
}

export interface ConnectedApp {
  familyId: string;
  clientName: string;
  connectedAt: string;
  projects: ProjectAccess[];
}

/** One row per approval that still has a live refresh token, for the "connected apps" list. */
export async function listConnectedApps(store: McpStore, uid: string, nowMs = Date.now()): Promise<ConnectedApp[]> {
  const byFamily = new Map<string, ConnectedApp>();
  for (const t of await store.listTokens(uid)) {
    if (t.kind !== 'refresh' || t.revokedAt || t.expiresAt <= nowMs) continue;
    const cur = byFamily.get(t.familyId);
    if (!cur || t.createdAt > cur.connectedAt) byFamily.set(t.familyId, { familyId: t.familyId, clientName: t.clientName, connectedAt: t.createdAt, projects: t.projects });
  }
  return [...byFamily.values()].sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
}

export async function revokeConnectedApp(store: McpStore, uid: string, familyId: string, nowMs = Date.now()): Promise<boolean> {
  const has = (await store.listTokens(uid)).some((t) => t.familyId === familyId && !t.revokedAt);
  if (!has) return false;
  await revokeFamily(store, uid, familyId, nowMs);
  return true;
}
