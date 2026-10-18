import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  COMPARE_STORAGE_KEY,
  CURRENCY_STORAGE_KEY,
  DATE_PRESET_STORAGE_KEY,
  THEME_STORAGE_KEY,
  TIMEZONE_STORAGE_KEY,
} from '../config/app';
import type { ComputedDateRange, CurrencyCode, CustomDateInput, DatePreset, ThemeMode } from '../types';
import { computeDateRange, DATE_PRESETS } from '../utils/dateUtils';

interface AppContextValue {
  preset: DatePreset;
  setPreset: (preset: DatePreset) => void;
  customDates: CustomDateInput;
  setCustomDates: (custom: CustomDateInput) => void;
  compareEnabled: boolean;
  setCompareEnabled: (enabled: boolean) => void;
  dateRange: ComputedDateRange;
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  timezone: string;
  setTimezone: (timezone: string) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function readStorage<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    if (allowed && !allowed.includes(raw as T)) return fallback;
    return raw as T;
  } catch {
    return fallback;
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() =>
    readStorage<ThemeMode>(THEME_STORAGE_KEY, 'light', ['light', 'dark'])
  );

  const [currency, setCurrencyState] = useState<CurrencyCode>(() =>
    readStorage<CurrencyCode>(CURRENCY_STORAGE_KEY, 'BDT', ['BDT', 'USD'])
  );

  const [timezone, setTimezoneState] = useState<string>(() =>
    readStorage<string>(TIMEZONE_STORAGE_KEY, 'Asia/Dhaka')
  );

  const [preset, setPresetState] = useState<DatePreset>(() =>
    readStorage<DatePreset>(DATE_PRESET_STORAGE_KEY, 'Last 28 days', DATE_PRESETS)
  );

  const [compareEnabled, setCompareEnabledState] = useState<boolean>(() => {
    const saved = readStorage<string>(COMPARE_STORAGE_KEY, 'true');
    return saved !== 'false';
  });

  const [customDates, setCustomDates] = useState<CustomDateInput>(() => {
    const initialRange = computeDateRange('Last 7 days', 'Asia/Dhaka');
    return {
      startDate: initialRange.startDate,
      endDate: initialRange.endDate,
    };
  });

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (theme === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const setTheme = (next: ThemeMode) => setThemeState(next);
  const toggleTheme = () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));

  const setCurrency = (next: CurrencyCode) => {
    setCurrencyState(next);
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const setTimezone = (next: string) => {
    setTimezoneState(next);
    try {
      window.localStorage.setItem(TIMEZONE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const setPreset = (next: DatePreset) => {
    setPresetState(next);
    try {
      window.localStorage.setItem(DATE_PRESET_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const setCompareEnabled = (enabled: boolean) => {
    setCompareEnabledState(enabled);
    try {
      window.localStorage.setItem(COMPARE_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
  };

  const dateRange = useMemo(
    () => computeDateRange(preset, timezone, customDates, new Date(), compareEnabled),
    [preset, timezone, customDates, compareEnabled]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      preset,
      setPreset,
      customDates,
      setCustomDates,
      compareEnabled,
      setCompareEnabled,
      dateRange,
      currency,
      setCurrency,
      timezone,
      setTimezone,
      theme,
      setTheme,
      toggleTheme,
    }),
    [preset, customDates, compareEnabled, dateRange, currency, timezone, theme]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return ctx;
}
