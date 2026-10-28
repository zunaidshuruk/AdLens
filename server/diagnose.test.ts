import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { explainDatabaseError } from './routes/ops.js';
import { mapFirebaseErrorMessage } from '../src/utils/firebaseErrors.js';
import { resetProtectionState } from './middleware/protect.js';

test('Diagnose — database errors become plain-language reasons without leaking the raw message', () => {
  assert.match(explainDatabaseError({ code: 5, message: '5 NOT_FOUND: The database (default) does not exist' }).reason, /Create database/);
  assert.match(explainDatabaseError({ code: 7, message: 'PERMISSION_DENIED: Missing or insufficient permissions' }).reason, /Cloud Datastore User/);
  assert.match(explainDatabaseError(new Error('Could not load the default credentials')).reason, /FIREBASE_PRIVATE_KEY/);
  assert.match(explainDatabaseError({ code: 8 }).reason, /quota/i);
  assert.equal(explainDatabaseError(new Error('boom secret=abc')).reason.includes('abc'), false);
});

test('Diagnose — verification email errors are explained, and only the owner can run the check', async () => {
  resetProtectionState();
  assert.match(mapFirebaseErrorMessage('auth/unauthorized-continue-uri'), /Authorized domains/);
  process.env.OPERATOR_EMAILS = 'owner@op.com';
  setTestFirestoreStore(createInMemoryFirestoreStore());
  setTestTokenVerifier(async (t: string) => ({ uid: `u_${t}`, email: `${t}@${t === 'owner' ? 'op.com' : 'x.com'}`, email_verified: true, iat: Math.floor(Date.now() / 1000), auth_time: Math.floor(Date.now() / 1000), firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } }) as never);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/api/ops/diagnose`, { headers: { Authorization: 'Bearer other' } })).status, 403);
    assert.equal((await fetch(`${base}/api/ops/diagnose`)).status, 401);
  } finally { server.close(); }
});
