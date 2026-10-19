import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLongLivedExchangeUrl,
  buildMetaLoginUrl,
  diagnoseMeta,
  effectiveExpiry,
  mapAdAccounts,
  parseTokenResponse,
  reconnectStatus,
} from './metaOAuth.js';

test('login URL uses config_id for Facebook Login for Business, scope otherwise', () => {
  const u = new URL(buildMetaLoginUrl({ appId: '123', redirectUri: 'https://x.app/api/auth/meta/callback', state: 's1', configId: 'cfg9' }));
  assert.equal(u.origin + u.pathname, 'https://www.facebook.com/v26.0/dialog/oauth');
  assert.equal(u.searchParams.get('config_id'), 'cfg9');
  assert.equal(u.searchParams.get('override_default_response_type'), 'true');
  assert.equal(u.searchParams.get('scope'), null);
  assert.equal(u.searchParams.get('state'), 's1');
  const classic = new URL(buildMetaLoginUrl({ appId: '123', redirectUri: 'https://x.app/cb', state: 's2' }));
  assert.equal(classic.searchParams.get('scope'), 'ads_read');
  const ll = new URL(buildLongLivedExchangeUrl({ appId: 'a', appSecret: 'b', shortLivedToken: 't' }));
  assert.equal(ll.searchParams.get('grant_type'), 'fb_exchange_token');
});

test('token parsing, effective expiry and reconnect status', () => {
  const now = new Date('2026-10-19T00:00:00Z');
  const t = parseTokenResponse({ access_token: 'EAAB-long-token', expires_in: 60 * 86400 }, now);
  assert.equal(t.expiresAt, '2026-12-18T00:00:00.000Z');
  assert.equal(parseTokenResponse({ access_token: 'EAAB-long-token' }, now).expiresAt, null);
  assert.throws(() => parseTokenResponse({ error: 'x' }, now), /META_TOKEN_EXCHANGE_FAILED/);

  // data access ends earlier than the token → earlier wins
  const dataAccess = Date.parse('2026-11-30T00:00:00Z') / 1000;
  assert.equal(effectiveExpiry(t.expiresAt, dataAccess), '2026-11-30T00:00:00.000Z');
  assert.equal(effectiveExpiry(null, 0), null);

  assert.deepEqual(reconnectStatus('2026-12-18T00:00:00Z', now), { state: 'ok', daysLeft: 60 });
  assert.deepEqual(reconnectStatus('2026-10-24T00:00:00Z', now), { state: 'due_soon', daysLeft: 5 });
  assert.deepEqual(reconnectStatus('2026-10-18T00:00:00Z', now), { state: 'expired', daysLeft: 0 });
  assert.deepEqual(reconnectStatus(null, now), { state: 'no_expiry', daysLeft: null });
});

test('ad accounts are mapped, invalid IDs dropped, usable first', () => {
  const list = mapAdAccounts([
    { id: 'act_222', name: 'Closed one', account_status: 101, currency: 'USD' },
    { id: 'act_111', account_id: '111', name: 'Acme Ads', account_status: 1, currency: 'BDT', timezone_name: 'Asia/Dhaka', business: { name: 'Synesis IT' } },
    { id: 'weird', name: 'Broken' },
  ]);
  assert.deepEqual(list.map((a) => [a.accountId, a.status, a.usable]), [['111', 'Active', true], ['222', 'Closed', false]]);
  assert.equal(list[0].businessName, 'Synesis IT');
  assert.equal(list[0].currency, 'BDT');
});

test('diagnosis gives plain-English reasons and the right action', () => {
  assert.equal(diagnoseMeta({ callbackError: 'access_denied', callbackErrorReason: 'user_denied' }).code, 'META_USER_CANCELLED');
  assert.equal(diagnoseMeta({ callbackError: 'server_error' }).action, 'ask_admin');
  assert.match(diagnoseMeta({ graphError: { code: 190, error_subcode: 460 } }).message, /password was changed/);
  assert.equal(diagnoseMeta({ graphError: { code: 17 } }).code, 'META_RATE_LIMITED');
  assert.equal(diagnoseMeta({ graphError: { code: 200 } }).code, 'META_PERMISSION_DENIED');
  assert.equal(diagnoseMeta({ grantedScopes: ['public_profile'] }).code, 'META_SCOPE_MISSING');
  assert.equal(diagnoseMeta({ expiresAt: '2020-01-01T00:00:00Z' }).code, 'META_TOKEN_EXPIRED');
  assert.equal(diagnoseMeta({ grantedScopes: ['ads_read'], adAccountCount: 0 }).code, 'META_NO_AD_ACCOUNTS');
  assert.equal(diagnoseMeta({ grantedScopes: ['ads_read'], adAccountCount: 2 }).code, 'META_OK');
});
