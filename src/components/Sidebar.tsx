import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Bot,
  Globe,
  LayoutDashboard,
  Megaphone,
  Plug,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { APP_NAME, APP_TAGLINE, TRACKED_SITE } from '../config/app';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ga4', label: 'Google Analytics', icon: BarChart3 },
  { to: '/search-console', label: 'Search Console', icon: Search },
  { to: '/meta-ads', label: 'Meta Ads', icon: Megaphone },
  { to: '/ai-analyst', label: 'AI Analyst', icon: Bot },
  { to: '/connections', label: 'Connections', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({ open, onClose }) => {
  return (
    <>
      {/* Mobile Backdrop */}
      {open && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs md:hidden"
        />
      )}

      <aside
        aria-label="Primary Navigation"
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-transform duration-200 ease-out md:static md:translate-x-0 shrink-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand Header */}
          <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm tracking-tight">
                {APP_NAME.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-none">
                  {APP_NAME}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-none">
                  {APP_TAGLINE}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation menu"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tracked Property Switcher / Display */}
          <div className="px-4 py-3.5 border-b border-slate-200/70 dark:border-slate-800/70">
            <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mb-1">
              Tracked Property
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="truncate">{TRACKED_SITE.name}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono text-slate-500 dark:text-slate-400 font-normal truncate">
                {TRACKED_SITE.domain}
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="font-medium text-slate-700 dark:text-slate-300">{TRACKED_SITE.name} Workspace</div>
          <div className="mt-0.5 font-mono">{TRACKED_SITE.domain}</div>
        </div>
      </aside>
    </>
  );
};
