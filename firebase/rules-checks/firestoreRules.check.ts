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

  test('update own name, avatar flag and valid settings', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice H',
        hasCustomAvatar: true,
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

  test('rejects invalid settings, server-only fields and missing timestamp', async () => {
    const me = doc(ctx(ALICE), 'users', ALICE);
    await assertFails(updateDoc(me, { settings: { theme: 'neon' }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { settings: { displayCurrency: 'usd' }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { settings: { hacker: true }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { photoURL: 'https://evil.example/x.png', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { hasCustomAvatar: 'yes', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { email: 'new@example.com', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(me, { displayName: 'No timestamp' }));
    await assertFails(updateDoc(me, { displayName: '', updatedAt: serverTimestamp() }));
  });

  test('appearance settings: valid themes are saved, anything else is rejected', async () => {
    const me = doc(ctx(ALICE), 'users', ALICE);
    const save = (appearance: unknown) => updateDoc(me, { settings: { appearance }, updatedAt: serverTimestamp() });
    await assertSucceeds(save({ preset: 'midnight', radius: 'round', density: 'compact', fontScale: 'large', chartPalette: 'colorblind' }));
    await assertSucceeds(save({ preset: 'custom', custom: { mode: 'dark', accent: '#e11d48', tint: 'warm' } }));
    await assertSucceeds(save({ preset: 'system' }));
    await assertSucceeds(save({}));
    await assertFails(save({ preset: 'neon' }));
    await assertFails(save({ custom: { accent: 'red' } }));
    await assertFails(save({ custom: { accent: '#FF0000' } })); // stored lower-case, as sanitizeAppearance does
    await assertFails(save({ custom: { accent: '#12345' } }));
    await assertFails(save({ custom: { mode: 'sepia' } }));
    await assertFails(save({ custom: { accent: '#e11d48', extra: true } }));
    await assertFails(save({ fontScale: 'huge' }));
    await assertFails(save({ radius: 'pointy' }));
    await assertFails(save({ chartPalette: 7 }));
    await assertFails(save({ preset: 'adlens-dark', hacker: 1 }));
    await assertFails(save('dark'));
    await assertFails(updateDoc(me, { settings: { theme: 'dark', appearance: { preset: 'ocean' }, other: 1 }, updatedAt: serverTimestamp() }));
    // someone else's profile is still off limits
    await assertFails(updateDoc(doc(ctx(BOB), 'users', ALICE), { settings: { appearance: { preset: 'ocean' } }, updatedAt: serverTimestamp() }));
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

  test('owner and admin edit name, logo flag and defaults; member cannot', async () => {
    const update = {
      name: 'Synesis Marketing',
      hasLogo: true,
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

  test('logo flag must be boolean; old URL fields rejected; defaults validated', async () => {
    const ws = doc(ctx(ALICE), 'workspaces', 'ws_a');
    await assertFails(updateDoc(ws, { hasLogo: 'yes', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ws, { logoURL: 'https://evil.example/x.png', updatedAt: serverTimestamp() }));
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

// ---------------- images stored as data URLs ----------------

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function asset(overrides: Record<string, unknown> = {}) {
  return { dataUrl: TINY_PNG, mimeType: 'image/png', width: 256, height: 256, updatedAt: serverTimestamp(), ...overrides };
}

describe('profile pictures (users/{uid}/assets/avatar)', () => {
  test('owner sets and removes own avatar; others cannot', async () => {
    await assertSucceeds(setDoc(doc(ctx(ALICE), 'users/alice/assets/avatar'), asset()));
    await assertFails(setDoc(doc(ctx(BOB), 'users/alice/assets/avatar'), asset()));
    await assertFails(deleteDoc(doc(ctx(BOB), 'users/alice/assets/avatar')));
    await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'users/alice/assets/avatar')));
  });

  test('verified users can view avatars; signed-out and unverified cannot', async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'users/alice/assets/avatar'), { dataUrl: TINY_PNG, mimeType: 'image/png', width: 256, height: 256 });
    });
    await assertSucceeds(getDoc(doc(ctx(BOB), 'users/alice/assets/avatar')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice/assets/avatar')));
    await assertFails(getDoc(doc(ctx(UNVERIFIED, { verified: false }), 'users/alice/assets/avatar')));
  });

  test('rejects wrong types, mismatched mime, oversize, bad dimensions, extra fields', async () => {
    const ref = doc(ctx(ALICE), 'users/alice/assets/avatar');
    await assertFails(setDoc(ref, asset({ mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })));
    await assertFails(setDoc(ref, asset({ mimeType: 'image/jpeg' }))); // data URL says png
    await assertFails(setDoc(ref, asset({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(100001) })));
    await assertFails(setDoc(ref, asset({ dataUrl: 'https://evil.example/x.png' })));
    await assertFails(setDoc(ref, asset({ width: 4096 })));
    await assertFails(setDoc(ref, asset({ width: 256.5 })));
    await assertFails(setDoc(ref, asset({ extra: true })));
    await assertFails(setDoc(ref, { dataUrl: TINY_PNG, mimeType: 'image/png', width: 256, height: 256 })); // no timestamp
  });
});

describe('workspace logos (workspaces/{wsId}/assets/logo)', () => {
  test('owner and admin set the logo; member and outsider cannot', async () => {
    await assertSucceeds(setDoc(doc(ctx(ALICE), 'workspaces/ws_a/assets/logo'), asset({ width: 512, height: 128 })));
    await assertSucceeds(setDoc(doc(ctx(DAVE), 'workspaces/ws_a/assets/logo'), asset({ width: 512, height: 512 })));
    await assertFails(setDoc(doc(ctx(CAROL), 'workspaces/ws_a/assets/logo'), asset()));
    await assertFails(setDoc(doc(ctx(BOB), 'workspaces/ws_a/assets/logo'), asset()));
  });

  test('members view the logo; outsiders cannot; only owner/admin delete', async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'workspaces/ws_a/assets/logo'), { dataUrl: TINY_PNG, mimeType: 'image/png', width: 512, height: 512 });
    });
    await assertSucceeds(getDoc(doc(ctx(CAROL), 'workspaces/ws_a/assets/logo')));
    await assertFails(getDoc(doc(ctx(BOB), 'workspaces/ws_a/assets/logo')));
    await assertFails(deleteDoc(doc(ctx(CAROL), 'workspaces/ws_a/assets/logo')));
    await assertSucceeds(deleteDoc(doc(ctx(DAVE), 'workspaces/ws_a/assets/logo')));
  });

  test('logo size limit is larger than avatars but still capped', async () => {
    const ref = doc(ctx(ALICE), 'workspaces/ws_a/assets/logo');
    await assertSucceeds(setDoc(ref, asset({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(150000) })));
    await assertFails(setDoc(ref, asset({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(200001) })));
  });
});

describe('token vault and unknown paths', () => {
  test('connections are invisible to everyone, including the owner', async () => {
    await assertFails(getDoc(doc(ctx(ALICE), 'connections', 'c1')));
    await assertFails(getDocs(collection(ctx(ALICE), 'connections')));
    await assertFails(setDoc(doc(ctx(ALICE), 'connections', 'c2'), { provider: 'google' }));
  });

  test('two-step secrets and backup-code hashes are invisible to everyone, including the owner', async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'twoStep', ALICE), { uid: ALICE, secretEnc: 'x', enabled: true, backupHashes: ['h'] });
    });
    await assertFails(getDoc(doc(ctx(ALICE), 'twoStep', ALICE)));
    await assertFails(getDoc(doc(ctx(BOB), 'twoStep', ALICE)));
    await assertFails(getDocs(collection(ctx(ALICE), 'twoStep')));
    await assertFails(setDoc(doc(ctx(ALICE), 'twoStep', ALICE), { enabled: false }));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'twoStep', ALICE)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'twoStep', ALICE)));
  });

  test('server-only collections (plans, digests, MCP keys, audit log) are closed to browsers', async () => {
    for (const path of ['adminSettings/config', 'digestSubscriptions/s1', 'mcpKeys/k1', 'auditLog/a1']) {
      await assertFails(getDoc(doc(ctx(ALICE), path)));
      await assertFails(setDoc(doc(ctx(ALICE), path), { x: 1 }));
    }
  });

  test('anything not listed is denied', async () => {
    await assertFails(setDoc(doc(ctx(ALICE), 'random', 'x'), { a: 1 }));
    await assertFails(getDoc(doc(ctx(ALICE), 'random', 'x')));
  });
});
