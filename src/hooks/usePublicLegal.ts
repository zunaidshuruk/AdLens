import { useEffect, useState } from 'react';
import type { LegalOwner } from '../config/legalContent.js';

const FALLBACK: LegalOwner = { entity: 'Synesis IT PLC', supportEmail: '', address: '' };

/** Owner name and contact for the public legal pages, from /api/public-config. Works before sign-in. */
export function usePublicLegal(): LegalOwner {
  const [owner, setOwner] = useState<LegalOwner>(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/public-config', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { legal?: { entity?: string; supportEmail?: string; address?: string } } | null) => {
        if (cancelled || !body?.legal) return;
        setOwner({
          entity: body.legal.entity || FALLBACK.entity,
          supportEmail: body.legal.supportEmail || '',
          address: body.legal.address || '',
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return owner;
}
