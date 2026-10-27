import { ShieldCheck } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient, type McpProjectOption } from '../api/client';

export const McpAuthorizePage: React.FC = () => {
  const [params] = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const challenge = params.get('code_challenge') ?? '';
  const state = params.get('state') ?? undefined;

  const [info, setInfo] = useState<{ clientName: string; redirectHost: string; projects: McpProjectOption[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clientId || !redirectUri || !challenge) { setError('This connection request is not valid.'); return; }
    apiClient.mcpAuthorizeInfo(clientId, redirectUri).then(setInfo).catch((e) => setError(e instanceof Error ? e.message : 'This connection request is not valid.'));
  }, [clientId, redirectUri, challenge]);

  const keyOf = (p: McpProjectOption) => `${p.workspaceId}/${p.projectId}`;

  const decide = async (approve: boolean) => {
    if (!info) return;
    setBusy(true);
    try {
      const projects = info.projects.filter((p) => picked.has(keyOf(p))).map((p) => ({ workspaceId: p.workspaceId, projectId: p.projectId }));
      const r = await apiClient.mcpApprove({ client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, state, approve, projects });
      window.location.assign(r.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-page text-fg flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5 space-y-4">
        <h1 className="text-lg font-semibold text-fg flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Allow access to AdLens?</h1>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {info && (
          <>
            <p className="text-sm text-fg"><strong>{info.clientName}</strong> wants to read your AdLens reports. It will be sent back to <span className="font-mono text-xs">{info.redirectHost}</span>. Only continue if you started this.</p>
            <p className="text-xs text-fg-muted">It can only read, never change or delete anything. You can disconnect it any time under Connect AI tools.</p>
            <fieldset className="space-y-1">
              <legend className="text-xs text-fg-muted">Projects it may read</legend>
              {info.projects.length === 0 && <p className="text-xs text-fg-muted">You have no projects to share.</p>}
              {info.projects.map((p) => (
                <label key={keyOf(p)} className="flex items-center gap-2 text-sm text-fg min-h-[36px]">
                  <input type="checkbox" checked={picked.has(keyOf(p))} onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(keyOf(p)); else n.delete(keyOf(p)); return n; })} />
                  {p.name} <span className="text-xs text-fg-muted">{p.domain}</span>
                </label>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <button type="button" disabled={busy || picked.size === 0} onClick={() => void decide(true)} className="flex-1 rounded-lg bg-accent text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50">Approve</button>
              <button type="button" disabled={busy} onClick={() => void decide(false)} className="flex-1 rounded-lg border border-line text-fg text-sm px-4 py-2 min-h-[40px]">Deny</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
