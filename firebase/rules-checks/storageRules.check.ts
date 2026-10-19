/**
 * Cloud Storage security rules checks (avatars and workspace logos).
 * Runs against the Firebase Emulator (Firestore + Storage): npm run test:rules
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'demo-adlens';
let env: RulesTestEnvironment;

const small = new Uint8Array(10 * 1024); // 10 KB
const tooBig = new Uint8Array(2 * 1024 * 1024 + 1); // just over 2 MB
const png = { contentType: 'image/png' };

function storageAs(uid: string, opts: { verified?: boolean; provider?: 'password' | 'google.com' | 'microsoft.com' } = {}) {
  return env
    .authenticatedContext(uid, {
      email: `${uid}@example.com`,
      email_verified: opts.verified ?? true,
      firebase: { sign_in_provider: opts.provider ?? 'password' },
    })
    .storage();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8') },
    storage: { rules: readFileSync('firebase/storage.rules', 'utf8') },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), 'workspaces', 'ws_a'), {
      name: 'Alice WS',
      ownerId: 'alice',
      plan: 'beta',
      members: { alice: 'owner', dave: 'admin', carol: 'member' },
      memberIds: ['alice', 'dave', 'carol'],
    });
    await uploadBytes(ref(admin.storage(), 'workspaces/ws_a/logo/current.png'), small, png);
    await uploadBytes(ref(admin.storage(), 'users/alice/avatar/current.png'), small, png);
  });
});

describe('profile pictures', () => {
  test('owner uploads a valid image; others cannot write it', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs('alice'), 'users/alice/avatar/new.webp'), small, { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(storageAs('bob'), 'users/alice/avatar/x.png'), small, png));
  });

  test('rejects wrong type, oversized files and bad names', async () => {
    const s = storageAs('alice');
    await assertFails(uploadBytes(ref(s, 'users/alice/avatar/a.svg'), small, { contentType: 'image/svg+xml' }));
    await assertFails(uploadBytes(ref(s, 'users/alice/avatar/a.pdf'), small, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(s, 'users/alice/avatar/big.png'), tooBig, png));
    await assertFails(uploadBytes(ref(s, 'users/alice/avatar/bad name!.png'), small, png));
    await assertFails(uploadBytes(ref(s, 'users/alice/other/a.png'), small, png));
  });

  test('signed-in users can view avatars; signed-out cannot', async () => {
    await assertSucceeds(getBytes(ref(storageAs('bob'), 'users/alice/avatar/current.png')));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'users/alice/avatar/current.png')));
  });

  test('owner deletes own avatar; others cannot', async () => {
    await assertFails(deleteObject(ref(storageAs('bob'), 'users/alice/avatar/current.png')));
    await assertSucceeds(deleteObject(ref(storageAs('alice'), 'users/alice/avatar/current.png')));
  });

  test('unverified password accounts cannot upload', async () => {
    await assertFails(uploadBytes(ref(storageAs('eve', { verified: false }), 'users/eve/avatar/a.png'), small, png));
  });
});

describe('workspace logos', () => {
  test('owner and admin upload; member and outsider cannot', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs('alice'), 'workspaces/ws_a/logo/new.png'), small, png));
    await assertSucceeds(uploadBytes(ref(storageAs('dave'), 'workspaces/ws_a/logo/new2.png'), small, png));
    await assertFails(uploadBytes(ref(storageAs('carol'), 'workspaces/ws_a/logo/new3.png'), small, png));
    await assertFails(uploadBytes(ref(storageAs('bob'), 'workspaces/ws_a/logo/new4.png'), small, png));
  });

  test('members view the logo; outsiders cannot', async () => {
    await assertSucceeds(getBytes(ref(storageAs('carol'), 'workspaces/ws_a/logo/current.png')));
    await assertFails(getBytes(ref(storageAs('bob'), 'workspaces/ws_a/logo/current.png')));
  });

  test('only owner/admin delete; size and type limits apply', async () => {
    await assertFails(deleteObject(ref(storageAs('carol'), 'workspaces/ws_a/logo/current.png')));
    await assertFails(uploadBytes(ref(storageAs('alice'), 'workspaces/ws_a/logo/big.png'), tooBig, png));
    await assertSucceeds(deleteObject(ref(storageAs('dave'), 'workspaces/ws_a/logo/current.png')));
  });
});

describe('everything else', () => {
  test('unknown paths are denied', async () => {
    await assertFails(uploadBytes(ref(storageAs('alice'), 'public/anything.png'), small, png));
    await assertFails(getBytes(ref(storageAs('alice'), 'connections/secret.json')));
  });
});
