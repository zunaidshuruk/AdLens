import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, installUi, isIos, isStandalone, type Platform } from './installState.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  winOpera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};
const p = (userAgent: string, maxTouchPoints = 0) => detectPlatform({ userAgent, maxTouchPoints, standaloneMedia: false });

test('detects the browsers that matter, including an iPad that pretends to be a Mac', () => {
  assert.equal(p(UA.iphoneSafari, 5), 'ios-safari');
  assert.equal(p(UA.iphoneChrome, 5), 'ios-chrome');
  assert.equal(p(UA.iphoneEdge, 5), 'ios-edge');
  assert.equal(p(UA.iphoneFirefox, 5), 'ios-firefox');
  assert.equal(p(UA.ipadDesktopMode, 5), 'ios-safari'); // touch screen: an iPad, not a Mac
  assert.equal(p(UA.macSafari, 0), 'mac-safari'); // no touch: a real Mac
  assert.equal(p(UA.macChrome, 0), 'mac-chrome');
  assert.equal(p(UA.winChrome), 'windows-chrome');
  assert.equal(p(UA.winEdge), 'windows-edge');
  assert.equal(p(UA.androidChrome, 5), 'android-chrome');
  for (const ua of [UA.winFirefox, UA.winOpera, UA.androidSamsung, '', 'curl/8.0']) assert.equal(p(ua), 'other', ua.slice(0, 40));
  assert.ok(isIos('ios-chrome') && !isIos('windows-chrome') && !isIos('mac-safari'));
});

test('standalone detection covers iOS and Chrome', () => {
  assert.equal(isStandalone({ standaloneNav: true, standaloneMedia: false }), true);
  assert.equal(isStandalone({ standaloneNav: undefined, standaloneMedia: true }), true);
  assert.equal(isStandalone({ standaloneNav: false, standaloneMedia: false }), false);
  assert.equal(isStandalone({ standaloneMedia: false }), false);
});

const ui = (platform: Platform, o: Partial<Parameters<typeof installUi>[0]> = {}) => installUi({ platform, standalone: false, hasInstallPrompt: false, guideDismissed: false, where: 'banner', ...o });

test('already installed: nothing to offer anywhere', () => {
  for (const platform of ['ios-safari', 'windows-chrome', 'other'] as Platform[]) for (const where of ['banner', 'settings'] as const) assert.deepEqual(ui(platform, { standalone: true, where, hasInstallPrompt: true }), { kind: 'installed' });
});

test('Chrome and Edge: a real install button when the browser offers one', () => {
  assert.deepEqual(ui('windows-chrome', { hasInstallPrompt: true }), { kind: 'prompt' });
  assert.deepEqual(ui('windows-edge', { hasInstallPrompt: true, where: 'settings' }), { kind: 'prompt' });
  assert.deepEqual(ui('android-chrome', { hasInstallPrompt: true }), { kind: 'prompt' });
});

test('iPhone and iPad: no prompt exists, so a how-to guide (once in the banner, always in Settings)', () => {
  for (const platform of ['ios-safari', 'ios-chrome', 'ios-edge', 'ios-firefox'] as Platform[]) {
    const g = ui(platform);
    assert.equal(g.kind, 'guide');
    if (g.kind === 'guide') { assert.ok(g.steps.length === 3 && g.steps.some((s) => /Add to Home Screen/.test(s))); assert.ok(g.title.length > 5); }
    assert.deepEqual(ui(platform, { guideDismissed: true }), { kind: 'none' }); // banner respects "dismiss"
    assert.equal(ui(platform, { guideDismissed: true, where: 'settings' }).kind, 'guide'); // Settings always explains
  }
  const safari = ui('ios-safari');
  assert.ok(safari.kind === 'guide' && /Open as Web App/.test(safari.steps.join(' '))); // iOS 26 detail
  const firefox = ui('ios-firefox');
  assert.ok(firefox.kind === 'guide' && /Safari/.test(firefox.title));
});

test('desktop without a prompt: silent in the banner, but Settings explains where the install option is', () => {
  assert.deepEqual(ui('windows-chrome'), { kind: 'none' });
  assert.deepEqual(ui('windows-edge'), { kind: 'none' });
  const chrome = ui('windows-chrome', { where: 'settings' });
  assert.ok(chrome.kind === 'guide' && /Install AdLens/.test(chrome.steps.join(' ')));
  const edge = ui('windows-edge', { where: 'settings' });
  assert.ok(edge.kind === 'guide' && /Install this site as an app/.test(edge.steps.join(' ')));
  assert.deepEqual(ui('other', { where: 'settings' }), { kind: 'none' });
  assert.deepEqual(ui('mac-safari', { where: 'settings' }), { kind: 'none' });
});
