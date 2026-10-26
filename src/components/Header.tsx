import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronDown, LogOut, Menu, Moon, Search, Settings, Sun, WifiOff, X } from 'lucide-react';
import { APP_NAME, DEMO_PROJECT } from '../config/app';
import { AdLensLogo } from './AdLensLogo';
import { openCommandPalette } from './CommandPalette';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useAvatar } from '../hooks/useAvatar';
import { useConnections } from '../hooks/useConnections';
import { useAdapterStatus } from '../hooks/useReport';
import { DateRangePicker } from './DateRangePicker';

interface HeaderProps {
  onOpenSidebar: () => void;
}

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name || email || 'AD').trim();
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar }) => {
  const navigate = useNavigate();
  const { isMocked } = useAdapterStatus();
  const { googleConnected, connections } = useConnections();
  const { theme, toggleTheme, currency, setCurrency, activeProject, userProfile, isDemoMode } =
    useAppContext();
  const { user, signOut, accountLinkNotice, dismissAccountLinkNotice } = useAuth();
  const { avatarUrl } = useAvatar(userProfile);

  const [menuOpen, setMenuOpen] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const displayName =
    userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'AdLens User';
  const email = user?.email || '';
  const initials = getInitials(displayName, user?.email);

  const projectName = activeProject?.name || DEMO_PROJECT.name;
  const projectDomain = activeProject?.domain || DEMO_PROJECT.domain;
  const isDemo = Boolean(activeProject?.isDemo || isDemoMode);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate('/sign-in', { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-xs border-b border-line px-4 sm:px-6 py-3 space-y-2">
      {isOffline && (
        <div
          role="status"
          data-testid="offline-banner"
          className="flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-lg border border-warning-line bg-warning-soft text-xs font-medium text-warning"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>{"You're offline"}</span>
        </div>
      )}
      {accountLinkNotice && (
        <div
          role="status"
          data-testid="account-linked-toast"
          className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-lg border border-success-line bg-success-soft text-xs text-success"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span>{accountLinkNotice}</span>
          </div>
          <button
            type="button"
            onClick={dismissAccountLinkNotice}
            aria-label="Dismiss account link notice"
            className="p-0.5 rounded hover:bg-fill-2 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Left Zone: Mobile menu button + Property identity + MOCK DATA indicator */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Open navigation menu"
              className="p-2 rounded-lg border border-line text-fg hover:bg-fill-2 md:hidden cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-fg md:hidden">
                <AdLensLogo className="w-5 h-5 shrink-0" />
                <span>{APP_NAME}</span>
              </span>
              <span className="hidden md:inline font-semibold text-fg">
                {projectName}
              </span>
              <span aria-hidden="true" className="text-line-strong">
                ·
              </span>
              <span className="font-mono text-fg-muted">
                {projectDomain}
              </span>
            </div>

            {isMocked && (
              <span
                data-testid="mock-data-badge"
                className="px-2 py-0.5 text-[11px] font-mono font-semibold tracking-wide bg-warning-soft text-warning border border-warning-line rounded-md whitespace-nowrap shrink-0"
              >
                {isDemo ? 'DEMO STORE' : 'MOCK DATA'}
              </span>
            )}

            {googleConnected && (
              <span
                data-testid="header-google-connected"
                className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-success"
              >
                <span>·</span>
                <span>Google: {connections?.google.email || 'Google account'}</span>
              </span>
            )}
          </div>

          {/* Mobile quick controls (Currency & Theme) */}
          <div className="flex items-center gap-1.5 lg:hidden">
            <button
              type="button"
              onClick={() => setCurrency(currency === 'BDT' ? 'USD' : 'BDT')}
              aria-label={`Switch currency (currently ${currency})`}
              className="px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg border border-line bg-fill-1 text-fg cursor-pointer"
            >
              {currency}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className="p-1.5 rounded-lg border border-line bg-fill-1 text-fg cursor-pointer"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Right Zone: Date Range Picker + Compare Toggle + Desktop Currency/Theme + User Menu */}
        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2.5">
          <DateRangePicker />

          <div className="flex items-center gap-2 pl-2 border-l border-line">
            <button
              type="button"
              onClick={openCommandPalette}
              data-testid="header-search-button"
              className="inline-flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-line bg-fill-1 text-fg-muted hover:text-fg hover:bg-fill-2 transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="sr-only sm:not-sr-only">Search</span>
              <kbd className="hidden sm:inline px-1.5 py-0.5 text-[10px] font-mono text-fg-subtle bg-surface border border-line rounded">
                Ctrl K
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => setCurrency(currency === 'BDT' ? 'USD' : 'BDT')}
              aria-label={`Switch currency (currently ${currency})`}
              className="hidden lg:inline-flex px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg border border-line bg-fill-1 text-fg hover:bg-fill-2 transition-colors cursor-pointer"
            >
              {currency === 'BDT' ? '৳ BDT' : '$ USD'}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className="hidden lg:inline-flex p-1.5 rounded-lg border border-line bg-fill-1 text-fg hover:bg-fill-2 transition-colors cursor-pointer"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            {/* User Menu Dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-expanded={menuOpen}
                aria-label="Open user account menu"
                data-testid="header-user-menu-button"
                className="flex items-center gap-2 px-2 py-1 rounded-lg border border-line bg-fill-1 hover:bg-fill-2 transition-colors cursor-pointer"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-accent text-on-accent text-[11px] font-bold flex items-center justify-center shrink-0">
                    {initials}
                  </span>
                )}
                <span className="hidden sm:inline text-xs font-medium text-fg max-w-[120px] truncate">
                  {displayName}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-fg-subtle" />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  data-testid="header-user-menu-dropdown"
                  className="absolute right-0 mt-2 w-60 rounded-xl border border-line bg-surface shadow-lg py-1.5 z-50"
                >
                  <div className="px-3.5 py-2.5 border-b border-line">
                    <div className="text-xs font-semibold text-fg truncate">
                      {displayName}
                    </div>
                    {email && (
                      <div className="text-[11px] font-mono text-fg-muted truncate mt-0.5">
                        {email}
                      </div>
                    )}
                  </div>

                  <div className="py-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate('/settings');
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-fg hover:bg-fill-2 cursor-pointer"
                    >
                      <Settings className="w-3.5 h-3.5 text-fg-subtle" />
                      <span>Settings</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-danger hover:bg-danger-soft cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
