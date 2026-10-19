import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  FolderKanban,
  Globe,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Moon,
  Plus,
  Save,
  Shield,
  Sun,
  Trash2,
  Unlink,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { PasswordStrengthChecklist } from '../components/PasswordStrengthChecklist';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  DEMO_PROJECT,
  THEME_STORAGE_KEY,
} from '../config/app';
import { useAppContext, type ThemePreference } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import type { DatePreset, NumberFormatLocale } from '../types';
import { SUPPORTED_TIMEZONES } from '../utils/dateUtils';
import { evaluatePasswordRules } from '../utils/firebaseErrors';
import { USD_TO_BDT_RATE } from '../utils/formatters';

const DEFAULT_DATE_RANGES: Exclude<DatePreset, 'Custom'>[] = [
  'Today',
  'Last 7 days',
  'Last 28 days',
  'Last 90 days',
  'This month',
  'Last month',
];

const NUMBER_FORMAT_OPTIONS: { value: NumberFormatLocale; label: string }[] = [
  { value: 'en-US', label: '1,234,567.89 (US / International)' },
  { value: 'en-GB', label: '1,234,567.89 (UK)' },
  { value: 'en-IN', label: '12,34,567.89 (South Asia / Lakh-Crore)' },
  { value: 'bn-BD', label: '১২,৩৪,৫৬৭.৮৯ (Bangladesh / Bengali)' },
  { value: 'de-DE', label: '1.234.567,89 (Germany / Europe)' },
  { value: 'fr-FR', label: '1 234 567,89 (France)' },
];

export const SettingsPage: React.FC = () => {
  const {
    currency,
    setCurrency,
    timezone,
    setTimezone,
    theme,
    setTheme,
    themePreference,
    setThemePreference,
    dateRange,
    userProfile,
    activeWorkspace,
    activeProject,
    projects,
    updateUserProfile,
    updateWorkspaceSettings,
    updateProject,
    deleteProject,
    openNewProjectModal,
  } = useAppContext();

  const {
    user,
    providers,
    enabledProviders,
    changePassword,
    setPasswordForSsoAccount,
    linkGoogleProvider,
    linkMicrosoftProvider,
    unlinkProvider,
  } = useAuth();

  const trackedName = activeProject?.name || DEMO_PROJECT.name;
  const trackedDomain = activeProject?.domain || DEMO_PROJECT.domain;

  const showPasswordOption = enabledProviders.includes('password');
  const showGoogleOption = enabledProviders.includes('google');
  const showMicrosoftOption = enabledProviders.includes('microsoft');

  const hasPasswordProvider = providers.includes('password');
  const hasGoogleProvider = providers.includes('google.com');
  const hasMicrosoftProvider = providers.includes('microsoft.com');
  const canUnlink = providers.length > 1;

  // User profile & preferences state
  const [displayName, setDisplayName] = useState(
    userProfile?.displayName || user?.displayName || ''
  );
  const [defaultDateRange, setDefaultDateRange] = useState<Exclude<DatePreset, 'Custom'>>(
    userProfile?.settings?.defaultDateRange || 'Last 28 days'
  );
  const [compareByDefault, setCompareByDefault] = useState<boolean>(
    userProfile?.settings?.compareByDefault ?? true
  );
  const [numberFormat, setNumberFormat] = useState<NumberFormatLocale>(
    userProfile?.settings?.numberFormat || 'en-US'
  );
  const [weeklyReportEmail, setWeeklyReportEmail] = useState<boolean>(
    userProfile?.settings?.emailNotifications?.weeklyReport ?? true
  );
  const [alertsEmail, setAlertsEmail] = useState<boolean>(
    userProfile?.settings?.emailNotifications?.alerts ?? true
  );
  const [productUpdatesEmail, setProductUpdatesEmail] = useState<boolean>(
    userProfile?.settings?.emailNotifications?.productUpdates ?? false
  );
  const [userSaving, setUserSaving] = useState(false);
  const [userBanner, setUserBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName || '');
      if (userProfile.settings?.defaultDateRange) {
        setDefaultDateRange(userProfile.settings.defaultDateRange);
      }
      if (typeof userProfile.settings?.compareByDefault === 'boolean') {
        setCompareByDefault(userProfile.settings.compareByDefault);
      }
      if (userProfile.settings?.numberFormat) {
        setNumberFormat(userProfile.settings.numberFormat);
      }
      if (userProfile.settings?.emailNotifications) {
        setWeeklyReportEmail(Boolean(userProfile.settings.emailNotifications.weeklyReport));
        setAlertsEmail(Boolean(userProfile.settings.emailNotifications.alerts));
        setProductUpdatesEmail(Boolean(userProfile.settings.emailNotifications.productUpdates));
      }
    }
  }, [userProfile]);

  // Workspace settings state
  const [wsName, setWsName] = useState(activeWorkspace?.name || 'My workspace');
  const [wsCurrency, setWsCurrency] = useState(activeWorkspace?.defaults?.currency || 'USD');
  const [wsTimezone, setWsTimezone] = useState(activeWorkspace?.defaults?.timezone || 'UTC');
  const [wsSaving, setWsSaving] = useState(false);
  const [wsBanner, setWsBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (activeWorkspace) {
      setWsName(activeWorkspace.name);
      setWsCurrency(activeWorkspace.defaults?.currency || 'USD');
      setWsTimezone(activeWorkspace.defaults?.timezone || 'UTC');
    }
  }, [activeWorkspace]);

  // Project settings state
  const [projName, setProjName] = useState(activeProject?.name || '');
  const [projDomain, setProjDomain] = useState(activeProject?.domain || '');
  const [projTimezone, setProjTimezone] = useState(activeProject?.timezone || 'UTC');
  const [projCurrency, setProjCurrency] = useState(activeProject?.currency || 'USD');
  const [projMetaAdAccountId, setProjMetaAdAccountId] = useState(
    activeProject?.metaAdAccountId || ''
  );
  const [brandTerms, setBrandTerms] = useState<string[]>(activeProject?.brandTerms || []);
  const [brandTermInput, setBrandTermInput] = useState('');
  const [hostnameFilters, setHostnameFilters] = useState<string[]>(
    activeProject?.hostnameFilters || []
  );
  const [hostnameInput, setHostnameInput] = useState('');
  const [projSaving, setProjSaving] = useState(false);
  const [projDeleting, setProjDeleting] = useState(false);
  const [projBanner, setProjBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (activeProject) {
      setProjName(activeProject.name);
      setProjDomain(activeProject.domain || '');
      setProjTimezone(activeProject.timezone || 'UTC');
      setProjCurrency(activeProject.currency || 'USD');
      setProjMetaAdAccountId(activeProject.metaAdAccountId || '');
      setBrandTerms(activeProject.brandTerms || []);
      setHostnameFilters(activeProject.hostnameFilters || []);
      setProjBanner(null);
    }
  }, [activeProject]);

  // Security state
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

  const handleSaveUserSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserBanner(null);
    setUserSaving(true);
    try {
      await updateUserProfile({
        displayName: displayName.trim() || undefined,
        settings: {
          theme: themePreference,
          defaultDateRange,
          compareByDefault,
          displayCurrency: currency,
          timezone,
          numberFormat,
          emailNotifications: {
            weeklyReport: weeklyReportEmail,
            alerts: alertsEmail,
            productUpdates: productUpdatesEmail,
          },
        },
      });
      setUserBanner({
        type: 'success',
        message: 'User profile and preferences saved to Firestore.',
      });
    } catch (err) {
      setUserBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save user settings.',
      });
    } finally {
      setUserSaving(false);
    }
  };

  const handleSaveWorkspaceSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setWsBanner(null);
    setWsSaving(true);
    try {
      await updateWorkspaceSettings({
        name: wsName.trim(),
        defaults: {
          currency: wsCurrency.toUpperCase(),
          timezone: wsTimezone,
        },
      });
      setWsBanner({
        type: 'success',
        message: 'Workspace settings updated.',
      });
    } catch (err) {
      setWsBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update workspace settings.',
      });
    } finally {
      setWsSaving(false);
    }
  };

  const handleAddBrandTerm = () => {
    const term = brandTermInput.trim();
    if (!term) return;
    if (term.length > 50) {
      setProjBanner({ type: 'error', message: 'Brand term must be 1–50 characters.' });
      return;
    }
    if (brandTerms.length >= 20) {
      setProjBanner({ type: 'error', message: 'At most 20 brand terms are allowed.' });
      return;
    }
    if (!brandTerms.includes(term)) {
      setBrandTerms((prev) => [...prev, term]);
    }
    setBrandTermInput('');
  };

  const handleAddHostnameFilter = () => {
    const raw = hostnameInput.trim().toLowerCase();
    if (!raw) return;
    if (hostnameFilters.length >= 20) {
      setProjBanner({ type: 'error', message: 'At most 20 hostname filters are allowed.' });
      return;
    }
    if (!hostnameFilters.includes(raw)) {
      setHostnameFilters((prev) => [...prev, raw]);
    }
    setHostnameInput('');
  };

  const handleSaveProjectSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject) return;
    setProjBanner(null);
    setProjSaving(true);
    try {
      await updateProject(activeProject.id, {
        name: projName.trim(),
        domain: projDomain.trim(),
        timezone: projTimezone,
        currency: projCurrency.toUpperCase(),
        metaAdAccountId: projMetaAdAccountId.trim() ? projMetaAdAccountId.trim() : null,
        brandTerms,
        hostnameFilters,
      });
      setProjBanner({
        type: 'success',
        message: 'Project configuration saved.',
      });
    } catch (err) {
      setProjBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update project configuration.',
      });
    } finally {
      setProjSaving(false);
    }
  };

  const handleDeleteActiveProject = async () => {
    if (!activeProject) return;
    setProjBanner(null);
    setProjDeleting(true);
    try {
      await deleteProject(activeProject.id);
      setProjBanner({
        type: 'success',
        message: 'Project deleted.',
      });
    } catch (err) {
      setProjBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete project.',
      });
    } finally {
      setProjDeleting(false);
    }
  };

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

  const canManageWorkspace =
    !activeWorkspace || activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin';

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Workspace Settings
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Configure user preferences, workspace defaults, project settings, and account security for{' '}
          {APP_NAME} (synced across devices in Firestore)
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
            Synced across devices in Firestore and cached under{' '}
            <code className="font-mono">{THEME_STORAGE_KEY}</code>.
          </p>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                themePreference === 'light'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                themePreference === 'dark'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Dark</span>
            </button>
            <button
              type="button"
              onClick={() => setThemePreference('system' as ThemePreference)}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                themePreference === 'system'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <span>System</span>
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
              {APP_NAME} · Tracked website: {trackedName} ({trackedDomain})
            </p>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {APP_TAGLINE} — Version {APP_VERSION}. Built on a modular data-adapter architecture
              unifying Google Analytics 4, Google Search Console, and Meta Ads.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/70 flex items-center justify-between text-[11px] font-mono text-slate-400 dark:text-slate-500">
            <span>Version: {APP_VERSION}</span>
            <span>Property: {trackedDomain}</span>
          </div>
        </div>
      </div>

      {/* Project Configuration Section */}
      <div
        data-testid="settings-project-section"
        className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <FolderKanban className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Project Configuration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configure domain, brand terms, hostname filters, and connected accounts for{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {trackedName}
                </span>
              </p>
            </div>
          </div>

          {!activeProject && (
            <button
              type="button"
              onClick={openNewProjectModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create project</span>
            </button>
          )}
        </div>

        {projBanner && (
          <div
            role="status"
            className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
              projBanner.type === 'success'
                ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
            }`}
          >
            {projBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            )}
            <span>{projBanner.message}</span>
          </div>
        )}

        {activeProject ? (
          <form onSubmit={handleSaveProjectSettings} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="settings-project-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Project name
                </label>
                <input
                  id="settings-project-name"
                  type="text"
                  required
                  maxLength={100}
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-project-domain"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Website domain (bare hostname)
                </label>
                <input
                  id="settings-project-domain"
                  type="text"
                  value={projDomain}
                  onChange={(e) => setProjDomain(e.target.value)}
                  placeholder="example.com"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-project-timezone"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Project time zone
                </label>
                <select
                  id="settings-project-timezone"
                  value={projTimezone}
                  onChange={(e) => setProjTimezone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {SUPPORTED_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="settings-project-currency"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Project currency (ISO 3-letter)
                </label>
                <input
                  id="settings-project-currency"
                  type="text"
                  maxLength={3}
                  value={projCurrency}
                  onChange={(e) => setProjCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                  className="w-full px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Connected data sources summary + Meta Ad Account override */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 text-xs">
              <div>
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  GA4 Property
                </div>
                <div className="mt-0.5 font-mono text-slate-800 dark:text-slate-200 truncate">
                  {activeProject.ga4PropertyName || activeProject.ga4PropertyId || 'Not bound'}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Search Console Site
                </div>
                <div className="mt-0.5 font-mono text-slate-800 dark:text-slate-200 truncate">
                  {activeProject.searchConsoleSite || 'Not bound'}
                </div>
              </div>
              <div>
                <label
                  htmlFor="settings-project-meta-account"
                  className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
                >
                  Meta Ad Account ID
                </label>
                <input
                  id="settings-project-meta-account"
                  type="text"
                  value={projMetaAdAccountId}
                  onChange={(e) => setProjMetaAdAccountId(e.target.value)}
                  placeholder="e.g. 123456789"
                  className="mt-1 w-full px-2.5 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Brand terms (max 20) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Brand terms ({brandTerms.length}/20)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={50}
                    value={brandTermInput}
                    onChange={(e) => setBrandTermInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddBrandTerm();
                      }
                    }}
                    placeholder="Add brand term..."
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddBrandTerm}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                {brandTerms.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {brandTerms.map((term) => (
                      <span
                        key={term}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                      >
                        <span>{term}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setBrandTerms((prev) => prev.filter((item) => item !== term))
                          }
                          aria-label={`Remove brand term ${term}`}
                          className="hover:text-blue-900 dark:hover:text-white cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Hostname filters (max 20) */}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Hostname filters ({hostnameFilters.length}/20)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={hostnameInput}
                    onChange={(e) => setHostnameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddHostnameFilter();
                      }
                    }}
                    placeholder="e.g. app.example.com"
                    className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddHostnameFilter}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                {hostnameFilters.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {hostnameFilters.map((host) => (
                      <span
                        key={host}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                      >
                        <span>{host}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setHostnameFilters((prev) => prev.filter((item) => item !== host))
                          }
                          aria-label={`Remove hostname ${host}`}
                          className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              {canManageWorkspace ? (
                <button
                  type="button"
                  disabled={projDeleting || projSaving}
                  onClick={handleDeleteActiveProject}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer disabled:opacity-50"
                >
                  {projDeleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  <span>Delete project</span>
                </button>
              ) : (
                <div />
              )}

              <button
                type="submit"
                disabled={projSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {projSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Save project settings</span>
              </button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No project selected yet. Create a project to configure domain, brand terms, and hostname
            filters.
          </p>
        )}
      </div>

      {/* User & Workspace Firestore Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Profile & Preferences */}
        <form
          onSubmit={handleSaveUserSettings}
          data-testid="settings-user-section"
          className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
        >
          <div className="flex items-center gap-2.5 border-b border-slate-200/80 dark:border-slate-800 pb-3">
            <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                User Preferences
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Personal defaults synced to your account
              </p>
            </div>
          </div>

          {userBanner && (
            <div
              role="status"
              className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                userBanner.type === 'success'
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
              }`}
            >
              <span>{userBanner.message}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="settings-user-display-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Display name
            </label>
            <input
              id="settings-user-display-name"
              type="text"
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="settings-default-date-range"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Default date range
              </label>
              <select
                id="settings-default-date-range"
                value={defaultDateRange}
                onChange={(e) =>
                  setDefaultDateRange(e.target.value as Exclude<DatePreset, 'Custom'>)
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                {DEFAULT_DATE_RANGES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-number-format"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Number format
              </label>
              <select
                id="settings-number-format"
                value={numberFormat}
                onChange={(e) => setNumberFormat(e.target.value as NumberFormatLocale)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                {NUMBER_FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={compareByDefault}
              onChange={(e) => setCompareByDefault(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Compare to previous period by default</span>
          </label>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Bell className="w-3.5 h-3.5 text-slate-400" />
              <span>Email notifications</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={weeklyReportEmail}
                onChange={(e) => setWeeklyReportEmail(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Weekly performance summary</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={alertsEmail}
                onChange={(e) => setAlertsEmail(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Connection &amp; anomaly alerts</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={productUpdatesEmail}
                onChange={(e) => setProductUpdatesEmail(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Product updates</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={userSaving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {userSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save user preferences</span>
          </button>
        </form>

        {/* Workspace Settings & Members */}
        <form
          onSubmit={handleSaveWorkspaceSettings}
          data-testid="settings-workspace-section"
          className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Workspace &amp; Plan
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Defaults for new projects and team membership
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                {activeWorkspace?.plan || 'beta'} ({projects.length}/
                {activeWorkspace?.limits?.maxProjects ?? 3} projects)
              </span>
            </div>

            {wsBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  wsBanner.type === 'success'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
                }`}
              >
                <span>{wsBanner.message}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="settings-workspace-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Workspace name
              </label>
              <input
                id="settings-workspace-name"
                type="text"
                maxLength={100}
                disabled={!canManageWorkspace}
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="settings-workspace-currency"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Default project currency
                </label>
                <input
                  id="settings-workspace-currency"
                  type="text"
                  maxLength={3}
                  disabled={!canManageWorkspace}
                  value={wsCurrency}
                  onChange={(e) => setWsCurrency(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-workspace-timezone"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Default project time zone
                </label>
                <select
                  id="settings-workspace-timezone"
                  disabled={!canManageWorkspace}
                  value={wsTimezone}
                  onChange={(e) => setWsTimezone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                >
                  {SUPPORTED_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Members read-only list */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span>Workspace members (read-only)</span>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                    {user?.email || userProfile?.email || 'Current user'}
                  </span>
                  <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {activeWorkspace?.role || 'owner'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {canManageWorkspace && (
            <button
              type="submit"
              disabled={wsSaving}
              className="self-start inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {wsSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save workspace settings</span>
            </button>
          )}
        </form>
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

        <div
          className={`grid grid-cols-1 ${
            showPasswordOption ? 'lg:grid-cols-2' : ''
          } gap-6`}
        >
          {/* Password Management (Change Password or Set a Password for SSO-only accounts) */}
          {showPasswordOption && (
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
          )}

          {/* Linked Sign-In Methods */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Sign-in methods
              </h3>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage active sign-in providers on your account. At least one sign-in method must
              remain active.
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
              {showPasswordOption && (
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
              )}

              {/* Google Row */}
              {showGoogleOption && (
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
              )}

              {/* Microsoft Row */}
              {showMicrosoftOption && (
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
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
