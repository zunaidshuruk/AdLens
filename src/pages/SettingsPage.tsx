import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Info,
  KeyRound,
  Link2,
  Lock,
  Moon,
  Shield,
  Sun,
  Unlink,
  Wallet,
} from 'lucide-react';
import { PasswordStrengthChecklist } from '../components/PasswordStrengthChecklist';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  THEME_STORAGE_KEY,
  TRACKED_SITE,
} from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { SUPPORTED_TIMEZONES } from '../utils/dateUtils';
import { evaluatePasswordRules } from '../utils/firebaseErrors';
import { USD_TO_BDT_RATE } from '../utils/formatters';

export const SettingsPage: React.FC = () => {
  const { currency, setCurrency, timezone, setTimezone, theme, setTheme, dateRange } =
    useAppContext();
  const {
    user,
    providers,
    changePassword,
    setPasswordForSsoAccount,
    linkGoogleProvider,
    linkMicrosoftProvider,
    unlinkProvider,
  } = useAuth();

  const hasPasswordProvider = providers.includes('password');
  const hasGoogleProvider = providers.includes('google.com');
  const hasMicrosoftProvider = providers.includes('microsoft.com');
  const canUnlink = providers.length > 1;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordBanner, setPasswordBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [providerBusy, setProviderBusy] = useState<string | null>(null);
  const [providerBanner, setProviderBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const passwordRules = evaluatePasswordRules(newPassword);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordBanner(null);

    if (!passwordRules.allValid) {
      setPasswordBanner({
        type: 'error',
        message:
          'New password must be at least 8 characters and include uppercase, lowercase, and a number.',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordBanner({
        type: 'error',
        message: 'New password and confirmation do not match.',
      });
      return;
    }

    setPasswordSaving(true);
    try {
      if (hasPasswordProvider) {
        await changePassword(currentPassword, newPassword);
        setPasswordBanner({
          type: 'success',
          message: 'Your password has been updated.',
        });
      } else {
        await setPasswordForSsoAccount(newPassword);
        setPasswordBanner({
          type: 'success',
          message: 'Password set! You can now sign in with email and password as well as SSO.',
        });
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update password.',
      });
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleLinkProvider = async (target: 'google.com' | 'microsoft.com') => {
    setProviderBanner(null);
    setProviderBusy(target);
    try {
      if (target === 'google.com') {
        await linkGoogleProvider();
        setProviderBanner({
          type: 'success',
          message: 'Google sign-in linked to your AdLens account.',
        });
      } else {
        await linkMicrosoftProvider();
        setProviderBanner({
          type: 'success',
          message: 'Microsoft sign-in linked to your AdLens account.',
        });
      }
    } catch (err) {
      setProviderBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to link sign-in method.',
      });
    } finally {
      setProviderBusy(null);
    }
  };

  const handleUnlinkProvider = async (providerId: string, label: string) => {
    if (!canUnlink) {
      setProviderBanner({
        type: 'error',
        message: 'You cannot remove your last sign-in method.',
      });
      return;
    }

    setProviderBanner(null);
    setProviderBusy(providerId);
    try {
      await unlinkProvider(providerId);
      setProviderBanner({
        type: 'success',
        message: `${label} sign-in has been removed from your account.`,
      });
    } catch (err) {
      setProviderBanner({
        type: 'error',
        message: err instanceof Error ? err.message : `Unable to unlink ${label}.`,
      });
    } finally {
      setProviderBusy(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Workspace Settings
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Configure display currency, reporting timezone, appearance, and account security for{' '}
          {APP_NAME}
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
            Select how monetary metrics (Spend, CPC, CPM, Cost per Lead) are formatted across all
            charts and tables.
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
            Date presets (&ldquo;Today&rdquo;, &ldquo;Last 7 days&rdquo;, etc.) resolve relative to
            this timezone via <code className="font-mono">Intl.DateTimeFormat</code>.
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
            Persisted in localStorage under key <code className="font-mono">{THEME_STORAGE_KEY}</code>
            .
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
              {APP_TAGLINE} — Version {APP_VERSION}. Built on a modular data-adapter architecture
              unifying Google Analytics 4, Google Search Console, and Meta Ads.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/70 flex items-center justify-between text-[11px] font-mono text-slate-400 dark:text-slate-500">
            <span>Version: {APP_VERSION}</span>
            <span>Property: {TRACKED_SITE.domain}</span>
          </div>
        </div>
      </div>

      {/* Security Section */}
      <div
        data-testid="settings-security-section"
        className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-6"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-200/80 dark:border-slate-800 pb-4">
          <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Security &amp; Sign-in Methods
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage your password and linked identity providers for {user?.email || 'your account'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Password Management (Change Password or Set a Password for SSO-only accounts) */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                {hasPasswordProvider ? 'Change password' : 'Set a password'}
              </h3>
            </div>

            {!hasPasswordProvider && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Your account currently signs in via SSO. Set a password to enable direct email and
                password sign-in.
              </p>
            )}

            {passwordBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  passwordBanner.type === 'success'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
                }`}
              >
                {passwordBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                )}
                <span>{passwordBanner.message}</span>
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-3">
              {hasPasswordProvider && (
                <div className="space-y-1">
                  <label
                    htmlFor="security-current-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Current password
                  </label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="security-current-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="security-new-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  New password
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="security-new-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <PasswordStrengthChecklist password={newPassword} />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="security-confirm-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Confirm new password
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="security-confirm-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={passwordSaving}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {passwordSaving
                  ? 'Saving...'
                  : hasPasswordProvider
                    ? 'Update password'
                    : 'Set password'}
              </button>
            </form>
          </div>

          {/* Linked Sign-In Methods */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Sign-in methods
              </h3>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Link Google or Microsoft for one-click sign-in. At least one sign-in method must
              remain active on your account.
            </p>

            {providerBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  providerBanner.type === 'success'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
                }`}
              >
                {providerBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                )}
                <span>{providerBanner.message}</span>
              </div>
            )}

            <div className="space-y-2.5">
              {/* Email & Password Row */}
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Email &amp; password
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {hasPasswordProvider ? 'Linked' : 'Not set — use form on the left'}
                  </div>
                </div>
                {hasPasswordProvider && (
                  <button
                    type="button"
                    disabled={!canUnlink || providerBusy === 'password'}
                    onClick={() => handleUnlinkProvider('password', 'Password')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Unlink className="w-3 h-3" />
                    <span>Unlink</span>
                  </button>
                )}
              </div>

              {/* Google Row */}
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Google
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {hasGoogleProvider ? 'Linked' : 'Not linked'}
                  </div>
                </div>
                {hasGoogleProvider ? (
                  <button
                    type="button"
                    disabled={!canUnlink || providerBusy === 'google.com'}
                    onClick={() => handleUnlinkProvider('google.com', 'Google')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Unlink className="w-3 h-3" />
                    <span>Unlink</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={providerBusy === 'google.com'}
                    onClick={() => handleLinkProvider('google.com')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 cursor-pointer disabled:opacity-50"
                  >
                    <Link2 className="w-3 h-3" />
                    <span>Link Google</span>
                  </button>
                )}
              </div>

              {/* Microsoft Row */}
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Microsoft
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {hasMicrosoftProvider ? 'Linked' : 'Not linked'}
                  </div>
                </div>
                {hasMicrosoftProvider ? (
                  <button
                    type="button"
                    disabled={!canUnlink || providerBusy === 'microsoft.com'}
                    onClick={() => handleUnlinkProvider('microsoft.com', 'Microsoft')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Unlink className="w-3 h-3" />
                    <span>Unlink</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={providerBusy === 'microsoft.com'}
                    onClick={() => handleLinkProvider('microsoft.com')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 cursor-pointer disabled:opacity-50"
                  >
                    <Link2 className="w-3 h-3" />
                    <span>Link Microsoft</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
