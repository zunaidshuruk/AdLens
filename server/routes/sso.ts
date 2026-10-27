import { can } from '../lib/permissions.js';
import { getPlanFeatures } from '../config/plans.js';
import { Router, type Request, type Response } from 'express';
import { listAuditForWorkspace, recordAudit } from '../lib/auditLog.js';
import { revokeUserSessions } from '../lib/firebaseAdmin.js';
import { getFirestoreStore, type WorkspaceDoc } from '../lib/firestore.js';
import {
  domainHasToken, domainOfEmail, forgetDomain, getOrgSsoStore, isEnterpriseProviderId, isFreeMailDomain, lookupDomainRule,
  newVerificationToken, normalizeSsoDomain, verificationHost, verificationValue, type OrgSsoConfig, type TxtResolver,
} from '../lib/orgSso.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { getSharedStore } from '../lib/sharedStore.js';
import { requireUser } from '../middleware/requireUser.js';

export const ssoRouter = Router();
export const securityRouter = Router();

let txtResolverOverride: TxtResolver | undefined;
export function setTestTxtResolver(r: TxtResolver | undefined): void { txtResolverOverride = r; }

const err = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });

// Public. Lets the sign-in page offer "Continue with <company>" after someone types their work email. Only the domain is used,
// and only verified domains answer.
ssoRouter.get('/lookup', async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const limit = await checkRateLimit('sso-lookup', ip, 30, 60_000);
  if (!limit.allowed) return err(res, 429, 'RATE_LIMITED', 'Too many requests. Please wait a moment.');
  const email = typeof req.query.email === 'string' ? req.query.email.slice(0, 254) : '';
  const rule = await lookupDomainRule(domainOfEmail(email)).catch(() => null);
  res.json({ sso: rule ? { providerId: rule.providerId, displayName: rule.displayName } : null });
});

const summary = (c: OrgSsoConfig) => ({
  domain: c.domain,
  providerId: c.providerId,
  displayName: c.displayName,
  verified: c.verified,
  enforced: c.enforced,
  requireMfa: c.requireMfa,
  autoJoin: c.autoJoin,
  // The proof is only needed until the domain is verified.
  ...(c.verified ? {} : { dnsHost: verificationHost(c.domain), dnsValue: verificationValue(c.verificationToken) }),
});

async function ownerOnly(req: Request, res: Response): Promise<WorkspaceDoc | null> {
  const ws = await getFirestoreStore().getWorkspace(String(req.params.wsId || '').trim());
  const role = ws?.members && Object.prototype.hasOwnProperty.call(ws.members, req.user!.uid) ? ws.members[req.user!.uid] : null;
  if (!ws || role !== 'owner') {
    err(res, 403, 'NOT_ALLOWED', 'Only the workspace owner can manage single sign-on.');
    return null;
  }
  return ws;
}

ssoRouter.use(requireUser);

ssoRouter.get('/workspaces/:wsId', async (req: Request, res: Response) => {
  const ws = await ownerOnly(req, res);
  if (!ws) return;
  const cfg = await getOrgSsoStore().getConfig(ws.id);
  res.json({ config: cfg ? summary(cfg) : null, signedInWith: req.user!.signInProvider ?? null });
});

ssoRouter.put('/workspaces/:wsId', async (req: Request, res: Response) => {
  const ws = await ownerOnly(req, res);
  if (!ws) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const domain = typeof b.domain === 'string' ? normalizeSsoDomain(b.domain) : null;
  const providerId = typeof b.providerId === 'string' ? b.providerId.trim() : '';
  const displayName = typeof b.displayName === 'string' ? b.displayName.trim().slice(0, 60) : '';
  if (!domain) return err(res, 400, 'VALIDATION_ERROR', 'Enter your company email domain, for example company.com.');
  if (isFreeMailDomain(domain)) return err(res, 400, 'VALIDATION_ERROR', 'Public email domains such as gmail.com cannot be used for single sign-on.');
  if (!isEnterpriseProviderId(providerId)) return err(res, 400, 'VALIDATION_ERROR', 'The provider ID must look like saml.okta or oidc.mycompany (as shown in Firebase Authentication).');
  if (!displayName) return err(res, 400, 'VALIDATION_ERROR', 'Enter the name people will see on the sign-in button, for example "Acme SSO".');

  const store = getOrgSsoStore();
  const existing = await store.getConfig(ws.id);
  const sameDomain = existing?.domain === domain;
  if (existing && !sameDomain && existing.verified) await store.releaseDomain(existing.domain, ws.id);
  const cfg: OrgSsoConfig = {
    workspaceId: ws.id,
    domain,
    providerId,
    displayName,
    verificationToken: sameDomain ? existing!.verificationToken : newVerificationToken(),
    verified: sameDomain ? existing!.verified : false,
    ...(sameDomain && existing!.verifiedAt ? { verifiedAt: existing!.verifiedAt } : {}),
    // Changing the provider on a live domain would lock people out, so enforcement is switched off until the owner re-enables it.
    enforced: sameDomain && existing!.providerId === providerId ? existing!.enforced : false,
    requireMfa: sameDomain ? existing!.requireMfa : false,
    autoJoin: typeof b.autoJoin === 'boolean' ? b.autoJoin : existing?.autoJoin ?? true,
    updatedBy: req.user!.uid,
    updatedAt: new Date().toISOString(),
  };
  await store.putConfig(cfg);
  if (existing) await forgetDomain(existing.domain);
  await forgetDomain(domain);
  void recordAudit({ uid: req.user!.uid, workspaceId: ws.id, action: 'sso.configured', detail: `${domain} via ${providerId}` });
  res.json({ config: summary(cfg) });
});

ssoRouter.post('/workspaces/:wsId/verify', async (req: Request, res: Response) => {
  const ws = await ownerOnly(req, res);
  if (!ws) return;
  const store = getOrgSsoStore();
  const cfg = await store.getConfig(ws.id);
  if (!cfg) return err(res, 404, 'NOT_FOUND', 'Set up single sign-on first.');
  if (!(await domainHasToken(cfg.domain, cfg.verificationToken, txtResolverOverride))) {
    return err(res, 422, 'DNS_NOT_FOUND', `We could not find the DNS record yet. Add a TXT record named ${verificationHost(cfg.domain)} with the value ${verificationValue(cfg.verificationToken)}, wait a few minutes, then try again.`);
  }
  if (!(await store.claimDomain(cfg.domain, ws.id))) return err(res, 409, 'DOMAIN_ALREADY_CLAIMED', 'Another workspace has already verified this domain. Contact support if this is your domain.');
  const next: OrgSsoConfig = { ...cfg, verified: true, verifiedAt: new Date().toISOString(), updatedBy: req.user!.uid, updatedAt: new Date().toISOString() };
  await store.putConfig(next);
  await forgetDomain(cfg.domain);
  void recordAudit({ uid: req.user!.uid, workspaceId: ws.id, action: 'sso.configured', detail: `${cfg.domain} verified` });
  res.json({ config: summary(next) });
});

ssoRouter.put('/workspaces/:wsId/enforce', async (req: Request, res: Response) => {
  const ws = await ownerOnly(req, res);
  if (!ws) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.enforced !== 'boolean' || typeof b.requireMfa !== 'boolean') return err(res, 400, 'VALIDATION_ERROR', 'Choose whether to require single sign-on and two-step verification.');
  const store = getOrgSsoStore();
  const cfg = await store.getConfig(ws.id);
  if (!cfg || !cfg.verified) return err(res, 409, 'NOT_VERIFIED', 'Verify your domain first.');
  const viaProvider = req.user!.signInProvider === cfg.providerId;
  if (b.enforced && !viaProvider) {
    return err(res, 409, 'TEST_FIRST', `Sign out, then sign in once with "${cfg.displayName}" and come back here. This proves it works, so you cannot lock yourself out.`);
  }
  if (b.requireMfa && !viaProvider && !req.user!.secondFactor) {
    return err(res, 409, 'MFA_FIRST', 'Turn on two-step verification for your own account first (Settings, Security), then sign in again.');
  }
  const next: OrgSsoConfig = { ...cfg, enforced: b.enforced, requireMfa: b.requireMfa, updatedBy: req.user!.uid, updatedAt: new Date().toISOString() };
  await store.putConfig(next);
  await forgetDomain(cfg.domain);
  void recordAudit({ uid: req.user!.uid, workspaceId: ws.id, action: 'sso.enforcement_changed', detail: `sso ${b.enforced ? 'required' : 'optional'}, mfa ${b.requireMfa ? 'required' : 'optional'}` });
  res.json({ config: summary(next) });
});

ssoRouter.delete('/workspaces/:wsId', async (req: Request, res: Response) => {
  const ws = await ownerOnly(req, res);
  if (!ws) return;
  const store = getOrgSsoStore();
  const cfg = await store.getConfig(ws.id);
  if (cfg) {
    await store.releaseDomain(cfg.domain, ws.id);
    await store.deleteConfig(ws.id);
    await forgetDomain(cfg.domain);
    void recordAudit({ uid: req.user!.uid, workspaceId: ws.id, action: 'sso.removed', detail: cfg.domain });
  }
  res.status(204).end();
});

// Just-in-time membership: after someone signs in through their company's provider, they join the company workspace as a member.
ssoRouter.post('/join', async (req: Request, res: Response) => {
  const rule = await lookupDomainRule(domainOfEmail(req.user!.email)).catch(() => null);
  if (!rule || !rule.autoJoin || req.user!.signInProvider !== rule.providerId) {
    res.json({ joined: false });
    return;
  }
  const wsForJoin = await getFirestoreStore().getWorkspace(rule.workspaceId);
  if (wsForJoin && !Object.prototype.hasOwnProperty.call(wsForJoin.members, req.user!.uid) && Object.keys(wsForJoin.members).length >= getPlanFeatures(wsForJoin.plan).maxMembers) {
    return err(res, 403, 'PLAN_MEMBER_LIMIT', `This workspace's plan allows ${getPlanFeatures(wsForJoin.plan).maxMembers} members. Ask the workspace owner to upgrade.`);
  }
  const ok = await getFirestoreStore().addWorkspaceMember(rule.workspaceId, req.user!.uid, 'member');
  res.json({ joined: ok, workspaceId: ok ? rule.workspaceId : null });
});

// Owners and admins see what happened in their workspace.
ssoRouter.get('/workspaces/:wsId/audit', async (req: Request, res: Response) => {
  const ws = await getFirestoreStore().getWorkspace(String(req.params.wsId || '').trim());
  if (!ws || !can(ws, req.user!.uid, 'audit.view')) return err(res, 403, 'NOT_ALLOWED', 'Your role does not allow seeing the activity log.');
  const events = await listAuditForWorkspace(ws.id, 200);
  res.json({ events: events.map((e) => ({ id: e.id, at: e.at, action: e.action, detail: e.detail ?? null, by: e.uid === req.user!.uid ? 'you' : 'a member' })) });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

securityRouter.use(requireUser);

// Signs the person out on every device. Their current token is refused too, so they sign in again here as well.
securityRouter.post('/sign-out-everywhere', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  try {
    await revokeUserSessions(uid);
  } catch {
    return err(res, 502, 'REVOKE_FAILED', 'Could not sign you out everywhere right now. Please try again.');
  }
  // ID tokens already issued stay valid for up to an hour; refuse any issued before now.
  await getSharedStore().set(`sess:revoked:${uid}`, String(Date.now()), 65 * 60 * 1000).catch(() => undefined);
  res.json({ ok: true });
});
