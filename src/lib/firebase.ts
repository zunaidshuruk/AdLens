import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import type { PublicConfigResponse } from '../types/index.js';

export type FirebaseInitErrorReason = 'config_missing' | 'network' | 'sdk_error';

export interface FirebaseInitError {
  reason: FirebaseInitErrorReason;
  message: string;
}

export let auth: Auth | null = null;
export let lastInitError: FirebaseInitError | null = null;

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
  firebaseApp = null;
  initPromise = null;
  lastInitError = null;
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
        console.error('[Firebase Init] Network error:', message);
        initPromise = null;
        return null;
      }

      data = (await response.json()) as PublicConfigResponse;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const message = `Failed to reach /api/public-config: ${detail}`;
      lastInitError = { reason: 'network', message };
      console.error('[Firebase Init] Network error:', err);
      initPromise = null;
      return null;
    }

    const fb = data?.firebase;
    if (!fb?.apiKey || !fb?.projectId || !fb?.authDomain || !fb?.appId) {
      const message =
        'Firebase Authentication is not configured. Please set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID.';
      lastInitError = { reason: 'config_missing', message };
      console.error('[Firebase Init] Configuration missing:', message);
      initPromise = null;
      return null;
    }

    try {
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
      lastInitError = null;
      return auth;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      lastInitError = { reason: 'sdk_error', message: detail };
      console.error('[Firebase Init] SDK error:', err);
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

