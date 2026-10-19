import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiClient, setActiveProjectHeader } from '../api/client';
import { DEMO_PROJECT } from '../config/app';
import type {
  ComputedDateRange,
  CurrencyCode,
  DatePreset,
  ProjectConfig,
  ThemeMode,
  UserProfile,
  UserSettings,
  WorkspaceSummary,
} from '../types';
import { computeDateRange } from '../utils/dateUtils';
import { useAuth } from './AuthContext';

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
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => void;
  toggleTheme: () => void;

  // Sprint 7B: Firestore user, workspace & project state
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
  updateWorkspaceSettings: (patch: {
    name?: string;
    logoURL?: string | null;
    logoPath?: string | null;
    defaults?: { currency: string; timezone: string };
  }) => Promise<WorkspaceSummary>;
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
};

function readStorage<T extends string>(key: string, fallback: T): T {
  try {
    const val = localStorage.getItem(key);
    return (val as T) || fallback;
  } catch {
    return fallback;
  }
}

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEMO_PROJECT.defaultTimezone;
  } catch {
    return DEMO_PROJECT.defaultTimezone;
  }
}

function resolveThemeMode(pref: ThemePreference): ThemeMode {
  if (pref === 'dark' || pref === 'light') return pref;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, emailVerified, loading: authLoading } = useAuth();

  const [preset, setPresetState] = useState<DatePreset>(() =>
    readStorage<DatePreset>(STORAGE_KEYS.PRESET, 'Last 28 days')
  );

  const [compareEnabled, setCompareEnabledState] = useState<boolean>(() => {
    try {
      const val = localStorage.getItem(STORAGE_KEYS.COMPARE);
      return val === null ? true : val === 'true';
    } catch {
      return true;
    }
  });

  const [currency, setCurrencyState] = useState<CurrencyCode>(() =>
    readStorage<CurrencyCode>(STORAGE_KEYS.CURRENCY, DEMO_PROJECT.defaultCurrency)
  );

  const [timezone, setTimezoneState] = useState<string>(() =>
    readStorage<string>(STORAGE_KEYS.TIMEZONE, getBrowserTimezone())
  );

  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => {
    const saved = readStorage<string>(STORAGE_KEYS.THEME, 'light');
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
    return 'light';
  });

  const theme = useMemo<ThemeMode>(() => resolveThemeMode(themePreference), [themePreference]);

  const initialComputed = useMemo(
    () => computeDateRange('Last 28 days', timezone),
    [timezone]
  );

  const [customDates, setCustomDates] = useState<CustomDateRange>({
    startDate: initialComputed.startDate,
    endDate: initialComputed.endDate,
  });

  // Sprint 7B state
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState<boolean>(false);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);
  const settingsAppliedForUid = useRef<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, themePreference);
    } catch {
      // ignore storage errors
    }
  }, [theme, themePreference]);

  const applyMeResponse = useCallback(
    (uid: string, me: { user: UserProfile; workspaces: WorkspaceSummary[]; projects: ProjectConfig[] }) => {
      setUserProfile(me.user);
      setWorkspaces(me.workspaces);
      setProjects(me.projects);

      // Apply user settings from Firestore on first load for this user
      if (settingsAppliedForUid.current !== uid && me.user?.settings) {
        settingsAppliedForUid.current = uid;
        const s = me.user.settings;
        if (s.theme) {
          setThemePreferenceState(s.theme);
        }
        if (s.displayCurrency === 'BDT' || s.displayCurrency === 'USD') {
          setCurrencyState(s.displayCurrency);
        }
        if (s.timezone) {
          setTimezoneState(s.timezone);
        }
        if (s.defaultDateRange) {
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
          me.projects.find((p) => `${p.workspaceId}/${p.id}` === savedHeader || p.id === savedProjId) ??
          null;
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

  // Part B.1: After sign-in, call /api/me/bootstrap, then /api/me
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
    } else {
      setActiveProjectHeader(null);
    }
  }, [activeProject, user]);

  const selectProject = useCallback(
    (projectId: string) => {
      const found = projects.find((p) => p.id === projectId);
      if (!found) return;
      setActiveProjectId(found.id);
      setIsDemoMode(Boolean(found.isDemo));
      const headerVal = `${found.workspaceId}/${found.id}`;
      setActiveProjectHeader(headerVal);
      if (user) {
        try {
          localStorage.setItem(`adlens_active_project_${user.uid}`, headerVal);
        } catch {
          // ignore
        }
      }
      if (found.timezone) {
        setTimezoneState(found.timezone);
      }
      if (found.currency === 'BDT' || found.currency === 'USD') {
        setCurrencyState(found.currency);
      }
    },
    [projects, user]
  );

  const refreshMe = useCallback(async () => {
    if (!user) return;
    const me = await apiClient.getMe();
    applyMeResponse(user.uid, me);
  }, [user, applyMeResponse]);

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
        throw new Error('No active workspace found.');
      }
      const { project } = await apiClient.createProject(wsId, input);
      setProjects((prev) => [...prev, project]);
      setActiveProjectId(project.id);
      setIsDemoMode(Boolean(project.isDemo));
      const headerVal = `${project.workspaceId}/${project.id}`;
      setActiveProjectHeader(headerVal);
      if (user) {
        try {
          localStorage.setItem(`adlens_active_project_${user.uid}`, headerVal);
        } catch {
          // ignore
        }
      }
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
      const target = projects.find((p) => p.id === projectId) ?? activeProject;
      const wsId = target?.workspaceId || activeWorkspace?.id;
      if (!wsId) {
        throw new Error('No active workspace found.');
      }
      const { project } = await apiClient.updateProject(wsId, projectId, patch);
      setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)));
      return project;
    },
    [projects, activeProject, activeWorkspace]
  );

  const deleteProject = useCallback(
    async (projectId: string): Promise<void> => {
      const target = projects.find((p) => p.id === projectId);
      const wsId = target?.workspaceId || activeWorkspace?.id;
      if (!wsId) {
        throw new Error('No active workspace found.');
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

  const updateUserProfile = useCallback(
    async (patch: {
      displayName?: string;
      photoURL?: string | null;
      photoPath?: string | null;
      settings?: UserSettings;
    }): Promise<UserProfile> => {
      const { user: updated } = await apiClient.updateMe(patch);
      setUserProfile(updated);
      if (patch.settings?.theme) {
        setThemePreferenceState(patch.settings.theme);
      }
      if (patch.settings?.displayCurrency === 'BDT' || patch.settings?.displayCurrency === 'USD') {
        setCurrencyState(patch.settings.displayCurrency);
      }
      if (patch.settings?.timezone) {
        setTimezoneState(patch.settings.timezone);
      }
      return updated;
    },
    []
  );

  const updateWorkspaceSettings = useCallback(
    async (patch: {
      name?: string;
      logoURL?: string | null;
      logoPath?: string | null;
      defaults?: { currency: string; timezone: string };
    }): Promise<WorkspaceSummary> => {
      const wsId = activeWorkspace?.id || workspaces[0]?.id;
      if (!wsId) {
        throw new Error('No active workspace found.');
      }
      const { workspace } = await apiClient.updateWorkspace(wsId, patch);
      setWorkspaces((prev) => prev.map((w) => (w.id === workspace.id ? workspace : w)));
      return workspace;
    },
    [activeWorkspace, workspaces]
  );

  const setPreset = (next: DatePreset) => {
    setPresetState(next);
    try {
      localStorage.setItem(STORAGE_KEYS.PRESET, next);
    } catch {
      // ignore
    }
  };

  const setCompareEnabled = (enabled: boolean) => {
    setCompareEnabledState(enabled);
    try {
      localStorage.setItem(STORAGE_KEYS.COMPARE, String(enabled));
    } catch {
      // ignore
    }
  };

  const toggleCompare = () => {
    setCompareEnabled(!compareEnabled);
  };

  const setCurrency = (next: CurrencyCode) => {
    setCurrencyState(next);
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENCY, next);
    } catch {
      // ignore
    }
    if (user) {
      void apiClient.updateMe({ settings: { displayCurrency: next } }).catch(() => {});
    }
  };

  const setTimezone = (tz: string) => {
    setTimezoneState(tz);
    try {
      localStorage.setItem(STORAGE_KEYS.TIMEZONE, tz);
    } catch {
      // ignore
    }
    if (user) {
      void apiClient.updateMe({ settings: { timezone: tz } }).catch(() => {});
    }
  };

  const setThemePreference = (pref: ThemePreference) => {
    setThemePreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, pref);
    } catch {
      // ignore
    }
    if (user) {
      void apiClient.updateMe({ settings: { theme: pref } }).catch(() => {});
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
    updateWorkspaceSettings,
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
