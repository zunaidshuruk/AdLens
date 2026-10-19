/**
 * Firestore security rules checks. Runs against the Firebase Emulator:
 *   npm run test:rules
 * (Not part of `npm test`, because it needs the emulator.)
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-adlens';
let env: RulesTestEnvironment;

const ALICE = 'alice'; // owner of ws_a
const BOB = 'bob'; // owner of ws_b
const CAROL = 'carol'; // member of ws_a
const DAVE = 'dave'; // admin of ws_a
const UNVERIFIED = 'eve'; // password account, email not verified

function ctx(uid: string, opts: { verified?: boolean; provider?: 'password' | 'google.com' | 'microsoft.com' } = {}) {
  return env
    .authenticatedContext(uid, {
      email: `${uid}@example.com`,
      email_verified: opts.verified ?? true,
      firebase: { sign_in_provider: opts.provider ?? 'password' },
    })
    .firestore();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8') },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    for (const uid of [ALICE, BOB, CAROL, DAVE, UNVERIFIED]) {
      await setDoc(doc(db, 'users', uid), {
        email: `${uid}@example.com`,
        displayName: uid,
        photoURL: null,
        photoPath: null,
        settings: { theme: 'light' },
      });
    }
    await setDoc(doc(db, 'workspaces', 'ws_a'), {
      name: 'Alice WS',
      ownerId: ALICE,
      plan: 'beta',
      members: { [ALICE]: 'owner', [CAROL]: 'member', [DAVE]: 'admin', [UNVERIFIED]: 'member' },
      memberIds: [ALICE, CAROL, DAVE, UNVERIFIED],
      defaults: { currency: 'USD', timezone: 'UTC' },
    });
    await setDoc(doc(db, 'workspaces', 'ws_b'), {
      name: 'Bob WS',
      ownerId: BOB,
      plan: 'beta',
      members: { [BOB]: 'owner' },
      memberIds: [BOB],
    });
    await setDoc(doc(db, 'workspaces/ws_a/projects/p1'), { name: 'Site A', workspaceId: 'ws_a' });
    await setDoc(doc(db, 'workspaces/ws_b/projects/p2'), { name: 'Site B', workspaceId: 'ws_b' });
    await setDoc(doc(db, 'workspaces/ws_a/usage/2026-10'), { aiQuestions: 3, apiCalls: 120 });
    await setDoc(doc(db, 'connections', 'c1'), { userId: ALICE, provider: 'google', encryptedRefreshToken: 'x' });
  });
});

describe('users', () => {
  test('read own profile, not others', async () => {
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'users', ALICE)));
    await assertFails(getDoc(doc(ctx(ALICE), 'users', BOB)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users', ALICE)));
  });

  test('update own name, photo and valid settings', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice H',
        photoURL: 'https://firebasestorage.googleapis.com/v0/b/x/o/users%2Falice%2Favatar%2Fa.webp',
        photoPath: 'users/alice/avatar/a.webp',
        settings: {
          theme: 'dark',
          defaultDateRange: 'Last 90 days',
          compareByDefault: false,
          displayCurrency: 'BDT',
          timezone: 'Asia/Dhaka',
          numberFormat: 'en-IN',
          emailNotifications: { weeklyReport: true, alerts: false },
        },
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('rejects invalid settings, foreign photo paths, protected fields and missing timestamp', async () => {
    const me = doc(ctx(ALICE), 'users', ALICE);
    await assertFails(updateDoc(me, { settings: { theme: 'neon' }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { settings: { displayCurrency: 'usd' }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { settings: { hacker: true }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { photoPath: 'users/bob/avatar/x.png', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { photoURL: 'https://evil.example/x.png', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { email: 'new@example.com', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { displayName: 'No timestamp' }));
    await assertFails(updateDoc(me, { displayName: '', updatedAt: serverTimestamp() }));
  });

  test('cannot create or delete user docs from the browser', async () => {
    await assertFails(setDoc(doc(ctx('newbie'), 'users', 'newbie'), { displayName: 'x' }));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'users', ALICE)));
  });

  test('unverified password accounts cannot write', async () => {
    await assertFails(
      updateDoc(doc(ctx(UNVERIFIED, { verified: false }), 'users', UNVERIFIED), {
        displayName: 'Eve',
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('Microsoft sign-in counts as verified even if email_verified is false', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE, { verified: false, provider: 'microsoft.com' }), 'users', ALICE), {
        displayName: 'Alice MS',
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe('workspaces', () => {
  test('members read their workspace; others cannot', async () => {
    await assertSucceeds(getDoc(doc(ctx(CAROL), 'workspaces', 'ws_a')));
    await assertFails(getDoc(doc(ctx(BOB), 'workspaces', 'ws_a')));
  });

  test('list only "my" workspaces via memberIds', async () => {
    const db = ctx(ALICE);
    await assertSucceeds(getDocs(query(collection(db, 'workspaces'), where('memberIds', 'array-contains', ALICE))));
    await assertFails(getDocs(collection(db, 'workspaces')));
  });

  test('owner and admin edit name, logo and defaults; member cannot', async () => {
    const update = {
      name: 'Synesis Marketing',
      logoURL: 'https://firebasestorage.googleapis.com/v0/b/x/o/logo.png',
      logoPath: 'workspaces/ws_a/logo/logo.png',
      defaults: { currency: 'BDT', timezone: 'Asia/Dhaka' },
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'workspaces', 'ws_a'), update));
    await assertSucceeds(updateDoc(doc(ctx(DAVE), 'workspaces', 'ws_a'), { ...update, name: 'By admin' }));
    await assertFails(updateDoc(doc(ctx(CAROL), 'workspaces', 'ws_a'), { ...update, name: 'By member' }));
    await assertFails(updateDoc(doc(ctx(BOB), 'workspaces', 'ws_a'), update));
  });

  test('plan, owner and members can never be changed from the browser', async () => {
    const ws = doc(ctx(ALICE), 'workspaces', 'ws_a');
    await assertFails(updateDoc(ws, { plan: 'enterprise', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ws, { ownerId: BOB, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ws, { [`members.${BOB}`]: 'admin', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ws, { memberIds: [ALICE, BOB], updatedAt: serverTimestamp() }));
  });

  test('logo path must belong to the same workspace; defaults validated', async () => {
    const ws = doc(ctx(ALICE), 'workspaces', 'ws_a');
    await assertFails(updateDoc(ws, { logoPath: 'workspaces/ws_b/logo/x.png', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ws, { defaults: { currency: 'dollars' }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ws, { defaults: { currency: 'USD', extra: 1 }, updatedAt: serverTimestamp() }));
  });

  test('cannot create or delete workspaces from the browser', async () => {
    await assertFails(setDoc(doc(ctx(ALICE), 'workspaces', 'ws_new'), { name: 'x', members: { [ALICE]: 'owner' } }));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'workspaces', 'ws_a')));
  });
});

describe('projects and usage', () => {
  test('members read projects of their workspace only', async () => {
    await assertSucceeds(getDoc(doc(ctx(CAROL), 'workspaces/ws_a/projects/p1')));
    await assertSucceeds(getDocs(collection(ctx(CAROL), 'workspaces/ws_a/projects')));
    await assertFails(getDoc(doc(ctx(ALICE), 'workspaces/ws_b/projects/p2')));
    await assertFails(getDocs(collection(ctx(ALICE), 'workspaces/ws_b/projects')));
  });

  test('projects are written only by the server', async () => {
    await assertFails(setDoc(doc(ctx(ALICE), 'workspaces/ws_a/projects/p9'), { name: 'Direct' }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'workspaces/ws_a/projects/p1'), { name: 'Renamed' }));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'workspaces/ws_a/projects/p1')));
  });

  test('usage is readable by members and never writable', async () => {
    await assertSucceeds(getDoc(doc(ctx(CAROL), 'workspaces/ws_a/usage/2026-10')));
    await assertFails(getDoc(doc(ctx(BOB), 'workspaces/ws_a/usage/2026-10')));
    await assertFails(setDoc(doc(ctx(ALICE), 'workspaces/ws_a/usage/2026-10'), { aiQuestions: 0 }));
  });

  test('unverified members cannot read workspace data', async () => {
    await assertFails(getDoc(doc(ctx(UNVERIFIED, { verified: false }), 'workspaces/ws_a/projects/p1')));
  });
});

describe('token vault and unknown paths', () => {
  test('connections are invisible to everyone, including the owner', async () => {
    await assertFails(getDoc(doc(ctx(ALICE), 'connections', 'c1')));
    await assertFails(getDocs(collection(ctx(ALICE), 'connections')));
    await assertFails(setDoc(doc(ctx(ALICE), 'connections', 'c2'), { provider: 'google' }));
  });

  test('anything not listed is denied', async () => {
    await assertFails(setDoc(doc(ctx(ALICE), 'random', 'x'), { a: 1 }));
    await assertFails(getDoc(doc(ctx(ALICE), 'random', 'x')));
  });
});
