import assert from 'node:assert/strict';
import test from 'node:test';
import { isMfaRequiredError, isSixDigitCode } from './mfa.js';

test('authenticator code must be exactly six digits', () => {
  assert.equal(isSixDigitCode('123456'), true);
  assert.equal(isSixDigitCode(' 123456 '), true);
  assert.equal(isSixDigitCode('12345'), false);
  assert.equal(isSixDigitCode('1234567'), false);
  assert.equal(isSixDigitCode('12a456'), false);
});

test('recognises the Firebase "second step needed" error and nothing else', () => {
  assert.equal(isMfaRequiredError({ code: 'auth/multi-factor-auth-required' }), true);
  assert.equal(isMfaRequiredError({ code: 'auth/wrong-password' }), false);
  assert.equal(isMfaRequiredError(null), false);
  assert.equal(isMfaRequiredError('auth/multi-factor-auth-required'), false);
});
