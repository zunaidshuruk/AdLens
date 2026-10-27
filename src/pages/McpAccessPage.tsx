import { Check, Copy, KeyRound, Plug, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type McpConnectedApp, type McpKeyInfo, type McpProjectOption } from '../api/client';

const MCP_URL = `${typeof window !== 'undefined' ? window.location.origin : 'https://your-adlens-address'}/mcp`;

function snippets(key: string): { title: string; where: string; code: string }[] {
  return [
    { title: 'Claude Code', where: 'Run this once in your terminal.', code: `claude mcp add --transport http adlens ${MCP_URL} --header "Authorization: Bearer ${key}"` },
    { title: 'Cursor', where: 'Add to .cursor/mcp.json', code: JSON.stringify({ mcpServers: { adlens: { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
    { title: 'Codex CLI', where: 'Add to ~/.codex/config.toml', code: `[mcp_servers.adlens]\nurl = "${MCP_URL}"\nbearer_token_env_var = "ADLENS_KEY"\n# then: export ADLENS_KEY=${key}` },
    { title: 'Gemini CLI', where: 'Add to ~/.gemini/settings.json', code: JSON.stringify({ mcpServers: { adlens: { httpUrl: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
  ];
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-fg-muted hover:text-fg min-h-[32px]"
    >
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'never');

export const McpAccessPage: React.FC = () => {
  const [projects, setProjects] = useState<McpProjectOption[]>([]);
  const [keys, setKeys] = useState<McpKeyInfo[]>([]);
  const [apps, setApps] = useState<McpConnectedApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<{ secret: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, k, a] = await Promise.all([apiClient.mcpProjects(), apiClient.mcpListKeys(), apiClient.mcpListApps()]);
      setProjects(p.projects);
      setKeys(k.keys);
      setApps(a.apps);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this page.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const keyOf = (p: { workspaceId: string; projectId: string }) => `${p.workspaceId}/${p.projectId}`;
  const label = (p: { workspaceId: string; projectId: string }) => projects.find((x) => keyOf(x) === keyOf(p))?.name ?? 'Unknown project';

  const create = async () => {
    setBusy(true);
    try {
      const chosen = projects.filter((p) => picked.has(keyOf(p))).map((p) => ({ workspaceId: p.workspaceId, projectId: p.projectId }));
      const r = await apiClient.mcpCreateKey(name.trim(), chosen);
      setCreated({ secret: r.secret, name: r.key.name });
      setName('');
      setPicked(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the key.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'block w-full rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2';
  const card = 'rounded-xl border border-line bg-surface p-4 space-y-3';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-fg flex items-center gap-2"><Plug className="w-5 h-5" /> Connect your own AI tools</h1>
        <p className="text-sm text-fg-muted mt-1">Let Claude, Cursor, Codex or Gemini read your AdLens numbers. Access is read-only and limited to the projects you choose. Nothing can be changed or deleted this way.</p>
      </header>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <section className={card} aria-labelledby="mcp-new">
        <h2 id="mcp-new" className="text-sm font-semibold text-fg flex items-center gap-2"><KeyRound className="w-4 h-4" /> Create an access key</h2>
        <label className="block text-xs text-fg-muted space-y-1">
          <span>Name (for example, “My laptop”)</span>
          <input className={field} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="space-y-1">
          <legend className="text-xs text-fg-muted">Projects this key can read</legend>
          {projects.length === 0 && <p className="text-xs text-fg-muted">You have no projects yet.</p>}
          {projects.map((p) => (
            <label key={keyOf(p)} className="flex items-center gap-2 text-sm text-fg min-h-[32px]">
              <input
                type="checkbox"
                checked={picked.has(keyOf(p))}
                onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(keyOf(p)); else n.delete(keyOf(p)); return n; })}
              />
              {p.name} <span className="text-xs text-fg-muted">{p.domain}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" disabled={busy || !name.trim() || picked.size === 0} onClick={() => void create()} className="rounded-lg bg-accent text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50">
          Create key
        </button>
        {keys.length >= 10 && <p className="text-xs text-fg-muted">You can have up to 10 keys. Delete one you no longer use.</p>}
      </section>

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
          <p className="text-xs text-fg-muted">Tools that sign in with a web page (such as Claude.ai connectors) only need this address: <code>{MCP_URL}</code>. You approve them on a screen here, with no key.</p>
          <button type="button" onClick={() => setCreated(null)} className="text-xs text-fg-muted underline min-h-[32px]">I have saved it</button>
        </section>
      )}

      <section className={card} aria-labelledby="mcp-keys">
        <h2 id="mcp-keys" className="text-sm font-semibold text-fg">Your keys</h2>
        {keys.length === 0 ? <p className="text-xs text-fg-muted">No keys yet.</p> : (
          <ul className="divide-y divide-line">
            {keys.map((k) => (
              <li key={k.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg truncate">{k.name} <span className="font-mono text-xs text-fg-muted">{k.prefix}…</span></p>
                  <p className="text-xs text-fg-muted truncate">{k.projects.map(label).join(', ')} · last used {when(k.lastUsedAt)}</p>
                </div>
                <button type="button" aria-label={`Delete key ${k.name}`} onClick={() => { void apiClient.mcpRevokeKey(k.id).then(load).catch((e) => setError(e instanceof Error ? e.message : 'Could not delete.')); }} className="rounded-md border border-line p-2 text-fg-muted hover:text-danger min-h-[36px] min-w-[36px]"><Trash2 className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="mcp-apps">
        <h2 id="mcp-apps" className="text-sm font-semibold text-fg">Apps you approved</h2>
        {apps.length === 0 ? <p className="text-xs text-fg-muted">No apps connected.</p> : (
          <ul className="divide-y divide-line">
            {apps.map((a) => (
              <li key={a.familyId} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg truncate">{a.clientName}</p>
                  <p className="text-xs text-fg-muted truncate">{a.projects.map(label).join(', ')} · connected {when(a.connectedAt)}</p>
                </div>
                <button type="button" onClick={() => { void apiClient.mcpRevokeApp(a.familyId).then(load).catch((e) => setError(e instanceof Error ? e.message : 'Could not disconnect.')); }} className="rounded-md border border-line px-3 text-xs text-fg-muted hover:text-danger min-h-[36px]">Disconnect</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
