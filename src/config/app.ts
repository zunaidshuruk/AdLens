export const APP_NAME = 'AdLens';
export const APP_TAGLINE = 'Web & Ad Analytics';
export const APP_VERSION = '0.7.0';

export const DEMO_PROJECT = {
  name: 'Demo Store',
  domain: 'demo-store.example',
  description: 'Sample e-commerce & SaaS analytics project',
  defaultCurrency: 'USD' as const,
  defaultTimezone: 'UTC',
};

export const TRACKED_SITE = DEMO_PROJECT;

export const STORAGE_PREFIX = 'adlens';
export const THEME_STORAGE_KEY = `${STORAGE_PREFIX}-theme`;
export const CURRENCY_STORAGE_KEY = `${STORAGE_PREFIX}-currency`;
export const TIMEZONE_STORAGE_KEY = `${STORAGE_PREFIX}-timezone`;
export const DATE_PRESET_STORAGE_KEY = `${STORAGE_PREFIX}-date-preset`;
export const COMPARE_STORAGE_KEY = `${STORAGE_PREFIX}-compare`;
