import {
  Bell,
  Bot,
  Briefcase,
  Check,
  ChevronDown,
  Compass,
  FileText,
  Gauge,
  Plug,
  GitCompare,
  LifeBuoy,
  Globe,
  LayoutDashboard,
  LayoutGrid,
  SlidersHorizontal,
  Link2,
  Megaphone,
  Plus,
  Search,
  ScanSearch,
  Settings,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE, DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useAdapterStatus } from '../hooks/useReport';
import { useWorkspaceLogo } from '../hooks/useWorkspaceLogo';
import { AdLensLogo } from './AdLensLogo';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/ga4', label: 'Google Analytics 4', icon: TrendingUp },
  { to: '/ai-traffic', label: 'AI Traffic', icon: Sparkles, badge: 'NEW' },
  { to: '/snapshot', label: 'Site snapshot', icon: Gauge },
  { to: '/search-console', label: 'Search Console', icon: Search },
  { to: '/seo', label: 'SEO tools', icon: ScanSearch },
  { to: '/leads', label: 'Leads', icon: Briefcase },
  { to: '/search-intelligence', label: 'Search intelligence', icon: Compass },
  { to: '/pages', label: 'Pages', icon: FileText },
  { to: '/meta-ads', label: 'Meta Ads', icon: Megaphone },
  { to: '/cross-channel', label: 'Ads vs website', icon: GitCompare },
  { to: '/dashboards', label: 'Dashboards', icon: LayoutGrid },
  { to: '/explore', label: 'Explore', icon: SlidersHorizontal },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/ai-analyst', label: 'AI Analyst', icon: Sparkles },
  { to: '/agents', label: 'AI Agents', icon: Bot },
  { to: '/connections', label: 'Connections', icon: Link2 },
  { to: '/mcp-access', label: 'Connect AI tools', icon: Plug },
  { to: '/help', label: 'Help and guide', icon: LifeBuoy },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { isGA4Live, isSearchConsoleLive, isMetaAdsLive } = useAdapterStatus();
  const {
    projects,
    activeProject,
    activeWorkspace,
    isDemoMode,
    selectProject,
    openNewProjectModal,
  } = useAppContext();

  const { logoUrl } = useWorkspaceLogo(activeWorkspace);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    if (switcherOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [switcherOpen]);

  const liveCount = [isGA4Live, isSearchConsoleLive, isMetaAdsLive].filter(Boolean).length;
  const maxProjects = activeWorkspace?.limits?.maxProjects ?? 3;
  const planLimitReached = projects.length >= maxProjects;

  const currentProjectName = activeProject?.name || DEMO_PROJECT.name;
  const currentProjectDomain = activeProject?.domain || DEMO_PROJECT.domain;
  const isCurrentDemo = Boolean(activeProject?.isDemo || isDemoMode || !activeProject);

  const getWorkspaceInitials = (name?: string | null): string => {
    const clean = (name || 'My workspace').trim();
    const words = clean.split(/[\s._-]+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  };

  const getStatusDotClass = (to: string): string | null => {
    if (to === '/ga4' || to === '/ai-traffic') {
      return isGA4Live ? 'bg-success' : 'bg-warning';
    }
    if (to === '/search-console') {
      return isSearchConsoleLive ? 'bg-success' : 'bg-warning';
    }
    if (to === '/meta-ads') {
      return isMetaAdsLive ? 'bg-success' : 'bg-warning';
    }
    if (to === '/connections') {
      return liveCount > 0 ? 'bg-success' : 'bg-warning';
    }
    return null;
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-scrim/50 backdrop-blur-xs md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Primary Navigation"
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-line flex flex-col transition-transform duration-200 ease-in-out md:translate-x-0 md:sticky md:top-0 md:h-screen md:self-start md:shrink-0 md:z-auto ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-line">
          <div className="flex items-center gap-2.5">
            <AdLensLogo className="w-8 h-8 shrink-0" />
            <div>
              <div className="text-base font-bold tracking-tight text-fg leading-none">
                {APP_NAME}
              </div>
              <div className="text-[11px] font-medium text-fg-muted mt-0.5">
                {APP_TAGLINE}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="p-1.5 rounded-lg text-fg-subtle hover:text-fg md:hidden cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Project Switcher */}
        <div className="px-4 py-3 border-b border-line relative" ref={switcherRef}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-fg-subtle">
              Active Project
            </span>
            {isCurrentDemo && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning-line">
                Demo Store
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={activeWorkspace?.name || 'Workspace logo'}
                data-testid="sidebar-workspace-logo"
                className="w-9 h-9 rounded-lg object-contain bg-fill-1 border border-line p-0.5 shrink-0"
              />
            ) : (
              <span
                data-testid="sidebar-workspace-initials"
                className="w-9 h-9 rounded-lg bg-accent-soft border border-accent-line text-accent-text text-xs font-bold flex items-center justify-center shrink-0"
              >
                {getWorkspaceInitials(activeWorkspace?.name)}
              </span>
            )}

            <button
              type="button"
              onClick={() => setSwitcherOpen((prev) => !prev)}
              data-testid="sidebar-project-switcher"
              aria-expanded={switcherOpen}
              aria-label="Switch active project"
              className="min-w-0 flex-1 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-fill-1 hover:bg-fill-2 border border-line text-left transition-colors cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-fg truncate">
                  <Globe className="w-3.5 h-3.5 text-accent-text shrink-0" />
                  <span className="truncate">{currentProjectName}</span>
                </div>
                <div className="text-[11px] font-mono text-fg-muted truncate mt-0.5">
                  {currentProjectDomain}
                </div>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-fg-subtle shrink-0 transition-transform ${
                  switcherOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>

          {switcherOpen && (
            <div
              data-testid="sidebar-project-dropdown"
              className="absolute left-3 right-3 mt-1.5 z-50 rounded-xl bg-surface border border-line shadow-xl py-1.5 overflow-hidden"
            >
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Projects ({projects.length}/{maxProjects})
              </div>

              <div className="max-h-56 overflow-y-auto divide-y divide-line">
                {projects.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-fg-muted">
                    Viewing <span className="font-semibold text-fg">{DEMO_PROJECT.name}</span> ({DEMO_PROJECT.domain})
                  </div>
                ) : (
                  projects.map((proj) => {
                    const isSelected = activeProject?.id === proj.id;
                    return (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() => {
                          selectProject(proj.id);
                          setSwitcherOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-accent-soft text-accent-text'
                            : 'text-fg hover:bg-fill-1'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold truncate">
                            <Globe className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                            <span className="truncate">{proj.name}</span>
                            {proj.isDemo && (
                              <span className="text-[9px] font-semibold px-1 py-0.2 rounded bg-warning-soft text-warning">
                                Demo
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-fg-muted truncate pl-5">
                            {proj.domain || 'No domain'}
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-accent-text shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="border-t border-line mt-1 pt-1 px-1.5">
                <div
                  title={
                    planLimitReached
                      ? `Plan limit reached (${maxProjects} projects max on ${activeWorkspace?.plan || 'beta'} plan)`
                      : 'Create a new project'
                  }
                >
                  <button
                    type="button"
                    disabled={planLimitReached}
                    onClick={() => {
                      setSwitcherOpen(false);
                      openNewProjectModal();
                    }}
                    data-testid="sidebar-new-project-button"
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold text-accent-text hover:bg-accent-soft transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>+ New project</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const statusDotClass = getStatusDotClass(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-soft text-accent-text'
                      : 'text-fg-muted hover:bg-fill-2 hover:text-fg'
                  }`
                }
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  {statusDotClass && (
                    <span
                      className={`w-2 h-2 rounded-full ${statusDotClass}`}
                      title={
                        statusDotClass.includes('emerald')
                          ? 'Live API connected'
                          : 'Using mock data'
                      }
                    />
                  )}
                  {item.badge && (
                    <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-fill-2 text-fg-muted">
                      {item.badge}
                    </span>
                  )}
                </span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer Info */}
        <div className="p-4 border-t border-line text-xs text-fg-muted">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-fg truncate">
              {activeWorkspace?.name || 'My workspace'}
            </span>
            <span className="text-[10px] uppercase font-mono font-semibold px-1.5 py-0.5 rounded bg-fill-2 text-fg-muted">
              {activeWorkspace?.plan || 'beta'}
            </span>
          </div>
          <div className="mt-0.5 font-mono truncate">{currentProjectDomain}</div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px]">
            <span
              className={`w-2 h-2 rounded-full ${
                liveCount > 0 ? 'bg-success' : 'bg-warning'
              }`}
            />
            <span>
              {liveCount > 0
                ? `${liveCount} of 3 live sources active`
                : isCurrentDemo
                ? 'Demo Store active'
                : 'Mock data mode active'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
