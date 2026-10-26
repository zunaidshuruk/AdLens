import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstallPromptStore, type InstallPromptEvent, type PromptTarget } from './installPrompt.js';

function fakeTarget() {
  const handlers: Record<string, (e: never) => void> = {};
  const target: PromptTarget = { addEventListener: (t, l) => { handlers[t] = l; } };
  return { target, fire: (t: string, e?: unknown) => handlers[t](e as never) };
}
function fakeEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  let prevented = false; let prompts = 0;
  const ev: InstallPromptEvent = { preventDefault: () => { prevented = true; }, prompt: async () => { prompts += 1; }, userChoice: Promise.resolve({ outcome }) };
  return { ev, prevented: () => prevented, prompts: () => prompts };
}

test('the browser offer is captured, its own bar is suppressed, and listeners are told', () => {
  const { target, fire } = fakeTarget();
  const store = createInstallPromptStore(target);
  let told = 0;
  store.subscribe(() => { told += 1; });
  assert.equal(store.hasPrompt(), false);
  const f = fakeEvent();
  fire('beforeinstallprompt', f.ev);
  assert.equal(store.hasPrompt(), true);
  assert.equal(f.prevented(), true);
  assert.equal(told, 1);
});

test('prompt() opens the dialog once and reports the choice', async () => {
  const { target, fire } = fakeTarget();
  const store = createInstallPromptStore(target);
  const f = fakeEvent('dismissed');
  fire('beforeinstallprompt', f.ev);
  assert.equal(await store.prompt(), 'dismissed');
  assert.equal(f.prompts(), 1);
  assert.equal(store.hasPrompt(), false);
  assert.equal(await store.prompt(), 'unavailable');
  assert.equal(f.prompts(), 1);
});

test('after the app is installed the offer is forgotten; a failing prompt never throws', async () => {
  const { target, fire } = fakeTarget();
  const store = createInstallPromptStore(target);
  fire('beforeinstallprompt', fakeEvent().ev);
  fire('appinstalled');
  assert.equal(store.hasPrompt(), false);
  const bad: InstallPromptEvent = { preventDefault() {}, prompt: async () => { throw new Error('x'); }, userChoice: new Promise(() => {}) };
  fire('beforeinstallprompt', bad);
  assert.equal(await store.prompt(), 'unavailable');
});

test('unsubscribe stops notifications', () => {
  const { target, fire } = fakeTarget();
  const store = createInstallPromptStore(target);
  let n = 0;
  const off = store.subscribe(() => { n += 1; });
  off();
  fire('beforeinstallprompt', fakeEvent().ev);
  assert.equal(n, 0);
});
