import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLaunchReadiness, summariseReadiness } from './lib/launchReadiness.js';

const GOOD = {
  APP_BASE_URL: 'https://app.adlens.example', SUPPORT_EMAIL: 'help@adlens.example', LEGAL_ENTITY: 'Synesis IT PLC', LEGAL_ADDRESS: 'Dhaka',
  GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', META_APP_ID: 'c', META_APP_SECRET: 'd', META_LOGIN_CONFIG_ID: 'e',
  TOKEN_ENCRYPTION_KEY: 'x'.repeat(40), FIREBASE_API_KEY: '1', FIREBASE_AUTH_DOMAIN: '2', FIREBASE_PROJECT_ID: '3', FIREBASE_APP_ID: '4', FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
  GEMINI_API_KEY: 'g', GEMINI_MODEL: 'm',
};

test('a complete setup is ready', () => {
  const checks = evaluateLaunchReadiness(GOOD);
  assert.deepEqual(summariseReadiness(checks), { ready: true, failed: 0, warned: 0 });
});

test('hosting addresses are not an own domain, and http is rejected', () => {
  const c = evaluateLaunchReadiness({ ...GOOD, APP_BASE_URL: 'https://adlens-1.ai.studio' });
  assert.equal(c.find((x) => x.id === 'own-domain')!.status, 'fail');
  const h = evaluateLaunchReadiness({ ...GOOD, APP_BASE_URL: 'http://app.adlens.example' });
  assert.equal(h.find((x) => x.id === 'base-url')!.status, 'fail');
  assert.equal(summariseReadiness(c).ready, false);
});

test('a missing support email blocks launch; a missing address only warns', () => {
  const c = evaluateLaunchReadiness({ ...GOOD, SUPPORT_EMAIL: '', LEGAL_ADDRESS: '' });
  assert.equal(c.find((x) => x.id === 'support-email')!.status, 'fail');
  assert.equal(c.find((x) => x.id === 'legal-address')!.status, 'warn');
});

test('a shared Meta system token without an allow-list is a failure', () => {
  const c = evaluateLaunchReadiness({ ...GOOD, META_ACCESS_TOKEN: 'tok' });
  assert.equal(c.find((x) => x.id === 'meta-system-token')!.status, 'fail');
  const ok = evaluateLaunchReadiness({ ...GOOD, META_ACCESS_TOKEN: 'tok', META_SYSTEM_USER_ALLOWED_EMAILS: 'me@x.com' });
  assert.equal(ok.find((x) => x.id === 'meta-system-token')!.status, 'pass');
});

test('details never contain secret values', () => {
  const out = JSON.stringify(evaluateLaunchReadiness({ ...GOOD, META_ACCESS_TOKEN: 'SUPERSECRETTOKEN' }));
  for (const secret of ['SUPERSECRETTOKEN', GOOD.TOKEN_ENCRYPTION_KEY, GOOD.FIREBASE_SERVICE_ACCOUNT_JSON + GOOD.GEMINI_API_KEY]) assert.ok(!out.includes(secret));
});
