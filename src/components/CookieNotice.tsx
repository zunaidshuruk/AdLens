import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const KEY = 'adlens_cookie_notice_v1';

function alreadyDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** AdLens only uses essential cookies, so this is an information notice (no choices to make). Remembers it was read. */
export const CookieNotice: React.FC = () => {
  const [hidden, setHidden] = useState<boolean>(alreadyDismissed);
  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // private window: it will simply show again next time
    }
    setHidden(true);
  };
  return (
    <div role="region" aria-label="Cookie notice" className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-2xl rounded-xl border border-line bg-raised shadow-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs sm:text-sm text-fg">
          AdLens uses only essential cookies to keep you signed in and to connect your accounts safely. There are no advertising or tracking cookies.{' '}
          <Link to="/privacy#cookies" className="text-accent-text underline">Learn more</Link>
        </p>
        <button type="button" onClick={dismiss} className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-on-accent hover:bg-accent-hover">
          Got it
        </button>
      </div>
    </div>
  );
};
