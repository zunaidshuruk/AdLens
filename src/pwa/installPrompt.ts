/**
 * Captures the browser's "install this app" offer (Chrome and Edge fire `beforeinstallprompt`) so a button
 * of our own can use it later. iPhone and iPad never fire it; they get a how-to guide instead.
 */

export interface InstallPromptEvent {
  preventDefault(): void;
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PromptTarget {
  addEventListener(type: 'beforeinstallprompt' | 'appinstalled', listener: (e: never) => void): void;
}

export function createInstallPromptStore(target: PromptTarget) {
  let saved: InstallPromptEvent | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  target.addEventListener('beforeinstallprompt', ((e: InstallPromptEvent) => {
    e.preventDefault(); // stop the browser's own mini-bar; we show our button instead
    saved = e;
    notify();
  }) as (e: never) => void);

  target.addEventListener('appinstalled', (() => {
    saved = null;
    notify();
  }) as (e: never) => void);

  return {
    hasPrompt: (): boolean => saved !== null,
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Opens the browser's install dialog. A saved offer can only be used once. */
    async prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
      const ev = saved;
      if (!ev) return 'unavailable';
      saved = null;
      notify();
      try {
        await ev.prompt();
        return (await ev.userChoice).outcome;
      } catch {
        return 'unavailable';
      }
    },
  };
}

export type InstallPromptStore = ReturnType<typeof createInstallPromptStore>;

let shared: InstallPromptStore | null = null;

/** Call once, as early as possible (before the page finishes loading), so the offer is not missed. */
export function initInstallPrompt(): InstallPromptStore | null {
  if (typeof window === 'undefined') return null;
  if (!shared) shared = createInstallPromptStore(window as unknown as PromptTarget);
  return shared;
}

export function getInstallPromptStore(): InstallPromptStore | null {
  return shared;
}
