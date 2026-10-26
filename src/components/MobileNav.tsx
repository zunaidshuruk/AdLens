import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Menu, Search, Sparkles, TrendingUp } from 'lucide-react';

interface MobileNavProps {
  onOpenMenu: () => void;
}

interface MobileNavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ga4', label: 'Analytics', icon: TrendingUp },
  { to: '/ai-analyst', label: 'AI Analyst', icon: Sparkles },
  { to: '/search-console', label: 'Search', icon: Search },
];

export const MobileNav: React.FC<MobileNavProps> = ({ onOpenMenu }) => {
  return (
    <nav
      aria-label="Main"
      data-testid="mobile-bottom-nav"
      className="fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex items-stretch justify-around">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative flex-1 min-h-[44px] py-2 flex flex-col items-center justify-center gap-1 transition-colors ${
                  isActive
                    ? 'text-accent-text font-semibold'
                    : 'text-fg-muted hover:text-fg'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-accent"
                    />
                  )}
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] leading-tight">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}

        <button
          type="button"
          onClick={onOpenMenu}
          className="relative flex-1 min-h-[44px] py-2 flex flex-col items-center justify-center gap-1 text-fg-muted hover:text-fg transition-colors cursor-pointer"
        >
          <Menu className="w-4 h-4 shrink-0" />
          <span className="text-[10px] leading-tight">More</span>
        </button>
      </div>
    </nav>
  );
};
