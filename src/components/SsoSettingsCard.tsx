import { Building2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type SsoConfigInfo } from '../api/client';
import { useApp } from '../context/AppContext';
import { auth as firebaseAuth } from '../lib/firebase';

/** Workspace owners: link the company email domain to the company's identity provider. */
export const SsoSettingsCard: React.FC = () => {
  const { activeWorkspace } = useApp();
  const wsId = activeWorkspace?.id ?? '';
  const [cfg, setCfg] = useState<SsoConfigInfo | null>(null);
  const [signedInWith, setSignedInWith] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [providerId, setProviderId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = activeWorkspace?.role === 'owner';

  const load = useCallback(async () => {
    if (!wsId || !owner) return;
    try {
      const r = await apiClient.ssoGet(wsId);
      setCfg(r.config);
      setSignedInWith(r.signedInWith);
      if (r.config) { setDomain(r.config.domain); setProviderId(r.config.providerId); setDisplayName(r.config.displayName); }
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Could not load single sign-on settings.' });
    }
  }, [wsId, owner]);
  useEffect(() => { void load(); }, [load]);

  if (!activeWorkspace || !owner) return null;

  const run = async (fn: () => Promise<{ config: SsoConfigInfo } | void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r && 'config' in r) setCfg(r.config);
      setMsg({ kind: 'ok', text: ok });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  const authDomain = firebaseAuth?.app.options.authDomain ?? 'YOUR-PROJECT.firebaseapp.com';
  const callbackUrl = `https://${authDomain}/__/auth/handler`;
  const field = 'block w-full rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2';
  const viaProvider = cfg ? signedInWith === cfg.providerId : false;

  return (
    <div data-testid="sso-settings-card" className="p-5 rounded-xl border border-line bg-surface space-y-4">
      <div className="flex items-center gap-2.5"><Building2 className="w-4 h-4 text-accent-text" /><h2 className="text-sm font-semibold text-fg">Company single sign-on</h2></div>
      <p className="text-xs text-fg-muted">Let your team sign in with your company account (Okta, Microsoft Entra ID, Google Workspace, OneLogin). Set the connection up first in Firebase Authentication, under Sign-in method, as a SAML or OpenID Connect provider, using this return address: <code className="select-all">{callbackUrl}</code></p>
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`text-xs ${msg.kind === 'error' ? 'text-danger' : 'text-success'}`}>{msg.text}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-fg-muted space-y-1"><span>Company email domain</span><input className={field} value={domain} placeholder="company.com" onChange={(e) => setDomain(e.target.value)} /></label>
        <label className="text-xs text-fg-muted space-y-1"><span>Provider ID from Firebase</span><input className={field} value={providerId} placeholder="saml.okta" onChange={(e) => setProviderId(e.target.value)} /></label>
        <label className="text-xs text-fg-muted space-y-1"><span>Button name</span><input className={field} value={displayName} placeholder="Acme SSO" maxLength={60} onChange={(e) => setDisplayName(e.target.value)} /></label>
      </div>
      <button type="button" disabled={busy || !domain.trim() || !providerId.trim() || !displayName.trim()} onClick={() => void run(() => apiClient.ssoSave(wsId, { domain, providerId, displayName }), 'Saved.')} className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">{cfg ? 'Save changes' : 'Save'}</button>

      {cfg && !cfg.verified && (
        <div className="rounded-lg border border-line bg-fill-1 p-3 space-y-2">
          <p className="text-xs text-fg">Prove you own <strong>{cfg.domain}</strong>. Add this DNS record where your domain is managed:</p>
          <p className="text-xs text-fg-muted">Type <strong>TXT</strong> · Name <code className="select-all">{cfg.dnsHost}</code> · Value <code className="select-all">{cfg.dnsValue}</code></p>
          <p className="text-xs text-fg-muted">It can take a few minutes to appear.</p>
          <button type="button" disabled={busy} onClick={() => void run(() => apiClient.ssoVerify(wsId), 'Domain verified.')} className="rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px]">Check the record</button>
        </div>
      )}

      {cfg?.verified && (
        <div className="rounded-lg border border-line bg-fill-1 p-3 space-y-2">
          <p className="text-xs text-fg">Domain verified. People with an @{cfg.domain} address now see “Continue with {cfg.displayName}” on the sign-in page and join this workspace as members.</p>
          <label className="flex items-start gap-2 text-xs text-fg"><input type="checkbox" className="mt-0.5" disabled={busy} checked={cfg.enforced} onChange={(e) => void run(() => apiClient.ssoEnforce(wsId, { enforced: e.target.checked, requireMfa: cfg.requireMfa }), e.target.checked ? 'Single sign-on is now required.' : 'Single sign-on is optional again.')} /><span>Require single sign-on for everyone with this email domain.{!viaProvider && !cfg.enforced && <span className="text-fg-muted"> To switch this on, sign out and sign in once with “{cfg.displayName}”, then come back here. This makes sure you cannot lock yourself out.</span>}</span></label>
          <label className="flex items-start gap-2 text-xs text-fg"><input type="checkbox" className="mt-0.5" disabled={busy} checked={cfg.requireMfa} onChange={(e) => void run(() => apiClient.ssoEnforce(wsId, { enforced: cfg.enforced, requireMfa: e.target.checked }), e.target.checked ? 'Two-step verification is now required.' : 'Two-step verification is optional again.')} /><span>Require two-step verification for people on this domain who do not sign in through single sign-on.</span></label>
        </div>
      )}

      {cfg && (
        <button type="button" disabled={busy} onClick={() => { if (window.confirm('Remove single sign-on for this workspace? Your team will sign in the usual way.')) void run(async () => { await apiClient.ssoRemove(wsId); setCfg(null); setDomain(''); setProviderId(''); setDisplayName(''); }, 'Single sign-on removed.'); }} className="text-xs text-danger underline min-h-[32px]">Remove single sign-on</button>
      )}
    </div>
  );
};
