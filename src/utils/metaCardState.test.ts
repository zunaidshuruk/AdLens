import assert from 'node:assert/strict';
import test from 'node:test';
import { describeMetaExpiry, getMetaCardMode, type MetaCardInput } from './metaCardState.js';

const base: MetaCardInput = {
  loginConfigured: true,
  userConnected: false,
  reconnect: 'no_expiry',
  adAccountId: null,
  systemConfigured: false,
  notAvailable: false,
};

test('mode: not connected but sign-in is ready shows Connect', () => {
  assert.equal(getMetaCardMode(base), 'connect');
});

test('mode: connected without an account asks to choose one', () => {
  assert.equal(getMetaCardMode({ ...base, userConnected: true, reconnect: 'ok' }), 'choose_account');
});

test('mode: connected with an account shows details', () => {
  assert.equal(getMetaCardMode({ ...base, userConnected: true, reconnect: 'ok', adAccountId: '123' }), 'connected');
});

test('mode: expired connection asks to reconnect', () => {
  assert.equal(getMetaCardMode({ ...base, userConnected: true, reconnect: 'expired', adAccountId: '123' }), 'reconnect');
});

test('mode: shared company connection when Facebook sign-in is not set up', () => {
  assert.equal(getMetaCardMode({ ...base, loginConfigured: false, systemConfigured: true }), 'shared');
});

test('mode: coming soon and setup needed', () => {
  assert.equal(getMetaCardMode({ ...base, loginConfigured: false, notAvailable: true }), 'coming_soon');
  assert.equal(getMetaCardMode({ ...base, loginConfigured: false }), 'setup_needed');
});

test('expiry: none, expired, soon, later', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  assert.equal(describeMetaExpiry(null, now), null);
  assert.equal(describeMetaExpiry('garbage', now), null);
  assert.equal(describeMetaExpiry('2026-10-25T00:00:00Z', now)?.urgent, true);
  assert.match(describeMetaExpiry('2026-10-29T00:00:00Z', now)!.text, /ends in 3 days/);
  assert.equal(describeMetaExpiry('2026-12-20T00:00:00Z', now)?.urgent, false);
});
