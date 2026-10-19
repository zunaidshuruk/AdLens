import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client.js';
import { db, firestoreDirectAvailable, markFirestoreDirectUnavailable } from '../lib/firebase.js';

interface AvatarCacheEntry {
  dataUrl: string | null;
  updatedAt?: string;
}

const avatarMemoryCache = new Map<string, AvatarCacheEntry>();

export function invalidateAvatarCache(uid: string): void {
  avatarMemoryCache.delete(uid);
}

export interface UseAvatarUser {
  uid?: string | null;
  photoURL?: string | null;
  hasCustomAvatar?: boolean;
  updatedAt?: string;
}

export interface UseAvatarResult {
  avatarUrl: string | null;
  loading: boolean;
}

/**
 * Returns the custom avatar data URL if hasCustomAvatar, else photoURL, else null (UI shows initials).
 * Caches per uid in memory; refetches when hasCustomAvatar or updatedAt changes.
 */
export function useAvatar(user?: UseAvatarUser | null): UseAvatarResult {
  const uid = user?.uid || null;
  const photoURL = user?.photoURL || null;
  const hasCustomAvatar = Boolean(user?.hasCustomAvatar);
  const updatedAt = user?.updatedAt;

  const getCachedValue = (): string | null => {
    if (!uid) return null;
    if (!hasCustomAvatar) return photoURL;
    const cached = avatarMemoryCache.get(uid);
    if (cached && (!updatedAt || cached.updatedAt === updatedAt)) {
      return cached.dataUrl;
    }
    return null;
  };

  const [avatarUrl, setAvatarUrl] = useState<string | null>(getCachedValue);
  const [loading, setLoading] = useState<boolean>(() => {
    if (!uid || !hasCustomAvatar) return false;
    const cached = avatarMemoryCache.get(uid);
    return !(cached && (!updatedAt || cached.updatedAt === updatedAt));
  });

  useEffect(() => {
    if (!uid) {
      setAvatarUrl(null);
      setLoading(false);
      return;
    }

    if (!hasCustomAvatar) {
      setAvatarUrl(photoURL);
      setLoading(false);
      return;
    }

    const cached = avatarMemoryCache.get(uid);
    if (cached && (!updatedAt || cached.updatedAt === updatedAt)) {
      setAvatarUrl(cached.dataUrl);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      if (db && firestoreDirectAvailable) {
        try {
          const avatarRef = doc(db, 'users', uid, 'assets', 'avatar');
          const snap = await Promise.race([
            getDoc(avatarRef),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('FIRESTORE_DIRECT_TIMEOUT')), 3500)
            ),
          ]);
          if (cancelled) return;
          if (snap.exists()) {
            const data = snap.data();
            const dataUrl = typeof data?.dataUrl === 'string' ? data.dataUrl : null;
            avatarMemoryCache.set(uid, { dataUrl, updatedAt });
            setAvatarUrl(dataUrl || photoURL);
          } else {
            avatarMemoryCache.set(uid, { dataUrl: null, updatedAt });
            setAvatarUrl(photoURL);
          }
          setLoading(false);
          return;
        } catch {
          markFirestoreDirectUnavailable();
        }
      }

      try {
        const res = await apiClient.getUserAvatar(uid);
        if (cancelled) return;
        const dataUrl = res.avatar?.dataUrl || null;
        avatarMemoryCache.set(uid, { dataUrl, updatedAt });
        setAvatarUrl(dataUrl || photoURL);
      } catch {
        if (cancelled) return;
        setAvatarUrl(photoURL);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, hasCustomAvatar, photoURL, updatedAt]);

  return { avatarUrl, loading };
}

