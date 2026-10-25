import test from 'node:test';
import assert from 'node:assert/strict';
import { registerServiceWorker, type RegisterDeps, type SwContainerLike } from './register.js';
import type { WorkerLike } from './updateManager.js';

function fakeWorker(): WorkerLike & { posted: unknown[]; set(s: string): void } {
  const ls: (() => void)[] = []; const posted: unknown[] = [];
  const w = { state: 'installing', posted, postMessage: (m: unknown) => posted.push(m), addEventListener: (_t: 'statechange', l: () => void) => ls.push(l), set(s: string) { w.state = s; ls.forEach((l) => l()); } };
  return w;
}

function setup(o: { controller?: boolean; enabled?: boolean; container?: boolean; registerFails?: boolean } = {}) {
  const log: string[] = [];
  let found: (() => void) | undefined;
  let controllerChange: (() => void) | undefined;
  let visibility: (() => void) | undefined;
  let state = 'visible';
  let clock = 1_000_000;
  const installing = fakeWorker();
  const reg = { waiting: null, installing, addEventListener: (_t: 'updatefound', l: () => void) => { found = l; }, update: async () => { log.push('update'); } };
  const registerArgs: unknown[][] = [];
  const container: SwContainerLike = {
    controller: o.controller ? {} : null,
    register: async (...args) => { registerArgs.push(args); if (o.registerFails) throw new Error('blocked'); return reg; },
    addEventListener: (_t, l) => { controllerChange = l; },
  };
  const deps: RegisterDeps = {
    container: o.container === false ? undefined : container, enabled: o.enabled ?? true,
    reload: () => log.push('reload'), onUpdateReady: () => log.push('ready'), onReplacedElsewhere: () => log.push('elsewhere'),
    visibility: { addEventListener: (_t, l) => { visibility = l; }, state: () => state }, now: () => clock,
  };
  return { deps, log, registerArgs, installing, fire: { updateFound: () => found?.(), controllerChange: () => controllerChange?.(), visibility: () => visibility?.() }, setState: (s: string) => { state = s; }, tick: (ms: number) => { clock += ms; } };
}

test('does nothing in development, without browser support, or when registration is blocked', async () => {
  const dev = setup({ enabled: false });
  assert.equal(await registerServiceWorker(dev.deps), null);
  assert.equal(dev.registerArgs.length, 0);
  assert.equal(await registerServiceWorker(setup({ container: false }).deps), null);
  assert.equal(await registerServiceWorker(setup({ registerFails: true }).deps), null); // never throws into the app
});

test('registers /sw.js for the whole app and always asks the server whether it changed', async () => {
  const s = setup();
  assert.ok(await registerServiceWorker(s.deps));
  assert.deepEqual(s.registerArgs, [['/sw.js', { scope: '/', updateViaCache: 'none' }]]);
});

test('first visit: the worker takes control quietly (no prompt, no reload)', async () => {
  const s = setup({ controller: false });
  await registerServiceWorker(s.deps);
  s.fire.updateFound(); s.installing.set('installed'); s.fire.controllerChange();
  assert.deepEqual(s.log, []);
});

test('update on a later visit: prompt, then one reload only after the user accepts', async () => {
  const s = setup({ controller: true });
  const handle = await registerServiceWorker(s.deps);
  s.fire.updateFound(); s.installing.set('installed');
  assert.deepEqual(s.log, ['ready']);
  handle!.accept();
  assert.deepEqual(s.installing.posted, [{ type: 'SKIP_WAITING' }]);
  s.fire.controllerChange(); s.fire.controllerChange();
  assert.deepEqual(s.log, ['ready', 'reload']);
});

test('an installed app left open checks for updates when it comes back, but not constantly', async () => {
  const s = setup({ controller: true });
  await registerServiceWorker(s.deps);
  s.tick(5 * 60_000); s.fire.visibility();
  assert.deepEqual(s.log, []); // only 5 minutes
  s.tick(30 * 60_000); s.setState('hidden'); s.fire.visibility();
  assert.deepEqual(s.log, []); // not visible
  s.setState('visible'); s.fire.visibility();
  assert.deepEqual(s.log, ['update']);
  s.tick(60_000); s.fire.visibility();
  assert.deepEqual(s.log, ['update']); // just checked
});

test('checkNow asks for an update immediately', async () => {
  const s = setup();
  const handle = await registerServiceWorker(s.deps);
  handle!.checkNow();
  assert.deepEqual(s.log, ['update']);
});
