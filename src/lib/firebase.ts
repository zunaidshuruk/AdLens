import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  setLogLevel,
  type Firestore,
} from 'firebase/firestore';
import type { PublicConfigResponse } from '../types/index.js';

export type FirebaseInitErrorReason = 'config_missing' | 'network' | 'sdk_error';

export interface FirebaseInitError {
  reason: FirebaseInitErrorReason;
  message: string;
}

export let auth: Auth | null = null;
export let db: Firestore | null = null;
export let firestoreDirectAvailable: boolean = true;
export let lastInitError: FirebaseInitError | null = null;
export let configuredAuthProviders: string[] = ['password', 'google'];

export function getFirestoreDb(): Firestore | null {
  return db;
}

export function markFirestoreDirectUnavailable(): void {
  firestoreDirectAvailable = false;
}

let firebaseApp: FirebaseApp | null = null;
let initPromise: Promise<Auth | null> | null = null;

type TokenGetter = (forceRefresh?: boolean) => Promise<string | null>;
let registeredTokenGetter: TokenGetter | null = null;

export function registerAuthTokenGetter(getter: TokenGetter | null): void {
  registeredTokenGetter = getter;
}

export async function getCurrentIdToken(forceRefresh: boolean = false): Promise<string | null> {
  if (registeredTokenGetter) {
    return registeredTokenGetter(forceRefresh);
  }
  if (auth?.currentUser) {
    try {
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch {
      return null;
    }
  }
  return null;
}

export function resetFirebaseInitForTest(): void {
  auth = null;
  db = null;
  firestoreDirectAvailable = true;
  firebaseApp = null;
  initPromise = null;
  lastInitError = null;
  configuredAuthProviders = ['password', 'google'];
}

export async function initFirebase(): Promise<Auth | null> {
  if (auth) return auth;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let data: PublicConfigResponse;
    try {
      const response = await fetch('/api/public-config', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        const message = `Failed to load Firebase config from /api/public-config (HTTP ${response.status}).`;
        lastInitError = { reason: 'network', message };
        console.warn('[Firebase Init] Network error:', message);
        initPromise = null;
        return null;
      }

      data = (await response.json()) as PublicConfigResponse;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const message = `Failed to reach /api/public-config: ${detail}`;
      lastInitError = { reason: 'network', message };
      console.warn('[Firebase Init] Network error:', err);
      initPromise = null;
      return null;
    }

    if (Array.isArray(data?.providers) && data.providers.length > 0) {
      const normalized = data.providers
        .map((p) => String(p).trim().toLowerCase())
        .filter(Boolean);
      if (normalized.length > 0) {
        configuredAuthProviders = normalized;
      }
    }

    const fb = data?.firebase;
    if (!fb?.apiKey || !fb?.projectId || !fb?.authDomain || !fb?.appId) {
      const message =
        'Firebase Authentication is not configured. Please set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID.';
      lastInitError = { reason: 'config_missing', message };
      console.warn('[Firebase Init] Configuration missing:', message);
      initPromise = null;
      return null;
    }

    try {
      try {
        setLogLevel('silent');
      } catch {
        // ignore if unsupported in test environment
      }

      const existing = getApps()[0];
      firebaseApp =
        existing ??
        initializeApp({
          apiKey: fb.apiKey,
          authDomain: fb.authDomain,
          projectId: fb.projectId,
          appId: fb.appId,
        });

      auth = getAuth(firebaseApp);
      try {
        db = initializeFirestore(firebaseApp, {
          experimentalAutoDetectLongPolling: true,
        });
      } catch {
        db = getFirestore(firebaseApp);
      }
      firestoreDirectAvailable = true;
      lastInitError = null;
      return auth;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      lastInitError = { reason: 'sdk_error', message: detail };
      console.warn('[Firebase Init] SDK error:', err);
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}


