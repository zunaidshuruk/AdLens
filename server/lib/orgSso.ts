/**
 * Enterprise single sign-on rules (Sprint 19).
 *
 * A workspace owner links their company email domain to their company's identity provider (Okta, Microsoft Entra ID,
 * Google Workspace SAML, OneLogin, ...) that has been added in Firebase Authentication with Identity Platform.
 *
 * Security rules, all enforced on the server:
 *  1. A domain only counts after the owner proves they control it with a DNS TXT record (`_adlens-verify.<domain>`).
 *     Without that, anyone could claim someone else's domain and lock their staff out or impersonate them.
 *  2. Free email domains (gmail.com, outlook.com ...) can never be claimed.
 *  3. A SAML or OIDC sign-in is accepted only if the email's domain is verified AND registered to that exact provider.
 *     Otherwise a customer's identity provider could assert someone else's email address and take over their account.
 *  4. "Require SSO" can only be switched on by an owner who is signed in through that provider right now (no self lock-out).
 *  5. Optionally, people on that domain who do not sign in through SSO must have a second factor (MFA).
 */
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { getAdminFirestore } from './firestore.js';
import { getSharedStore, type KeyValueStore } from './sharedStore.js';

export interface OrgSsoConfig {
  workspaceId: string;
  domain: string;
  /** Firebase provider id, e.g. "saml.okta" or "oidc.acme". */
  providerId: string;
  displayName: string;
  verificationToken: string;
  verified: boolean;
  verifiedAt?: string;
  /** People on the domain must use the provider. Only allowed once verified. */
  enforced: boolean;
  /** People on the domain who do not use the provider must have a second factor. */
  requireMfa: boolean;
  /** People who sign in through the provider join the workspace automatically as members. */
  autoJoin: boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface OrgSsoStore {
  getConfig(workspaceId: string): Promise<OrgSsoConfig | null>;
  putConfig(cfg: OrgSsoConfig): Promise<void>;
  deleteConfig(workspaceId: string): Promise<void>;
  /** The workspace that has verified this domain, if any. */
  getClaim(domain: string): Promise<string | null>;
  /** Returns false when another workspace already holds the domain. */
  claimDomain(domain: string, workspaceId: string): Promise<boolean>;
  releaseDomain(domain: string, workspaceId: string): Promise<void>;
}

export function createInMemoryOrgSsoStore(): OrgSsoStore {
  const configs = new Map<string, OrgSsoConfig>();
  const claims = new Map<string, string>();
  return {
    async getConfig(ws) { const c = configs.get(ws); return c ? { ...c } : null; },
    async putConfig(c) { configs.set(c.workspaceId, { ...c }); },
    async deleteConfig(ws) { configs.delete(ws); },
    async getClaim(d) { return claims.get(d) ?? null; },
    async claimDomain(d, ws) { const cur = claims.get(d); if (cur && cur !== ws) return false; claims.set(d, ws); return true; },
    async releaseDomain(d, ws) { if (claims.get(d) === ws) claims.delete(d); },
  };
}

const firestoreOrgSsoStore: OrgSsoStore = {
  async getConfig(ws) { const s = await getAdminFirestore().collection('orgSso').doc(ws).get(); return s.exists ? (s.data() as OrgSsoConfig) : null; },
  async putConfig(c) { await getAdminFirestore().collection('orgSso').doc(c.workspaceId).set(c); },
  async deleteConfig(ws) { await getAdminFirestore().collection('orgSso').doc(ws).delete(); },
  async getClaim(d) { const s = await getAdminFirestore().collection('ssoDomains').doc(d).get(); return s.exists ? String((s.data() as { workspaceId?: string }).workspaceId ?? '') || null : null; },
  async claimDomain(d, ws) {
    const db = getAdminFirestore();
    const ref = db.collection('ssoDomains').doc(d);
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const cur = s.exists ? String((s.data() as { workspaceId?: string }).workspaceId ?? '') : '';
      if (cur && cur !== ws) return false;
      tx.set(ref, { workspaceId: ws, claimedAt: new Date().toISOString() });
      return true;
    });
  },
  async releaseDomain(d, ws) {
    const db = getAdminFirestore();
    const ref = db.collection('ssoDomains').doc(d);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists && (s.data() as { workspaceId?: string }).workspaceId === ws) tx.delete(ref);
    });
  },
};

let override: OrgSsoStore | null = null;
export function setTestOrgSsoStore(s: OrgSsoStore | null): void { override = s; }
export function getOrgSsoStore(): OrgSsoStore { return override ?? firestoreOrgSsoStore; }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'qq.com', '163.com', '126.com', 'fastmail.com',
]);

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL.has(domain.toLowerCase());
}

/** Lower-case host name, or null when it is not a plain domain such as "company.com". */
export function normalizeSsoDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/^@/, '');
  if (!/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}

export function domainOfEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  return at > 0 ? normalizeSsoDomain(email.slice(at + 1)) : null;
}

const PROVIDER_ID = /^(saml|oidc)\.[a-z0-9][a-z0-9._-]{0,59}$/;
export const isEnterpriseProviderId = (id: string): boolean => PROVIDER_ID.test(id);

export function newVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

export const verificationHost = (domain: string) => `_adlens-verify.${domain}`;
export const verificationValue = (token: string) => `adlens-verify=${token}`;

export type TxtResolver = (host: string) => Promise<string[][]>;

export async function domainHasToken(domain: string, token: string, resolve: TxtResolver = (h) => dns.resolveTxt(h)): Promise<boolean> {
  try {
    const records = await resolve(verificationHost(domain));
    const want = verificationValue(token);
    return records.some((chunks) => chunks.join('').trim() === want);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Looking a domain up (cached briefly) and deciding about a sign-in
// ---------------------------------------------------------------------------

const CACHE_MS = 60_000;
const cacheKey = (domain: string) => `sso:dom:${domain}`;

export interface DomainRule {
  workspaceId: string;
  providerId: string;
  displayName: string;
  enforced: boolean;
  requireMfa: boolean;
  autoJoin: boolean;
}

/** The verified rule for an email domain, or null. */
export async function lookupDomainRule(domain: string | null, opts: { store?: OrgSsoStore; cache?: KeyValueStore } = {}): Promise<DomainRule | null> {
  if (!domain || isFreeMailDomain(domain)) return null;
  const cache = opts.cache ?? getSharedStore();
  try {
    const hit = await cache.get(cacheKey(domain));
    if (hit !== null) return hit === '-' ? null : (JSON.parse(hit) as DomainRule);
  } catch { /* fall through to the database */ }
  const store = opts.store ?? getOrgSsoStore();
  const ws = await store.getClaim(domain);
  const cfg = ws ? await store.getConfig(ws) : null;
  const rule: DomainRule | null = cfg && cfg.verified && cfg.domain === domain
    ? { workspaceId: cfg.workspaceId, providerId: cfg.providerId, displayName: cfg.displayName, enforced: cfg.enforced, requireMfa: cfg.requireMfa, autoJoin: cfg.autoJoin }
    : null;
  try { await cache.set(cacheKey(domain), rule ? JSON.stringify(rule) : '-', CACHE_MS); } catch { /* not worth failing */ }
  return rule;
}

export async function forgetDomain(domain: string, cache: KeyValueStore = getSharedStore()): Promise<void> {
  try { await cache.del(cacheKey(domain)); } catch { /* it expires in a minute anyway */ }
}

export type SsoDecision =
  | { allow: true; viaSso: boolean }
  | { allow: false; code: 'SSO_REQUIRED' | 'SSO_DOMAIN_MISMATCH' | 'MFA_REQUIRED'; message: string };

export function decideSignIn(input: { email: string | null; signInProvider: string | null; secondFactor: string | null }, rule: DomainRule | null): SsoDecision {
  const provider = input.signInProvider ?? '';
  const enterprise = /^(saml|oidc)\./.test(provider);
  if (enterprise) {
    if (rule && rule.providerId === provider) return { allow: true, viaSso: true };
    return { allow: false, code: 'SSO_DOMAIN_MISMATCH', message: 'This single sign-on connection is not set up for your email address. Ask your administrator.' };
  }
  if (!rule) return { allow: true, viaSso: false };
  if (rule.enforced) {
    return { allow: false, code: 'SSO_REQUIRED', message: `Your organisation requires you to sign in with ${rule.displayName}. Use "Continue with ${rule.displayName}" on the sign-in page.` };
  }
  if (rule.requireMfa && !input.secondFactor) {
    return { allow: false, code: 'MFA_REQUIRED', message: 'Your organisation requires two-step verification. Turn it on under Settings, Security, then sign in again.' };
  }
  return { allow: true, viaSso: false };
}
