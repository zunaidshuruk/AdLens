import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { patchUserSchema } from './routes/workspaces.js';
import {
  applyThemeToDocument,
  migrateOldThemeSetting,
  saveAppearanceSettings,
  THEME_CACHE_KEY,
} from '../src/context/ThemeContext.js';
import { sanitizeUserSettings } from '../src/lib/firestoreClient.js';
import type { UserSettings } from '../src/types/index.js';
import {
  buildTheme,
  DEFAULT_APPEARANCE,
  resolveAppearance,
} from '../src/utils/themeEngine.js';

test('one-time migration of old settings.theme to settings.appearance', () => {
  // light -> preset adlens-light
  const fromLight = migrateOldThemeSetting({ theme: 'light' });
  assert.equal(fromLight.migrated, true);
  assert.deepEqual(fromLight.appearance, {
    ...DEFAULT_APPEARANCE,
    preset: 'adlens-light',
  });

  // dark -> preset adlens-dark
  const fromDark = migrateOldThemeSetting({ theme: 'dark' });
  assert.equal(fromDark.migrated, true);
  assert.deepEqual(fromDark.appearance, {
    ...DEFAULT_APPEARANCE,
    preset: 'adlens-dark',
  });

  // system -> preset system
  const fromSystem = migrateOldThemeSetting({ theme: 'system' });
  assert.equal(fromSystem.migrated, true);
  assert.deepEqual(fromSystem.appearance, {
    ...DEFAULT_APPEARANCE,
    preset: 'system',
  });

  // existing appearance is preserved and not re-migrated even if legacy theme is still present
  const existing = migrateOldThemeSetting({
    theme: 'light',
    appearance: {
      ...DEFAULT_APPEARANCE,
      preset: 'midnight',
      fontScale: 'large',
    },
  });
  assert.equal(existing.migrated, false);
  assert.equal(existing.appearance.preset, 'midnight');
  assert.equal(existing.appearance.fontScale, 'large');

  // empty settings default to DEFAULT_APPEARANCE without migration flag
  const empty = migrateOldThemeSetting({});
  assert.equal(empty.migrated, false);
  assert.deepEqual(empty.appearance, DEFAULT_APPEARANCE);
});

test('saveAppearance validation sanitizes, lower-cases hex colours, and merges with other settings', async () => {
  const existingSettings: UserSettings = {
    defaultDateRange: 'Last 7 days',
    compareByDefault: false,
    displayCurrency: 'BDT',
    timezone: 'Asia/Dhaka',
    numberFormat: 'bn-BD',
  };

  let persistedPatch: Partial<UserSettings> | null = null;
  const mockSaveHelper = async (patch: Partial<UserSettings>): Promise<UserSettings> => {
    persistedPatch = patch;
    return sanitizeUserSettings({ ...existingSettings, ...patch });
  };

  // Uppercase 3-digit / 6-digit hex colour is lower-cased and normalized; bad fields fall back to defaults
  const result = await saveAppearanceSettings(
    {
      preset: 'custom',
      custom: {
        mode: 'dark',
        accent: '#ABC',
        tint: 'warm',
      },
      radius: 'round',
      density: 'compact',
      fontScale: 'large',
      chartPalette: 'colorblind',
    },
    existingSettings,
    mockSaveHelper
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.value.custom.accent, '#aabbcc');
  assert.ok(persistedPatch);
  assert.equal((persistedPatch as UserSettings).displayCurrency, 'BDT');
  assert.equal((persistedPatch as UserSettings).timezone, 'Asia/Dhaka');
  assert.equal((persistedPatch as UserSettings).appearance?.custom.accent, '#aabbcc');
  assert.equal(result.savedSettings.displayCurrency, 'BDT');
  assert.equal(result.savedSettings.appearance?.custom.accent, '#aabbcc');

  // Invalid inputs are caught by sanitizeAppearance and repaired before saving
  const badResult = await saveAppearanceSettings(
    {
      preset: 'not-a-preset',
      custom: {
        mode: 'sepia',
        accent: 'not-a-hex',
        tint: 'invalid-tint',
      },
      radius: 'pill',
      density: 'extra-dense',
      fontScale: 'giant',
      chartPalette: 'rainbow',
    },
    existingSettings,
    mockSaveHelper
  );

  assert.ok(badResult.errors.length > 0);
  assert.deepEqual(badResult.value, DEFAULT_APPEARANCE);
  assert.deepEqual(badResult.savedSettings.appearance, DEFAULT_APPEARANCE);
  assert.equal(badResult.savedSettings.displayCurrency, 'BDT');
});

test('applyThemeToDocument sets CSS variables, root font-size, dark class, colorScheme, and localStorage cache', () => {
  const varsMap = new Map<string, string>();
  const classSet = new Set<string>();
  const fakeDoc = {
    documentElement: {
      style: {
        fontSize: '',
        colorScheme: '',
        setProperty(k: string, v: string) {
          varsMap.set(k, v);
        },
      },
      classList: {
        toggle(cls: string, force?: boolean) {
          if (force) classSet.add(cls);
          else classSet.delete(cls);
        },
      },
    },
  } as unknown as Document;

  const storageMap = new Map<string, string>();
  const fakeStorage = {
    setItem(k: string, v: string) {
      storageMap.set(k, v);
    },
    getItem(k: string) {
      return storageMap.get(k) ?? null;
    },
  } as unknown as Storage;

  const opts = resolveAppearance(
    { ...DEFAULT_APPEARANCE, preset: 'midnight', fontScale: 'large' },
    false
  );
  const theme = buildTheme(opts);
  applyThemeToDocument(theme, opts.mode, fakeDoc, fakeStorage);

  assert.equal(varsMap.get('--color-accent'), '#818cf8');
  assert.equal(fakeDoc.documentElement.style.fontSize, '112.5%');
  assert.equal(fakeDoc.documentElement.style.colorScheme, 'dark');
  assert.equal(classSet.has('dark'), true);

  const cachedRaw = storageMap.get(THEME_CACHE_KEY);
  assert.ok(cachedRaw);
  const cached = JSON.parse(cachedRaw);
  assert.equal(cached.mode, 'dark');
  assert.equal(cached.vars['--color-accent'], '#818cf8');
  assert.equal(cached['--root-font-size'], '112.5%');
});

test('server settings validation accepts valid settings.appearance and rejects bad values', async () => {
  // Direct schema validation checks
  const validParse = patchUserSchema.safeParse({
    settings: {
      appearance: {
        preset: 'custom',
        custom: { mode: 'dark', accent: '#1D4ED8', tint: 'cool' },
        radius: 'round',
        density: 'compact',
        fontScale: 'large',
        chartPalette: 'colorblind',
      },
    },
  });
  assert.equal(validParse.success, true);
  if (validParse.success) {
    assert.equal(validParse.data.settings?.appearance?.custom.accent, '#1d4ed8');
  }

  for (const badAppearance of [
    { ...DEFAULT_APPEARANCE, preset: 'invalid-preset' },
    { ...DEFAULT_APPEARANCE, custom: { ...DEFAULT_APPEARANCE.custom, accent: 'not-a-hex' } },
    { ...DEFAULT_APPEARANCE, custom: { ...DEFAULT_APPEARANCE.custom, accent: '#12345' } },
    { ...DEFAULT_APPEARANCE, custom: { ...DEFAULT_APPEARANCE.custom, mode: 'sepia' } },
    { ...DEFAULT_APPEARANCE, custom: { ...DEFAULT_APPEARANCE.custom, tint: 'neon' } },
    { ...DEFAULT_APPEARANCE, radius: 'circle' },
    { ...DEFAULT_APPEARANCE, density: 'tiny' },
    { ...DEFAULT_APPEARANCE, fontScale: 'huge' },
    { ...DEFAULT_APPEARANCE, chartPalette: 'neon' },
    { ...DEFAULT_APPEARANCE, extraField: true },
  ]) {
    const parsed = patchUserSchema.safeParse({ settings: { appearance: badAppearance } });
    assert.equal(parsed.success, false, `Expected rejection for ${JSON.stringify(badAppearance)}`);
  }

  // HTTP endpoint check against PATCH /api/me
  const store = createInMemoryFirestoreStore();
  setTestFirestoreStore(store);
  setTestTokenVerifier(async (token: string) => {
    if (token === 'token-appearance-user') {
      return {
        uid: 'uid_appearance',
        email: 'user@acme.com',
        email_verified: true,
        auth_time: Math.floor(Date.now() / 1000) - 10,
        firebase: { identities: { password: ['user@acme.com'] }, sign_in_provider: 'password' },
      } as never;
    }
    throw new Error('Invalid token');
  });

  await store.bootstrapUserAndWorkspace({
    uid: 'uid_appearance',
    email: 'user@acme.com',
    displayName: 'Appearance Tester',
  });

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Reject bad appearance value with 400 VALIDATION_ERROR
    const badRes = await fetch(`${baseUrl}/api/me`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer token-appearance-user',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          appearance: {
            ...DEFAULT_APPEARANCE,
            preset: 'nonexistent',
          },
        },
      }),
    });
    assert.equal(badRes.status, 400);
    const badJson = (await badRes.json()) as { error: { code: string } };
    assert.equal(badJson.error.code, 'VALIDATION_ERROR');

    // Accept valid appearance and persist in user settings
    const okRes = await fetch(`${baseUrl}/api/me`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer token-appearance-user',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          appearance: {
            ...DEFAULT_APPEARANCE,
            preset: 'ocean',
            fontScale: 'xlarge',
          },
        },
      }),
    });
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as { user: { settings: UserSettings } };
    assert.equal(okJson.user.settings.appearance?.preset, 'ocean');
    assert.equal(okJson.user.settings.appearance?.fontScale, 'xlarge');
  } finally {
    setTestFirestoreStore(null);
    setTestTokenVerifier(null);
    server.close();
  }
});
