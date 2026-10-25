import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { apiClient } from '../api/client.js';
import type {
  NumberFormatLocale,
  UserEmailNotifications,
  UserSettings,
} from '../types/index.js';
import { prepareImageAsset } from '../utils/imageAssets.js';
import { sanitizeAppearance } from '../utils/themeEngine.js';
import { db, firestoreDirectAvailable, markFirestoreDirectUnavailable } from './firebase.js';
import { invalidateAvatarCache } from '../hooks/useAvatar.js';
import { invalidateLogoCache } from '../hooks/useWorkspaceLogo.js';

function withFirestoreTimeout<T>(promise: Promise<T>, ms: number = 3500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('FIRESTORE_DIRECT_TIMEOUT'));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export const VALID_THEMES = ['light', 'dark', 'system'] as const;
export const VALID_DATE_RANGES = [
  'Today',
  'Last 7 days',
  'Last 28 days',
  'Last 90 days',
  'This month',
  'Last month',
] as const;
export const VALID_NUMBER_FORMATS: NumberFormatLocale[] = [
  'en-US',
  'en-GB',
  'en-IN',
  'de-DE',
  'fr-FR',
  'bn-BD',
];

const CURRENCY_RE = /^[A-Z]{3}$/;
const TIMEZONE_RE = /^[A-Za-z0-9_+/-]+$/;

export function sanitizeUserSettings(raw: Partial<UserSettings>): UserSettings {
  const sanitized: UserSettings = {};

  if (raw.theme && VALID_THEMES.includes(raw.theme as (typeof VALID_THEMES)[number])) {
    sanitized.theme = raw.theme;
  }
  if (raw.appearance !== undefined) {
    sanitized.appearance = sanitizeAppearance(raw.appearance).value;
  }
  if (
    raw.defaultDateRange &&
    VALID_DATE_RANGES.includes(raw.defaultDateRange as (typeof VALID_DATE_RANGES)[number])
  ) {
    sanitized.defaultDateRange = raw.defaultDateRange;
  }
  if (typeof raw.compareByDefault === 'boolean') {
    sanitized.compareByDefault = raw.compareByDefault;
  }
  if (raw.displayCurrency && CURRENCY_RE.test(raw.displayCurrency)) {
    sanitized.displayCurrency = raw.displayCurrency;
  }
  if (
    raw.timezone &&
    raw.timezone.length >= 1 &&
    raw.timezone.length <= 64 &&
    TIMEZONE_RE.test(raw.timezone)
  ) {
    sanitized.timezone = raw.timezone;
  }
  if (
    raw.numberFormat &&
    VALID_NUMBER_FORMATS.includes(raw.numberFormat as NumberFormatLocale)
  ) {
    sanitized.numberFormat = raw.numberFormat;
  }

  if (raw.emailNotifications && typeof raw.emailNotifications === 'object') {
    const n = raw.emailNotifications;
    const notifs: UserEmailNotifications = {};
    if (typeof n.weeklyReport === 'boolean') notifs.weeklyReport = n.weeklyReport;
    if (typeof n.alerts === 'boolean') notifs.alerts = n.alerts;
    if (typeof n.productUpdates === 'boolean') notifs.productUpdates = n.productUpdates;
    sanitized.emailNotifications = notifs;
  }

  return sanitized;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  defaultDateRange: 'Last 28 days',
  compareByDefault: true,
  displayCurrency: 'USD',
  timezone: 'UTC',
  numberFormat: 'en-US',
  emailNotifications: {
    weeklyReport: true,
    alerts: true,
    productUpdates: false,
  },
};

export async function saveUserSettingsDirect(
  uid: string,
  current: UserSettings,
  patch: Partial<UserSettings>
): Promise<UserSettings> {
  const merged = sanitizeUserSettings({
    ...DEFAULT_USER_SETTINGS,
    ...current,
    ...patch,
    emailNotifications: {
      ...DEFAULT_USER_SETTINGS.emailNotifications,
      ...(current.emailNotifications || {}),
      ...(patch.emailNotifications || {}),
    },
  });

  if (db && firestoreDirectAvailable) {
    try {
      const userRef = doc(db, 'users', uid);
      await withFirestoreTimeout(
        updateDoc(userRef, {
          settings: merged,
          updatedAt: serverTimestamp(),
        })
      );
      return merged;
    } catch {
      markFirestoreDirectUnavailable();
    }
  }

  await apiClient.updateMe({ settings: merged });
  return merged;
}

export async function saveDisplayNameDirect(uid: string, displayName: string): Promise<string> {
  const trimmed = displayName.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new Error('Display name must be between 1 and 100 characters.');
  }

  if (db && firestoreDirectAvailable) {
    try {
      const userRef = doc(db, 'users', uid);
      await withFirestoreTimeout(
        updateDoc(userRef, {
          displayName: trimmed,
          updatedAt: serverTimestamp(),
        })
      );
      return trimmed;
    } catch {
      markFirestoreDirectUnavailable();
    }
  }

  await apiClient.updateMe({ displayName: trimmed });
  return trimmed;
}

export async function saveWorkspaceSettingsDirect(
  wsId: string,
  name: string,
  defaults: { currency: string; timezone: string }
): Promise<void> {
  const trimmedName = name.trim();
  if (trimmedName.length < 1 || trimmedName.length > 100) {
    throw new Error('Workspace name must be between 1 and 100 characters.');
  }

  const currency = (defaults.currency || 'USD').trim().toUpperCase();
  if (!CURRENCY_RE.test(currency)) {
    throw new Error('Currency must be a 3-letter uppercase code (e.g. USD, BDT).');
  }

  const timezone = defaults.timezone.trim();
  if (timezone.length < 1 || timezone.length > 64 || !TIMEZONE_RE.test(timezone)) {
    throw new Error('Timezone must be a valid IANA identifier.');
  }

  if (db && firestoreDirectAvailable) {
    try {
      const wsRef = doc(db, 'workspaces', wsId);
      await withFirestoreTimeout(
        updateDoc(wsRef, {
          name: trimmedName,
          defaults: { currency, timezone },
          updatedAt: serverTimestamp(),
        })
      );
      return;
    } catch {
      markFirestoreDirectUnavailable();
    }
  }

  await apiClient.updateWorkspace(wsId, {
    name: trimmedName,
    defaults: { currency, timezone },
  });
}

export async function uploadAvatarDirect(uid: string, file: File): Promise<string> {
  const asset = await prepareImageAsset(file, 'avatar');

  if (db && firestoreDirectAvailable) {
    try {
      const avatarDocRef = doc(db, 'users', uid, 'assets', 'avatar');
      const userDocRef = doc(db, 'users', uid);

      await withFirestoreTimeout(
        setDoc(avatarDocRef, {
          dataUrl: asset.dataUrl,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          updatedAt: serverTimestamp(),
        })
      );

      await withFirestoreTimeout(
        updateDoc(userDocRef, {
          hasCustomAvatar: true,
          updatedAt: serverTimestamp(),
        })
      );

      invalidateAvatarCache(uid);
      return asset.dataUrl;
    } catch {
      markFirestoreDirectUnavailable();
    }
  }

  await apiClient.setUserAvatar(asset);
  invalidateAvatarCache(uid);
  return asset.dataUrl;
}

export async function removeAvatarDirect(uid: string): Promise<void> {
  if (db && firestoreDirectAvailable) {
    try {
      const avatarDocRef = doc(db, 'users', uid, 'assets', 'avatar');
      const userDocRef = doc(db, 'users', uid);

      try {
        await withFirestoreTimeout(deleteDoc(avatarDocRef));
      } catch {
        // ignore if already deleted
      }

      await withFirestoreTimeout(
        updateDoc(userDocRef, {
          hasCustomAvatar: false,
          updatedAt: serverTimestamp(),
        })
      );

      invalidateAvatarCache(uid);
      return;
    } catch {
      markFirestoreDirectUnavailable();
    }
  }

  await apiClient.deleteUserAvatar();
  invalidateAvatarCache(uid);
}

export async function uploadWorkspaceLogoDirect(wsId: string, file: File): Promise<string> {
  const asset = await prepareImageAsset(file, 'logo');

  if (db && firestoreDirectAvailable) {
    try {
      const logoDocRef = doc(db, 'workspaces', wsId, 'assets', 'logo');
      const wsDocRef = doc(db, 'workspaces', wsId);

      await withFirestoreTimeout(
        setDoc(logoDocRef, {
          dataUrl: asset.dataUrl,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          updatedAt: serverTimestamp(),
        })
      );

      await withFirestoreTimeout(
        updateDoc(wsDocRef, {
          hasLogo: true,
          updatedAt: serverTimestamp(),
        })
      );

      invalidateLogoCache(wsId);
      return asset.dataUrl;
    } catch {
      markFirestoreDirectUnavailable();
    }
  }

  await apiClient.setWorkspaceLogo(wsId, asset);
  invalidateLogoCache(wsId);
  return asset.dataUrl;
}

export async function removeWorkspaceLogoDirect(wsId: string): Promise<void> {
  if (db && firestoreDirectAvailable) {
    try {
      const logoDocRef = doc(db, 'workspaces', wsId, 'assets', 'logo');
      const wsDocRef = doc(db, 'workspaces', wsId);

      try {
        await withFirestoreTimeout(deleteDoc(logoDocRef));
      } catch {
        // ignore if already deleted
      }

      await withFirestoreTimeout(
        updateDoc(wsDocRef, {
          hasLogo: false,
          updatedAt: serverTimestamp(),
        })
      );

      invalidateLogoCache(wsId);
      return;
    } catch {
      markFirestoreDirectUnavailable();
    }
  }

  await apiClient.deleteWorkspaceLogo(wsId);
  invalidateLogoCache(wsId);
}

