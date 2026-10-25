import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getRedirectResult,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  OAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  unlink,
  updatePassword,
  updateProfile,
  type Auth,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { setSourceLiveMode } from '../adapters';
import { apiClient } from '../api/client';
import {
  configuredAuthProviders,
  initFirebase,
  lastInitError,
  registerAuthTokenGetter,
  type FirebaseInitError,
} from '../lib/firebase';
import { extractFirebaseErrorCode, mapFirebaseErrorMessage } from '../utils/firebaseErrors';

export function formatFirebaseInitError(err: FirebaseInitError | null): string {
  if (!err || err.reason === 'config_missing') {
    return 'Firebase Authentication is not configured. Please set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID.';
  }
  if (err.reason === 'sdk_error') {
    return 'Sign-in could not start (Firebase SDK error). Please reload the page.';
  }
  return (
    err.message ||
    'Could not connect to the authentication service. Please check your connection and try again.'
  );
}

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  firebaseReady: boolean;
  initError: FirebaseInitError | null;
  initErrorMessage: string | null;
  retryFirebaseInit: () => Promise<Auth | null>;
  emailVerified: boolean;
  providers: string[];
  enabledProviders: string[];
  pendingLinkEmail: string | null;
  pendingLinkProviderLabel: string | null;
  accountLinkNotice: string | null;
  dismissAccountLinkNotice: () => void;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  reloadUser: () => Promise<boolean>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setPasswordForSsoAccount: (newPassword: string) => Promise<void>;
  reauthenticateWithPassword: (password: string) => Promise<void>;
  reauthenticateWithGoogle: () => Promise<void>;
  linkGoogleProvider: () => Promise<void>;
  linkMicrosoftProvider: () => Promise<void>;
  unlinkProvider: (providerId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SSO_VERIFIED_PROVIDERS = new Set(['google.com', 'microsoft.com']);

function extractProviders(user: User | null): string[] {
  if (!user) return [];
  const set = new Set<string>();
  for (const info of user.providerData) {
    if (info?.providerId) {
      set.add(info.providerId);
    }
  }
  return Array.from(set);
}

function isUserVerified(user: User | null, providers: string[]): boolean {
  if (!user) return false;
  if (user.emailVerified) return true;
  return providers.some((p) => SSO_VERIFIED_PROVIDERS.has(p));
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authInstance, setAuthInstance] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [firebaseReady, setFirebaseReady] = useState<boolean>(false);
  const [enabledProviders, setEnabledProviders] = useState<string[]>(configuredAuthProviders);
  const [initError, setInitError] = useState<FirebaseInitError | null>(null);
  const [retryingInit, setRetryingInit] = useState<boolean>(false);
  const [, setRenderTick] = useState<number>(0);

  const [pendingLinkCredential, setPendingLinkCredential] = useState<AuthCredential | null>(null);
  const [pendingLinkEmail, setPendingLinkEmail] = useState<string | null>(null);
  const [pendingLinkProviderLabel, setPendingLinkProviderLabel] = useState<string | null>(null);
  const [accountLinkNotice, setAccountLinkNotice] = useState<string | null>(null);

  const forceUserRefresh = useCallback(() => {
    setRenderTick((t) => t + 1);
  }, []);

  const attachAuthInstance = useCallback(
    (auth: Auth): (() => void) => {
      setAuthInstance(auth);
      setFirebaseReady(true);
      setInitError(null);

      registerAuthTokenGetter(async (forceRefresh = false) => {
        const current = auth.currentUser;
        if (!current) return null;
        try {
          return await current.getIdToken(forceRefresh);
        } catch {
          return null;
        }
      });

      getRedirectResult(auth).catch((err) => {
        const code = extractFirebaseErrorCode(err);
        if (code === 'auth/account-exists-with-different-credential') {
          const gCred = GoogleAuthProvider.credentialFromError(err);
          const mCred = OAuthProvider.credentialFromError(err);
          const cred = gCred || mCred;
          const customEmail = (err as { customData?: { email?: string } })?.customData?.email;
          if (cred) {
            setPendingLinkCredential(cred);
            setPendingLinkEmail(customEmail ?? null);
            setPendingLinkProviderLabel(gCred ? 'Google' : 'Microsoft');
          }
        }
      });

      const unsub = onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        setLoading(false);
        forceUserRefresh();
      });

      return unsub;
    },
    [forceUserRefresh]
  );

  const unsubRef = React.useRef<(() => void) | null>(null);

  const retryFirebaseInit = useCallback(async (): Promise<Auth | null> => {
    setRetryingInit(true);
    try {
      const auth = await initFirebase();
      setEnabledProviders([...configuredAuthProviders]);
      if (!auth) {
        setFirebaseReady(false);
        setInitError(lastInitError);
        setLoading(false);
        return null;
      }
      if (unsubRef.current) {
        unsubRef.current();
      }
      unsubRef.current = attachAuthInstance(auth);
      return auth;
    } finally {
      setRetryingInit(false);
    }
  }, [attachAuthInstance]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const auth = await initFirebase();
      if (cancelled) return;
      setEnabledProviders([...configuredAuthProviders]);

      if (!auth) {
        setFirebaseReady(false);
        setInitError(lastInitError);
        setLoading(false);
        return;
      }

      unsubRef.current = attachAuthInstance(auth);
    })();

    return () => {
      cancelled = true;
      registerAuthTokenGetter(null);
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [attachAuthInstance]);

  const providers = extractProviders(user);
  const emailVerified = isUserVerified(user, providers);
  const initErrorMessage = !firebaseReady && !loading ? formatFirebaseInitError(initError ?? lastInitError) : null;

  const requireAuthInstance = useCallback((): Auth => {
    if (!authInstance) {
      throw new Error(formatFirebaseInitError(initError ?? lastInitError));
    }
    return authInstance;
  }, [authInstance, initError]);

  const maybeLinkPendingCredential = useCallback(
    async (signedInUser: User) => {
      if (!pendingLinkCredential) return;
      try {
        await linkWithCredential(signedInUser, pendingLinkCredential);
        const label = pendingLinkProviderLabel || 'Social';
        setAccountLinkNotice(
          `${label} sign-in has been linked to your AdLens account (${signedInUser.email || ''}).`
        );
      } catch (err) {
        throw new Error(mapFirebaseErrorMessage(err));
      } finally {
        setPendingLinkCredential(null);
        setPendingLinkEmail(null);
        setPendingLinkProviderLabel(null);
        await signedInUser.reload().catch(() => {});
        forceUserRefresh();
      }
    },
    [pendingLinkCredential, pendingLinkProviderLabel, forceUserRefresh]
  );

  const signUp = useCallback(
    async (fullName: string, email: string, password: string) => {
      const auth = requireAuthInstance();
      try {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (fullName.trim()) {
          await updateProfile(cred.user, { displayName: fullName.trim() });
        }
        await sendEmailVerification(cred.user, {
          url: `${window.location.origin}/`,
          handleCodeInApp: false,
        });
        await cred.user.reload().catch(() => {});
        setUser(auth.currentUser);
        forceUserRefresh();
      } catch (err) {
        throw new Error(mapFirebaseErrorMessage(err));
      }
    },
    [requireAuthInstance, forceUserRefresh]
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const auth = requireAuthInstance();
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await maybeLinkPendingCredential(cred.user);
        setUser(auth.currentUser);
        forceUserRefresh();
      } catch (err) {
        throw new Error(mapFirebaseErrorMessage(err));
      }
    },
    [requireAuthInstance, maybeLinkPendingCredential, forceUserRefresh]
  );

  const handleSsoSignIn = useCallback(
    async (provider: GoogleAuthProvider | OAuthProvider, providerLabel: 'Google' | 'Microsoft') => {
      const auth = requireAuthInstance();
      try {
        const cred = await signInWithPopup(auth, provider);
        await maybeLinkPendingCredential(cred.user);
        setUser(auth.currentUser);
        forceUserRefresh();
      } catch (err) {
        const code = extractFirebaseErrorCode(err);
        if (code === 'auth/popup-blocked') {
          await signInWithRedirect(auth, provider);
          return;
        }
        if (code === 'auth/account-exists-with-different-credential') {
          const pendingCred =
            providerLabel === 'Google'
              ? GoogleAuthProvider.credentialFromError(err as never)
              : OAuthProvider.credentialFromError(err as never);
          const customEmail = (err as { customData?: { email?: string } })?.customData?.email;
          if (pendingCred) {
            setPendingLinkCredential(pendingCred);
            setPendingLinkEmail(customEmail ?? null);
            setPendingLinkProviderLabel(providerLabel);
          }
          throw new Error(
            'You already have an AdLens account with this email. Sign in with your existing method to link Google/Microsoft.'
          );
        }
        throw new Error(mapFirebaseErrorMessage(err));
      }
    },
    [requireAuthInstance, maybeLinkPendingCredential, forceUserRefresh]
  );

  const signInWithGoogle = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    await handleSsoSignIn(provider, 'Google');
  }, [handleSsoSignIn]);

  const signInWithMicrosoft = useCallback(async () => {
    const provider = new OAuthProvider('microsoft.com');
    provider.addScope('email');
    provider.addScope('profile');
    await handleSsoSignIn(provider, 'Microsoft');
  }, [handleSsoSignIn]);

  const sendReset = useCallback(
    async (email: string) => {
      const auth = requireAuthInstance();
      try {
        await sendPasswordResetEmail(auth, email.trim(), {
          url: `${window.location.origin}/sign-in`,
          handleCodeInApp: false,
        });
      } catch (err) {
        const code = extractFirebaseErrorCode(err);
        // Never reveal whether the email exists
        if (code === 'auth/user-not-found') {
          return;
        }
        if (code === 'auth/invalid-email' || code === 'auth/too-many-requests' || code === 'auth/network-request-failed') {
          throw new Error(mapFirebaseErrorMessage(err));
        }
        // For any other account enumeration error, return silently so the UI shows the uniform message
      }
    },
    [requireAuthInstance]
  );

  const signOut = useCallback(async () => {
    try {
      await apiClient.clearGoogleSession();
    } catch {
      // Ignore if session clear fails (e.g., already expired)
    }
    setSourceLiveMode('ga4', false);
    setSourceLiveMode('search_console', false);
    setSourceLiveMode('meta_ads', false);

    if (authInstance) {
      await firebaseSignOut(authInstance);
    }
    setUser(null);
    forceUserRefresh();
  }, [authInstance, forceUserRefresh]);

  const resendVerificationEmail = useCallback(async () => {
    const auth = requireAuthInstance();
    const current = auth.currentUser;
    if (!current) {
      throw new Error('Please sign in first to resend the verification email.');
    }
    try {
      await sendEmailVerification(current, {
        url: `${window.location.origin}/`,
        handleCodeInApp: false,
      });
    } catch (err) {
      throw new Error(mapFirebaseErrorMessage(err));
    }
  }, [requireAuthInstance]);

  const reloadUser = useCallback(async (): Promise<boolean> => {
    if (!authInstance?.currentUser) return false;
    await authInstance.currentUser.reload();
    await authInstance.currentUser.getIdToken(true);
    const updated = authInstance.currentUser;
    setUser(updated);
    forceUserRefresh();
    const updatedProviders = extractProviders(updated);
    return isUserVerified(updated, updatedProviders);
  }, [authInstance, forceUserRefresh]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const auth = requireAuthInstance();
      const current = auth.currentUser;
      if (!current || !current.email) {
        throw new Error('No signed-in user with an email address.');
      }
      try {
        const credential = EmailAuthProvider.credential(current.email, currentPassword);
        await reauthenticateWithCredential(current, credential);
        await updatePassword(current, newPassword);
        await current.reload();
        forceUserRefresh();
      } catch (err) {
        throw new Error(mapFirebaseErrorMessage(err));
      }
    },
    [requireAuthInstance, forceUserRefresh]
  );

  const setPasswordForSsoAccount = useCallback(
    async (newPassword: string) => {
      const auth = requireAuthInstance();
      const current = auth.currentUser;
      if (!current || !current.email) {
        throw new Error('No signed-in user with an email address.');
      }
      try {
        const credential = EmailAuthProvider.credential(current.email, newPassword);
        await linkWithCredential(current, credential);
        await current.reload();
        setUser(auth.currentUser);
        forceUserRefresh();
      } catch (err) {
        throw new Error(mapFirebaseErrorMessage(err));
      }
    },
    [requireAuthInstance, forceUserRefresh]
  );

  const linkGoogleProvider = useCallback(async () => {
    const auth = requireAuthInstance();
    const current = auth.currentUser;
    if (!current) throw new Error('Please sign in first.');
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      await linkWithPopup(current, provider);
      await current.reload();
      setUser(auth.currentUser);
      forceUserRefresh();
    } catch (err) {
      throw new Error(mapFirebaseErrorMessage(err));
    }
  }, [requireAuthInstance, forceUserRefresh]);

  const linkMicrosoftProvider = useCallback(async () => {
    const auth = requireAuthInstance();
    const current = auth.currentUser;
    if (!current) throw new Error('Please sign in first.');
    try {
      const provider = new OAuthProvider('microsoft.com');
      provider.addScope('email');
      provider.addScope('profile');
      await linkWithPopup(current, provider);
      await current.reload();
      setUser(auth.currentUser);
      forceUserRefresh();
    } catch (err) {
      throw new Error(mapFirebaseErrorMessage(err));
    }
  }, [requireAuthInstance, forceUserRefresh]);

  const unlinkProvider = useCallback(
    async (providerId: string) => {
      const auth = requireAuthInstance();
      const current = auth.currentUser;
      if (!current) throw new Error('Please sign in first.');
      const currentProviders = extractProviders(current);
      if (currentProviders.length <= 1) {
        throw new Error('You cannot remove your last sign-in method.');
      }
      try {
        await unlink(current, providerId);
        await current.reload();
        setUser(auth.currentUser);
        forceUserRefresh();
      } catch (err) {
        throw new Error(mapFirebaseErrorMessage(err));
      }
    },
    [requireAuthInstance, forceUserRefresh]
  );

  const reauthenticateWithPassword = useCallback(
    async (password: string) => {
      const auth = requireAuthInstance();
      const current = auth.currentUser;
      if (!current || !current.email) {
        throw new Error('No signed-in user with an email address.');
      }
      try {
        const credential = EmailAuthProvider.credential(current.email, password);
        await reauthenticateWithCredential(current, credential);
        await current.getIdToken(true);
        forceUserRefresh();
      } catch (err) {
        throw new Error(mapFirebaseErrorMessage(err));
      }
    },
    [requireAuthInstance, forceUserRefresh]
  );

  const reauthenticateWithGoogle = useCallback(async () => {
    const auth = requireAuthInstance();
    const current = auth.currentUser;
    if (!current) {
      throw new Error('Please sign in first.');
    }
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      await reauthenticateWithPopup(current, provider);
      await current.getIdToken(true);
      forceUserRefresh();
    } catch (err) {
      throw new Error(mapFirebaseErrorMessage(err));
    }
  }, [requireAuthInstance, forceUserRefresh]);

  const dismissAccountLinkNotice = useCallback(() => {
    setAccountLinkNotice(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      firebaseReady,
      initError,
      initErrorMessage,
      retryFirebaseInit,
      emailVerified,
      providers,
      enabledProviders,
      pendingLinkEmail,
      pendingLinkProviderLabel,
      accountLinkNotice,
      dismissAccountLinkNotice,
      signUp,
      signIn,
      signInWithGoogle,
      signInWithMicrosoft,
      sendReset,
      signOut,
      resendVerificationEmail,
      reloadUser,
      changePassword,
      setPasswordForSsoAccount,
      reauthenticateWithPassword,
      reauthenticateWithGoogle,
      linkGoogleProvider,
      linkMicrosoftProvider,
      unlinkProvider,
    }),
    [
      user,
      loading,
      firebaseReady,
      initError,
      initErrorMessage,
      retryFirebaseInit,
      emailVerified,
      providers,
      enabledProviders,
      pendingLinkEmail,
      pendingLinkProviderLabel,
      accountLinkNotice,
      dismissAccountLinkNotice,
      signUp,
      signIn,
      signInWithGoogle,
      signInWithMicrosoft,
      sendReset,
      signOut,
      resendVerificationEmail,
      reloadUser,
      changePassword,
      setPasswordForSsoAccount,
      reauthenticateWithPassword,
      reauthenticateWithGoogle,
      linkGoogleProvider,
      linkMicrosoftProvider,
      unlinkProvider,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {!loading && !firebaseReady && initErrorMessage && (
        <div
          role="alert"
          data-testid="firebase-init-error-banner"
          className="w-full px-4 py-3 bg-amber-50 dark:bg-amber-950/80 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100 text-xs sm:text-sm flex flex-wrap items-center justify-center gap-3"
        >
          <span>{initErrorMessage}</span>
          <button
            type="button"
            onClick={() => void retryFirebaseInit()}
            disabled={retryingInit}
            className="px-3 py-1 rounded-lg font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            {retryingInit ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
