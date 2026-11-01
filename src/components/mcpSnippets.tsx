import { Check, Copy } from 'lucide-react';
import React, { useState } from 'react';

export const MCP_URL = `${typeof window !== 'undefined' ? window.location.origin : 'https://your-adlens-address'}/mcp`;

export function snippets(key: string): { title: string; where: string; code: string }[] {
  return [
    { title: 'Claude Code', where: 'Run this once in your terminal.', code: `claude mcp add --transport http adlens ${MCP_URL} --header "Authorization: Bearer ${key}"` },
    { title: 'Cursor', where: 'Add to .cursor/mcp.json', code: JSON.stringify({ mcpServers: { adlens: { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
    { title: 'Codex CLI', where: 'Add to ~/.codex/config.toml', code: `[mcp_servers.adlens]\nurl = "${MCP_URL}"\nbearer_token_env_var = "ADLENS_KEY"\n# then: export ADLENS_KEY=${key}` },
    { title: 'Gemini CLI', where: 'Add to ~/.gemini/settings.json', code: JSON.stringify({ mcpServers: { adlens: { httpUrl: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
  ];
}

export function CopyButton({ text, label }: { text: string; label: string }) {
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

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'never');
