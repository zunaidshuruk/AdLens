import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import type { PublicConfigResponse } from '../types/index.js';

export let auth: Auth | null = null;
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

export async function initFirebase(): Promise<Auth | null> {
  if (auth) return auth;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const response = await fetch('/api/public-config', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as PublicConfigResponse;
      const fb = data?.firebase;
      if (!fb?.apiKey || !fb?.projectId || !fb?.authDomain || !fb?.appId) {
        return null;
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
      return auth;
    } catch {
      return null;
    }
  })();

  return initPromise;
}
