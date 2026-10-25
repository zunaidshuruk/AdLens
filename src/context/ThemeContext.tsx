import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { UserSettings } from '../types/index.js';
import {
  buildTheme,
  DEFAULT_APPEARANCE,
  resolveAppearance,
  sanitizeAppearance,
  type AppearanceSettings,
  type Mode,
  type Theme,
  type ThemeOptions,
} from '../utils/themeEngine.js';
import { useAppContext } from './AppContext.js';

export const THEME_CACHE_KEY = 'adlens_theme_cache';

const LEGACY_THEME_MAP: Record<'light' | 'dark' | 'system', AppearanceSettings['preset']> = {
  light: 'adlens-light',
  dark: 'adlens-dark',
  system: 'system',
};

/**
 * Resolves `AppearanceSettings` from a user's `UserSettings`, performing a one-time
 * migration of legacy `settings.theme` ('light' | 'dark' | 'system') when
 * `settings.appearance` is not yet set.
 */
export function migrateOldThemeSetting(
  settings: Partial<UserSettings> | null | undefined
): { appearance: AppearanceSettings; migrated: boolean } {
  if (settings && settings.appearance !== undefined && settings.appearance !== null) {
    return {
      appearance: sanitizeAppearance(settings.appearance).value,
      migrated: false,
    };
  }

  const oldTheme = settings?.theme;
  if (oldTheme === 'light' || oldTheme === 'dark' || oldTheme === 'system') {
    return {
      appearance: {
        ...DEFAULT_APPEARANCE,
        preset: LEGACY_THEME_MAP[oldTheme],
      },
      migrated: true,
    };
  }

  return {
    appearance: DEFAULT_APPEARANCE,
    migrated: false,
  };
}

/**
 * Validates and sanitizes `next` with `sanitizeAppearance(next)` (which lower-cases hex colours
 * and repairs invalid fields), then saves `settings.appearance` merged with the user's other settings
 * using the provided settings-save helper.
 */
export async function saveAppearanceSettings(
  next: unknown,
  currentSettings: UserSettings | undefined,
  saveHelper: (patch: Partial<UserSettings>) => Promise<UserSettings>
): Promise<{ value: AppearanceSettings; errors: string[]; savedSettings: UserSettings }> {
  const { value, errors } = sanitizeAppearance(next);
  const mergedPatch: Partial<UserSettings> = {
    ...(currentSettings ?? {}),
    appearance: value,
  };
  const savedSettings = await saveHelper(mergedPatch);
  return { value, errors, savedSettings };
}

/**
 * Applies every variable in `theme.vars` to `<html>`, sets root font-size,
 * toggles `.dark`, sets `style.colorScheme`, and caches vars in `localStorage`.
 */
export function applyThemeToDocument(
  theme: Theme,
  mode: Mode,
  doc: Document | null = typeof document !== 'undefined' ? document : null,
  storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null
): void {
  if (doc?.documentElement) {
    const root = doc.documentElement;
    for (const [key, val] of Object.entries(theme.vars)) {
      root.style.setProperty(key, val);
    }
    if (theme.vars['--root-font-size']) {
      root.style.fontSize = theme.vars['--root-font-size'];
    }
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode;
  }

  if (storage) {
    try {
      storage.setItem(
        THEME_CACHE_KEY,
        JSON.stringify({
          ...theme.vars,
          mode,
          vars: theme.vars,
        })
      );
    } catch {
      // Ignore storage quota or private mode errors
    }
  }
}

export interface ThemeContextValue {
  appearance: AppearanceSettings;
  resolvedOptions: ThemeOptions;
  theme: Theme;
  mode: Mode;
  prefersDark: boolean;
  previewAppearance: (next: unknown) => AppearanceSettings;
  setAppearance: (next: unknown) => AppearanceSettings;
  saveAppearance: (next: unknown) => Promise<AppearanceSettings>;
  resetAppearance: () => Promise<AppearanceSettings>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { userProfile, savePreferences } = useAppContext();
  const settings = userProfile?.settings;

  const [prefersDark, setPrefersDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [previewOverride, setPreviewOverride] = useState<AppearanceSettings | null>(null);
  const migratedUidRef = useRef<string | null>(null);

  // Clear preview override when the canonical settings.appearance from userProfile updates
  useEffect(() => {
    if (settings?.appearance) {
      setPreviewOverride(null);
    }
  }, [settings?.appearance]);

  // One-time migration of old settings.theme -> settings.appearance
  useEffect(() => {
    const uid = userProfile?.uid;
    if (!uid || !settings) return;
    if (migratedUidRef.current === uid) return;

    const { appearance: migratedAppearance, migrated } = migrateOldThemeSetting(settings);
    migratedUidRef.current = uid;

    if (migrated) {
      void saveAppearanceSettings(migratedAppearance, settings, savePreferences).catch(() => {
        // Ignore transient offline error during one-time background migration
      });
    }
  }, [userProfile?.uid, settings, savePreferences]);

  const appearance = useMemo<AppearanceSettings>(() => {
    if (previewOverride) {
      return previewOverride;
    }
    return migrateOldThemeSetting(settings).appearance;
  }, [previewOverride, settings]);

  const resolvedOptions = useMemo<ThemeOptions>(
    () => resolveAppearance(appearance, prefersDark),
    [appearance, prefersDark]
  );

  const theme = useMemo<Theme>(() => buildTheme(resolvedOptions), [resolvedOptions]);

  useEffect(() => {
    applyThemeToDocument(theme, resolvedOptions.mode);
  }, [theme, resolvedOptions.mode]);

  const previewAppearance = useCallback((next: unknown): AppearanceSettings => {
    const { value } = sanitizeAppearance(next);
    setPreviewOverride(value);
    return value;
  }, []);

  const saveAppearance = useCallback(
    async (next: unknown): Promise<AppearanceSettings> => {
      const { value } = sanitizeAppearance(next);
      setPreviewOverride(value);
      await saveAppearanceSettings(value, userProfile?.settings, savePreferences);
      return value;
    },
    [userProfile?.settings, savePreferences]
  );

  const resetAppearance = useCallback(async (): Promise<AppearanceSettings> => {
    return saveAppearance(DEFAULT_APPEARANCE);
  }, [saveAppearance]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance,
      resolvedOptions,
      theme,
      mode: resolvedOptions.mode,
      prefersDark,
      previewAppearance,
      setAppearance: previewAppearance,
      saveAppearance,
      resetAppearance,
    }),
    [
      appearance,
      resolvedOptions,
      theme,
      prefersDark,
      previewAppearance,
      saveAppearance,
      resetAppearance,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
}
