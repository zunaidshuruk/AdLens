import { SessionsCard } from '../components/SessionsCard';
import { SsoSettingsCard } from '../components/SsoSettingsCard';
import { WorkspaceActivityCard } from '../components/WorkspaceActivityCard';
import { PlanCard } from '../components/PlanCard';
import { TeamCard } from '../components/TeamCard';
import { EmailSummariesCard } from '../components/EmailSummariesCard';
import { SecurityActivityCard } from '../components/SecurityActivityCard';
import { InstallAppSection } from '../components/InstallAppSection';
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
  Monitor,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Shield,
  Sliders,
  Sparkles,
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
import { useNavigate } from 'react-router-dom';
import { apiClient, ApiClientError } from '../api/client';
import { PasswordStrengthChecklist } from '../components/PasswordStrengthChecklist';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  DEMO_PROJECT,
} from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useAvatar } from '../hooks/useAvatar';
import { useWorkspaceLogo } from '../hooks/useWorkspaceLogo';
import type { DatePreset, NumberFormatLocale, UserProfile, UserSettings } from '../types';
import { SUPPORTED_TIMEZONES } from '../utils/dateUtils';
import { evaluatePasswordRules } from '../utils/firebaseErrors';
import { USD_TO_BDT_RATE } from '../utils/formatters';
import { IMAGE_ERROR_MESSAGES } from '../utils/imageAssets';
import {
  buildTheme,
  DEFAULT_APPEARANCE,
  FONT_SCALES,
  normalizeHex,
  PRESET_IDS,
  presetToOptions,
  suggestAccentFix,
  THEME_PRESETS,
  type AppearanceSettings,
  type ChartPaletteId,
  type Density,
  type FontScale,
  type Mode,
  type PresetId,
  type Radius,
  type Tint,
} from '../utils/themeEngine';

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

type SettingsTab =
  | 'all'
  | 'appearance'
  | 'preferences'
  | 'account'
  | 'workspace'
  | 'projects'
  | 'security';

const TINT_OPTIONS: { value: Tint; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'cool', label: 'Cool' },
  { value: 'warm', label: 'Warm' },
  { value: 'accent', label: 'Accent' },
];

const RADIUS_OPTIONS: { value: Radius; label: string }[] = [
  { value: 'sharp', label: 'Sharp' },
  { value: 'default', label: 'Default' },
  { value: 'round', label: 'Round' },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

const CHART_PALETTE_OPTIONS: { value: ChartPaletteId; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'colorblind', label: 'Colour-blind safe' },
  { value: 'monochrome', label: 'Monochrome' },
  { value: 'brand', label: 'Brand' },
];

const PresetLiveSwatch: React.FC<{ vars: Record<string, string>; label: string }> = ({
  vars,
  label,
}) => (
  <svg
    viewBox="0 0 88 48"
    className="w-full h-12 rounded-md border border-line shrink-0"
    role="img"
    aria-label={`${label} theme swatch`}
  >
    <rect x="0" y="0" width="88" height="48" rx="6" fill={vars['--color-page']} />
    <rect
      x="6"
      y="6"
      width="76"
      height="36"
      rx="4"
      fill={vars['--color-surface']}
      stroke={vars['--color-line']}
      strokeWidth="1"
    />
    <rect x="12" y="12" width="32" height="5" rx="2.5" fill={vars['--color-fg']} />
    <rect x="12" y="20" width="22" height="4" rx="2" fill={vars['--color-fg-muted']} />
    <rect x="12" y="29" width="26" height="8" rx="3" fill={vars['--color-accent']} />
    <circle cx="62" cy="18" r="5" fill={vars['--color-accent-soft']} />
    <circle cx="62" cy="18" r="2.5" fill={vars['--color-accent-text']} />
    <rect x="52" y="30" width="24" height="5" rx="2" fill={vars['--color-line']} />
  </svg>
);

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
          <span className="w-7 h-7 rounded-full bg-accent text-on-accent text-[11px] font-bold flex items-center justify-center shrink-0">
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-xs font-medium text-fg truncate">
            {displayName} {isCurrentUser && <span className="text-[10px] text-fg-subtle font-normal">(You)</span>}
          </div>
          <div className="text-[10px] font-mono text-fg-subtle truncate">
            {isCurrentUser ? currentUserEmail : memberUid}
          </div>
        </div>
      </div>
      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-fill-2 text-fg-muted">
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
    appearance,
    resolvedOptions,
    theme: activeTheme,
    prefersDark,
    previewAppearance,
    saveAppearance,
  } = useTheme();

  const {
    user,
    providers,
    enabledProviders,
    signOut,
    changePassword,
    setPasswordForSsoAccount,
    reauthenticateWithPassword,
    reauthenticateWithGoogle,
    linkGoogleProvider,
    linkMicrosoftProvider,
    unlinkProvider,
  } = useAuth();

  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTab>('all');

  // Appearance local input state, instant preview & debounced save
  const [customHexInput, setCustomHexInput] = useState<string>(appearance.custom.accent);
  const [appearanceStatus, setAppearanceStatus] = useState<{
    type: 'saving' | 'saved' | 'error';
    message: string;
  } | null>(null);
  const appearanceDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const appearanceToastTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setCustomHexInput(appearance.custom.accent);
  }, [appearance.custom.accent]);

  useEffect(() => {
    return () => {
      if (appearanceDebounceRef.current) clearTimeout(appearanceDebounceRef.current);
      if (appearanceToastTimerRef.current) clearTimeout(appearanceToastTimerRef.current);
    };
  }, []);

  const scheduleAppearanceSave = (next: AppearanceSettings, immediate = false) => {
    previewAppearance(next);
    if (appearanceDebounceRef.current) clearTimeout(appearanceDebounceRef.current);
    if (appearanceToastTimerRef.current) clearTimeout(appearanceToastTimerRef.current);

    const runSave = async () => {
      setAppearanceStatus({ type: 'saving', message: 'Saving…' });
      try {
        await saveAppearance(next);
        setAppearanceStatus({ type: 'saved', message: 'Saved' });
        appearanceToastTimerRef.current = setTimeout(() => {
          setAppearanceStatus(null);
        }, 2800);
      } catch (err) {
        setAppearanceStatus({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to save appearance',
        });
      }
    };

    if (immediate) {
      void runSave();
    } else {
      appearanceDebounceRef.current = setTimeout(() => {
        void runSave();
      }, 350);
    }
  };

  const handleResetAppearance = () => {
    setCustomHexInput(DEFAULT_APPEARANCE.custom.accent);
    scheduleAppearanceSave(DEFAULT_APPEARANCE, true);
  };

  const accentFixSuggestion = suggestAccentFix(
    customHexInput,
    appearance.preset === 'custom' ? appearance.custom.mode : resolvedOptions.mode,
    resolvedOptions.contrast
  );

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

  // Delete account modal state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteReauthPassword, setDeleteReauthPassword] = useState('');
  const [deleteReauthBusy, setDeleteReauthBusy] = useState(false);
  const [deleteReauthenticated, setDeleteReauthenticated] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openDeleteAccountDialog = () => {
    setDeleteDialogOpen(true);
    setDeleteReauthPassword('');
    setDeleteReauthBusy(false);
    setDeleteReauthenticated(false);
    setDeleteConfirmText('');
    setDeleteSubmitting(false);
    setDeleteError(null);
  };

  const closeDeleteAccountDialog = () => {
    if (deleteSubmitting) return;
    setDeleteDialogOpen(false);
  };

  const handleDeleteReauthWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteReauthPassword) return;
    setDeleteError(null);
    setDeleteReauthBusy(true);
    try {
      await reauthenticateWithPassword(deleteReauthPassword);
      setDeleteReauthenticated(true);
      setDeleteReauthPassword('');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to verify password.');
    } finally {
      setDeleteReauthBusy(false);
    }
  };

  const handleDeleteReauthWithGoogle = async () => {
    setDeleteError(null);
    setDeleteReauthBusy(true);
    try {
      await reauthenticateWithGoogle();
      setDeleteReauthenticated(true);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Unable to re-authenticate with Google.'
      );
    } finally {
      setDeleteReauthBusy(false);
    }
  };

  const handleConfirmDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteReauthenticated || deleteConfirmText !== 'DELETE') return;
    setDeleteError(null);
    setDeleteSubmitting(true);
    try {
      if (user) {
        await user.getIdToken(true);
      }
      await apiClient.deleteMyAccount('DELETE');
      await signOut();
      navigate('/sign-in?deleted=1', {
        replace: true,
        state: { accountDeletedMessage: 'Your account was deleted.' },
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'TRANSFER_OWNERSHIP_REQUIRED' || err.status === 409) {
          setDeleteError(
            'You own a workspace that has other members. Please transfer workspace ownership or remove other members before deleting your account.'
          );
          setDeleteSubmitting(false);
          return;
        }
        if (err.code === 'REAUTH_REQUIRED' || err.status === 401) {
          setDeleteReauthenticated(false);
          setDeleteError(
            'Please sign in again to delete your account. Re-authenticate below and try again.'
          );
          setDeleteSubmitting(false);
          return;
        }
      }
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete account.');
      setDeleteSubmitting(false);
    }
  };

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
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
          Settings
        </h1>
        <p className="text-xs sm:text-sm text-fg-muted mt-0.5">
          User profile, personal preferences, workspace branding, and project settings (synced across devices in Firestore).
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-line">
        {[
          { id: 'all' as const, label: 'All', icon: Sliders },
          { id: 'appearance' as const, label: 'Appearance', icon: Palette },
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
                  ? 'bg-accent text-on-accent shadow-xs'
                  : 'text-fg-muted hover:bg-fill-2 hover:text-fg'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 0. APPEARANCE SECTION (Theme Engine & Accessibility Controls)   */}
      {/* ------------------------------------------------------------- */}
      {showSection('appearance') && (
        <section
          id="settings-appearance-section"
          data-testid="settings-appearance-section"
          className="p-6 rounded-xl border border-line bg-surface space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-2.5">
              <Palette className="w-4 h-4 text-accent-text" />
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  Appearance
                </h2>
                <p className="text-xs text-fg-muted">
                  Theme presets, custom brand colour with automatic WCAG contrast checks, font scale, density, and chart palettes
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {appearanceStatus && (
                <div
                  role="status"
                  data-testid="appearance-save-toast"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                    appearanceStatus.type === 'saved'
                      ? 'bg-success-soft text-success border border-success-line'
                      : appearanceStatus.type === 'saving'
                        ? 'bg-fill-2 text-fg-muted border border-line'
                        : 'bg-danger-soft text-danger border border-danger-line'
                  }`}
                >
                  {appearanceStatus.type === 'saved' ? (
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : appearanceStatus.type === 'saving' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                  )}
                  <span>{appearanceStatus.message}</span>
                </div>
              )}

              <button
                type="button"
                data-testid="appearance-reset-btn"
                onClick={handleResetAppearance}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-line bg-fill-1 text-fg hover:bg-fill-2 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to default</span>
              </button>
            </div>
          </div>

          {/* Preset Cards (every PRESET_IDS entry + "Match my system") */}
          <div className="space-y-2.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Theme Presets
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PRESET_IDS.map((presetId: PresetId) => {
                const presetMeta = THEME_PRESETS[presetId];
                const swatchVars = buildTheme(presetToOptions(presetId)).vars;
                const isSelected = appearance.preset === presetId;
                return (
                  <button
                    key={presetId}
                    type="button"
                    data-testid={`appearance-preset-${presetId}`}
                    onClick={() =>
                      scheduleAppearanceSave({
                        ...appearance,
                        preset: presetId,
                      })
                    }
                    className={`group flex flex-col gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-accent ring-2 ring-focus/20 bg-accent-soft'
                        : 'border-line hover:border-line-strong bg-fill-1'
                    }`}
                  >
                    <PresetLiveSwatch vars={swatchVars} label={presetMeta.label} />
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-semibold text-fg">
                        {presetMeta.label}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-accent-text" />}
                    </div>
                  </button>
                );
              })}

              {/* "Match my system" preset card */}
              {(() => {
                const systemId: PresetId = prefersDark ? 'adlens-dark' : 'adlens-light';
                const systemVars = buildTheme(presetToOptions(systemId)).vars;
                const isSelected = appearance.preset === 'system';
                return (
                  <button
                    type="button"
                    data-testid="appearance-preset-system"
                    onClick={() =>
                      scheduleAppearanceSave({
                        ...appearance,
                        preset: 'system',
                      })
                    }
                    className={`group flex flex-col gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-accent ring-2 ring-focus/20 bg-accent-soft'
                        : 'border-line hover:border-line-strong bg-fill-1'
                    }`}
                  >
                    <PresetLiveSwatch vars={systemVars} label="Match my system" />
                    <div className="flex items-center justify-between w-full">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-fg">
                        <Monitor className="w-3.5 h-3.5 text-fg-subtle" />
                        <span>Match my system</span>
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-accent-text" />}
                    </div>
                  </button>
                );
              })()}
            </div>
          </div>

          {/* Custom Theme Subsection */}
          <div className="p-4 rounded-xl border border-line bg-fill-1 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent-text" />
                <div>
                  <h3 className="text-xs font-semibold text-fg">
                    Custom Theme
                  </h3>
                  <p className="text-[11px] text-fg-muted">
                    Pick a custom brand accent colour, light/dark mode, and surface tint
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="appearance-preset-custom"
                onClick={() =>
                  scheduleAppearanceSave({
                    ...appearance,
                    preset: 'custom',
                  })
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  appearance.preset === 'custom'
                    ? 'bg-accent text-on-accent border-accent'
                    : 'bg-surface border-line text-fg hover:bg-fill-2'
                }`}
              >
                {appearance.preset === 'custom' ? 'Using Custom' : 'Use Custom'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Accent Colour (hex field + colour picker) */}
              <div className="space-y-1.5">
                <label
                  htmlFor="appearance-accent-hex"
                  className="block text-xs font-medium text-fg"
                >
                  Accent Colour
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="appearance-accent-picker"
                    data-testid="appearance-accent-picker"
                    type="color"
                    aria-label="Accent colour picker"
                    value={normalizeHex(customHexInput) || appearance.custom.accent}
                    onChange={(e) => {
                      const hex = e.target.value.toLowerCase();
                      setCustomHexInput(hex);
                      scheduleAppearanceSave({
                        ...appearance,
                        preset: 'custom',
                        custom: {
                          ...appearance.custom,
                          accent: hex,
                        },
                      });
                    }}
                    className="h-9 w-11 rounded-lg border border-line bg-surface p-0.5 cursor-pointer"
                  />
                  <input
                    id="appearance-accent-hex"
                    data-testid="appearance-accent-hex"
                    type="text"
                    value={customHexInput}
                    placeholder="#1d4ed8"
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCustomHexInput(raw);
                      const normalized = normalizeHex(raw);
                      if (normalized) {
                        scheduleAppearanceSave({
                          ...appearance,
                          preset: 'custom',
                          custom: {
                            ...appearance.custom,
                            accent: normalized,
                          },
                        });
                      }
                    }}
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-line bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
              </div>

              {/* Custom Mode (Light / Dark) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-fg">
                  Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['light', 'dark'] as Mode[]).map((m) => {
                    const isSelected = appearance.custom.mode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        data-testid={`appearance-custom-mode-${m}`}
                        onClick={() =>
                          scheduleAppearanceSave({
                            ...appearance,
                            preset: 'custom',
                            custom: {
                              ...appearance.custom,
                              mode: m,
                            },
                          })
                        }
                        className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-accent text-on-accent border-accent'
                            : 'bg-surface border-line text-fg hover:bg-fill-2'
                        }`}
                      >
                        {m === 'light' ? (
                          <Sun className="w-3.5 h-3.5" />
                        ) : (
                          <Moon className="w-3.5 h-3.5" />
                        )}
                        <span className="capitalize">{m}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Surface Tint */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-fg">
                  Surface Tint
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {TINT_OPTIONS.map((t) => {
                    const isSelected = appearance.custom.tint === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        data-testid={`appearance-custom-tint-${t.value}`}
                        onClick={() =>
                          scheduleAppearanceSave({
                            ...appearance,
                            preset: 'custom',
                            custom: {
                              ...appearance.custom,
                              tint: t.value,
                            },
                          })
                        }
                        className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-accent text-on-accent border-accent'
                            : 'bg-surface border-line text-fg hover:bg-fill-2'
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Contrast warning with "Fix it for me" button when suggestAccentFix() flags low contrast */}
            {accentFixSuggestion &&
              (!accentFixSuggestion.readableAsText || !accentFixSuggestion.visibleAsUi) && (
                <div
                  role="alert"
                  data-testid="appearance-accent-warning"
                  className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-warning-line bg-warning-soft text-warning text-xs"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <span>
                      This accent colour has a contrast ratio of{' '}
                      <strong>{accentFixSuggestion.ratioOnSurface}:1</strong> on cards (
                      {!accentFixSuggestion.visibleAsUi
                        ? 'not visible enough as a UI element or text'
                        : 'not readable enough as link or label text'}
                      ).
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="appearance-fix-accent-btn"
                    onClick={() => {
                      const fixed = !accentFixSuggestion.readableAsText
                        ? accentFixSuggestion.fixedForText
                        : accentFixSuggestion.fixedForUi;
                      setCustomHexInput(fixed);
                      scheduleAppearanceSave({
                        ...appearance,
                        preset: 'custom',
                        custom: {
                          ...appearance.custom,
                          accent: fixed,
                        },
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-warning hover:bg-warning/90 text-on-warning transition-colors cursor-pointer shrink-0"
                  >
                    Fix it for me
                  </button>
                </div>
              )}

            {/* Theme adjustments reported by buildTheme */}
            {activeTheme.adjustments.length > 0 && (
              <div
                data-testid="appearance-theme-adjustments"
                className="flex items-start gap-2 p-3 rounded-lg border border-accent-line bg-accent-soft text-accent-hover text-xs"
              >
                <Info className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                <ul className="space-y-1">
                  {activeTheme.adjustments.map((adj, idx) => (
                    <li key={idx}>{adj}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Font Size, Density, Corner Roundness, Chart Palette */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Font Size */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg">
                Font Size
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(FONT_SCALES) as FontScale[]).map((scaleKey) => {
                  const isSelected = appearance.fontScale === scaleKey;
                  return (
                    <button
                      key={scaleKey}
                      type="button"
                      data-testid={`appearance-font-scale-${scaleKey}`}
                      onClick={() =>
                        scheduleAppearanceSave({
                          ...appearance,
                          fontScale: scaleKey,
                        })
                      }
                      className={`px-2.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-accent text-on-accent border-accent'
                          : 'bg-fill-1 border-line text-fg hover:bg-fill-2'
                      }`}
                    >
                      {FONT_SCALES[scaleKey].label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Density */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg">
                Density
              </label>
              <div className="grid grid-cols-2 gap-2">
                {DENSITY_OPTIONS.map((opt) => {
                  const isSelected = appearance.density === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`appearance-density-${opt.value}`}
                      onClick={() =>
                        scheduleAppearanceSave({
                          ...appearance,
                          density: opt.value,
                        })
                      }
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-accent text-on-accent border-accent'
                          : 'bg-fill-1 border-line text-fg hover:bg-fill-2'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Corner Roundness */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg">
                Corner Roundness
              </label>
              <div className="grid grid-cols-3 gap-2">
                {RADIUS_OPTIONS.map((opt) => {
                  const isSelected = appearance.radius === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`appearance-radius-${opt.value}`}
                      onClick={() =>
                        scheduleAppearanceSave({
                          ...appearance,
                          radius: opt.value,
                        })
                      }
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-accent text-on-accent border-accent'
                          : 'bg-fill-1 border-line text-fg hover:bg-fill-2'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Chart Palette */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-fg">
                  Chart Palette
                </label>
                <svg
                  viewBox="0 0 112 12"
                  className="w-28 h-3"
                  role="img"
                  aria-label="Active chart palette swatch"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n, idx) => (
                    <circle
                      key={n}
                      cx={6 + idx * 14}
                      cy="6"
                      r="5"
                      fill={activeTheme.vars[`--chart-${n}`]}
                    />
                  ))}
                </svg>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CHART_PALETTE_OPTIONS.map((opt) => {
                  const isSelected = appearance.chartPalette === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`appearance-chart-palette-${opt.value}`}
                      onClick={() =>
                        scheduleAppearanceSave({
                          ...appearance,
                          chartPalette: opt.value,
                        })
                      }
                      className={`px-2.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-accent text-on-accent border-accent'
                          : 'bg-fill-1 border-line text-fg hover:bg-fill-2'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {showSection('preferences') && <InstallAppSection />}

      {/* ------------------------------------------------------------- */}
      {/* 1. PREFERENCES SECTION (Synced to users/{uid} settings)         */}
      {/* ------------------------------------------------------------- */}
      {showSection('preferences') && (
        <section
          data-testid="settings-preferences-section"
          className="p-6 rounded-xl border border-line bg-surface space-y-6"
        >
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4 text-accent-text" />
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  Preferences
                </h2>
                <p className="text-xs text-fg-muted">
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
                    ? 'bg-success-soft text-success border border-success-line'
                    : 'bg-danger-soft text-danger border border-danger-line'
                }`}
              >
                {prefToast.type === 'saved' ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                )}
                <span>{prefToast.message}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Link to Appearance section (replaces old Light/Dark/System control) */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg">
                Interface Theme &amp; Appearance
              </label>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-line bg-fill-1">
                <span className="text-xs text-fg-muted">
                  Theme presets, custom colours, font size &amp; chart palettes
                </span>
                <button
                  type="button"
                  data-testid="preferences-appearance-link"
                  onClick={() => {
                    setActiveTab('appearance');
                    document
                      .getElementById('settings-appearance-section')
                      ?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-accent-text hover:underline cursor-pointer shrink-0 ml-2"
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>Appearance</span>
                </button>
              </div>
            </div>

            {/* Default Date Range */}
            <div className="space-y-2">
              <label
                htmlFor="preferences-date-range"
                className="block text-xs font-medium text-fg"
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
                className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
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
              <label className="block text-xs font-medium text-fg">
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
                      ? 'bg-accent text-on-accent border-accent'
                      : 'bg-fill-1 border-line text-fg hover:bg-fill-2'
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
                      ? 'bg-accent text-on-accent border-accent'
                      : 'bg-fill-1 border-line text-fg hover:bg-fill-2'
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
                className="block text-xs font-medium text-fg"
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
                className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
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
                className="block text-xs font-medium text-fg"
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
                className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
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
              <label className="flex items-center gap-2.5 text-xs text-fg cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={prefCompareByDefault}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setPrefCompareByDefault(checked);
                    void handleUpdatePrefField({ compareByDefault: checked });
                  }}
                  className="rounded border-line-strong text-accent-text focus:ring-focus w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Compare to previous period by default on dashboards</span>
              </label>
            </div>
          </div>

          {/* Email Notifications */}
          <div className="pt-4 border-t border-line space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-fg">
              <Bell className="w-3.5 h-3.5 text-fg-subtle" />
              <span>Email Notification Preferences</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
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
                  className="rounded border-line-strong text-accent-text focus:ring-focus"
                />
                <span>Weekly summary</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
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
                  className="rounded border-line-strong text-accent-text focus:ring-focus"
                />
                <span>Anomaly &amp; sync alerts</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
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
                  className="rounded border-line-strong text-accent-text focus:ring-focus"
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
          className="p-6 rounded-xl border border-line bg-surface space-y-6"
        >
          <div className="flex items-center gap-2.5 border-b border-line pb-4">
            <User className="w-4 h-4 text-accent-text" />
            <div>
              <h2 className="text-sm font-semibold text-fg">
                Account &amp; Profile Picture
              </h2>
              <p className="text-xs text-fg-muted">
                Manage your profile picture (stored in Firestore) and display name
              </p>
            </div>
          </div>

          {/* Profile Picture Upload & Remove */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Profile Picture
            </label>

            {avatarBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  avatarBanner.type === 'success'
                    ? 'bg-success-soft border-success-line text-success'
                    : 'bg-danger-soft border-danger-line text-danger'
                }`}
              >
                {avatarBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
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
                    className="w-16 h-16 rounded-full object-cover border-2 border-line shadow-xs"
                  />
                ) : (
                  <div
                    data-testid="account-avatar-initials"
                    className="w-16 h-16 rounded-full bg-accent text-on-accent text-lg font-bold flex items-center justify-center border-2 border-line shadow-xs"
                  >
                    {userInitials}
                  </div>
                )}
                {avatarUploading && (
                  <div className="absolute inset-0 bg-scrim/60 rounded-full flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-on-scrim animate-spin" />
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
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
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
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-danger border border-danger-line hover:bg-danger-soft disabled:opacity-50 transition-colors cursor-pointer"
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
                <p className="text-[11px] text-fg-muted">
                  Accepts PNG, JPEG, WebP, GIF up to 10 MB. Resized and stored directly in Firestore.
                </p>
              </div>
            </div>
          </div>

          {/* Display Name Edit */}
          <form onSubmit={handleSaveDisplayName} className="space-y-3 pt-3 border-t border-line">
            {nameBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  nameBanner.type === 'success'
                    ? 'bg-success-soft border-success-line text-success'
                    : 'bg-danger-soft border-danger-line text-danger'
                }`}
              >
                <span>{nameBanner.message}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="settings-account-display-name"
                  className="block text-xs font-medium text-fg mb-1"
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
                  className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-account-email"
                  className="block text-xs font-medium text-fg mb-1"
                >
                  Email Address
                </label>
                <input
                  id="settings-account-email"
                  type="email"
                  disabled
                  value={user?.email || userProfile?.email || ''}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-line bg-fill-2 text-fg-muted cursor-not-allowed"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={nameSaving}
              data-testid="account-save-name-button"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
            >
              {nameSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save display name</span>
            </button>
          </form>

          {/* Danger Zone — Delete Account */}
          <div
            data-testid="account-danger-zone"
            className="pt-5 border-t border-line"
          >
            <div className="p-4 rounded-xl border border-danger-line bg-danger-soft flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-danger">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Danger zone</span>
                </div>
                <div className="text-xs font-semibold text-fg">
                  Delete account
                </div>
                <p className="text-xs text-fg-muted">
                  Permanently delete your AdLens profile, photo, solo workspaces you own, projects, saved settings, and connected Google/Meta access. This cannot be undone.
                </p>
              </div>
              <button
                type="button"
                onClick={openDeleteAccountDialog}
                data-testid="open-delete-account-dialog"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-on-danger bg-danger hover:bg-danger/90 transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete account</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 3. WORKSPACE SECTION (Name, Defaults, Logo, Members)          */}
      {/* ------------------------------------------------------------- */}
      {showSection('workspace') && (
        <section
          data-testid="settings-workspace-section"
          className="p-6 rounded-xl border border-line bg-surface space-y-6"
        >
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-accent-text" />
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  Workspace Settings &amp; Branding
                </h2>
                <p className="text-xs text-fg-muted">
                  Workspace name, defaults, brand logo, and team members
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase bg-accent-soft text-accent-text border border-accent-line">
              {activeWorkspace?.plan || 'beta'} ({projects.length}/
              {activeWorkspace?.limits?.maxProjects ?? 3} projects)
            </span>
          </div>

          {/* Non-admin notice */}
          {!canManageWorkspace && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-warning-soft border border-warning-line text-xs text-warning">
              <Info className="w-4 h-4 shrink-0 text-warning" />
              <span>You are viewing this workspace as a {activeWorkspace?.role || 'member'}. Only owners and admins can edit settings and logo.</span>
            </div>
          )}

          {/* Workspace Logo Upload */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Workspace Logo
            </label>

            {logoBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  logoBanner.type === 'success'
                    ? 'bg-success-soft border-success-line text-success'
                    : 'bg-danger-soft border-danger-line text-danger'
                }`}
              >
                {logoBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
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
                    className="w-16 h-16 rounded-xl object-contain bg-fill-1 border-2 border-line p-1 shadow-xs"
                  />
                ) : (
                  <div
                    data-testid="workspace-logo-initials"
                    className="w-16 h-16 rounded-xl bg-accent-soft text-accent-text border-2 border-accent-line text-lg font-bold flex items-center justify-center shadow-xs"
                  >
                    {workspaceInitials}
                  </div>
                )}
                {logoUploading && (
                  <div className="absolute inset-0 bg-scrim/60 rounded-xl flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-on-scrim animate-spin" />
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
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-danger border border-danger-line hover:bg-danger-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
                <p className="text-[11px] text-fg-muted">
                  Transparent PNG recommended. Maximum 512 px, saved directly in Firestore.
                </p>
              </div>
            </div>
          </div>

          {/* Workspace Name & Defaults */}
          <form onSubmit={handleSaveWorkspaceSettings} className="space-y-4 pt-3 border-t border-line">
            {wsBanner && (
              <div
                role="status"
                className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                  wsBanner.type === 'success'
                    ? 'bg-success-soft border-success-line text-success'
                    : 'bg-danger-soft border-danger-line text-danger'
                }`}
              >
                <span>{wsBanner.message}</span>
              </div>
            )}

            <div title={roleTooltip}>
              <label
                htmlFor="settings-workspace-name"
                className="block text-xs font-medium text-fg mb-1"
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
                className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" title={roleTooltip}>
              <div>
                <label
                  htmlFor="settings-workspace-currency"
                  className="block text-xs font-medium text-fg mb-1"
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
                  className="w-full px-3 py-2 text-xs font-mono uppercase rounded-lg border border-line bg-fill-1 text-fg disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-workspace-timezone"
                  className="block text-xs font-medium text-fg mb-1"
                >
                  Default Project Time Zone
                </label>
                <select
                  id="settings-workspace-timezone"
                  disabled={!canManageWorkspace}
                  value={wsTimezone}
                  onChange={(e) => setWsTimezone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg disabled:opacity-60 disabled:cursor-not-allowed"
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
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
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
          <div className="pt-4 border-t border-line space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-fg">
              <Users className="w-4 h-4 text-fg-subtle" />
              <span>Workspace Members ({workspaceMembersList.length})</span>
            </div>
            <div
              data-testid="workspace-members-list"
              className="rounded-xl border border-line divide-y divide-line bg-fill-1 overflow-hidden"
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
          className="p-6 rounded-xl border border-line bg-surface space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-2.5">
              <FolderKanban className="w-4 h-4 text-accent-text" />
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  Project Configuration
                </h2>
                <p className="text-xs text-fg-muted">
                  Configure domain, brand terms, and filters for{' '}
                  <span className="font-semibold text-fg">
                    {trackedName}
                  </span>
                </p>
              </div>
            </div>

            {!activeProject && (
              <button
                type="button"
                onClick={openNewProjectModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover cursor-pointer"
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
                  ? 'bg-success-soft border-success-line text-success'
                  : 'bg-danger-soft border-danger-line text-danger'
              }`}
            >
              {projBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
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
                    className="block text-xs font-medium text-fg mb-1"
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
                    className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="settings-project-domain"
                    className="block text-xs font-medium text-fg mb-1"
                  >
                    Website domain (bare hostname)
                  </label>
                  <input
                    id="settings-project-domain"
                    type="text"
                    value={projDomain}
                    onChange={(e) => setProjDomain(e.target.value)}
                    placeholder="example.com"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-line bg-fill-1 text-fg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="settings-project-timezone"
                    className="block text-xs font-medium text-fg mb-1"
                  >
                    Project time zone
                  </label>
                  <select
                    id="settings-project-timezone"
                    value={projTimezone}
                    onChange={(e) => setProjTimezone(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg"
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
                    className="block text-xs font-medium text-fg mb-1"
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
                    className="w-full px-3 py-2 text-xs font-mono uppercase rounded-lg border border-line bg-fill-1 text-fg"
                  />
                </div>
              </div>

              {/* Connected data sources summary + Meta Ad Account override */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-lg bg-fill-1 border border-line text-xs">
                <div>
                  <div className="text-[11px] font-semibold text-fg-muted">
                    GA4 Property
                  </div>
                  <div className="mt-0.5 font-mono text-fg truncate">
                    {activeProject.ga4PropertyName || activeProject.ga4PropertyId || 'Not bound'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-fg-muted">
                    Search Console Site
                  </div>
                  <div className="mt-0.5 font-mono text-fg truncate">
                    {activeProject.searchConsoleSite || 'Not bound'}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="settings-project-meta-account"
                    className="block text-[11px] font-semibold text-fg-muted"
                  >
                    Meta Ad Account ID
                  </label>
                  <input
                    id="settings-project-meta-account"
                    type="text"
                    value={projMetaAdAccountId}
                    onChange={(e) => setProjMetaAdAccountId(e.target.value)}
                    placeholder="e.g. 123456789"
                    className="mt-1 w-full px-2.5 py-1 text-xs font-mono rounded border border-line bg-surface text-fg"
                  />
                </div>
              </div>

              {/* Brand terms (max 20) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-fg mb-1">
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
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-line bg-fill-1 text-fg"
                    />
                    <button
                      type="button"
                      onClick={handleAddBrandTerm}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-line bg-fill-2 text-fg hover:bg-fill-3 cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                  {brandTerms.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {brandTerms.map((term) => (
                        <span
                          key={term}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-accent-soft text-accent-text border border-accent-line"
                        >
                          <span>{term}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setBrandTerms((prev) => prev.filter((item) => item !== term))
                            }
                            aria-label={`Remove brand term ${term}`}
                            className="hover:text-accent-hover cursor-pointer"
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
                  <label className="block text-xs font-medium text-fg mb-1">
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
                      className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-line bg-fill-1 text-fg"
                    />
                    <button
                      type="button"
                      onClick={handleAddHostnameFilter}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-line bg-fill-2 text-fg hover:bg-fill-3 cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                  {hostnameFilters.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {hostnameFilters.map((host) => (
                        <span
                          key={host}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-fill-2 text-fg border border-line"
                        >
                          <span>{host}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setHostnameFilters((prev) => prev.filter((item) => item !== host))
                            }
                            aria-label={`Remove hostname ${host}`}
                            className="hover:text-fg cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-line">
                {canManageWorkspace ? (
                  <button
                    type="button"
                    disabled={projDeleting || projSaving}
                    onClick={handleDeleteActiveProject}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-danger border border-danger-line hover:bg-danger-soft cursor-pointer disabled:opacity-50"
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
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
            <p className="text-xs text-fg-muted">
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
          className="p-6 rounded-xl border border-line bg-surface space-y-6"
        >
          <div className="flex items-center gap-2.5 border-b border-line pb-4">
            <Shield className="w-4 h-4 text-accent-text" />
            <div>
              <h2 className="text-sm font-semibold text-fg">
                Security &amp; Sign-in Methods
              </h2>
              <p className="text-xs text-fg-muted">
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
                  <KeyRound className="w-4 h-4 text-fg-muted" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    {hasPasswordProvider ? 'Change password' : 'Set a password'}
                  </h3>
                </div>

                {!hasPasswordProvider && (
                  <p className="text-xs text-fg-muted">
                    Your account currently signs in via SSO. Set a password to enable direct email and password sign-in.
                  </p>
                )}

                {passwordBanner && (
                  <div
                    role="status"
                    className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                      passwordBanner.type === 'success'
                        ? 'bg-success-soft border-success-line text-success'
                        : 'bg-danger-soft border-danger-line text-danger'
                    }`}
                  >
                    {passwordBanner.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                    )}
                    <span>{passwordBanner.message}</span>
                  </div>
                )}

                <form onSubmit={handlePasswordSubmit} className="space-y-3">
                  {hasPasswordProvider && (
                    <div className="space-y-1">
                      <label
                        htmlFor="security-current-password"
                        className="block text-xs font-medium text-fg"
                      >
                        Current password
                      </label>
                      <div className="relative">
                        <Lock className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="security-current-password"
                          type="password"
                          required
                          autoComplete="current-password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="Enter current password"
                          className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label
                      htmlFor="security-new-password"
                      className="block text-xs font-medium text-fg"
                    >
                      New password
                    </label>
                    <div className="relative">
                      <Lock className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="security-new-password"
                        type="password"
                        required
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                      />
                    </div>
                    <PasswordStrengthChecklist password={newPassword} />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="security-confirm-password"
                      className="block text-xs font-medium text-fg"
                    >
                      Confirm new password
                    </label>
                    <div className="relative">
                      <Lock className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="security-confirm-password"
                        type="password"
                        required
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={passwordSaving}
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
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
                <Link2 className="w-4 h-4 text-fg-muted" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  Sign-in methods
                </h3>
              </div>

              <p className="text-xs text-fg-muted">
                Manage active sign-in providers on your account. At least one sign-in method must remain active.
              </p>

              {providerBanner && (
                <div
                  role="status"
                  className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                    providerBanner.type === 'success'
                      ? 'bg-success-soft border-success-line text-success'
                      : 'bg-danger-soft border-danger-line text-danger'
                  }`}
                >
                  {providerBanner.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                  )}
                  <span>{providerBanner.message}</span>
                </div>
              )}

              <div className="space-y-2.5">
                {/* Email & Password */}
                {showPasswordOption && (
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-line bg-fill-1">
                    <div>
                      <div className="text-xs font-semibold text-fg">
                        Email &amp; password
                      </div>
                      <div className="text-[11px] text-fg-muted">
                        {hasPasswordProvider ? 'Linked' : 'Not set — use form on the left'}
                      </div>
                    </div>
                    {hasPasswordProvider && (
                      <button
                        type="button"
                        disabled={!canUnlink || providerBusy === 'password'}
                        onClick={() => handleUnlinkProvider('password', 'Password')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-line text-fg hover:bg-fill-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Unlink className="w-3 h-3" />
                        <span>Unlink</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Google */}
                {showGoogleOption && (
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-line bg-fill-1">
                    <div>
                      <div className="text-xs font-semibold text-fg">
                        Google
                      </div>
                      <div className="text-[11px] text-fg-muted">
                        {hasGoogleProvider ? 'Linked' : 'Not linked'}
                      </div>
                    </div>
                    {hasGoogleProvider ? (
                      <button
                        type="button"
                        disabled={!canUnlink || providerBusy === 'google.com'}
                        onClick={() => handleUnlinkProvider('google.com', 'Google')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-line text-fg hover:bg-fill-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Unlink className="w-3 h-3" />
                        <span>Unlink</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={providerBusy === 'google.com'}
                        onClick={() => handleLinkProvider('google.com')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-accent-text border border-accent-line hover:bg-accent-soft cursor-pointer disabled:opacity-50"
                      >
                        <Link2 className="w-3 h-3" />
                        <span>Link Google</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Microsoft */}
                {showMicrosoftOption && (
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-line bg-fill-1">
                    <div>
                      <div className="text-xs font-semibold text-fg">
                        Microsoft
                      </div>
                      <div className="text-[11px] text-fg-muted">
                        {hasMicrosoftProvider ? 'Linked' : 'Not linked'}
                      </div>
                    </div>
                    {hasMicrosoftProvider ? (
                      <button
                        type="button"
                        disabled={!canUnlink || providerBusy === 'microsoft.com'}
                        onClick={() => handleUnlinkProvider('microsoft.com', 'Microsoft')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-line text-fg hover:bg-fill-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Unlink className="w-3 h-3" />
                        <span>Unlink</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={providerBusy === 'microsoft.com'}
                        onClick={() => handleLinkProvider('microsoft.com')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-accent-text border border-accent-line hover:bg-accent-soft cursor-pointer disabled:opacity-50"
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

      {showSection('workspace') && <PlanCard />}
      {showSection('workspace') && <TeamCard />}
      {showSection('preferences') && <EmailSummariesCard />}
      {showSection('security') && <SessionsCard />}
      {showSection('security') && <SsoSettingsCard />}
      {showSection('security') && <WorkspaceActivityCard />}
      {showSection('security') && <SecurityActivityCard />}

      {/* ------------------------------------------------------------- */}
      {/* 6. ABOUT CARD                                                 */}
      {/* ------------------------------------------------------------- */}
      <div className="p-5 rounded-xl border border-line bg-surface space-y-3">
        <div className="flex items-center gap-2.5">
          <Info className="w-4 h-4 text-accent-text" />
          <h2 className="text-sm font-semibold text-fg">About {APP_NAME}</h2>
        </div>

        <p
          data-testid="about-card-headline"
          className="text-xs sm:text-sm font-semibold text-fg"
        >
          {APP_NAME} · Tracked website: {trackedName} ({trackedDomain})
        </p>

        <p className="text-xs text-fg-muted leading-relaxed">
          {APP_TAGLINE} — Version {APP_VERSION}. Built on a modular data-adapter architecture
          unifying Google Analytics 4, Google Search Console, and Meta Ads.
        </p>

        <div className="pt-3 border-t border-line flex items-center justify-between text-[11px] font-mono text-fg-subtle">
          <span>Version: {APP_VERSION}</span>
          <span>1 USD = ৳{USD_TO_BDT_RATE} BDT</span>
          <span>Property: {trackedDomain}</span>
        </div>
      </div>

      {/* Delete Account Confirmation Dialog */}
      {deleteDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-dialog-title"
          data-testid="delete-account-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/60 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-danger-soft text-danger flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="delete-account-dialog-title"
                    className="text-base font-bold text-fg"
                  >
                    Delete account
                  </h2>
                  <p className="text-xs text-danger font-medium">
                    This action is permanent and cannot be undone.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDeleteAccountDialog}
                disabled={deleteSubmitting}
                aria-label="Close delete account dialog"
                className="p-1.5 rounded-lg text-fg-subtle hover:text-fg hover:bg-fill-2 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-fill-1 border border-line text-xs text-fg space-y-2">
              <div className="font-semibold text-fg">
                Deleting your account will permanently remove:
              </div>
              <ul className="list-disc pl-4 space-y-1 text-fg-muted">
                <li>Your user profile and profile photo</li>
                <li>Workspaces you own (with no other members) and workspace logos</li>
                <li>All projects and usage records inside your owned workspaces</li>
                <li>Your saved personal preferences and notification settings</li>
                <li>Connected Google (GA4, Search Console) and Meta Ads access</li>
              </ul>
            </div>

            {deleteError && (
              <div
                role="alert"
                data-testid="delete-account-error-banner"
                className="flex items-start gap-2 p-3 rounded-xl border border-danger-line bg-danger-soft text-xs text-danger"
              >
                <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            {/* Step 1: Re-authenticate */}
            <div className="space-y-3 pt-1 border-t border-line">
              <div className="text-xs font-semibold text-fg">
                1. Confirm your identity
              </div>

              {deleteReauthenticated ? (
                <div
                  role="status"
                  data-testid="delete-account-reauth-verified"
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-success-line bg-success-soft text-xs font-medium text-success"
                >
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  <span>Identity verified — recent sign-in confirmed.</span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {(hasPasswordProvider || (!hasGoogleProvider && showPasswordOption)) && (
                    <form onSubmit={handleDeleteReauthWithPassword} className="flex gap-2">
                      <input
                        type="password"
                        required
                        autoComplete="current-password"
                        value={deleteReauthPassword}
                        onChange={(e) => setDeleteReauthPassword(e.target.value)}
                        placeholder="Enter your password"
                        data-testid="delete-account-password-input"
                        className="flex-1 px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg"
                      />
                      <button
                        type="submit"
                        disabled={deleteReauthBusy || !deleteReauthPassword}
                        data-testid="delete-account-reauth-password-button"
                        className="px-3 py-2 rounded-lg text-xs font-semibold text-surface bg-fg hover:bg-fg/90 disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {deleteReauthBusy ? 'Verifying...' : 'Verify password'}
                      </button>
                    </form>
                  )}

                  {hasGoogleProvider && (
                    <button
                      type="button"
                      disabled={deleteReauthBusy}
                      onClick={handleDeleteReauthWithGoogle}
                      data-testid="delete-account-reauth-google-button"
                      className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg border border-line bg-fill-1 hover:bg-fill-2 text-xs font-semibold text-fg cursor-pointer disabled:opacity-50"
                    >
                      {deleteReauthBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : null}
                      <span>Re-authenticate with Google</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Type DELETE */}
            <form onSubmit={handleConfirmDeleteAccount} className="space-y-4 pt-2 border-t border-line">
              <div className="space-y-1.5">
                <label
                  htmlFor="delete-account-confirm-input"
                  className="block text-xs font-semibold text-fg"
                >
                  2. Type <span className="font-mono text-danger">DELETE</span> to confirm
                </label>
                <input
                  id="delete-account-confirm-input"
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  disabled={!deleteReauthenticated || deleteSubmitting}
                  placeholder="DELETE"
                  data-testid="delete-account-confirm-input"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-line bg-fill-1 text-fg disabled:opacity-50"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={closeDeleteAccountDialog}
                  disabled={deleteSubmitting}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold text-fg border border-line hover:bg-fill-2 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    !deleteReauthenticated ||
                    deleteConfirmText !== 'DELETE' ||
                    deleteSubmitting
                  }
                  data-testid="confirm-delete-account-button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-on-danger bg-danger hover:bg-danger/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {deleteSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  <span>{deleteSubmitting ? 'Deleting account...' : 'Delete account'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
