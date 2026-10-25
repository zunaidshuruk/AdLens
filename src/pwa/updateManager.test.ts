import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAppCaches, createUpdateManager, type RegistrationLike, type WorkerLike } from './updateManager.js';

function worker(state = 'installing') {
  const listeners: (() => void)[] = [];
  const posted: unknown[] = [];
  const w: WorkerLike & { set(s: string): void; posted: unknown[] } = {
    state, posted,
    postMessage: (m) => posted.push(m),
    addEventListener: (_t, l) => listeners.push(l),
    set(s) { w.state = s; listeners.forEach((l) => l()); },
  };
  return w;
}
function registration(init: { waiting?: ReturnType<typeof worker> | null; installing?: ReturnType<typeof worker> | null } = {}) {
  let found: (() => void) | null = null;
  const reg: RegistrationLike & { fireUpdateFound(): void } = {
    waiting: init.waiting ?? null, installing: init.installing ?? null,
    addEventListener: (_t, l) => { found = l; },
    fireUpdateFound: () => found?.(),
  };
  return reg;
}
function setup(hadController: boolean) {
  const log: string[] = [];
  const m = createUpdateManager({ hadController, reload: () => log.push('reload'), onUpdateReady: () => log.push('ready'), onReplacedElsewhere: () => log.push('elsewhere') });
  return { m, log };
}

test('FIRST INSTALL: no prompt and no reload when the worker takes control for the first time', () => {
  const { m, log } = setup(false);
  const w = worker();
  const reg = registration({ installing: w });
  m.watch(reg);
  reg.fireUpdateFound();
  w.set('installed');
  m.controllerChanged(); // worker claims the page
  assert.deepEqual(log, []);
});

test('UPDATE: prompt appears once, nothing reloads until the user accepts, then exactly one reload', () => {
  const { m, log } = setup(true);
  const w = worker();
  const reg = registration({ installing: w });
  m.watch(reg);
  reg.fireUpdateFound();
  w.set('installing');
  assert.deepEqual(log, []);
  w.set('installed');
  w.set('installed');
  assert.deepEqual(log, ['ready']); // announced once
  m.accept();
  assert.deepEqual(w.posted, [{ type: 'SKIP_WAITING' }]);
  m.controllerChanged();
  m.controllerChanged();
  assert.deepEqual(log, ['ready', 'reload']); // never twice
});

test('an update that was already waiting when the page loaded is announced straight away', () => {
  const { m, log } = setup(true);
  const w = worker('installed');
  m.watch(registration({ waiting: w }));
  assert.deepEqual(log, ['ready']);
  m.accept();
  assert.equal(w.posted.length, 1);
});

test('another tab updating the worker never reloads this tab uninvited', () => {
  const { m, log } = setup(true);
  m.watch(registration());
  m.controllerChanged();
  assert.deepEqual(log, ['elsewhere']);
});

test('accept() with nothing waiting does nothing', () => {
  const { m, log } = setup(true);
  m.watch(registration());
  m.accept();
  m.controllerChanged();
  assert.deepEqual(log, ['elsewhere']); // not a reload
});

test('signing out clears AdLens caches and nothing else', async () => {
  const store = new Map<string, true>([['adlens-202610-aaa1111', true], ['adlens-202611-bbb2222', true], ['other-site-cache', true], ['workbox-precache-v2', true]]);
  const n = await clearAppCaches({ keys: async () => [...store.keys()], delete: async (k) => store.delete(k) });
  assert.equal(n, 2);
  assert.deepEqual([...store.keys()], ['other-site-cache', 'workbox-precache-v2']);
  assert.equal(await clearAppCaches({ keys: async () => [], delete: async () => true }), 0);
});
