import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AgentsPage } from './AgentsPage';
import { McpAccessPage } from './McpAccessPage';

const TABS = [
  { key: 'agents', label: 'Your AI agents', hint: 'Chat with your data using your own AI account' },
  { key: 'tools', label: 'Connect outside AI tools', hint: 'Let Claude, Cursor, Codex or Gemini read your numbers' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** One page for everything AI: agents that answer questions inside AdLens, and keys that let outside AI apps read your numbers. */
export const AiHubPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'tools' ? 'tools' : 'agents';
  const go = (key: TabKey) => { const next = new URLSearchParams(params); if (key === 'agents') next.delete('tab'); else next.set('tab', key); setParams(next, { replace: true }); };
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">AI agents and tools</h1>
        <p className="text-xs sm:text-sm text-fg-muted">Set up the AI that works inside AdLens, and connect outside AI apps to your numbers. Everything is read-only and uses your own accounts.</p>
      </div>
      <div role="tablist" aria-label="AI agents and tools" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} role="tab" id={`ai-tab-${t.key}`} aria-controls={`ai-panel-${t.key}`} type="button" aria-selected={tab === t.key} title={t.hint} onClick={() => go(t.key)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t.key ? 'border-accent text-accent-text font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`ai-panel-${tab}`} aria-labelledby={`ai-tab-${tab}`}>
        {tab === 'agents' ? <AgentsPage embedded /> : <McpAccessPage embedded />}
      </div>
    </div>
  );
};
