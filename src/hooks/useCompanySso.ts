import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

export interface CompanySso { providerId: string; displayName: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Asks the server whether the typed work email belongs to a company that uses single sign-on. Quiet on any error. */
export function useCompanySso(email: string): CompanySso | null {
  const [found, setFound] = useState<{ domain: string; sso: CompanySso | null } | null>(null);
  const trimmed = email.trim().toLowerCase();
  const domain = EMAIL.test(trimmed) ? trimmed.slice(trimmed.lastIndexOf('@') + 1) : '';

  useEffect(() => {
    if (!domain) return;
    let active = true;
    const t = setTimeout(() => {
      apiClient
        .ssoLookup(trimmed)
        .then((r) => active && setFound({ domain, sso: r.sso }))
        .catch(() => active && setFound({ domain, sso: null }));
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [domain, trimmed]);

  return domain && found?.domain === domain ? found.sso : null;
}
