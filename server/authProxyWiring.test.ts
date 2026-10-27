import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { app } from './app.js';

const KEYS = ['AUTH_PROXY', 'AUTH_ALLOWED_HOSTS', 'APP_BASE_URL', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY', 'FIREBASE_APP_ID'] as const;

async function withEnv<T>(env: Partial<Record<(typeof KEYS)[number], string>>, fn: (base: string) => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { FIREBASE_AUTH_DOMAIN: 'adlens-404e6.firebaseapp.com', FIREBASE_PROJECT_ID: 'adlens-404e6', FIREBASE_API_KEY: 'k', FIREBASE_APP_ID: 'a' }, env);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

async function authDomain(base: string): Promise<string> {
  const body = (await (await fetch(`${base}/api/public-config`)).json()) as { firebase: { authDomain: string } };
  return body.firebase.authDomain;
}

test('proxy off (default): sign-in address stays the Firebase address', async () => {
  await withEnv({ AUTH_ALLOWED_HOSTS: '127.0.0.1' }, async (base) => {
    assert.equal(await authDomain(base), 'adlens-404e6.firebaseapp.com');
  });
});

test('proxy on: the address the page came from is used, but only if it is on the allow-list', async () => {
  await withEnv({ AUTH_PROXY: 'on', AUTH_ALLOWED_HOSTS: '127.0.0.1' }, async (base) => {
    assert.equal(await authDomain(base), '127.0.0.1');
  });
  await withEnv({ AUTH_PROXY: 'on', AUTH_ALLOWED_HOSTS: 'app.example.com' }, async (base) => {
    assert.equal(await authDomain(base), 'adlens-404e6.firebaseapp.com');
  });
});

test('helper files are only served when the proxy is on', async () => {
  await withEnv({}, async (base) => {
    const r = await fetch(`${base}/__/auth/handler`);
    assert.notEqual(r.headers.get('cache-control'), 'no-store');
  });
  await withEnv({ AUTH_PROXY: 'on' }, async (base) => {
    const r = await fetch(`${base}/__/auth/handler`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('set-cookie'), null);
  });
});

test('proxy on never touches normal API calls', async () => {
  await withEnv({ AUTH_PROXY: 'on' }, async (base) => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
  });
});
