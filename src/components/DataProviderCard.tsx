import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type CustomEndpointInfo, type DataProviderInput, type DataProviderStatus } from '../api/client';

const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const EXAMPLES: Record<'keywordMetrics' | 'competitorKeywords' | 'backlinks', CustomEndpointInfo> = {
  keywordMetrics: { method: 'POST', url: 'https://api.example.com/v1/keywords', body: '{"keywords":"{{keywords}}","country":"{{country}}"}', itemsPath: 'data.rows', fields: { keyword: 'term', volume: 'searches', cpc: 'cpc', difficulty: 'difficulty', competition: '' } },
  competitorKeywords: { method: 'GET', url: 'https://api.example.com/v1/ranked?domain={{domain}}&country={{country}}', itemsPath: 'data.items', fields: { keyword: 'keyword', position: 'position', volume: 'volume', url: 'url' } },
  backlinks: { method: 'GET', url: 'https://api.example.com/v1/backlinks?domain={{domain}}', itemsPath: 'data', fields: { referringDomains: 'referring_domains', backlinks: 'backlinks', authority: 'authority' } },
};
const LABEL = { keywordMetrics: 'Keyword numbers (volume, cost, difficulty)', competitorKeywords: 'Keywords a website ranks for', backlinks: 'Backlink numbers' } as const;
type Slot = keyof typeof EXAMPLES;

/** Settings → Workspace: connect your own market-data provider for search volume, cost per click, difficulty, competitor keywords and backlinks. */
export const DataProviderCard: React.FC = () => {
  const [state, setState] = useState<{ provider: DataProviderStatus | null; canEdit: boolean; vaultReady: boolean } | null>(null);
  const [kind, setKind] = useState<'dataforseo' | 'custom'>('dataforseo');
  const [login, setLogin] = useState(''); const [password, setPassword] = useState('');
  const [name, setName] = useState(''); const [authType, setAuthType] = useState<'none' | 'bearer' | 'header' | 'basic'>('bearer');
  const [headerName, setHeaderName] = useState(''); const [secret, setSecret] = useState(''); const [username, setUsername] = useState('');
  const [json, setJson] = useState<Record<Slot, string>>({ keywordMetrics: '', competitorKeywords: '', backlinks: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ name: string; ok: boolean; message: string }[] | null>(null);

  const apply = (p: DataProviderStatus | null) => {
    if (!p) return;
    setKind(p.kind);
    if (p.config) {
      setName(p.config.name); setAuthType(p.config.auth.type); setHeaderName(p.config.auth.headerName ?? '');
      setJson({ keywordMetrics: p.config.keywordMetrics ? JSON.stringify(p.config.keywordMetrics, null, 2) : '', competitorKeywords: p.config.competitorKeywords ? JSON.stringify(p.config.competitorKeywords, null, 2) : '', backlinks: p.config.backlinks ? JSON.stringify(p.config.backlinks, null, 2) : '' });
    }
  };
  const load = useCallback(async () => { try { const s = await apiClient.dataProviderGet(); setState(s); apply(s.provider); } catch { /* card stays hidden */ } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!state) return null;
  const locked = !state.canEdit || !state.vaultReady;

  const build = (enabled: boolean): DataProviderInput => {
    if (kind === 'dataforseo') return { kind, enabled, ...(login || password ? { credentials: { login, password } } : {}) };
    const cfg: Record<string, unknown> = { name, auth: { type: authType, ...(authType === 'header' ? { headerName } : {}) } };
    for (const slot of Object.keys(EXAMPLES) as Slot[]) {
      if (!json[slot].trim()) continue;
      try { cfg[slot] = JSON.parse(json[slot]); } catch { throw new Error(`"${LABEL[slot]}": this is not valid JSON. Check the brackets and quotes.`); }
    }
    return { kind, enabled, config: cfg as never, ...(secret || username ? { credentials: { secret, ...(username ? { username } : {}) } } : {}) };
  };
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(null); setNote(null);
    try { const m = await fn(); if (m) setNote(m); await load(); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); }
  };
  const save = (enabled = true) => run(async () => { await apiClient.dataProviderSave(build(enabled)); setPassword(''); setSecret(''); setChecks(null); return enabled ? 'Saved. Press "Test connection" to check it works.' : 'Turned off. Your details are kept.'; });
  const test = () => run(async () => { const r = await apiClient.dataProviderTest(); setChecks(r.checks); return r.ok ? 'Connected. At least one lookup works.' : 'Nothing worked yet. See the messages below.'; });
  const p = state.provider;

  return (
    <section data-testid="data-provider-card" className="rounded-2xl border border-line bg-surface p-4 sm:p-5 space-y-3">
      <div><h2 className="text-base font-semibold text-fg">Market data provider</h2>
        <p className="text-xs text-fg-muted">Connect your own account with a data provider to see search volume, cost per click, keyword difficulty, the keywords other websites rank for, and backlink numbers. You pay the provider directly for what you use. We keep your sign-in details encrypted, never show them again, and remember each lookup for a day so repeats cost nothing. We stop at 300 lookups a day per workspace as a safety limit.</p></div>
      {!state.vaultReady && <p role="status" className="text-xs text-warning">Secure storage is not set up on this server yet, so a provider cannot be connected.</p>}
      {state.vaultReady && !state.canEdit && <p className="text-xs text-fg-muted">Only owners and admins can change this.</p>}
      <p className="text-sm text-fg">{p ? <><span className={p.enabled ? 'text-success font-medium' : 'text-fg-muted font-medium'}>{p.enabled ? 'Connected' : 'Turned off'}</span>{p.kind === 'custom' && p.config ? `: ${p.config.name}` : ': DataForSEO'}{p.lastTestedAt ? <span className="text-xs text-fg-muted"> · tested {new Date(p.lastTestedAt).toLocaleDateString()} ({p.lastTestOk ? 'worked' : 'did not work'})</span> : <span className="text-xs text-fg-muted"> · not tested yet</span>}</> : <span className="text-fg-muted">Not connected.</span>}</p>
      <div className="flex gap-2" role="radiogroup" aria-label="Provider">
        {([['dataforseo', 'DataForSEO'], ['custom', 'Another provider (custom)']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={locked} onClick={() => setKind(k)} className={`rounded-full border px-4 py-1.5 text-sm ${kind === k ? 'border-accent bg-accent-soft text-accent-text font-medium' : 'border-line text-fg-muted hover:text-fg'}`}>{l}</button>)}
      </div>
      {kind === 'dataforseo' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="text-xs text-fg-muted sm:col-span-2">In your DataForSEO account, open the API access page and copy your API login and API password (they are not the same as your website password). Pay as you go, no monthly fee. Backlink lookups need DataForSEO's separate Backlinks subscription.</p>
          <label className="text-xs font-medium text-fg block">API login<input className={`${field} block w-full mt-1`} disabled={locked} autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} placeholder={p?.hasSecret && p.kind === 'dataforseo' ? 'Saved (leave empty to keep)' : 'login'} /></label>
          <label className="text-xs font-medium text-fg block">API password<input type="password" className={`${field} block w-full mt-1`} disabled={locked} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={p?.hasSecret && p.kind === 'dataforseo' ? 'Saved (leave empty to keep)' : 'password'} /></label>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-fg-muted">Use any provider that has a web API (HTTPS, JSON replies). Say how to sign in, then describe each lookup you want: the address, and where in the reply each number sits. Use {'{{keywords}}'}, {'{{keyword}}'}, {'{{domain}}'}, {'{{country}}'} (like us), {'{{location_code}}'} where the provider needs them. Leave a lookup empty if the provider does not offer it. Your provider's documentation shows the reply format.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-fg block">Name<input className={`${field} block w-full mt-1`} disabled={locked} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="My SEO data API" /></label>
            <label className="text-xs font-medium text-fg block">How it signs you in<select className={`${field} block w-full mt-1`} disabled={locked} value={authType} onChange={(e) => setAuthType(e.target.value as typeof authType)}><option value="bearer">Key sent as "Bearer" token</option><option value="header">Key sent in a header I name</option><option value="basic">Username and password</option><option value="none">No sign-in</option></select></label>
            {authType === 'header' && <label className="text-xs font-medium text-fg block">Header name<input className={`${field} block w-full mt-1`} disabled={locked} value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-Api-Key" /></label>}
            {authType === 'basic' && <label className="text-xs font-medium text-fg block">Username<input className={`${field} block w-full mt-1`} disabled={locked} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></label>}
            {authType !== 'none' && <label className="text-xs font-medium text-fg block">{authType === 'basic' ? 'Password' : 'Key'}<input type="password" className={`${field} block w-full mt-1`} disabled={locked} autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={p?.hasSecret && p.kind === 'custom' ? 'Saved (leave empty to keep)' : ''} /></label>}
          </div>
          {(Object.keys(EXAMPLES) as Slot[]).map((slot) => (
            <label key={slot} className="text-xs font-medium text-fg block">{LABEL[slot]}
              <textarea className={`${field} block w-full min-h-[110px] mt-1 font-mono text-xs`} disabled={locked} spellCheck={false} value={json[slot]} onChange={(e) => setJson({ ...json, [slot]: e.target.value })} placeholder="Leave empty if not used" />
              {!locked && !json[slot] && <button type="button" className="mt-1 text-xs underline text-accent-text font-normal" onClick={() => setJson({ ...json, [slot]: JSON.stringify(EXAMPLES[slot], null, 2) })}>Fill with an example to edit</button>}
            </label>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {note && <p role="status" className="text-xs text-success">{note}</p>}
      {checks && <ul className="text-xs space-y-0.5">{checks.map((c) => <li key={c.name} className={c.ok ? 'text-success' : 'text-fg-muted'}>{c.ok ? 'Works' : 'Not working'} · {c.name}: {c.message}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={locked || busy} onClick={() => void save(true)}>{busy ? 'Working…' : 'Save'}</button>
        <button type="button" className={secondary} disabled={locked || busy || !p} onClick={() => void test()}>Test connection</button>
        {p && p.enabled && <button type="button" className={secondary} disabled={locked || busy} onClick={() => void save(false)}>Turn off</button>}
        {p && <button type="button" className={secondary} disabled={locked || busy} onClick={() => void run(async () => { await apiClient.dataProviderDelete(); setChecks(null); setLogin(''); setPassword(''); return 'Removed. Your details were deleted.'; })}>Remove</button>}
      </div>
    </section>
  );
};
