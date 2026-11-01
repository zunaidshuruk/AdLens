import { X } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AgentFormValues, AgentOptions, AgentProviderKind, AgentSourceId, AgentTestResult, PublicAgent } from '../types/agents.js';
import { agentReadiness, emptyForm, formFromAgent, formToPayload, PROVIDER_DEFAULTS, PROVIDER_LABEL, toggleInList, validateForm } from '../utils/agentForm.js';

export const SOURCE_LABEL: Record<AgentSourceId, string> = { ga4: 'Google Analytics', search_console: 'Search Console', meta: 'Meta Ads' };
export const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const input = 'block w-full rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px] focus:outline-none focus:ring-2 focus:ring-focus';

function ConsentText({ provider }: { provider: AgentProviderKind }) {
  const where = provider === 'gemini' ? "Google's Gemini service" : provider === 'webhook' ? 'the web address you entered' : 'the API address you entered';
  return (
    <>I understand that when I (or my teammates) ask this agent a question, AdLens sends the question and the report numbers it needs for the selected project and dates to <strong>{where}</strong>. My Google sign-in and raw account data are never sent.</>
  );
}

export function AgentForm(props: {
  initial: AgentFormValues;
  existing: PublicAgent | null;
  options: AgentOptions | null;
  onCancel: () => void;
  onSaved: (agent: PublicAgent, webhookSecret?: string) => void;
}) {
  const { initial, existing, options, onCancel, onSaved } = props;
  const [f, setF] = useState<AgentFormValues>(initial);
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [consent, setConsent] = useState(Boolean(existing?.consentedAt));
  const [pickReports, setPickReports] = useState(initial.allowedReportIds !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AgentFormValues>(k: K, v: AgentFormValues[K]) => setF((cur) => ({ ...cur, [k]: v }));

  const needsKey = f.provider === 'gemini' && !(existing && existing.provider === 'gemini' && existing.hasApiKey);
  const problems = validateForm(f, { needsKey, apiKey });
  const where = (existing?.provider !== f.provider || (existing?.baseUrl ?? '') !== f.baseUrl.trim()) ;
  const consentNeeded = !existing || !existing.consentedAt || where;

  const reports = useMemo(() => (options?.reports ?? []).filter((r) => f.allowedSources.includes(r.source as AgentSourceId) || r.source === 'combined'), [options, f.allowedSources]);

  const changeProvider = (p: AgentProviderKind) => {
    setF((cur) => ({ ...cur, provider: p, model: PROVIDER_DEFAULTS[p].model, baseUrl: PROVIDER_DEFAULTS[p].baseUrl }));
    setApiKey('');
  };

  const submit = async () => {
    if (problems.length > 0) return setError(problems[0]);
    if (consentNeeded && !consent) return setError('Tick the box to confirm what will be sent.');
    setSaving(true);
    setError(null);
    try {
      const agent = formToPayload(f);
      const res = existing
        ? await apiClient.updateAgent(existing.id, {
            agent,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            ...(removeKey ? { removeApiKey: true } : {}),
            ...(consent ? { consent: true } : {}),
          })
        : await apiClient.createAgent({ agent, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), consent: true });
      onSaved(res.agent, res.webhookSecret);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">{existing ? `Edit ${existing.name}` : 'New AI agent'}</h2>
        <button type="button" aria-label="Close" onClick={onCancel} className="p-1 text-fg-muted hover:text-fg"><X className="w-4 h-4" /></button>
      </div>

      <label className="block text-xs text-fg-muted space-y-1"><span>Name</span>
        <input className={input} value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} placeholder="e.g. My ChatGPT analyst" />
      </label>

      <label className="block text-xs text-fg-muted space-y-1"><span>Where does the AI run?</span>
        <select className={input} value={f.provider} onChange={(e) => changeProvider(e.target.value as AgentProviderKind)}>
          {(Object.keys(PROVIDER_LABEL) as AgentProviderKind[]).map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
        </select>
      </label>

      {f.provider !== 'webhook' && (
        <label className="block text-xs text-fg-muted space-y-1"><span>Model name</span>
          <input className={input} value={f.model} maxLength={100} onChange={(e) => set('model', e.target.value)} placeholder={f.provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'} />
        </label>
      )}
      {f.provider !== 'gemini' && (
        <label className="block text-xs text-fg-muted space-y-1"><span>{f.provider === 'webhook' ? 'Webhook address (https://…)' : 'API address (https://…)'}</span>
          <input className={input} value={f.baseUrl} maxLength={500} inputMode="url" onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://" />
        </label>
      )}
      {f.provider !== 'webhook' && (
        <label className="block text-xs text-fg-muted space-y-1">
          <span>API key {existing?.hasApiKey && existing.provider === f.provider ? `(saved ${existing.apiKeyHint ?? ''}; leave empty to keep it)` : f.provider === 'openai-compatible' ? '(optional for local servers)' : ''}</span>
          <input className={input} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={existing?.hasApiKey ? '••••••••' : 'Paste the key'} />
          {existing?.hasApiKey && f.provider === 'openai-compatible' && (
            <span className="flex items-center gap-2 pt-1"><input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} /> Remove the saved key</span>
          )}
          <span className="block text-[11px] text-fg-subtle">Your key is encrypted on our server and never shown again.</span>
        </label>
      )}
      {f.provider === 'webhook' && (
        <p className="text-xs text-fg-muted">AdLens will sign every request so your service can check it. A signing secret is shown once after saving. <Link to="/agents/developers" className="text-accent-text underline">Developer guide</Link></p>
      )}

      <label className="block text-xs text-fg-muted space-y-1"><span>Instructions (optional)</span>
        <textarea className={input} rows={3} maxLength={4000} value={f.systemPrompt} onChange={(e) => set('systemPrompt', e.target.value)} placeholder="e.g. Answer in simple Bangla-English. Always mention the date range." />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-fg">What may this agent look at?</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SOURCE_LABEL) as AgentSourceId[]).map((s) => {
            const on = f.allowedSources.includes(s);
            const connected = options?.sources.find((x) => x.id === s)?.connected;
            return (
              <button key={s} type="button" aria-pressed={on} onClick={() => set('allowedSources', toggleInList(f.allowedSources, s))} className={`text-xs rounded-lg border px-3 py-2 min-h-[36px] ${on ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted hover:bg-fill-2'}`}>
                {SOURCE_LABEL[s]}{connected === false ? ' (not connected here)' : ''}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={pickReports} onChange={(e) => { setPickReports(e.target.checked); set('allowedReportIds', e.target.checked ? reports.map((r) => r.id) : null); }} />
          Choose individual reports (otherwise all reports of the allowed sources)
        </label>
        {pickReports && (
          <ul className="max-h-48 overflow-y-auto rounded-lg border border-line divide-y divide-line">
            {reports.map((r) => (
              <li key={r.id}>
                <label className="flex items-start gap-2 px-3 py-2 text-xs cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={f.allowedReportIds?.includes(r.id) ?? false} onChange={() => set('allowedReportIds', toggleInList(f.allowedReportIds ?? [], r.id))} />
                  <span><span className="font-medium text-fg">{r.title}</span> <span className="text-fg-subtle">({r.id})</span><span className="block text-fg-muted">{r.description.slice(0, 120)}</span></span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <details className="text-xs text-fg-muted">
        <summary className="cursor-pointer text-fg">Advanced</summary>
        <div className="grid gap-3 sm:grid-cols-2 pt-3">
          <label className="space-y-1"><span>Creativity (0 = careful, 1.5 = bold): {f.temperature}</span>
            <input type="range" min={0} max={1.5} step={0.1} value={f.temperature} onChange={(e) => set('temperature', Number(e.target.value))} className="w-full" />
          </label>
          <label className="space-y-1"><span>Most reports it may read per question: {f.maxToolCalls}</span>
            <input type="range" min={1} max={10} step={1} value={f.maxToolCalls} onChange={(e) => set('maxToolCalls', Number(e.target.value))} className="w-full" />
          </label>
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Switched on</label>

      {consentNeeded && (
        <label className="flex items-start gap-2 rounded-lg border border-warning-line bg-warning-soft p-3 text-xs text-fg">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span><ConsentText provider={f.provider} /></span>
        </label>
      )}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-accent text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50">{saving ? 'Saving…' : existing ? 'Save changes' : 'Create agent'}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line text-sm px-4 py-2 min-h-[40px] text-fg hover:bg-fill-2">Cancel</button>
      </div>
    </form>
  );
}
