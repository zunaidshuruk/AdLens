import { useCallback, useEffect, useMemo, useState } from 'react';
import { getInstallPromptStore } from '../pwa/installPrompt.js';
import { detectPlatform, installUi, isStandalone, type InstallUi } from '../pwa/installState.js';

const DISMISS_KEY = 'adlens_install_banner_dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function currentEnv() {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standaloneNav: nav.standalone,
    standaloneMedia: ['standalone', 'window-controls-overlay', 'minimal-ui'].some(
      (m) => window.matchMedia?.(`(display-mode: ${m})`).matches
    ),
  };
}

export interface UseInstall {
  banner: InstallUi;
  settings: InstallUi;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  dismissBanner: () => void;
}

/** Everything the install banner and the Settings "Install" section need. */
export function useInstall(): UseInstall {
  const [hasPrompt, setHasPrompt] = useState<boolean>(() => getInstallPromptStore()?.hasPrompt() ?? false);
  const [dismissed, setDismissed] = useState<boolean>(() => (typeof window === 'undefined' ? false : readDismissed()));

  useEffect(() => {
    const store = getInstallPromptStore();
    if (!store) return;
    setHasPrompt(store.hasPrompt());
    return store.subscribe(() => setHasPrompt(store.hasPrompt()));
  }, []);

  const env = useMemo(() => (typeof window === 'undefined' ? null : currentEnv()), []);

  const compute = useCallback(
    (where: 'banner' | 'settings'): InstallUi => {
      if (!env) return { kind: 'none' };
      const ui = installUi({
        platform: detectPlatform(env),
        standalone: isStandalone(env),
        hasInstallPrompt: hasPrompt,
        guideDismissed: dismissed,
        where,
      });
      // One dismissal silences the unprompted banner for every kind of device.
      if (where === 'banner' && dismissed && ui.kind !== 'installed') return { kind: 'none' };
      return ui;
    },
    [env, hasPrompt, dismissed]
  );

  const install = useCallback(async () => {
    const store = getInstallPromptStore();
    return store ? store.prompt() : 'unavailable';
  }, []);

  const dismissBanner = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode: the banner simply comes back next visit */
    }
  }, []);

  return { banner: compute('banner'), settings: compute('settings'), install, dismissBanner };
}
