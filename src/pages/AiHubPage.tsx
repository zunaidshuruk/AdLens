import { Bot, CheckCircle2, Copy, KeyRound, MessageSquare, Plug, Plus, Trash2, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, type McpConnectedApp, type McpKeyInfo, type McpProjectOption } from '../api/client';
import { AgentForm, errMessage, SOURCE_LABEL } from '../components/AgentForm';
import { ErrorState } from '../components/ErrorState';
import { CopyButton, MCP_URL, snippets, when } from '../components/mcpSnippets';
import type { AgentOptions, AgentTestResult, PublicAgent } from '../types/agents.js';
import { agentReadiness, emptyForm, formFromAgent, formToPayload, PROVIDER_LABEL } from '../utils/agentForm.js';

const field = 'block w-full rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2';
const card = 'rounded-xl border border-line bg-surface p-4 space-y-3';
const ghost = 'rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2';
const keyOf = (p: { workspaceId: string; projectId: string }) => `${p.workspaceId}/${p.projectId}`;

type Mode = null | 'inside' | 'outside';

/** One page for every AI connection: AI that answers inside AdLens, and outside AI apps that read your numbers. */
export const AiHubPage: React.FC = () => {
  const [agents, setAgents] = useState<PublicAgent[] | null>(null);
  const [limit, setLimit] = useState(3);
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [projects, setProjects] = useState<McpProjectOption[]>([]);
  const [keys, setKeys] = useState<McpKeyInfo[]>([]);
  const [apps, setApps] = useState<McpConnectedApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [editing, setEditing] = useState<PublicAgent | 'new' | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, AgentTestResult | 'running'>>({});
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<{ secret: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [a, p, k, ap] = await Promise.allSettled([apiClient.listAgents(), apiClient.mcpProjects(), apiClient.mcpListKeys(), apiClient.mcpListApps()]);
    if (a.status === 'fulfilled') { setAgents(a.value.agents); setLimit(a.value.limit); } else { setAgents([]); setError(errMessage(a.reason)); }
    if (p.status === 'fulfilled') setProjects(p.value.projects);
    if (k.status === 'fulfilled') setKeys(k.value.keys);
    if (ap.status === 'fulfilled') setApps(ap.value.apps);
  }, []);
  useEffect(() => { void load(); void apiClient.getAgentOptions().then(setOptions).catch(() => setOptions(null)); }, [load]);

  const label = (p: { workspaceId: string; projectId: string }) => projects.find((x) => keyOf(x) === keyOf(p))?.name ?? 'Unknown project';

  const test = async (a: PublicAgent) => {
    setTests((t) => ({ ...t, [a.id]: 'running' }));
    try { const r = await apiClient.testAgent(a.id); setTests((t) => ({ ...t, [a.id]: r })); }
    catch (e) { setTests((t) => ({ ...t, [a.id]: { ok: false, message: errMessage(e) } })); }
  };
  const removeAgent = async (a: PublicAgent) => {
    if (!window.confirm(`Delete "${a.name}"? Its saved key is erased.`)) return;
    try { await apiClient.deleteAgent(a.id); await load(); } catch (e) { setError(errMessage(e)); }
  };
  const createKey = async () => {
    setBusy(true);
    try {
      const chosen = projects.filter((p) => picked.has(keyOf(p))).map((p) => ({ workspaceId: p.workspaceId, projectId: p.projectId }));
      const r = await apiClient.mcpCreateKey(name.trim(), chosen);
      setCreated({ secret: r.secret, name: r.key.name });
      setName(''); setPicked(new Set()); setMode(null);
      await load();
    } catch (e) { setError(errMessage(e)); } finally { setBusy(false); }
  };

  const choose = (m: Exclude<Mode, null>) => {
    setMode(m);
    setEditing(m === 'inside' ? 'new' : null);
  };
  const closeAll = () => { setMode(null); setEditing(null); };
  const showAgentForm = editing !== null;
  const showKeyForm = mode === 'outside' && !showAgentForm;
  const agentCount = agents?.length ?? 0;
  const empty = agents !== null && agentCount === 0 && keys.length === 0 && apps.length === 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">AI agents and tools</h1>
        <p className="text-xs sm:text-sm text-fg-muted">Connect your own AI to AdLens, in whichever direction you need. It is read-only and uses your own accounts. Your own key means these questions do not use the monthly AI allowance.</p>
      </div>

      {error && <ErrorState title="AI connections" message={error} onRetry={() => void load()} />}

      {!showAgentForm && !showKeyForm && (
        <section aria-labelledby="ai-add" className="space-y-2">
          <h2 id="ai-add" className="text-sm font-semibold text-fg">Connect an AI</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => choose('inside')} disabled={!agents || agentCount >= limit} className="text-left rounded-xl border border-line bg-surface p-4 space-y-1 hover:bg-fill-2 disabled:opacity-50 min-h-[44px]">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg"><MessageSquare className="w-4 h-4" /> Ask questions inside AdLens</span>
              <span className="block text-xs text-fg-muted">Paste your Gemini or ChatGPT key, or your own service, and chat with your data here.{agents ? ` (${agentCount} of ${limit} used)` : ''}</span>
            </button>
            <button type="button" onClick={() => choose('outside')} className="text-left rounded-xl border border-line bg-surface p-4 space-y-1 hover:bg-fill-2 min-h-[44px]">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg"><Plug className="w-4 h-4" /> Use my numbers in another AI app</span>
              <span className="block text-xs text-fg-muted">Let Claude, Cursor, Codex or Gemini read your reports. You choose the projects.</span>
            </button>
          </div>
          <p className="text-xs text-fg-muted">Building something yourself? See the <Link to="/agents/developers" className="text-accent-text underline">developer guide</Link>.</p>
        </section>
      )}

      {secret && (
        <div role="status" className="rounded-xl border border-accent-line bg-accent-soft p-4 space-y-2">
          <p className="text-sm font-semibold text-fg">Your webhook signing secret</p>
          <p className="text-xs text-fg-muted">Copy it now and keep it safe. For security it will not be shown again (you can create a new one later).</p>
          <code className="block break-all rounded-lg bg-surface border border-line p-2 text-xs text-fg">{secret}</code>
          <div className="flex gap-2 items-center">
            <CopyButton text={secret} label="Copy signing secret" />
            <button type="button" onClick={() => setSecret(null)} className={ghost}>I saved it</button>
            <Link to="/agents/developers" className="inline-flex items-center text-xs text-accent-text underline px-2">How to use it</Link>
          </div>
        </div>
      )}

      {created && (
        <section className={card} aria-label="Your new key">
          <h2 className="text-sm font-semibold text-fg">Copy your key now: “{created.name}”</h2>
          <p className="text-xs text-fg-muted">This is the only time it is shown. If you lose it, delete it and make a new one.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-line bg-fill-1 p-2 text-xs text-fg">{created.secret}</code>
            <CopyButton text={created.secret} label="Copy key" />
          </div>
          {snippets(created.secret).map((s) => (
            <div key={s.title} className="space-y-1">
              <div className="flex items-center justify-between"><p className="text-xs font-medium text-fg">{s.title} <span className="text-fg-muted font-normal">· {s.where}</span></p><CopyButton text={s.code} label={`Copy ${s.title} setup`} /></div>
              <pre className="overflow-x-auto rounded-lg border border-line bg-fill-1 p-2 text-[12px] text-fg"><code>{s.code}</code></pre>
            </div>
          ))}
          <p className="text-xs text-fg-muted">Apps that sign in with a web page (such as Claude.ai connectors) only need this address: <code>{MCP_URL}</code>. You approve them on a screen here, with no key.</p>
          <button type="button" onClick={() => setCreated(null)} className="text-xs text-fg-muted underline min-h-[32px]">I have saved it</button>
        </section>
      )}

      {showAgentForm && (
        <AgentForm
          initial={editing === 'new' ? emptyForm() : formFromAgent(editing as PublicAgent)}
          existing={editing === 'new' ? null : (editing as PublicAgent)}
          options={options}
          onCancel={closeAll}
          onSaved={(agent, webhookSecret) => {
            closeAll();
            if (webhookSecret) setSecret(webhookSecret);
            void load();
          }}
        />
      )}

      {showKeyForm && (
        <section className={card} aria-labelledby="mcp-new">
          <h2 id="mcp-new" className="text-sm font-semibold text-fg flex items-center gap-2"><KeyRound className="w-4 h-4" /> Create an access key for another AI app</h2>
          <label className="block text-xs text-fg-muted space-y-1">
            <span>Name (for example, “My laptop”)</span>
            <input className={field} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs text-fg-muted">Projects this key can read</legend>
            {projects.length === 0 && <p className="text-xs text-fg-muted">You have no projects yet.</p>}
            {projects.map((p) => (
              <label key={keyOf(p)} className="flex items-center gap-2 text-sm text-fg min-h-[32px]">
                <input type="checkbox" checked={picked.has(keyOf(p))} onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(keyOf(p)); else n.delete(keyOf(p)); return n; })} />
                {p.name} <span className="text-xs text-fg-muted">{p.domain}</span>
              </label>
            ))}
          </fieldset>
          {keys.length >= 10 && <p className="text-xs text-fg-muted">You can have up to 10 keys. Delete one you no longer use.</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !name.trim() || picked.size === 0 || keys.length >= 10} onClick={() => void createKey()} className="rounded-lg bg-accent text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50">Create key</button>
            <button type="button" onClick={closeAll} className="rounded-lg border border-line text-sm px-4 py-2 min-h-[40px] text-fg hover:bg-fill-2">Cancel</button>
          </div>
        </section>
      )}

      <section aria-labelledby="ai-list" className="space-y-3">
        <h2 id="ai-list" className="text-sm font-semibold text-fg">Your connected AIs</h2>
        {agents === null ? <p className="text-sm text-fg-muted">Loading…</p> : empty ? (
          <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center space-y-2">
            <Bot className="w-6 h-6 mx-auto text-fg-muted" />
            <p className="text-sm font-semibold text-fg">Nothing connected yet</p>
            <p className="text-xs text-fg-muted">Pick one of the two choices above to get started.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {(agents ?? []).map((a) => {
              const ready = agentReadiness(a);
              const t = tests[a.id];
              return (
                <li key={`agent-${a.id}`} className="rounded-xl border border-line bg-surface p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-fg">{a.name} <span className="ml-1 align-middle text-[11px] font-normal rounded-full bg-fill-2 text-fg-muted px-2 py-0.5">Inside AdLens</span></h3>
                      <p className="text-xs text-fg-muted">{PROVIDER_LABEL[a.provider].split(' (')[0]}{a.model ? ` · ${a.model}` : ''} · {a.allowedSources.map((s) => SOURCE_LABEL[s]).join(', ')}{a.hasApiKey ? ` · key ${a.apiKeyHint}` : ''}{a.hasWebhookSecret ? ' · signing secret saved' : ''}</p>
                    </div>
                    <span className={`text-[11px] rounded-full px-2 py-0.5 ${ready.ready ? 'bg-accent-soft text-accent-text' : 'bg-warning-soft text-warning'}`}>{ready.ready ? 'Ready' : ready.reason}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => void test(a)} disabled={t === 'running'} className={`${ghost} disabled:opacity-50`}>{t === 'running' ? 'Testing…' : 'Test connection'}</button>
                    <button type="button" onClick={() => { setMode('inside'); setEditing(a); }} className={ghost}>Edit</button>
                    {a.provider === 'webhook' && (
                      <button type="button" onClick={async () => {
                        if (!window.confirm('Create a new signing secret? The old one stops working immediately.')) return;
                        try {
                          const res = await apiClient.updateAgent(a.id, { agent: formToPayload(formFromAgent(a)), rotateWebhookSecret: true });
                          if (res.webhookSecret) setSecret(res.webhookSecret);
                          await load();
                        } catch (e) { setError(errMessage(e)); }
                      }} className={ghost}>New signing secret</button>
                    )}
                    <button type="button" aria-label={`Delete ${a.name}`} onClick={() => void removeAgent(a)} className="ml-auto p-2 text-fg-muted hover:text-danger"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  {t && t !== 'running' && (
                    <p role="status" className={`flex items-start gap-1.5 text-xs ${t.ok ? 'text-accent-text' : 'text-danger'}`}>
                      {t.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}<span>{t.message}</span>
                    </p>
                  )}
                </li>
              );
            })}
            {keys.map((k) => (
              <li key={`key-${k.id}`} className="rounded-xl border border-line bg-surface p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">{k.name} <span className="font-mono text-xs font-normal text-fg-muted">{k.prefix}…</span> <span className="ml-1 align-middle text-[11px] font-normal rounded-full bg-fill-2 text-fg-muted px-2 py-0.5">Outside app key</span></p>
                  <p className="text-xs text-fg-muted truncate">{k.projects.map(label).join(', ')} · last used {when(k.lastUsedAt)}</p>
                </div>
                <button type="button" aria-label={`Delete key ${k.name}`} onClick={() => { void apiClient.mcpRevokeKey(k.id).then(load).catch((e) => setError(errMessage(e))); }} className="rounded-md border border-line p-2 text-fg-muted hover:text-danger min-h-[36px] min-w-[36px]"><Trash2 className="w-4 h-4" /></button>
              </li>
            ))}
            {apps.map((a) => (
              <li key={`app-${a.familyId}`} className="rounded-xl border border-line bg-surface p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">{a.clientName} <span className="ml-1 align-middle text-[11px] font-normal rounded-full bg-fill-2 text-fg-muted px-2 py-0.5">Outside app</span></p>
                  <p className="text-xs text-fg-muted truncate">{a.projects.map(label).join(', ')} · connected {when(a.connectedAt)}</p>
                </div>
                <button type="button" onClick={() => { void apiClient.mcpRevokeApp(a.familyId).then(load).catch((e) => setError(errMessage(e))); }} className="rounded-md border border-line px-3 text-xs text-fg-muted hover:text-danger min-h-[36px]">Disconnect</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
