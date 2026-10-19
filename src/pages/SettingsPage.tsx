import {
  AlertTriangle,
  Bell,
  Building2,
  Check,
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
  Sliders,
  Sun,
  Trash2,
  Unlink,
  Upload,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { PasswordStrengthChecklist } from '../components/PasswordStrengthChecklist';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  DEMO_PROJECT,
} from '../config/app';
import { useAppContext, type ThemePreference } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useAvatar } from '../hooks/useAvatar';
import { useWorkspaceLogo } from '../hooks/useWorkspaceLogo';
import type { DatePreset, NumberFormatLocale, UserProfile, UserSettings } from '../types';
import { SUPPORTED_TIMEZONES } from '../utils/dateUtils';
import { evaluatePasswordRules } from '../utils/firebaseErrors';
import { USD_TO_BDT_RATE } from '../utils/formatters';
import { IMAGE_ERROR_MESSAGES } from '../utils/imageAssets';

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

type SettingsTab = 'all' | 'preferences' | 'account' | 'workspace' | 'projects' | 'security';

interface WorkspaceMemberRowProps {
  memberUid: string;
  role: string;
  isCurrentUser: boolean;
  currentUserProfile?: UserProfile | null;
  currentUserEmail?: string | null;
}

const WorkspaceMemberRow: React.FC<WorkspaceMemberRowProps> = ({
  memberUid,
  role,
  isCurrentUser,
  currentUserProfile,
  currentUserEmail,
}) => {
  const memberInfo = isCurrentUser
    ? {
        uid: memberUid,
        photoURL: currentUserProfile?.photoURL,
        hasCustomAvatar: currentUserProfile?.hasCustomAvatar,
        updatedAt: currentUserProfile?.updatedAt,
      }
    : { uid: memberUid, hasCustomAvatar: true };

  const { avatarUrl } = useAvatar(memberInfo);
  const displayName = isCurrentUser
    ? currentUserProfile?.displayName || currentUserEmail || 'You'
    : `Member (${memberUid.slice(0, 8)})`;
  const initials = isCurrentUser
    ? (currentUserProfile?.displayName || currentUserEmail || 'AD').slice(0, 2).toUpperCase()
    : memberUid.slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center justify-between px-3.5 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-7 h-7 rounded-full object-cover shrink-0"
          />
        ) : (
          <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
            {displayName} {isCurrentUser && <span className="text-[10px] text-slate-400 font-normal">(You)</span>}
          </div>
          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">
            {isCurrentUser ? currentUserEmail : memberUid}
          </div>
        </div>
      </div>
      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
        {role}
      </span>
    </div>
  );
};

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
    savePreferences,
    updateUserDisplayName,
    uploadAvatar,
    removeAvatar,
    uploadWorkspaceLogo,
    removeWorkspaceLogo,
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

  const [activeTab, setActiveTab] = useState<SettingsTab>('all');

  // Avatar state
  const { avatarUrl } = useAvatar(userProfile);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarRemoving, setAvatarRemoving] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarBanner, setAvatarBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Workspace logo state
  const { logoUrl } = useWorkspaceLogo(activeWorkspace);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoRemoving, setLogoRemoving] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoBanner, setLogoBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const canManageWorkspace =
    !activeWorkspace || activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin';
  const roleTooltip = canManageWorkspace
    ? undefined
    : 'Only workspace owners and admins can update workspace settings and logo.';

  // Account display name state
  const [displayName, setDisplayName] = useState(
    userProfile?.displayName || user?.displayName || ''
  );
  const [nameSaving, setNameSaving] = useState(false);
  const [nameBanner, setNameBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (userProfile?.displayName) {
      setDisplayName(userProfile.displayName);
    }
  }, [userProfile?.displayName]);

  // Preferences optimistic state & auto-save toast
  const [prefDefaultDateRange, setPrefDefaultDateRange] = useState<Exclude<DatePreset, 'Custom'>>(
    userProfile?.settings?.defaultDateRange || 'Last 28 days'
  );
  const [prefCompareByDefault, setPrefCompareByDefault] = useState<boolean>(
    userProfile?.settings?.compareByDefault ?? true
  );
  const [prefNumberFormat, setPrefNumberFormat] = useState<NumberFormatLocale>(
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

  const [prefToast, setPrefToast] = useState<{ type: 'saved' | 'error'; message: string } | null>(
    null
  );
  const prefToastTimer = useRef<NodeJS.Timeout | null>(null);

  const showPrefToast = (type: 'saved' | 'error', message: string) => {
    if (prefToastTimer.current) clearTimeout(prefToastTimer.current);
    setPrefToast({ type, message });
    prefToastTimer.current = setTimeout(() => {
      setPrefToast(null);
    }, 2800);
  };

  useEffect(() => {
    if (userProfile?.settings) {
      const s = userProfile.settings;
      if (s.defaultDateRange) setPrefDefaultDateRange(s.defaultDateRange);
      if (typeof s.compareByDefault === 'boolean') setPrefCompareByDefault(s.compareByDefault);
      if (s.numberFormat) setPrefNumberFormat(s.numberFormat);
      if (s.emailNotifications) {
        setWeeklyReportEmail(Boolean(s.emailNotifications.weeklyReport));
        setAlertsEmail(Boolean(s.emailNotifications.alerts));
        setProductUpdatesEmail(Boolean(s.emailNotifications.productUpdates));
      }
    }
  }, [userProfile?.settings]);

  const handleUpdatePrefField = async (patch: Partial<UserSettings>) => {
    try {
      await savePreferences(patch);
      showPrefToast('saved', 'Saved');
    } catch (err) {
      showPrefToast('error', err instanceof Error ? err.message : 'Failed to save');
    }
  };

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

  const showPasswordOption = enabledProviders.includes('password');
  const showGoogleOption = enabledProviders.includes('google');
  const showMicrosoftOption = enabledProviders.includes('microsoft');

  const hasPasswordProvider = providers.includes('password');
  const hasGoogleProvider = providers.includes('google.com');
  const hasMicrosoftProvider = providers.includes('microsoft.com');
  const canUnlink = providers.length > 1;

  const passwordRules = evaluatePasswordRules(newPassword);

  // Avatar upload / remove
  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show temporary preview
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl(objectUrl);
    setAvatarBanner(null);
    setAvatarUploading(true);

    try {
      await uploadAvatar(file);
      setAvatarBanner({ type: 'success', message: 'Profile picture updated successfully.' });
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      const friendly = IMAGE_ERROR_MESSAGES[code] || (err instanceof Error ? err.message : 'Upload failed.');
      setAvatarBanner({ type: 'error', message: friendly });
      setAvatarPreviewUrl(null);
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarBanner(null);
    setAvatarRemoving(true);
    setAvatarPreviewUrl(null);
    try {
      await removeAvatar();
      setAvatarBanner({ type: 'success', message: 'Profile picture removed.' });
    } catch (err) {
      setAvatarBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove picture.',
      });
    } finally {
      setAvatarRemoving(false);
    }
  };

  // Workspace logo upload / remove
  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeWorkspace) return;

    const objectUrl = URL.createObjectURL(file);
    setLogoPreviewUrl(objectUrl);
    setLogoBanner(null);
    setLogoUploading(true);

    try {
      await uploadWorkspaceLogo(activeWorkspace.id, file);
      setLogoBanner({ type: 'success', message: 'Workspace logo updated successfully.' });
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      const friendly = IMAGE_ERROR_MESSAGES[code] || (err instanceof Error ? err.message : 'Logo upload failed.');
      setLogoBanner({ type: 'error', message: friendly });
      setLogoPreviewUrl(null);
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    if (!activeWorkspace) return;
    setLogoBanner(null);
    setLogoRemoving(true);
    setLogoPreviewUrl(null);
    try {
      await removeWorkspaceLogo(activeWorkspace.id);
      setLogoBanner({ type: 'success', message: 'Workspace logo removed.' });
    } catch (err) {
      setLogoBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove logo.',
      });
    } finally {
      setLogoRemoving(false);
    }
  };

  const handleSaveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameBanner(null);
    setNameSaving(true);
    try {
      await updateUserDisplayName(displayName.trim());
      setNameBanner({ type: 'success', message: 'Display name updated.' });
    } catch (err) {
      setNameBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save display name.',
      });
    } finally {
      setNameSaving(false);
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

  const currentDisplayAvatar = avatarPreviewUrl || avatarUrl;
  const currentDisplayLogo = logoPreviewUrl || logoUrl;
  const userInitials = (displayName || user?.email || 'AD').slice(0, 2).toUpperCase();
  const workspaceInitials = (activeWorkspace?.name || 'MW').slice(0, 2).toUpperCase();
  const trackedName = activeProject?.name || DEMO_PROJECT.name;
  const trackedDomain = activeProject?.domain || DEMO_PROJECT.domain;

  const workspaceMembersList = activeWorkspace?.members
    ? Object.entries(activeWorkspace.members)
    : user
    ? [[user.uid, activeWorkspace?.role || 'owner']]
    : [];

  const showSection = (tab: SettingsTab) => activeTab === 'all' || activeTab === tab;

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      {/* Page Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Settings
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          User profile, personal preferences, workspace branding, and project settings (synced across devices in Firestore).
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
        {[
          { id: 'all' as const, label: 'All', icon: Sliders },
          { id: 'preferences' as const, label: 'Preferences', icon: Sliders },
          { id: 'account' as const, label: 'Account', icon: User },
          { id: 'workspace' as const, label: 'Workspace', icon: Building2 },
          { id: 'projects' as const, label: 'Project', icon: FolderKanban },
          { id: 'security' as const, label: 'Security', icon: Shield },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 1. PREFERENCES SECTION (Synced to users/{uid} settings)         */}
      {/* ------------------------------------------------------------- */}
      {showSection('preferences') && (
        <section
          data-testid="settings-preferences-section"
          className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-6"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Preferences
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Personal defaults synced in real time across devices via Firestore
                </p>
              </div>
            </div>

            {/* Optimistic "Saved" Toast Badge */}
            {prefToast && (
              <div
                role="status"
                data-testid="preferences-save-toast"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium animate-in fade-in duration-150 ${
                  prefToast.type === 'saved'
                    ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-red-50 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}
              >
                {prefToast.type === 'saved' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                )}
                <span>{prefToast.message}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Theme Control */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Interface Theme
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTheme('light');
                    void handleUpdatePrefField({ theme: 'light' });
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
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
                  onClick={() => {
                    setTheme('dark');
                    void handleUpdatePrefField({ theme: 'dark' });
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
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
                  onClick={() => {
                    setThemePreference('system' as ThemePreference);
                    void handleUpdatePrefField({ theme: 'system' });
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    themePreference === 'system'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>System</span>
                </button>
              </div>
            </div>

            {/* Default Date Range */}
            <div className="space-y-2">
              <label
                htmlFor="preferences-date-range"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Default Date Range
              </label>
              <select
                id="preferences-date-range"
                value={prefDefaultDateRange}
                onChange={(e) => {
                  const val = e.target.value as Exclude<DatePreset, 'Custom'>;
                  setPrefDefaultDateRange(val);
                  void handleUpdatePrefField({ defaultDateRange: val });
                }}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {DEFAULT_DATE_RANGES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Reporting Currency */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Reporting Currency
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCurrency('USD');
                    void handleUpdatePrefField({ displayCurrency: 'USD' });
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    currency === 'USD'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  $ USD (US Dollar)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrency('BDT');
                    void handleUpdatePrefField({ displayCurrency: 'BDT' });
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    currency === 'BDT'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  ৳ BDT (Bangladeshi Taka)
                </button>
              </div>
            </div>

            {/* Reporting Timezone */}
            <div className="space-y-2">
              <label
                htmlFor="preferences-timezone"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Reporting Timezone
              </label>
              <select
                id="preferences-timezone"
                value={timezone}
                onChange={(e) => {
                  const val = e.target.value;
                  setTimezone(val);
                  void handleUpdatePrefField({ timezone: val });
                }}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {SUPPORTED_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Number Format */}
            <div className="space-y-2">
              <label
                htmlFor="preferences-number-format"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Number &amp; Decimal Format
              </label>
              <select
                id="preferences-number-format"
                value={prefNumberFormat}
                onChange={(e) => {
                  const val = e.target.value as NumberFormatLocale;
                  setPrefNumberFormat(val);
                  void handleUpdatePrefField({ numberFormat: val });
                }}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {NUMBER_FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Comparison by Default Toggle */}
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={prefCompareByDefault}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setPrefCompareByDefault(checked);
                    void handleUpdatePrefField({ compareByDefault: checked });
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Compare to previous period by default on dashboards</span>
              </label>
            </div>
          </div>

          {/* Email Notifications */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Bell className="w-3.5 h-3.5 text-slate-400" />
              <span>Email Notification Preferences</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={weeklyReportEmail}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setWeeklyReportEmail(checked);
                    void handleUpdatePrefField({
                      emailNotifications: {
                        weeklyReport: checked,
                        alerts: alertsEmail,
                        productUpdates: productUpdatesEmail,
                      },
                    });
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Weekly summary</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alertsEmail}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAlertsEmail(checked);
                    void handleUpdatePrefField({
                      emailNotifications: {
                        weeklyReport: weeklyReportEmail,
                        alerts: checked,
                        productUpdates: productUpdatesEmail,
                      },
                    });
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Anomaly &amp; sync alerts</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={productUpdatesEmail}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setProductUpdatesEmail(checked);
                    void handleUpdatePrefField({
                      emailNotifications: {
                        weeklyReport: weeklyReportEmail,
                        alerts: alertsEmail,
                        productUpdates: checked,
                      },
                    });
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Product updates</span>
              </label>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 2. ACCOUNT SECTION (Profile Picture + Display Name)            */}
      {/* ------------------------------------------------------------- */}
      {showSection('account') && (
        <section
          data-testid="settings-account-section"
          className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-6"
        >
          <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-4">
            <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Account &amp; Profile Picture
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage your profile picture (stored in Firestore) and display name
              </p>
            </div>
          </div>

          {/* Profile Picture Upload & Remove */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Profile Picture
            </label>

            {avatarBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  avatarBanner.type === 'success'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
                }`}
              >
                {avatarBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                )}
                <span>{avatarBanner.message}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="relative">
                {currentDisplayAvatar ? (
                  <img
                    src={currentDisplayAvatar}
                    alt={displayName || 'Avatar'}
                    data-testid="account-avatar-preview"
                    className="w-16 h-16 rounded-full object-cover border-2 border-slate-200 dark:border-slate-700 shadow-xs"
                  />
                ) : (
                  <div
                    data-testid="account-avatar-initials"
                    className="w-16 h-16 rounded-full bg-blue-600 text-white text-lg font-bold flex items-center justify-center border-2 border-slate-200 dark:border-slate-700 shadow-xs"
                  >
                    {userInitials}
                  </div>
                )}
                {avatarUploading && (
                  <div className="absolute inset-0 bg-slate-900/60 rounded-full flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleAvatarFileChange}
                    className="hidden"
                    id="account-photo-input"
                  />
                  <button
                    type="button"
                    disabled={avatarUploading || avatarRemoving}
                    onClick={() => avatarInputRef.current?.click()}
                    data-testid="account-upload-photo-button"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {avatarUploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>Upload photo</span>
                  </button>

                  {(userProfile?.hasCustomAvatar || userProfile?.photoURL || avatarPreviewUrl) && (
                    <button
                      type="button"
                      disabled={avatarUploading || avatarRemoving}
                      onClick={handleRemoveAvatar}
                      data-testid="account-remove-photo-button"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {avatarRemoving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      <span>Remove</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Accepts PNG, JPEG, WebP, GIF up to 10 MB. Resized and stored directly in Firestore.
                </p>
              </div>
            </div>
          </div>

          {/* Display Name Edit */}
          <form onSubmit={handleSaveDisplayName} className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            {nameBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  nameBanner.type === 'success'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
                }`}
              >
                <span>{nameBanner.message}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="settings-account-display-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Display Name
                </label>
                <input
                  id="settings-account-display-name"
                  type="text"
                  required
                  maxLength={100}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-account-email"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Email Address
                </label>
                <input
                  id="settings-account-email"
                  type="email"
                  disabled
                  value={user?.email || userProfile?.email || ''}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 text-slate-500 cursor-not-allowed"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={nameSaving}
              data-testid="account-save-name-button"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {nameSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save display name</span>
            </button>
          </form>
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 3. WORKSPACE SECTION (Name, Defaults, Logo, Members)          */}
      {/* ------------------------------------------------------------- */}
      {showSection('workspace') && (
        <section
          data-testid="settings-workspace-section"
          className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-6"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Workspace Settings &amp; Branding
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Workspace name, defaults, brand logo, and team members
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              {activeWorkspace?.plan || 'beta'} ({projects.length}/
              {activeWorkspace?.limits?.maxProjects ?? 3} projects)
            </span>
          </div>

          {/* Non-admin notice */}
          {!canManageWorkspace && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
              <Info className="w-4 h-4 shrink-0 text-amber-600" />
              <span>You are viewing this workspace as a {activeWorkspace?.role || 'member'}. Only owners and admins can edit settings and logo.</span>
            </div>
          )}

          {/* Workspace Logo Upload */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Workspace Logo
            </label>

            {logoBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  logoBanner.type === 'success'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/70 text-red-800 dark:text-red-200'
                }`}
              >
                {logoBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                )}
                <span>{logoBanner.message}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="relative">
                {currentDisplayLogo ? (
                  <img
                    src={currentDisplayLogo}
                    alt={activeWorkspace?.name || 'Workspace Logo'}
                    data-testid="workspace-logo-preview"
                    className="w-16 h-16 rounded-xl object-contain bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 p-1 shadow-xs"
                  />
                ) : (
                  <div
                    data-testid="workspace-logo-initials"
                    className="w-16 h-16 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-2 border-blue-200 dark:border-blue-800 text-lg font-bold flex items-center justify-center shadow-xs"
                  >
                    {workspaceInitials}
                  </div>
                )}
                {logoUploading && (
                  <div className="absolute inset-0 bg-slate-900/60 rounded-xl flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}
              </div>

              <div className="space-y-1.5" title={roleTooltip}>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={!canManageWorkspace}
                    onChange={handleLogoFileChange}
                    className="hidden"
                    id="workspace-logo-input"
                  />
                  <button
                    type="button"
                    disabled={!canManageWorkspace || logoUploading || logoRemoving}
                    onClick={() => logoInputRef.current?.click()}
                    data-testid="workspace-upload-logo-button"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {logoUploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>Upload logo</span>
                  </button>

                  {(activeWorkspace?.hasLogo || activeWorkspace?.logoURL || logoPreviewUrl) && (
                    <button
                      type="button"
                      disabled={!canManageWorkspace || logoUploading || logoRemoving}
                      onClick={handleRemoveLogo}
                      data-testid="workspace-remove-logo-button"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {logoRemoving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      <span>Remove</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Transparent PNG recommended. Maximum 512 px, saved directly in Firestore.
                </p>
              </div>
            </div>
          </div>

          {/* Workspace Name & Defaults */}
          <form onSubmit={handleSaveWorkspaceSettings} className="space-y-4 pt-3 border-t border-slate-100 dark:border-slate-800">
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

            <div title={roleTooltip}>
              <label
                htmlFor="settings-workspace-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Workspace Name
              </label>
              <input
                id="settings-workspace-name"
                type="text"
                maxLength={100}
                disabled={!canManageWorkspace}
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" title={roleTooltip}>
              <div>
                <label
                  htmlFor="settings-workspace-currency"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Default Project Currency
                </label>
                <input
                  id="settings-workspace-currency"
                  type="text"
                  maxLength={3}
                  disabled={!canManageWorkspace}
                  value={wsCurrency}
                  onChange={(e) => setWsCurrency(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-workspace-timezone"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Default Project Time Zone
                </label>
                <select
                  id="settings-workspace-timezone"
                  disabled={!canManageWorkspace}
                  value={wsTimezone}
                  onChange={(e) => setWsTimezone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {SUPPORTED_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {canManageWorkspace && (
              <button
                type="submit"
                disabled={wsSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
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

          {/* Workspace Members with Avatars */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Users className="w-4 h-4 text-slate-400" />
              <span>Workspace Members ({workspaceMembersList.length})</span>
            </div>
            <div
              data-testid="workspace-members-list"
              className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-800/30 overflow-hidden"
            >
              {workspaceMembersList.map(([memberUid, role]) => (
                <WorkspaceMemberRow
                  key={memberUid}
                  memberUid={memberUid}
                  role={role}
                  isCurrentUser={memberUid === user?.uid}
                  currentUserProfile={userProfile}
                  currentUserEmail={user?.email}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. PROJECT CONFIGURATION SECTION                              */}
      {/* ------------------------------------------------------------- */}
      {showSection('projects') && (
        <section
          data-testid="settings-project-section"
          className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <FolderKanban className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Project Configuration
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Configure domain, brand terms, and filters for{' '}
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
              No project selected yet. Create a project to configure domain, brand terms, and hostname filters.
            </p>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 5. SECURITY SECTION (Password, Identity Providers)            */}
      {/* ------------------------------------------------------------- */}
      {showSection('security') && (
        <section
          data-testid="settings-security-section"
          className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-6"
        >
          <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-4">
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
            {/* Password Form */}
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
                    Your account currently signs in via SSO. Set a password to enable direct email and password sign-in.
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

            {/* Linked Sign-in Methods */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Sign-in methods
                </h3>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage active sign-in providers on your account. At least one sign-in method must remain active.
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
                {/* Email & Password */}
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

                {/* Google */}
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

                {/* Microsoft */}
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
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 6. ABOUT CARD                                                 */}
      {/* ------------------------------------------------------------- */}
      <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="flex items-center gap-2.5">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">About {APP_NAME}</h2>
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

        <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/70 flex items-center justify-between text-[11px] font-mono text-slate-400 dark:text-slate-500">
          <span>Version: {APP_VERSION}</span>
          <span>1 USD = ৳{USD_TO_BDT_RATE} BDT</span>
          <span>Property: {trackedDomain}</span>
        </div>
      </div>
    </div>
  );
};
