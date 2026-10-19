import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client.js';
import { db, firestoreDirectAvailable, markFirestoreDirectUnavailable } from '../lib/firebase.js';

interface LogoCacheEntry {
  dataUrl: string | null;
  updatedAt?: string;
}

const logoMemoryCache = new Map<string, LogoCacheEntry>();

export function invalidateLogoCache(wsId: string): void {
  logoMemoryCache.delete(wsId);
}

export interface UseWorkspaceLogoInput {
  id?: string | null;
  logoURL?: string | null;
  hasLogo?: boolean;
  updatedAt?: string;
}

export interface UseWorkspaceLogoResult {
  logoUrl: string | null;
  loading: boolean;
}

/**
 * Returns the custom logo data URL if hasLogo, else logoURL, else null (UI shows initials).
 * Caches per wsId in memory; refetches when hasLogo or updatedAt changes.
 */
export function useWorkspaceLogo(workspace?: UseWorkspaceLogoInput | null): UseWorkspaceLogoResult {
  const wsId = workspace?.id || null;
  const logoURL = workspace?.logoURL || null;
  const hasLogo = Boolean(workspace?.hasLogo);
  const updatedAt = workspace?.updatedAt;

  const getCachedValue = (): string | null => {
    if (!wsId) return null;
    if (!hasLogo) return logoURL;
    const cached = logoMemoryCache.get(wsId);
    if (cached && (!updatedAt || cached.updatedAt === updatedAt)) {
      return cached.dataUrl;
    }
    return null;
  };

  const [logoUrl, setLogoUrl] = useState<string | null>(getCachedValue);
  const [loading, setLoading] = useState<boolean>(() => {
    if (!wsId || !hasLogo) return false;
    const cached = logoMemoryCache.get(wsId);
    return !(cached && (!updatedAt || cached.updatedAt === updatedAt));
  });

  useEffect(() => {
    if (!wsId) {
      setLogoUrl(null);
      setLoading(false);
      return;
    }

    if (!hasLogo) {
      setLogoUrl(logoURL);
      setLoading(false);
      return;
    }

    const cached = logoMemoryCache.get(wsId);
    if (cached && (!updatedAt || cached.updatedAt === updatedAt)) {
      setLogoUrl(cached.dataUrl);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      if (db && firestoreDirectAvailable) {
        try {
          const logoRef = doc(db, 'workspaces', wsId, 'assets', 'logo');
          const snap = await Promise.race([
            getDoc(logoRef),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('FIRESTORE_DIRECT_TIMEOUT')), 3500)
            ),
          ]);
          if (cancelled) return;
          if (snap.exists()) {
            const data = snap.data();
            const dataUrl = typeof data?.dataUrl === 'string' ? data.dataUrl : null;
            logoMemoryCache.set(wsId, { dataUrl, updatedAt });
            setLogoUrl(dataUrl || logoURL);
          } else {
            logoMemoryCache.set(wsId, { dataUrl: null, updatedAt });
            setLogoUrl(logoURL);
          }
          setLoading(false);
          return;
        } catch {
          markFirestoreDirectUnavailable();
        }
      }

      try {
        const res = await apiClient.getWorkspaceLogo(wsId);
        if (cancelled) return;
        const dataUrl = res.logo?.dataUrl || null;
        logoMemoryCache.set(wsId, { dataUrl, updatedAt });
        setLogoUrl(dataUrl || logoURL);
      } catch {
        if (cancelled) return;
        setLogoUrl(logoURL);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wsId, hasLogo, logoURL, updatedAt]);

  return { logoUrl, loading };
}

