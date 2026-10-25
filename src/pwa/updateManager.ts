/**
 * Page-side handling of service worker updates (Sprint 16.5). Pure logic with injected browser pieces,
 * so the two classic bugs are tested:
 *   1. a reload loop or a surprise reload on the FIRST install (there is no old version to replace);
 *   2. reloading when the user never asked (another tab updated the worker): show a prompt instead.
 */

export interface WorkerLike { state: string; postMessage(m: unknown): void; addEventListener(t: 'statechange', l: () => void): void }
export interface RegistrationLike {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  addEventListener(t: 'updatefound', l: () => void): void;
}

export interface UpdateDeps {
  /** True when a worker already controlled this page when it loaded (so this is an update, not a first install). */
  hadController: boolean;
  reload: () => void;
  onUpdateReady: () => void;
  /** Another tab replaced the worker without this tab's consent. */
  onReplacedElsewhere: () => void;
}

export function createUpdateManager(deps: UpdateDeps) {
  let accepted = false;
  let reloaded = false;
  let announced = false;
  let waiting: WorkerLike | null = null;

  const announce = (w: WorkerLike) => {
    waiting = w;
    if (!deps.hadController || announced) return; // first install: nothing to refresh
    announced = true;
    deps.onUpdateReady();
  };

  function watch(reg: RegistrationLike): void {
    if (reg.waiting) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed') announce(w); });
    });
  }

  /** The user tapped "Refresh". */
  function accept(): void {
    if (!waiting) return;
    accepted = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  /** navigator.serviceWorker "controllerchange". */
  function controllerChanged(): void {
    if (!deps.hadController) return; // the worker just took control after the first install
    if (reloaded) return;
    if (accepted) { reloaded = true; deps.reload(); }
    else deps.onReplacedElsewhere();
  }

  return { watch, accept, controllerChanged };
}

/** Removes every AdLens cache (called on sign-out). Caches belonging to anything else are left alone. */
export async function clearAppCaches(store: { keys(): Promise<string[]>; delete(n: string): Promise<boolean> }, prefix = 'adlens-'): Promise<number> {
  const names = (await store.keys()).filter((n) => n.startsWith(prefix));
  await Promise.all(names.map((n) => store.delete(n)));
  return names.length;
}
