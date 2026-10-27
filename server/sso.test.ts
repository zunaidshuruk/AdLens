import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryAuditStore, setTestAuditStore } from './lib/auditLog.js';
import { setTestSessionRevoker, setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryOrgSsoStore, decideSignIn, domainHasToken, domainOfEmail, isEnterpriseProviderId, isFreeMailDomain, normalizeSsoDomain, setTestOrgSsoStore, verificationHost, verificationValue, type DomainRule } from './lib/orgSso.js';
import { createMemoryStore, setTestSharedStore } from './lib/sharedStore.js';
import { setTestTxtResolver } from './routes/sso.js';

const rule = (over: Partial<DomainRule> = {}): DomainRule => ({ workspaceId: 'w', providerId: 'saml.okta', displayName: 'Acme SSO', enforced: false, requireMfa: false, autoJoin: true, ...over });
const dec = (provider: string | null, r: DomainRule | null, mfa: string | null = null) => decideSignIn({ email: 'a@acme.com', signInProvider: provider, secondFactor: mfa }, r);

test('domain helpers: normalise, reject junk and free mail, read the domain of an email', () => {
  assert.equal(normalizeSsoDomain(' @Acme.COM '), 'acme.com');
  assert.equal(normalizeSsoDomain('localhost'), null);
  assert.equal(normalizeSsoDomain('a b.com'), null);
  assert.equal(normalizeSsoDomain('http://acme.com'), null);
  assert.equal(isFreeMailDomain('Gmail.com'), true);
  assert.equal(isFreeMailDomain('acme.com'), false);
  assert.equal(domainOfEmail('Jo@Sub.Acme.com'), 'sub.acme.com');
  assert.equal(domainOfEmail('nope'), null);
  assert.equal(isEnterpriseProviderId('saml.okta'), true);
  assert.equal(isEnterpriseProviderId('oidc.acme-corp'), true);
  assert.equal(isEnterpriseProviderId('google.com'), false);
  assert.equal(isEnterpriseProviderId('saml.'), false);
});

test('sign-in decisions: provider must match the verified domain; enforcement and MFA apply to everyone else', () => {
  assert.deepEqual(dec('password', null), { allow: true, viaSso: false });
  assert.deepEqual(dec('saml.okta', rule()), { allow: true, viaSso: true });
  const wrong = dec('saml.okta', rule({ providerId: 'saml.other' }));
  assert.equal(wrong.allow === false && wrong.code, 'SSO_DOMAIN_MISMATCH');
  const unknown = dec('oidc.evil', null);
  assert.equal(unknown.allow === false && unknown.code, 'SSO_DOMAIN_MISMATCH', 'an identity provider cannot vouch for a domain it does not own');
  assert.deepEqual(dec('password', rule()), { allow: true, viaSso: false }, 'optional SSO');
  const enforced = dec('google.com', rule({ enforced: true }));
  assert.equal(enforced.allow === false && enforced.code, 'SSO_REQUIRED');
  assert.match(enforced.allow === false ? enforced.message : '', /Acme SSO/);
  assert.equal(dec('password', rule({ requireMfa: true })).allow, false);
  assert.equal(dec('password', rule({ requireMfa: true }), 'totp').allow, true);
  assert.equal(dec('saml.okta', rule({ requireMfa: true, enforced: true })).allow, true, 'the company provider does its own MFA');
});

test('DNS proof: exact record only, errors mean not verified', async () => {
  const host = verificationHost('acme.com');
  assert.equal(host, '_adlens-verify.acme.com');
  const good = async (h: string) => (h === host ? [['adlens-verify=', 'abc123']] : []);
  assert.equal(await domainHasToken('acme.com', 'abc123', good), true, 'long records are split in chunks');
  assert.equal(await domainHasToken('acme.com', 'zzz', good), false);
  assert.equal(await domainHasToken('acme.com', 'abc123', async () => { throw new Error('ENOTFOUND'); }), false);
  assert.equal(verificationValue('t'), 'adlens-verify=t');
});

test('SSO API end to end: configure, prove the domain, enforce safely, block outsiders, join, sign out everywhere', async () => {
  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestOrgSsoStore(createInMemoryOrgSsoStore());
  setTestSharedStore(createMemoryStore());
  const audit = createInMemoryAuditStore();
  setTestAuditStore(audit);
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_owner', email: 'owner@acme.com', displayName: 'Owner' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_emp', email: 'emp@acme.com', displayName: 'Emp' });
  const other = await fs.bootstrapUserAndWorkspace({ uid: 'uid_rival', email: 'boss@rival.com', displayName: 'Rival' });

  let current: { uid: string; email: string; provider: string; second?: string; iat?: number } = { uid: 'uid_owner', email: 'owner@acme.com', provider: 'password' };
  setTestTokenVerifier(async () => ({ uid: current.uid, email: current.email, name: 'n', email_verified: true, iat: current.iat ?? Math.floor(Date.now() / 1000), firebase: { identities: {}, sign_in_provider: current.provider, ...(current.second ? { sign_in_second_factor: current.second } : {}) } }) as never);
  let dnsOk = false;
  let token = '';
  let rivalToken = '';
  setTestTxtResolver(async (host) => (dnsOk ? [[verificationValue(token)], ...(rivalToken ? [[verificationValue(rivalToken)]] : [])] : []));
  const revoked: string[] = [];
  setTestSessionRevoker(async (uid) => { revoked.push(uid); });

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' } });
  const ws = `/api/sso/workspaces/${workspace.id}`;
  try {
    // Only the owner of a workspace manages it.
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'password' };
    assert.equal((await call('GET', ws)).status, 403);
    current = { uid: 'uid_owner', email: 'owner@acme.com', provider: 'password' };

    // Validation
    assert.equal((await call('PUT', ws, { domain: 'gmail.com', providerId: 'saml.okta', displayName: 'X' })).status, 400);
    assert.equal((await call('PUT', ws, { domain: 'acme.com', providerId: 'google.com', displayName: 'X' })).status, 400);
    assert.equal((await call('PUT', ws, { domain: 'acme.com', providerId: 'saml.okta', displayName: '' })).status, 400);

    const put = await call('PUT', ws, { domain: 'acme.com', providerId: 'saml.okta', displayName: 'Acme SSO' });
    assert.equal(put.status, 200);
    const cfg = (await put.json() as { config: { verified: boolean; dnsHost: string; dnsValue: string } }).config;
    assert.equal(cfg.verified, false);
    assert.equal(cfg.dnsHost, '_adlens-verify.acme.com');
    token = cfg.dnsValue.replace('adlens-verify=', '');

    // Not verified yet: the domain does not route anyone, and enforcing is refused.
    let lookup = await (await fetch(`${base}/api/sso/lookup?email=emp@acme.com`)).json() as { sso: unknown };
    assert.equal(lookup.sso, null);
    assert.equal((await call('PUT', `${ws}/enforce`, { enforced: true, requireMfa: false })).status, 409);
    assert.equal((await call('POST', `${ws}/verify`)).status, 422, 'DNS record missing');

    dnsOk = true;
    assert.equal((await call('POST', `${ws}/verify`)).status, 200);
    lookup = await (await fetch(`${base}/api/sso/lookup?email=emp@acme.com`)).json() as { sso: { providerId: string; displayName: string } };
    assert.deepEqual(lookup.sso, { providerId: 'saml.okta', displayName: 'Acme SSO' });
    assert.equal(JSON.stringify(await (await call('GET', ws)).json()).includes('dnsValue'), false, 'the proof is hidden once verified');

    // Another workspace cannot take the same domain.
    current = { uid: 'uid_rival', email: 'boss@rival.com', provider: 'password' };
    const rivalPut = await call('PUT', `/api/sso/workspaces/${other.workspace.id}`, { domain: 'acme.com', providerId: 'saml.rival', displayName: 'Rival' });
    assert.equal((await call('POST', `/api/sso/workspaces/${other.workspace.id}/verify`)).status, 422, 'without the DNS record the rival cannot even try');
    rivalToken = ((await rivalPut.json()) as { config: { dnsValue: string } }).config.dnsValue.replace('adlens-verify=', '');
    assert.equal((await call('POST', `/api/sso/workspaces/${other.workspace.id}/verify`)).status, 409, 'even with a record, the first verified workspace keeps the domain');
    current = { uid: 'uid_owner', email: 'owner@acme.com', provider: 'password' };

    // No self lock-out: enforcing needs a sign-in through the provider.
    const tryEnforce = await call('PUT', `${ws}/enforce`, { enforced: true, requireMfa: false });
    assert.equal(tryEnforce.status, 409);
    assert.equal(((await tryEnforce.json()) as { error: { code: string } }).error.code, 'TEST_FIRST');
    current = { uid: 'uid_owner', email: 'owner@acme.com', provider: 'saml.okta' };
    assert.equal((await call('PUT', `${ws}/enforce`, { enforced: true, requireMfa: false })).status, 200);

    // Staff who sign in with a password are now refused; the same person through the company provider is fine.
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'password' };
    const blocked = await call('GET', '/api/ops/audit');
    assert.equal(blocked.status, 403);
    assert.equal(((await blocked.json()) as { error: { code: string } }).error.code, 'SSO_REQUIRED');
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'saml.okta' };
    assert.equal((await call('GET', '/api/ops/audit')).status, 200);

    // An identity provider cannot vouch for an address on a domain it does not own.
    current = { uid: 'uid_x', email: 'ceo@rival.com', provider: 'saml.okta' };
    const spoof = await call('GET', '/api/ops/audit');
    assert.equal(spoof.status, 403);
    assert.equal(((await spoof.json()) as { error: { code: string } }).error.code, 'SSO_DOMAIN_MISMATCH');
    // Ordinary free-mail people are untouched.
    current = { uid: 'uid_g', email: 'someone@gmail.com', provider: 'password' };
    assert.equal((await call('GET', '/api/ops/audit')).status, 200);

    // Joining the company workspace after signing in through the provider.
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'password' };
    assert.equal((await call('POST', '/api/sso/join')).status, 403, 'enforced: password is refused before anything else');
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'saml.okta' };
    const joined = await (await call('POST', '/api/sso/join')).json() as { joined: boolean; workspaceId: string };
    assert.equal(joined.joined, true);
    assert.equal((await fs.getWorkspace(workspace.id))?.members.uid_emp, 'member');
    assert.equal((await fs.getWorkspace(workspace.id))?.members.uid_owner, 'owner');

    // MFA rule
    current = { uid: 'uid_owner', email: 'owner@acme.com', provider: 'saml.okta' };
    assert.equal((await call('PUT', `${ws}/enforce`, { enforced: false, requireMfa: true })).status, 200);
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'password' };
    assert.equal(((await (await call('GET', '/api/ops/audit')).json()) as { error: { code: string } }).error.code, 'MFA_REQUIRED');
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'password', second: 'totp' };
    assert.equal((await call('GET', '/api/ops/audit')).status, 200);

    // The owner's activity log
    current = { uid: 'uid_owner', email: 'owner@acme.com', provider: 'saml.okta' };
    const log = await (await call('GET', `${ws}/audit`)).json() as { events: { action: string }[] };
    assert.ok(log.events.some((e) => e.action === 'sso.configured') && log.events.some((e) => e.action === 'sso.enforcement_changed'));
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'saml.okta' };
    assert.equal((await call('GET', `${ws}/audit`)).status, 403, 'members cannot read the workspace log');

    // Removing SSO frees the domain and the rules stop applying at once.
    current = { uid: 'uid_owner', email: 'owner@acme.com', provider: 'saml.okta' };
    assert.equal((await call('DELETE', ws)).status, 204);
    lookup = await (await fetch(`${base}/api/sso/lookup?email=emp@acme.com`)).json() as { sso: unknown };
    assert.equal(lookup.sso, null);
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'password' };
    assert.equal((await call('GET', '/api/ops/audit')).status, 200);

    // Sign out everywhere: a token issued before is refused, a newer one works.
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'password', iat: Math.floor(Date.now() / 1000) - 30 };
    assert.equal((await call('POST', '/api/security/sign-out-everywhere')).status, 200);
    assert.deepEqual(revoked, ['uid_emp']);
    assert.equal((await call('GET', '/api/ops/audit')).status, 401);
    current = { uid: 'uid_emp', email: 'emp@acme.com', provider: 'password', iat: Math.floor(Date.now() / 1000) + 2 };
    assert.equal((await call('GET', '/api/ops/audit')).status, 200);
  } finally {
    server.close();
    setTestOrgSsoStore(null);
    setTestSharedStore(null);
    setTestAuditStore(null);
    setTestTxtResolver(undefined);
    setTestSessionRevoker(null);
  }
});

test('the SSO lookup is rate limited', async () => {
  setTestSharedStore(createMemoryStore());
  setTestOrgSsoStore(createInMemoryOrgSsoStore());
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await fetch(`${base}/api/sso/lookup?email=a@acme.com`)).status;
    assert.equal(last, 429);
  } finally {
    server.close();
    setTestOrgSsoStore(null);
    setTestSharedStore(null);
  }
});
