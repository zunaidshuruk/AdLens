import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import {
  type Command,
  matchRanges,
  moveSelection,
  rankCommands,
} from '../utils/commandPalette.js';

export const OPEN_PALETTE_EVENT = 'adlens:open-palette';
export const RECENT_COMMANDS_STORAGE_KEY = 'adlens_recent_commands';
const MAX_RECENT_COMMANDS = 5;

export function openCommandPalette(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
  }
}

export function readRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT_COMMANDS);
  } catch {
    return [];
  }
}

export function recordRecentCommand(commandId: string): string[] {
  const existing = readRecentCommands().filter((id) => id !== commandId);
  const updated = [commandId, ...existing].slice(0, MAX_RECENT_COMMANDS);
  try {
    localStorage.setItem(RECENT_COMMANDS_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage blocked; ignore
  }
  return updated;
}

interface ActionCommand extends Command {
  run: () => void;
}

function renderHighlightedLabel(label: string, query: string): React.ReactNode {
  const ranges = matchRanges(label, query);
  if (ranges.length === 0) return label;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) {
      parts.push(<span key={`t-${index}`}>{label.slice(cursor, start)}</span>);
    }
    parts.push(
      <strong key={`m-${index}`} className="font-bold text-fg">
        {label.slice(start, end)}
      </strong>
    );
    cursor = end;
  });
  if (cursor < label.length) {
    parts.push(<span key="tail">{label.slice(cursor)}</span>);
  }
  return parts;
}

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { projects, selectProject, openNewProjectModal } = useAppContext();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentCommands());

  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const openPalette = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    setRecentIds(readRecentCommands());
    setQuery('');
    setSelectedIndex(0);
    setIsOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setIsOpen(false);
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    if (prev && typeof prev.focus === 'function') {
      setTimeout(() => {
        prev.focus();
      }, 0);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (isOpen) {
          closePalette();
        } else {
          openPalette();
        }
        return;
      }
      if (isOpen && event.key === 'Escape') {
        event.preventDefault();
        closePalette();
      }
    };

    const handleCustomOpen = () => {
      openPalette();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, handleCustomOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, handleCustomOpen);
    };
  }, [isOpen, openPalette, closePalette]);

  const commands = useMemo<ActionCommand[]>(() => {
    const navCommands: ActionCommand[] = [
      {
        id: 'nav:overview',
        label: 'Overview',
        group: 'Navigate',
        keywords: ['home', 'dashboard', 'summary', 'kpi'],
        hint: '/',
        run: () => navigate('/'),
      },
      {
        id: 'nav:ga4',
        label: 'Google Analytics 4',
        group: 'Navigate',
        keywords: ['ga4', 'ga', 'analytics', 'traffic', 'sessions', 'users', 'revenue'],
        hint: '/ga4',
        run: () => navigate('/ga4'),
      },
      {
        id: 'nav:ai-traffic',
        label: 'AI Traffic',
        group: 'Navigate',
        keywords: ['ai', 'chatgpt', 'perplexity', 'claude', 'gemini', 'llm', 'referrals'],
        hint: '/ai-traffic',
        run: () => navigate('/ai-traffic'),
      },
      {
        id: 'nav:agents',
        label: 'AI Agents',
        group: 'Navigate',
        keywords: ['agent', 'agents', 'openai', 'chatgpt', 'gemini', 'key', 'webhook', 'byok', 'own ai'],
        hint: '/agents',
        run: () => navigate('/agents'),
      },
      {
        id: 'nav:dashboards',
        label: 'Dashboards',
        group: 'Navigate',
        keywords: ['dashboard', 'dashboards', 'widgets', 'template', 'present', 'screen'],
        hint: '/dashboards',
        run: () => navigate('/dashboards'),
      },
      {
        id: 'nav:alerts',
        label: 'Alerts',
        group: 'Navigate',
        keywords: ['alert', 'alerts', 'notify', 'notification', 'threshold', 'slack', 'webhook', 'email'],
        hint: '/alerts',
        run: () => navigate('/alerts'),
      },
      {
        id: 'nav:explore',
        label: 'Explore (build a report)',
        group: 'Navigate',
        keywords: ['explore', 'custom', 'report', 'builder', 'csv', 'export', 'dimensions', 'metrics'],
        hint: '/explore',
        run: () => navigate('/explore'),
      },
      {
        id: 'nav:mcp-access',
        label: 'Connect AI tools (MCP keys)',
        group: 'Navigate',
        keywords: ['mcp', 'claude', 'cursor', 'codex', 'gemini', 'key', 'api', 'connect', 'agent'],
        hint: '/mcp-access',
        run: () => navigate('/mcp-access'),
      },
      {
        id: 'nav:snapshot',
        label: 'Site snapshot',
        group: 'Navigate',
        keywords: ['overview', 'health', 'summary', 'everything'],
        hint: '/snapshot',
        run: () => navigate('/snapshot'),
      },
      {
        id: 'nav:search-intelligence',
        label: 'Search intelligence',
        group: 'Navigate',
        keywords: ['seo', 'opportunities', 'trending', 'cannibalisation', 'topics', 'sitemaps', 'hosts'],
        hint: '/search-intelligence',
        run: () => navigate('/search-intelligence'),
      },
      {
        id: 'nav:pages',
        label: 'Pages',
        group: 'Navigate',
        keywords: ['page', 'url', 'landing', 'content'],
        hint: '/pages',
        run: () => navigate('/pages'),
      },
      {
        id: 'nav:cross-channel',
        label: 'Ads vs website visits',
        group: 'Navigate',
        keywords: ['meta', 'utm', 'cost per visit', 'campaign', 'landing rate'],
        hint: '/cross-channel',
        run: () => navigate('/cross-channel'),
      },
      {
        id: 'nav:search-console',
        label: 'Search Console',
        group: 'Navigate',
        keywords: ['gsc', 'google search console', 'seo', 'queries', 'clicks', 'impressions'],
        hint: '/search-console',
        run: () => navigate('/search-console'),
      },
      {
        id: 'nav:meta-ads',
        label: 'Meta Ads',
        group: 'Navigate',
        keywords: ['meta', 'facebook', 'instagram', 'ads', 'campaigns', 'roas', 'spend'],
        hint: '/meta-ads',
        run: () => navigate('/meta-ads'),
      },
      {
        id: 'nav:ai-analyst',
        label: 'AI Analyst',
        group: 'Navigate',
        keywords: ['ai', 'analyst', 'ask', 'chat', 'assistant', 'questions'],
        hint: '/ai-analyst',
        run: () => navigate('/ai-analyst'),
      },
      {
        id: 'nav:connections',
        label: 'Connections',
        group: 'Navigate',
        keywords: ['connect', 'integrations', 'oauth', 'google', 'meta', 'accounts'],
        hint: '/connections',
        run: () => navigate('/connections'),
      },
      {
        id: 'nav:settings',
        label: 'Settings',
        group: 'Navigate',
        keywords: ['settings', 'preferences', 'theme', 'appearance', 'currency', 'workspace'],
        hint: '/settings',
        run: () => navigate('/settings'),
      },
    ];

    const projectCommands: ActionCommand[] = projects.map((proj) => ({
      id: `project:${proj.id}`,
      label: `Switch to ${proj.name}`,
      group: 'Project',
      keywords: ['project', 'switch', 'store', proj.name, proj.domain || ''].filter(Boolean),
      hint: proj.domain || 'Project',
      run: () => selectProject(proj.id),
    }));

    const actionCommands: ActionCommand[] = [
      {
        id: 'action:new-project',
        label: 'New project',
        group: 'Actions',
        keywords: ['create', 'add', 'project', 'store', 'new'],
        hint: 'Action',
        run: () => openNewProjectModal(),
      },
    ];

    return [...navCommands, ...projectCommands, ...actionCommands];
  }, [navigate, projects, selectProject, openNewProjectModal]);

  const commandMap = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);

  const ranked = useMemo(
    () => rankCommands(query, commands, { recentIds }),
    [query, commands, recentIds]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const executeCommand = useCallback(
    (cmd: Command) => {
      const action = commandMap.get(cmd.id);
      const updated = recordRecentCommand(cmd.id);
      setRecentIds(updated);
      closePalette();
      action?.run();
    },
    [commandMap, closePalette]
  );

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((curr) => moveSelection(curr, 1, ranked.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((curr) => moveSelection(curr, -1, ranked.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = ranked[selectedIndex];
      if (target) {
        executeCommand(target);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-scrim"
      onClick={closePalette}
      data-testid="command-palette-overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg bg-surface border border-line rounded-xl shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-line">
          <Search className="w-4 h-4 text-fg-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            aria-label="Search pages and projects"
            placeholder="Search pages and projects..."
            className="w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-fg-muted bg-fill-1 border border-line rounded">
            Esc
          </kbd>
        </div>

        <ul
          role="listbox"
          aria-label="Search pages and projects"
          className="max-h-80 overflow-y-auto p-1.5"
        >
          {ranked.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-fg-muted">
              No matches. Try another word.
            </li>
          ) : (
            ranked.map((cmd, index) => {
              const isSelected = index === selectedIndex;
              const showGroupHeading = index === 0 || ranked[index - 1].group !== cmd.group;
              return (
                <React.Fragment key={cmd.id}>
                  {showGroupHeading && (
                    <li
                      role="presentation"
                      className="px-2.5 pt-2 pb-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-subtle select-none"
                    >
                      {cmd.group}
                    </li>
                  )}
                  <li
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => executeCommand(cmd)}
                    className={`flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-accent-soft text-accent-text'
                        : 'text-fg hover:bg-fill-1'
                    }`}
                  >
                    <span className="truncate">
                      {renderHighlightedLabel(cmd.label, query)}
                    </span>
                    {cmd.hint && (
                      <span className="text-[11px] font-mono text-fg-muted shrink-0">
                        {cmd.hint}
                      </span>
                    )}
                  </li>
                </React.Fragment>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
};
