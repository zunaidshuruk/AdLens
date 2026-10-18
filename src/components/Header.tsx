import React from 'react';
import { Menu, Moon, Sun } from 'lucide-react';
import { APP_NAME, TRACKED_SITE } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useConnections } from '../hooks/useConnections';
import { useAdapterStatus } from '../hooks/useReport';
import { DateRangePicker } from './DateRangePicker';

interface HeaderProps {
  onOpenSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar }) => {
  const { isMocked } = useAdapterStatus();
  const { googleConnected, connections } = useConnections();
  const { theme, toggleTheme, currency, setCurrency } = useAppContext();

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Left Zone: Mobile menu button + Property identity + MOCK DATA indicator */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Open navigation menu"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-900 dark:text-slate-100 md:hidden">
                {APP_NAME}
              </span>
              <span className="hidden md:inline font-semibold text-slate-900 dark:text-slate-100">
                {TRACKED_SITE.name}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="font-mono text-slate-500 dark:text-slate-400">
                {TRACKED_SITE.domain}
              </span>
            </div>

            {isMocked && (
              <span
                data-testid="mock-data-badge"
                className="px-2 py-0.5 text-[11px] font-mono font-semibold tracking-wide bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-800 rounded-md whitespace-nowrap shrink-0"
              >
                MOCK DATA
              </span>
            )}

            {googleConnected && (
              <span
                data-testid="header-google-connected"
                className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
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
              className="px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {currency}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Right Zone: Date Range Picker + Compare Toggle + Desktop Currency/Theme */}
        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2.5">
          <DateRangePicker />

          <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setCurrency(currency === 'BDT' ? 'USD' : 'BDT')}
              aria-label={`Switch currency (currently ${currency})`}
              className="px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {currency === 'BDT' ? '৳ BDT' : '$ USD'}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
