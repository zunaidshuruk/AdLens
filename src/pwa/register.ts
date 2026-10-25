/**
 * Registers the service worker and keeps an installed app up to date (Sprint 16.5).
 * Browser pieces are injected so the behaviour is unit-tested. Typical use (in main.tsx):
 *
 *   registerServiceWorker({
 *     container: navigator.serviceWorker, enabled: import.meta.env.PROD,
 *     reload: () => location.reload(), onUpdateReady: showRefreshToast, onReplacedElsewhere: showReloadHint,
 *     visibility: { addEventListener: (t, l) => document.addEventListener(t, l), state: () => document.visibilityState },
 *     now: () => Date.now(),
 *   });
 */
import { createUpdateManager, type RegistrationLike } from './updateManager.js';

export interface SwContainerLike {
  controller: unknown | null;
  register(url: string, options: { scope: string; updateViaCache: 'none' }): Promise<RegistrationLike & { update(): Promise<unknown> }>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface RegisterDeps {
  container: SwContainerLike | undefined;
  /** Production builds only: in development the worker would cache files that are changing all the time. */
  enabled: boolean;
  reload: () => void;
  onUpdateReady: () => void;
  onReplacedElsewhere: () => void;
  visibility: { addEventListener(type: 'visibilitychange', listener: () => void): void; state(): string };
  now: () => number;
  /** Minimum time between checks when the app returns to the foreground. Default 30 minutes. */
  minUpdateGapMs?: number;
}

export interface SwHandle {
  /** The user tapped "Refresh". */
  accept(): void;
  checkNow(): void;
}

export async function registerServiceWorker(deps: RegisterDeps): Promise<SwHandle | null> {
  if (!deps.enabled || !deps.container) return null;
  const container = deps.container;
  // Must be read BEFORE registering: it tells a first install apart from an update.
  const manager = createUpdateManager({
    hadController: !!container.controller,
    reload: deps.reload,
    onUpdateReady: deps.onUpdateReady,
    onReplacedElsewhere: deps.onReplacedElsewhere,
  });
  container.addEventListener('controllerchange', () => manager.controllerChanged());

  let reg: Awaited<ReturnType<SwContainerLike['register']>>;
  try {
    // updateViaCache "none": the browser always asks the server whether sw.js changed.
    reg = await container.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  } catch {
    return null; // the app works without the worker
  }
  manager.watch(reg);

  const gap = deps.minUpdateGapMs ?? 30 * 60 * 1000;
  let lastCheck = deps.now();
  const checkNow = () => {
    lastCheck = deps.now();
    reg.update().catch(() => undefined);
  };
  deps.visibility.addEventListener('visibilitychange', () => {
    if (deps.visibility.state() === 'visible' && deps.now() - lastCheck >= gap) checkNow();
  });
  return { accept: manager.accept, checkNow };
}
