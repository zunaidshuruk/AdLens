import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENGINE_SETTINGS,
  chooseEngine,
  detectScript,
  onDeviceSupportsText,
  type EngineEnvironment,
  type EngineSettings,
  type OnDeviceStatus,
} from './aiEngineRouter.js';

const env = (o: Partial<EngineEnvironment> = {}): EngineEnvironment => ({
  onDevice: 'available', online: true, cloudConfigured: true, cloudQuotaRemaining: null, ...o,
});
const priv = (o: Partial<EngineSettings> = {}): EngineSettings => ({ preference: 'on-device', allowCloudFallback: false, ...o });
const Q = 'Which campaign had the lowest cost per lead?';

test('default is the cloud model', () => {
  assert.deepEqual(DEFAULT_ENGINE_SETTINGS, { preference: 'cloud', allowCloudFallback: false });
  const d = chooseEngine(DEFAULT_ENGINE_SETTINGS, env(), Q);
  assert.deepEqual([d.engine, d.reason, d.dataLeavesDevice], ['cloud', 'cloud-chosen', true]);
});

test('script detection: Bengali, Japanese, Latin, digits, mixed', () => {
  assert.equal(detectScript('কোন ক্যাম্পেইনে খরচ কম?'), 'bengali');
  assert.equal(detectScript('先週のセッション数は?'), 'kana');
  assert.equal(detectScript('上周的流量'), 'han');
  assert.equal(detectScript('Sessions last week?'), 'latin');
  assert.equal(detectScript('12345 %'), 'latin');
  assert.equal(detectScript('Show কোন campaign cost per lead by country'), 'latin'); // mostly Latin letters
  assert.ok(onDeviceSupportsText('How many sessions came from Spain?'));
  assert.ok(!onDeviceSupportsText('আজকের ট্রাফিক কত?'));
});

test('cloud mode falls back to the on-device model when the cloud is unavailable (more private, never less)', () => {
  const offline = chooseEngine(DEFAULT_ENGINE_SETTINGS, env({ online: false }), Q);
  assert.deepEqual([offline.engine, offline.reason, offline.dataLeavesDevice], ['on-device', 'on-device-cloud-unavailable', false]);
  const quota = chooseEngine(DEFAULT_ENGINE_SETTINGS, env({ cloudQuotaRemaining: 0 }), Q);
  assert.equal(quota.engine, 'on-device');
  assert.match(quota.message, /limit/);
  const offerDownload = chooseEngine(DEFAULT_ENGINE_SETTINGS, env({ cloudQuotaRemaining: 0, onDevice: 'downloadable' }), Q);
  assert.deepEqual([offerDownload.engine, offerDownload.offer], ['none', 'download-model']);
  const nothing = chooseEngine(DEFAULT_ENGINE_SETTINGS, env({ online: false, onDevice: 'unsupported' }), Q);
  assert.deepEqual([nothing.engine, nothing.offer], ['none', 'connect-internet']);
  assert.match(chooseEngine(DEFAULT_ENGINE_SETTINGS, env({ cloudConfigured: false, onDevice: 'unsupported' }), Q).message, /not set up/);
});

test('private mode uses the on-device model when it is ready and stays local', () => {
  const d = chooseEngine(priv(), env(), Q);
  assert.deepEqual([d.engine, d.reason, d.dataLeavesDevice], ['on-device', 'on-device-chosen', false]);
  const offlineToo = chooseEngine(priv(), env({ online: false }), Q);
  assert.equal(offlineToo.engine, 'on-device');
});

test('private mode: model states map to clear offers', () => {
  assert.deepEqual(
    (({ engine, offer }) => ({ engine, offer }))(chooseEngine(priv(), env({ onDevice: 'downloadable' }), Q)),
    { engine: 'none', offer: 'download-model' }
  );
  assert.deepEqual(
    (({ engine, offer }) => ({ engine, offer }))(chooseEngine(priv(), env({ onDevice: 'downloading' }), Q)),
    { engine: 'none', offer: 'wait-for-download' }
  );
  const unsupported = chooseEngine(priv(), env({ onDevice: 'unsupported' }), Q);
  assert.deepEqual([unsupported.engine, unsupported.offer], ['none', 'ask-cloud-once']);
  const unsupportedOffline = chooseEngine(priv(), env({ onDevice: 'unsupported', online: false }), Q);
  assert.deepEqual([unsupportedOffline.engine, unsupportedOffline.offer], ['none', undefined]);
});

test('private mode: unsupported language is blocked, with a one-time cloud offer', () => {
  const bn = chooseEngine(priv(), env(), 'কোন ক্যাম্পেইনে খরচ কম?');
  assert.deepEqual([bn.engine, bn.offer, bn.dataLeavesDevice], ['none', 'ask-cloud-once', false]);
  assert.match(bn.message, /English, Spanish and Japanese/);
});

test('explicit "Ask the cloud model" sends one question to the cloud', () => {
  const d = chooseEngine(priv(), env(), 'কোন ক্যাম্পেইন?', { forceCloudOnce: true });
  assert.deepEqual([d.engine, d.reason, d.dataLeavesDevice], ['cloud', 'cloud-explicit', true]);
  const blocked = chooseEngine(priv(), env({ online: false }), Q, { forceCloudOnce: true });
  assert.deepEqual([blocked.engine, blocked.offer], ['none', 'connect-internet']);
  const quota = chooseEngine(priv(), env({ cloudQuotaRemaining: 0 }), Q, { forceCloudOnce: true });
  assert.equal(quota.engine, 'none');
});

test('allowCloudFallback lets private mode use the cloud, and says so', () => {
  const p = priv({ allowCloudFallback: true });
  assert.equal(chooseEngine(p, env({ onDevice: 'unsupported' }), Q).reason, 'cloud-fallback');
  const dl = chooseEngine(p, env({ onDevice: 'downloadable' }), Q);
  assert.deepEqual([dl.engine, dl.offer, dl.dataLeavesDevice], ['cloud', 'download-model', true]);
  assert.equal(chooseEngine(p, env({ onDevice: 'downloading' }), Q).offer, 'wait-for-download');
  assert.equal(chooseEngine(p, env(), 'আজকের ট্রাফিক').engine, 'cloud');
  // ...but only when the cloud is actually usable
  assert.equal(chooseEngine(p, env({ onDevice: 'unsupported', cloudQuotaRemaining: 0 }), Q).engine, 'none');
});

test('PRIVACY RULE (exhaustive): on-device preference without fallback never reaches the cloud', () => {
  const statuses: OnDeviceStatus[] = ['unsupported', 'downloadable', 'downloading', 'available'];
  const questions = [Q, 'আজকের ট্রাফিক কত?', '先週の流量', '', '12345'];
  let checked = 0;
  for (const onDevice of statuses)
    for (const online of [true, false])
      for (const cloudConfigured of [true, false])
        for (const cloudQuotaRemaining of [null, 0, 5])
          for (const question of questions) {
            const d = chooseEngine(priv({ allowCloudFallback: false }), { onDevice, online, cloudConfigured, cloudQuotaRemaining }, question);
            assert.notEqual(d.engine, 'cloud', JSON.stringify({ onDevice, online, cloudConfigured, cloudQuotaRemaining, question }));
            assert.equal(d.dataLeavesDevice, false);
            checked++;
          }
  assert.equal(checked, 4 * 2 * 2 * 3 * 5);
});

test('dataLeavesDevice is true exactly when the engine is cloud', () => {
  for (const preference of ['cloud', 'on-device'] as const)
    for (const allowCloudFallback of [true, false])
      for (const onDevice of ['unsupported', 'downloadable', 'downloading', 'available'] as OnDeviceStatus[])
        for (const online of [true, false]) {
          const d = chooseEngine({ preference, allowCloudFallback }, env({ onDevice, online }), Q);
          assert.equal(d.dataLeavesDevice, d.engine === 'cloud');
        }
});
