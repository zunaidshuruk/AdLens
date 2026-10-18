import React from 'react';
import { Globe, Info, Moon, Sun, Wallet } from 'lucide-react';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  THEME_STORAGE_KEY,
  TRACKED_SITE,
} from '../config/app';
import { useAppContext } from '../context/AppContext';
import { SUPPORTED_TIMEZONES } from '../utils/dateUtils';
import { USD_TO_BDT_RATE } from '../utils/formatters';

export const SettingsPage: React.FC = () => {
  const { currency, setCurrency, timezone, setTimezone, theme, setTheme, dateRange } =
    useAppContext();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Workspace Settings
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Configure display currency, reporting timezone, and appearance preferences for {APP_NAME}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Currency Card */}
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Reporting Currency
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Select how monetary metrics (Spend, CPC, CPM, Cost per Lead) are formatted across all charts and tables.
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setCurrency('BDT')}
              className={`px-3.5 py-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                currency === 'BDT'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              ৳ BDT (Bangladeshi Taka)
            </button>
            <button
              type="button"
              onClick={() => setCurrency('USD')}
              className={`px-3.5 py-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                currency === 'USD'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              $ USD (US Dollar)
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
            Reference conversion rate: $1.00 USD = ৳{USD_TO_BDT_RATE} BDT
          </div>
        </div>

        {/* Timezone Card */}
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center gap-2.5">
            <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Reporting Timezone
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Date presets (&ldquo;Today&rdquo;, &ldquo;Last 7 days&rdquo;, etc.) resolve relative to this timezone via{' '}
            <code className="font-mono">Intl.DateTimeFormat</code>.
          </p>

          <div>
            <label htmlFor="adlens-timezone-select" className="sr-only">
              Reporting Timezone
            </label>
            <select
              id="adlens-timezone-select"
              aria-label="Reporting Timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {SUPPORTED_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
            Active window ({timezone}): {dateRange.startDate} to {dateRange.endDate}
          </div>
        </div>

        {/* Theme Appearance Card */}
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center gap-2.5">
            {theme === 'dark' ? (
              <Moon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            ) : (
              <Sun className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            )}
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Interface Theme
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Persisted in localStorage under key <code className="font-mono">{THEME_STORAGE_KEY}</code>.
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                theme === 'light'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Light Mode</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                theme === 'dark'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Dark Mode</span>
            </button>
          </div>
        </div>

        {/* About Card */}
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">About</h2>
            </div>

            <p
              data-testid="about-card-headline"
              className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              {APP_NAME} · Tracked website: {TRACKED_SITE.name} ({TRACKED_SITE.domain})
            </p>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {APP_TAGLINE} — Version {APP_VERSION}. Built on a modular data-adapter architecture unifying Google Analytics 4, Google Search Console, and Meta Ads.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/70 flex items-center justify-between text-[11px] font-mono text-slate-400 dark:text-slate-500">
            <span>Version: {APP_VERSION}</span>
            <span>Property: {TRACKED_SITE.domain}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
