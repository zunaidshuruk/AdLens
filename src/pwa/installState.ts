/**
 * What to show someone who might want to install AdLens (Sprint 16.5, PWA-3). Pure functions.
 *
 * - Chrome/Edge on Windows (and Android): the browser offers a real install prompt; we capture it and show a button.
 * - iPhone and iPad: there is NO install prompt in any browser (all use Safari's engine), so we show a short how-to.
 * - Already installed (running in its own window): show nothing.
 * iPadOS reports itself as a Mac, so touch support is used to tell an iPad from a Mac.
 */

export type Platform = 'ios-safari' | 'ios-chrome' | 'ios-edge' | 'ios-firefox' | 'android-chrome' | 'windows-chrome' | 'windows-edge' | 'mac-safari' | 'mac-chrome' | 'other';

export interface BrowserEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** navigator.standalone (iOS only). */
  standaloneNav?: boolean;
  /** matchMedia('(display-mode: standalone)').matches, or window-controls-overlay / minimal-ui. */
  standaloneMedia: boolean;
}

export function detectPlatform(env: BrowserEnv): Platform {
  const ua = env.userAgent;
  const iPhoneOrPod = /iPhone|iPod/.test(ua);
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  if (iPhoneOrPod || iPad) {
    if (/CriOS/.test(ua)) return 'ios-chrome';
    if (/EdgiOS/.test(ua)) return 'ios-edge';
    if (/FxiOS/.test(ua)) return 'ios-firefox';
    return 'ios-safari';
  }
  if (/Android/.test(ua)) return /Chrome\//.test(ua) && !/EdgA|OPR|SamsungBrowser/.test(ua) ? 'android-chrome' : 'other';
  if (/Windows NT/.test(ua)) {
    if (/Edg\//.test(ua)) return 'windows-edge';
    if (/Chrome\//.test(ua) && !/OPR\/|Vivaldi|Brave/.test(ua)) return 'windows-chrome';
    return 'other';
  }
  if (/Macintosh/.test(ua)) {
    if (/Chrome\//.test(ua) && !/Edg\/|OPR\//.test(ua)) return 'mac-chrome';
    if (/Safari\//.test(ua) && !/Chrome\/|Chromium|Edg\//.test(ua)) return 'mac-safari';
  }
  return 'other';
}

export const isIos = (p: Platform): boolean => p.startsWith('ios-');

export function isStandalone(env: Pick<BrowserEnv, 'standaloneNav' | 'standaloneMedia'>): boolean {
  return env.standaloneNav === true || env.standaloneMedia;
}

export type InstallUi =
  | { kind: 'installed' }
  | { kind: 'prompt' }
  | { kind: 'guide'; title: string; steps: string[] }
  | { kind: 'none' };

const IOS_STEPS: Record<string, { title: string; steps: string[] }> = {
  'ios-safari': {
    title: 'Add AdLens to your Home Screen',
    steps: ['Tap the Share button (the square with an arrow) at the bottom of the screen.', 'Choose “Add to Home Screen”.', 'Keep “Open as Web App” switched on, then tap Add.'],
  },
  'ios-chrome': {
    title: 'Add AdLens to your Home Screen',
    steps: ['Tap the Share button next to the address bar.', 'Choose “Add to Home Screen”.', 'Keep “Open as Web App” switched on, then tap Add.'],
  },
  'ios-edge': {
    title: 'Add AdLens to your Home Screen',
    steps: ['Tap the menu (…) at the bottom of the screen, then Share.', 'Choose “Add to Home Screen”.', 'Keep “Open as Web App” switched on, then tap Add.'],
  },
  'ios-firefox': {
    title: 'Open AdLens in Safari to install it',
    steps: ['Open this page in Safari.', 'Tap the Share button, then “Add to Home Screen”.', 'Keep “Open as Web App” switched on, then tap Add.'],
  },
};

const DESKTOP_STEPS: Record<string, { title: string; steps: string[] }> = {
  'windows-chrome': { title: 'Install AdLens on this computer', steps: ['Click the install icon at the right end of the address bar, or open the menu (⋮).', 'Choose “Install AdLens…”.', 'AdLens then opens in its own window and appears in your Start menu.'] },
  'windows-edge': { title: 'Install AdLens on this computer', steps: ['Open the menu (…) and choose Apps.', 'Choose “Install this site as an app”.', 'AdLens then opens in its own window and appears in your Start menu.'] },
};

/**
 * `where`: "banner" is the unprompted suggestion (shown once, dismissible, only when something useful can be offered);
 * "settings" is the Install section, which always explains how.
 */
export function installUi(o: { platform: Platform; standalone: boolean; hasInstallPrompt: boolean; guideDismissed: boolean; where: 'banner' | 'settings' }): InstallUi {
  if (o.standalone) return { kind: 'installed' };
  if (o.hasInstallPrompt) return { kind: 'prompt' };
  const banner = o.where === 'banner';
  if (isIos(o.platform)) {
    if (banner && o.guideDismissed) return { kind: 'none' };
    return { kind: 'guide', ...IOS_STEPS[o.platform] };
  }
  if (!banner && DESKTOP_STEPS[o.platform]) return { kind: 'guide', ...DESKTOP_STEPS[o.platform] };
  return { kind: 'none' };
}
