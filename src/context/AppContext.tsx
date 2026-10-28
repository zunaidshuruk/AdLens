import {
  doc,
  onSnapshot,
} from 'firebase/firestore';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiClient, setActiveProjectHeader } from '../api/client.js';
import { DEMO_PROJECT } from '../config/app.js';
import { db, firestoreDirectAvailable, markFirestoreDirectUnavailable } from '../lib/firebase.js';
import {
  removeAvatarDirect,
  removeWorkspaceLogoDirect,
  saveDisplayNameDirect,
  saveUserSettingsDirect,
  saveWorkspaceSettingsDirect,
  uploadAvatarDirect,
  uploadWorkspaceLogoDirect,
  VALID_DATE_RANGES,
  VALID_NUMBER_FORMATS,
  VALID_THEMES,
} from '../lib/firestoreClient.js';
import type {
  ComputedDateRange,
  CurrencyCode,
  DatePreset,
  NumberFormatLocale,
  ProjectConfig,
  ThemeMode,
  UserProfile,
  UserSettings,
  WorkspaceSummary,
} from '../types/index.js';
import { computeDateRange } from '../utils/dateUtils.js';
import { resolveAppearance, sanitizeAppearance } from '../utils/themeEngine.js';
import { useAuth } from './AuthContext.js';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface CustomDateRange {
  startDate: string;
  endDate: string;
}

interface AppContextValue {
  preset: DatePreset;
  setPreset: (preset: DatePreset) => void;
  customDates: CustomDateRange;
  setCustomDates: (dates: CustomDateRange) => void;
  compareEnabled: boolean;
  setCompareEnabled: (enabled: boolean) => void;
  toggleCompare: () => void;
  dateRange: ComputedDateRange;
  computedDateRange: ComputedDateRange;
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  timezone: string;
  setTimezone: (tz: string) => void;
  numberFormat: NumberFormatLocale;
  setNumberFormat: (format: NumberFormatLocale) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => void;
  toggleTheme: () => void;

  // Firestore user, workspace & project state
  userProfile: UserProfile | null;
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  projects: ProjectConfig[];
  activeProject: ProjectConfig | null;
  workspaceLoading: boolean;
  isDemoMode: boolean;
  setIsDemoMode: (demo: boolean) => void;
  selectProject: (projectId: string) => void;
  refreshMe: () => Promise<void>;
  createProject: (input: {
    name: string;
    domain?: string;
    timezone?: string;
    currency?: string;
    isDemo?: boolean;
  }) => Promise<ProjectConfig>;
  updateProject: (
    projectId: string,
    patch: Partial<{
      name: string;
      domain: string;
      timezone: string;
      currency: string;
      brandTerms: string[];
      hostnameFilters: string[];
      ga4PropertyId: string | null;
      ga4PropertyName: string | null;
      searchConsoleSite: string | null;
      metaAdAccountId: string | null;
      metaAdAccountName: string | null;
    }>
  ) => Promise<ProjectConfig>;
  deleteProject: (projectId: string) => Promise<void>;
  updateUserProfile: (patch: {
    displayName?: string;
    photoURL?: string | null;
    photoPath?: string | null;
    settings?: UserSettings;
  }) => Promise<UserProfile>;
  savePreferences: (patch: Partial<UserSettings>) => Promise<UserSettings>;
  updateUserDisplayName: (name: string) => Promise<string>;
  updateWorkspaceSettings: (patch: {
    name?: string;
    logoURL?: string | null;
    logoPath?: string | null;
    defaults?: { currency: string; timezone: string };
    requireTwoStep?: boolean;
  }) => Promise<WorkspaceSummary>;
  updateWorkspaceDefaults: (
    wsId: string,
    name: string,
    defaults: { currency: string; timezone: string }
  ) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
  removeAvatar: () => Promise<void>;
  uploadWorkspaceLogo: (wsId: string, file: File) => Promise<string>;
  removeWorkspaceLogo: (wsId: string) => Promise<void>;
  isNewProjectModalOpen: boolean;
  openNewProjectModal: () => void;
  closeNewProjectModal: () => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const STORAGE_KEYS = {
  PRESET: 'adlens_date_preset',
  COMPARE: 'adlens_compare_enabled',
  CURRENCY: 'adlens_currency',
  TIMEZONE: 'adlens_timezone',
  THEME: 'adlens_theme',
  NUMBER_FORMAT: 'adlens_number_format',
};

function readStorage<T extends string>(key: string, fallback: T): T {
  try {
    const val = localStorage.getItem(key);
    return (val as T) || fallback;
  } catch {
    return fallback;
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, emailVerified, loading: authLoading } = useAuth();

  const [preset, setPresetState] = useState<DatePreset>(() =>
    readStorage<DatePreset>(STORAGE_KEYS.PRESET, 'Last 28 days')
  );
  const [customDates, setCustomDates] = useState<CustomDateRange>({
    startDate: '',
    endDate: '',
  });
  const [compareEnabled, setCompareEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.COMPARE);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [currency, setCurrencyState] = useState<CurrencyCode>(() =>
    readStorage<CurrencyCode>(STORAGE_KEYS.CURRENCY, 'USD')
  );
  const [timezone, setTimezoneState] = useState<string>(() =>
    readStorage(STORAGE_KEYS.TIMEZONE, 'UTC')
  );
  const [numberFormat, setNumberFormatState] = useState<NumberFormatLocale>(() =>
    readStorage<NumberFormatLocale>(STORAGE_KEYS.NUMBER_FORMAT, 'en-US')
  );

  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() =>
    readStorage<ThemePreference>(STORAGE_KEYS.THEME, 'system')
  );

  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Firestore user, workspace & project state
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState<boolean>(false);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);
  const settingsAppliedForUid = useRef<string | null>(null);

  const theme: ThemeMode = useMemo(() => {
    if (userProfile?.settings?.appearance) {
      return resolveAppearance(
        sanitizeAppearance(userProfile.settings.appearance).value,
        systemDark
      ).mode;
    }
    if (themePreference === 'system') {
      return systemDark ? 'dark' : 'light';
    }
    return themePreference;
  }, [userProfile?.settings?.appearance, themePreference, systemDark]);

  const applyMeResponse = useCallback(
    (
      uid: string,
      me: { user: UserProfile; workspaces: WorkspaceSummary[]; projects: ProjectConfig[] }
    ) => {
      setUserProfile(me.user);
      setWorkspaces(me.workspaces);
      setProjects(me.projects);

      if (settingsAppliedForUid.current !== uid && me.user?.settings) {
        settingsAppliedForUid.current = uid;
        const s = me.user.settings;
        if (s.theme && VALID_THEMES.includes(s.theme)) {
          setThemePreferenceState(s.theme);
        } else {
          try {
            const oldTheme = localStorage.getItem('adlens_theme');
            if (oldTheme && ['light', 'dark', 'system'].includes(oldTheme)) {
              localStorage.removeItem('adlens_theme');
              setThemePreferenceState(oldTheme as ThemePreference);
              void saveUserSettingsDirect(uid, s, {
                theme: oldTheme as ThemePreference,
              }).catch(() => {});
            }
          } catch {
            // ignore
          }
        }
        if (s.displayCurrency && (s.displayCurrency === 'BDT' || s.displayCurrency === 'USD')) {
          setCurrencyState(s.displayCurrency as CurrencyCode);
        }
        if (s.timezone) {
          setTimezoneState(s.timezone);
        }
        if (s.numberFormat && VALID_NUMBER_FORMATS.includes(s.numberFormat)) {
          setNumberFormatState(s.numberFormat);
        }
        if (s.defaultDateRange && VALID_DATE_RANGES.includes(s.defaultDateRange as (typeof VALID_DATE_RANGES)[number])) {
          setPresetState(s.defaultDateRange);
        }
        if (typeof s.compareByDefault === 'boolean') {
          setCompareEnabledState(s.compareByDefault);
        }
      }

      // Restore active project per user from localStorage
      const storageKey = `adlens_active_project_${uid}`;
      let savedHeader: string | null = null;
      try {
        savedHeader = localStorage.getItem(storageKey);
      } catch {
        // ignore
      }

      let chosenProject: ProjectConfig | null = null;
      if (savedHeader) {
        const [, savedProjId] = savedHeader.split('/');
        chosenProject =
          me.projects.find(
            (p) => `${p.workspaceId}/${p.id}` === savedHeader || p.id === savedProjId
          ) ?? null;
      }

      if (!chosenProject && me.projects.length > 0) {
        chosenProject = me.projects[0];
      }

      if (chosenProject) {
        setActiveProjectId(chosenProject.id);
        const headerVal = `${chosenProject.workspaceId}/${chosenProject.id}`;
        setActiveProjectHeader(headerVal);
        try {
          localStorage.setItem(storageKey, headerVal);
        } catch {
          // ignore
        }
        setIsDemoMode(Boolean(chosenProject.isDemo));
      } else {
        setActiveProjectId(null);
        setActiveProjectHeader(null);
      }
    },
    []
  );

  // Subscribe to real-time updates on users/{uid} with onSnapshot after bootstrap completes
  useEffect(() => {
    if (workspaceLoading || !userProfile?.uid || !user || !emailVerified || !db || !firestoreDirectAvailable) {
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(
      userRef,
      (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        const settings = (data.settings as UserSettings) || {};

        setUserProfile((prev) => ({
          uid: user.uid,
          email: typeof data.email === 'string' ? data.email : user.email || '',
          displayName:
            typeof data.displayName === 'string' ? data.displayName : prev?.displayName || 'AdLens User',
          photoURL: typeof data.photoURL === 'string' ? data.photoURL : prev?.photoURL ?? null,
          photoPath: typeof data.photoPath === 'string' ? data.photoPath : null,
          hasCustomAvatar: Boolean(data.hasCustomAvatar),
          settings,
          createdAt:
            data.createdAt && typeof data.createdAt === 'object' && 'toDate' in data.createdAt
              ? (data.createdAt as { toDate: () => Date }).toDate().toISOString()
              : prev?.createdAt || new Date().toISOString(),
          updatedAt:
            data.updatedAt && typeof data.updatedAt === 'object' && 'toDate' in data.updatedAt
              ? (data.updatedAt as { toDate: () => Date }).toDate().toISOString()
              : prev?.updatedAt || new Date().toISOString(),
        }));

        if (settings.theme && VALID_THEMES.includes(settings.theme)) {
          setThemePreferenceState(settings.theme);
        }
        if (
          settings.defaultDateRange &&
          VALID_DATE_RANGES.includes(settings.defaultDateRange as (typeof VALID_DATE_RANGES)[number])
        ) {
          setPresetState(settings.defaultDateRange);
        }
        if (typeof settings.compareByDefault === 'boolean') {
          setCompareEnabledState(settings.compareByDefault);
        }
        if (
          settings.displayCurrency &&
          (settings.displayCurrency === 'USD' || settings.displayCurrency === 'BDT')
        ) {
          setCurrencyState(settings.displayCurrency as CurrencyCode);
        }
        if (settings.timezone) {
          setTimezoneState(settings.timezone);
        }
        if (settings.numberFormat && VALID_NUMBER_FORMATS.includes(settings.numberFormat)) {
          setNumberFormatState(settings.numberFormat);
        }

        // Migrate old localStorage theme if needed
        try {
          const oldTheme = localStorage.getItem('adlens_theme');
          if (oldTheme && !settings.theme && ['light', 'dark', 'system'].includes(oldTheme)) {
            localStorage.removeItem('adlens_theme');
            void saveUserSettingsDirect(user.uid, settings, {
              theme: oldTheme as ThemePreference,
            }).catch(() => {});
          }
        } catch {
          // ignore
        }
      },
      () => {
        markFirestoreDirectUnavailable();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [user, emailVerified, workspaceLoading, userProfile?.uid]);

  // After sign-in, call /api/me/bootstrap, then /api/me
  useEffect(() => {
    if (authLoading) return;
    if (!user || !emailVerified) {
      setUserProfile(null);
      setWorkspaces([]);
      setProjects([]);
      setActiveProjectId(null);
      setActiveProjectHeader(null);
      setWorkspaceLoading(false);
      settingsAppliedForUid.current = null;
      return;
    }

    let cancelled = false;
    setWorkspaceLoading(true);

    (async () => {
      try {
        await apiClient.bootstrapMe(user.displayName || undefined);
        const me = await apiClient.getMe();
        if (!cancelled) {
          applyMeResponse(user.uid, me);
        }
      } catch {
        try {
          const me = await apiClient.getMe();
          if (!cancelled) {
            applyMeResponse(user.uid, me);
          }
        } catch {
          // ignore if offline or unconfigured in tests
        }
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, emailVerified, authLoading, applyMeResponse]);

  const activeWorkspace = useMemo<WorkspaceSummary | null>(() => {
    if (workspaces.length === 0) return null;
    if (activeProjectId) {
      const proj = projects.find((p) => p.id === activeProjectId);
      if (proj) {
        const found = workspaces.find((w) => w.id === proj.workspaceId);
        if (found) return found;
      }
    }
    return workspaces[0];
  }, [workspaces, projects, activeProjectId]);

  const activeProject = useMemo<ProjectConfig | null>(() => {
    if (!activeProjectId) return projects[0] ?? null;
    return projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;
  }, [projects, activeProjectId]);

  // Keep X-AdLens-Project header in sync with activeProject
  useEffect(() => {
    if (activeProject && user) {
      const headerVal = `${activeProject.workspaceId}/${activeProject.id}`;
      setActiveProjectHeader(headerVal);
      try {
        localStorage.setItem(`adlens_active_project_${user.uid}`, headerVal);
      } catch {
        // ignore
      }
    }
  }, [activeProject, user]);

  const selectProject = useCallback(
    (projectId: string) => {
      const proj = projects.find((p) => p.id === projectId);
      if (proj) {
        setActiveProjectId(proj.id);
        const headerVal = `${proj.workspaceId}/${proj.id}`;
        setActiveProjectHeader(headerVal);
        if (user) {
          try {
            localStorage.setItem(`adlens_active_project_${user.uid}`, headerVal);
          } catch {
            // ignore
          }
        }
        setIsDemoMode(Boolean(proj.isDemo));
      }
    },
    [projects, user]
  );

  const refreshMe = useCallback(async () => {
    if (!user || !emailVerified) return;
    try {
      const me = await apiClient.getMe();
      applyMeResponse(user.uid, me);
    } catch {
      // ignore
    }
  }, [user, emailVerified, applyMeResponse]);

  const createProject = useCallback(
    async (input: {
      name: string;
      domain?: string;
      timezone?: string;
      currency?: string;
      isDemo?: boolean;
    }): Promise<ProjectConfig> => {
      const wsId = activeWorkspace?.id || workspaces[0]?.id;
      if (!wsId) {
        throw new Error('No active workspace available to create project.');
      }
      const { project } = await apiClient.createProject(wsId, input);
      setProjects((prev) => [...prev, project]);
      setActiveProjectId(project.id);
      setActiveProjectHeader(`${wsId}/${project.id}`);
      if (user) {
        try {
          localStorage.setItem(`adlens_active_project_${user.uid}`, `${wsId}/${project.id}`);
        } catch {
          // ignore
        }
      }
      setIsDemoMode(Boolean(project.isDemo));
      return project;
    },
    [activeWorkspace, workspaces, user]
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      patch: Partial<{
        name: string;
        domain: string;
        timezone: string;
        currency: string;
        brandTerms: string[];
        hostnameFilters: string[];
        ga4PropertyId: string | null;
        ga4PropertyName: string | null;
        searchConsoleSite: string | null;
        metaAdAccountId: string | null;
        metaAdAccountName: string | null;
      }>
    ): Promise<ProjectConfig> => {
      const target = projects.find((p) => p.id === projectId);
      const wsId = target?.workspaceId || activeWorkspace?.id;
      if (!wsId) {
        throw new Error('Project not found.');
      }
      const { project: updated } = await apiClient.updateProject(wsId, projectId, patch);
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      return updated;
    },
    [projects, activeWorkspace]
  );

  const deleteProject = useCallback(
    async (projectId: string): Promise<void> => {
      const target = projects.find((p) => p.id === projectId);
      const wsId = target?.workspaceId || activeWorkspace?.id;
      if (!wsId) {
        throw new Error('Project not found.');
      }
      await apiClient.deleteProject(wsId, projectId);
      setProjects((prev) => {
        const remaining = prev.filter((p) => p.id !== projectId);
        if (activeProjectId === projectId) {
          const next = remaining[0] ?? null;
          setActiveProjectId(next?.id ?? null);
          setActiveProjectHeader(next ? `${next.workspaceId}/${next.id}` : null);
        }
        return remaining;
      });
    },
    [projects, activeWorkspace, activeProjectId]
  );

  const savePreferences = useCallback(
    async (patch: Partial<UserSettings>): Promise<UserSettings> => {
      const current = userProfile?.settings || {};

      // Optimistic update
      if (patch.theme && VALID_THEMES.includes(patch.theme)) {
        setThemePreferenceState(patch.theme);
      }
      if (
        patch.defaultDateRange &&
        VALID_DATE_RANGES.includes(patch.defaultDateRange as (typeof VALID_DATE_RANGES)[number])
      ) {
        setPresetState(patch.defaultDateRange);
      }
      if (typeof patch.compareByDefault === 'boolean') {
        setCompareEnabledState(patch.compareByDefault);
      }
      if (
        patch.displayCurrency &&
        (patch.displayCurrency === 'USD' || patch.displayCurrency === 'BDT')
      ) {
        setCurrencyState(patch.displayCurrency as CurrencyCode);
      }
      if (patch.timezone) {
        setTimezoneState(patch.timezone);
      }
      if (patch.numberFormat && VALID_NUMBER_FORMATS.includes(patch.numberFormat)) {
        setNumberFormatState(patch.numberFormat);
      }

      if (user?.uid && emailVerified) {
        try {
          const merged = await saveUserSettingsDirect(user.uid, current, patch);
          setUserProfile((prev) => (prev ? { ...prev, settings: merged } : null));
          return merged;
        } catch (err) {
          // Revert optimistic updates
          if (current.theme) setThemePreferenceState(current.theme);
          if (current.defaultDateRange) setPresetState(current.defaultDateRange);
          if (typeof current.compareByDefault === 'boolean') setCompareEnabledState(current.compareByDefault);
          if (current.displayCurrency) setCurrencyState(current.displayCurrency as CurrencyCode);
          if (current.timezone) setTimezoneState(current.timezone);
          if (current.numberFormat) setNumberFormatState(current.numberFormat);
          throw err;
        }
      } else {
        // Fallback to server API if not signed in via Firebase Auth
        const { user: updated } = await apiClient.updateMe({ settings: patch });
        setUserProfile(updated);
        return updated.settings;
      }
    },
    [user, emailVerified, userProfile]
  );

  const updateUserProfile = useCallback(
    async (patch: {
      displayName?: string;
      photoURL?: string | null;
      photoPath?: string | null;
      settings?: UserSettings;
    }): Promise<UserProfile> => {
      if (patch.settings) {
        await savePreferences(patch.settings);
      }
      if (patch.displayName && user?.uid && emailVerified) {
        await saveDisplayNameDirect(user.uid, patch.displayName);
      }
      const { user: updated } = await apiClient.updateMe({
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
      });
      setUserProfile(updated);
      return updated;
    },
    [savePreferences, user, emailVerified]
  );

  const updateUserDisplayName = useCallback(
    async (name: string): Promise<string> => {
      if (!user?.uid) throw new Error('Not signed in');
      const saved = await saveDisplayNameDirect(user.uid, name);
      setUserProfile((prev) => (prev ? { ...prev, displayName: saved } : null));
      return saved;
    },
    [user]
  );

  const updateWorkspaceDefaults = useCallback(
    async (
      wsId: string,
      name: string,
      defaults: { currency: string; timezone: string }
    ): Promise<void> => {
      await saveWorkspaceSettingsDirect(wsId, name, defaults);
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === wsId
            ? { ...w, name, defaults: { currency: defaults.currency, timezone: defaults.timezone } }
            : w
        )
      );
    },
    []
  );

  const updateWorkspaceSettings = useCallback(
    async (patch: {
      name?: string;
      logoURL?: string | null;
      logoPath?: string | null;
      defaults?: { currency: string; timezone: string };
      requireTwoStep?: boolean;
    }): Promise<WorkspaceSummary> => {
      const wsId = activeWorkspace?.id || workspaces[0]?.id;
      if (!wsId) {
        throw new Error('No active workspace found.');
      }
      if (patch.name && patch.defaults) {
        await saveWorkspaceSettingsDirect(wsId, patch.name, patch.defaults);
      }
      const { workspace } = await apiClient.updateWorkspace(wsId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.defaults !== undefined ? { defaults: patch.defaults } : {}),
        ...(patch.requireTwoStep !== undefined ? { requireTwoStep: patch.requireTwoStep } : {}),
      });
      setWorkspaces((prev) => prev.map((w) => (w.id === workspace.id ? workspace : w)));
      return workspace;
    },
    [activeWorkspace, workspaces]
  );

  const uploadAvatar = useCallback(
    async (file: File): Promise<string> => {
      if (!user?.uid) throw new Error('Not signed in');
      const dataUrl = await uploadAvatarDirect(user.uid, file);
      const nowIso = new Date().toISOString();
      setUserProfile((prev) =>
        prev ? { ...prev, hasCustomAvatar: true, updatedAt: nowIso } : null
      );
      return dataUrl;
    },
    [user]
  );

  const removeAvatar = useCallback(async (): Promise<void> => {
    if (!user?.uid) throw new Error('Not signed in');
    await removeAvatarDirect(user.uid);
    const nowIso = new Date().toISOString();
    setUserProfile((prev) =>
      prev ? { ...prev, hasCustomAvatar: false, updatedAt: nowIso } : null
    );
  }, [user]);

  const uploadWorkspaceLogo = useCallback(
    async (wsId: string, file: File): Promise<string> => {
      const dataUrl = await uploadWorkspaceLogoDirect(wsId, file);
      const nowIso = new Date().toISOString();
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === wsId ? { ...w, hasLogo: true, updatedAt: nowIso } : w))
      );
      return dataUrl;
    },
    []
  );

  const removeWorkspaceLogo = useCallback(async (wsId: string): Promise<void> => {
    await removeWorkspaceLogoDirect(wsId);
    const nowIso = new Date().toISOString();
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === wsId ? { ...w, hasLogo: false, updatedAt: nowIso } : w))
    );
  }, []);

  const setPreset = (next: DatePreset) => {
    setPresetState(next);
    if (user?.uid && emailVerified) {
      if (next !== 'Custom') {
        void saveUserSettingsDirect(user.uid, userProfile?.settings || {}, {
          defaultDateRange: next,
        })
          .then((merged) => {
            setUserProfile((prev) => (prev ? { ...prev, settings: merged } : null));
          })
          .catch(() => {});
      }
    } else {
      try {
        localStorage.setItem(STORAGE_KEYS.PRESET, next);
      } catch {
        // ignore
      }
    }
  };

  const setCompareEnabled = (enabled: boolean) => {
    setCompareEnabledState(enabled);
    if (user?.uid && emailVerified) {
      void saveUserSettingsDirect(user.uid, userProfile?.settings || {}, {
        compareByDefault: enabled,
      })
        .then((merged) => {
          setUserProfile((prev) => (prev ? { ...prev, settings: merged } : null));
        })
        .catch(() => {});
    } else {
      try {
        localStorage.setItem(STORAGE_KEYS.COMPARE, String(enabled));
      } catch {
        // ignore
      }
    }
  };

  const toggleCompare = () => {
    setCompareEnabled(!compareEnabled);
  };

  const setCurrency = (next: CurrencyCode) => {
    setCurrencyState(next);
    if (user?.uid && emailVerified) {
      void saveUserSettingsDirect(user.uid, userProfile?.settings || {}, {
        displayCurrency: next,
      })
        .then((merged) => {
          setUserProfile((prev) => (prev ? { ...prev, settings: merged } : null));
        })
        .catch(() => {});
    } else {
      try {
        localStorage.setItem(STORAGE_KEYS.CURRENCY, next);
      } catch {
        // ignore
      }
    }
  };

  const setTimezone = (tz: string) => {
    setTimezoneState(tz);
    if (user?.uid && emailVerified) {
      void saveUserSettingsDirect(user.uid, userProfile?.settings || {}, {
        timezone: tz,
      })
        .then((merged) => {
          setUserProfile((prev) => (prev ? { ...prev, settings: merged } : null));
        })
        .catch(() => {});
    } else {
      try {
        localStorage.setItem(STORAGE_KEYS.TIMEZONE, tz);
      } catch {
        // ignore
      }
    }
  };

  const setNumberFormat = (fmt: NumberFormatLocale) => {
    setNumberFormatState(fmt);
    if (user?.uid && emailVerified) {
      void saveUserSettingsDirect(user.uid, userProfile?.settings || {}, {
        numberFormat: fmt,
      })
        .then((merged) => {
          setUserProfile((prev) => (prev ? { ...prev, settings: merged } : null));
        })
        .catch(() => {});
    } else {
      try {
        localStorage.setItem(STORAGE_KEYS.NUMBER_FORMAT, fmt);
      } catch {
        // ignore
      }
    }
  };

  const setThemePreference = (pref: ThemePreference) => {
    setThemePreferenceState(pref);
    if (user?.uid && emailVerified) {
      void saveUserSettingsDirect(user.uid, userProfile?.settings || {}, {
        theme: pref,
      })
        .then((merged) => {
          setUserProfile((prev) => (prev ? { ...prev, settings: merged } : null));
        })
        .catch(() => {});
    } else {
      try {
        localStorage.setItem(STORAGE_KEYS.THEME, pref);
      } catch {
        // ignore
      }
    }
  };

  const setTheme = (next: ThemeMode) => {
    setThemePreference(next);
  };

  const toggleTheme = () => {
    setThemePreference(theme === 'light' ? 'dark' : 'light');
  };

  const dateRange = useMemo(
    () => computeDateRange(preset, timezone, customDates, undefined, compareEnabled),
    [preset, timezone, customDates, compareEnabled]
  );

  const openNewProjectModal = useCallback(() => setIsNewProjectModalOpen(true), []);
  const closeNewProjectModal = useCallback(() => setIsNewProjectModalOpen(false), []);

  const value: AppContextValue = {
    preset,
    setPreset,
    customDates,
    setCustomDates,
    compareEnabled,
    setCompareEnabled,
    toggleCompare,
    dateRange,
    computedDateRange: dateRange,
    currency,
    setCurrency,
    timezone,
    setTimezone,
    numberFormat,
    setNumberFormat,
    theme,
    setTheme,
    themePreference,
    setThemePreference,
    toggleTheme,
    userProfile,
    workspaces,
    activeWorkspace,
    projects,
    activeProject,
    workspaceLoading,
    isDemoMode,
    setIsDemoMode,
    selectProject,
    refreshMe,
    createProject,
    updateProject,
    deleteProject,
    updateUserProfile,
    savePreferences,
    updateUserDisplayName,
    updateWorkspaceSettings,
    updateWorkspaceDefaults,
    uploadAvatar,
    removeAvatar,
    uploadWorkspaceLogo,
    removeWorkspaceLogo,
    isNewProjectModalOpen,
    openNewProjectModal,
    closeNewProjectModal,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used inside AppProvider');
  }
  return ctx;
}

export const useApp = useAppContext;
