import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from './firebaseAdmin.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface UserEmailNotifications {
  weeklyReport?: boolean;
  alerts?: boolean;
  productUpdates?: boolean;
}

export interface UserSettings {
  theme?: 'light' | 'dark' | 'system';
  defaultDateRange?:
    | 'Today'
    | 'Last 7 days'
    | 'Last 28 days'
    | 'Last 90 days'
    | 'This month'
    | 'Last month';
  compareByDefault?: boolean;
  displayCurrency?: string;
  timezone?: string;
  numberFormat?: 'en-US' | 'en-GB' | 'en-IN' | 'de-DE' | 'fr-FR' | 'bn-BD';
  emailNotifications?: UserEmailNotifications;
}

export interface UserDoc {
  email: string;
  displayName: string;
  photoURL: string | null;
  photoPath: string | null;
  settings: UserSettings;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDefaults {
  currency: string;
  timezone: string;
}

export interface WorkspaceDoc {
  id: string;
  name: string;
  ownerId: string;
  plan: string;
  members: Record<string, WorkspaceRole>;
  memberIds: string[];
  logoURL: string | null;
  logoPath: string | null;
  defaults: WorkspaceDefaults;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDoc {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  ga4PropertyId: string | null;
  ga4PropertyName: string | null;
  searchConsoleSite: string | null;
  metaAdAccountId: string | null;
  metaAdAccountName: string | null;
  timezone: string;
  currency: string;
  brandTerms: string[];
  hostnameFilters: string[];
  isDemo: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageDoc {
  period: string;
  aiQuestions: number;
  apiCalls: number;
}

export interface FirestoreStoreAdapter {
  bootstrapUserAndWorkspace(params: {
    uid: string;
    email: string | null;
    displayName: string;
  }): Promise<{
    user: UserDoc;
    workspace: WorkspaceDoc;
    created: boolean;
  }>;
  getUser(uid: string): Promise<UserDoc | null>;
  updateUser(
    uid: string,
    patch: {
      displayName?: string;
      photoURL?: string | null;
      photoPath?: string | null;
      settings?: UserSettings;
    }
  ): Promise<UserDoc>;
  listWorkspacesForUser(uid: string): Promise<WorkspaceDoc[]>;
  getWorkspace(wsId: string): Promise<WorkspaceDoc | null>;
  updateWorkspace(
    wsId: string,
    patch: {
      name?: string;
      logoURL?: string | null;
      logoPath?: string | null;
      defaults?: WorkspaceDefaults;
    }
  ): Promise<WorkspaceDoc>;
  listProjects(wsId: string): Promise<ProjectDoc[]>;
  getProject(wsId: string, projectId: string): Promise<ProjectDoc | null>;
  createProject(
    wsId: string,
    input: {
      name: string;
      domain: string;
      timezone: string;
      currency: string;
      isDemo?: boolean;
      createdBy: string;
      ga4PropertyId?: string | null;
      ga4PropertyName?: string | null;
      searchConsoleSite?: string | null;
      metaAdAccountId?: string | null;
      metaAdAccountName?: string | null;
      brandTerms?: string[];
      hostnameFilters?: string[];
    }
  ): Promise<ProjectDoc>;
  updateProject(
    wsId: string,
    projectId: string,
    patch: Partial<{
      name: string;
      domain: string;
      timezone: string;
      currency: string;
      brandTerms: string[];
      hostnameFilters: string[];
      ga4PropertyId: string | null;
      ga4PropertyName: string | null;
      searchConsoleSite: string | null;
      metaAdAccountId: string | null;
      metaAdAccountName: string | null;
    }>
  ): Promise<ProjectDoc | null>;
  deleteProject(wsId: string, projectId: string): Promise<boolean>;
}

let cachedFirestore: Firestore | null = null;
let testStoreOverride: FirestoreStoreAdapter | null = null;

export function getAdminFirestore(): Firestore {
  const app = getFirebaseAdminApp();
  if (!cachedFirestore) {
    cachedFirestore = getFirestore(app);
  }
  return cachedFirestore;
}

export function setTestFirestoreStore(store: FirestoreStoreAdapter | null): void {
  testStoreOverride = store;
}

function serializeTimestamp(val: unknown, fallbackIso: string): string {
  if (!val) return fallbackIso;
  if (typeof val === 'string') return val;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return fallbackIso;
}

function mapRawUser(raw: Record<string, unknown>, fallbackEmail: string = ''): UserDoc {
  const nowIso = new Date().toISOString();
  const settingsRaw =
    raw.settings && typeof raw.settings === 'object'
      ? (raw.settings as UserSettings)
      : {};
  return {
    email: typeof raw.email === 'string' ? raw.email : fallbackEmail,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : 'AdLens User',
    photoURL: typeof raw.photoURL === 'string' ? raw.photoURL : null,
    photoPath: typeof raw.photoPath === 'string' ? raw.photoPath : null,
    settings: settingsRaw,
    createdAt: serializeTimestamp(raw.createdAt, nowIso),
    updatedAt: serializeTimestamp(raw.updatedAt, nowIso),
  };
}

function mapRawWorkspace(id: string, raw: Record<string, unknown>): WorkspaceDoc {
  const nowIso = new Date().toISOString();
  const membersRaw =
    raw.members && typeof raw.members === 'object'
      ? (raw.members as Record<string, WorkspaceRole>)
      : {};
  const memberIdsRaw = Array.isArray(raw.memberIds)
    ? raw.memberIds.filter((m): m is string => typeof m === 'string')
    : Object.keys(membersRaw);
  const defaultsRaw =
    raw.defaults && typeof raw.defaults === 'object'
      ? (raw.defaults as Partial<WorkspaceDefaults>)
      : {};

  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : 'My workspace',
    ownerId: typeof raw.ownerId === 'string' ? raw.ownerId : '',
    plan: typeof raw.plan === 'string' ? raw.plan : 'beta',
    members: membersRaw,
    memberIds: memberIdsRaw,
    logoURL: typeof raw.logoURL === 'string' ? raw.logoURL : null,
    logoPath: typeof raw.logoPath === 'string' ? raw.logoPath : null,
    defaults: {
      currency: typeof defaultsRaw.currency === 'string' ? defaultsRaw.currency : 'USD',
      timezone: typeof defaultsRaw.timezone === 'string' ? defaultsRaw.timezone : 'UTC',
    },
    createdAt: serializeTimestamp(raw.createdAt, nowIso),
    updatedAt: serializeTimestamp(raw.updatedAt, nowIso),
  };
}

function mapRawProject(wsId: string, id: string, raw: Record<string, unknown>): ProjectDoc {
  const nowIso = new Date().toISOString();
  return {
    id,
    workspaceId: wsId,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled Project',
    domain: typeof raw.domain === 'string' ? raw.domain : '',
    ga4PropertyId: typeof raw.ga4PropertyId === 'string' ? raw.ga4PropertyId : null,
    ga4PropertyName: typeof raw.ga4PropertyName === 'string' ? raw.ga4PropertyName : null,
    searchConsoleSite: typeof raw.searchConsoleSite === 'string' ? raw.searchConsoleSite : null,
    metaAdAccountId: typeof raw.metaAdAccountId === 'string' ? raw.metaAdAccountId : null,
    metaAdAccountName: typeof raw.metaAdAccountName === 'string' ? raw.metaAdAccountName : null,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : 'UTC',
    currency: typeof raw.currency === 'string' ? raw.currency : 'USD',
    brandTerms: Array.isArray(raw.brandTerms)
      ? raw.brandTerms.filter((t): t is string => typeof t === 'string')
      : [],
    hostnameFilters: Array.isArray(raw.hostnameFilters)
      ? raw.hostnameFilters.filter((h): h is string => typeof h === 'string')
      : [],
    isDemo: Boolean(raw.isDemo),
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '',
    createdAt: serializeTimestamp(raw.createdAt, nowIso),
    updatedAt: serializeTimestamp(raw.updatedAt, nowIso),
  };
}

const adminFirestoreStore: FirestoreStoreAdapter = {
  async bootstrapUserAndWorkspace({ uid, email, displayName }) {
    const db = getAdminFirestore();
    const userRef = db.collection('users').doc(uid);
    const defaultWsId = `ws_${uid}`;
    const wsRef = db.collection('workspaces').doc(defaultWsId);

    return db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const wsQuery = db.collection('workspaces').where('memberIds', 'array-contains', uid).limit(1);
      const existingWsSnap = await tx.get(wsQuery);

      const now = FieldValue.serverTimestamp();
      const nowIso = new Date().toISOString();
      let created = false;

      let userDoc: UserDoc;
      if (!userSnap.exists) {
        created = true;
        const newUserPayload = {
          email: email ?? '',
          displayName,
          photoURL: null,
          photoPath: null,
          settings: {},
          createdAt: now,
          updatedAt: now,
        };
        tx.set(userRef, newUserPayload);
        userDoc = {
          email: email ?? '',
          displayName,
          photoURL: null,
          photoPath: null,
          settings: {},
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      } else {
        userDoc = mapRawUser(userSnap.data() ?? {}, email ?? '');
      }

      let workspaceDoc: WorkspaceDoc;
      if (existingWsSnap.empty) {
        created = true;
        const members: Record<string, WorkspaceRole> = { [uid]: 'owner' };
        const memberIds = [uid];
        const defaults = { currency: 'USD', timezone: 'UTC' };
        const newWsPayload = {
          name: 'My workspace',
          ownerId: uid,
          plan: 'beta',
          members,
          memberIds,
          logoURL: null,
          logoPath: null,
          defaults,
          createdAt: now,
          updatedAt: now,
        };
        tx.set(wsRef, newWsPayload);
        workspaceDoc = {
          id: defaultWsId,
          name: 'My workspace',
          ownerId: uid,
          plan: 'beta',
          members,
          memberIds,
          logoURL: null,
          logoPath: null,
          defaults,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      } else {
        const firstDoc = existingWsSnap.docs[0];
        workspaceDoc = mapRawWorkspace(firstDoc.id, firstDoc.data());
      }

      return { user: userDoc, workspace: workspaceDoc, created };
    });
  },

  async getUser(uid: string): Promise<UserDoc | null> {
    const db = getAdminFirestore();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    return mapRawUser(snap.data() ?? {});
  },

  async updateUser(uid, patch): Promise<UserDoc> {
    const db = getAdminFirestore();
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();
    const existing = snap.exists ? mapRawUser(snap.data() ?? {}) : null;

    const mergedSettings: UserSettings = {
      ...(existing?.settings ?? {}),
      ...(patch.settings ?? {}),
    };

    const updateData: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.displayName !== undefined) updateData.displayName = patch.displayName;
    if (patch.photoURL !== undefined) updateData.photoURL = patch.photoURL;
    if (patch.photoPath !== undefined) updateData.photoPath = patch.photoPath;
    if (patch.settings !== undefined) updateData.settings = mergedSettings;

    if (snap.exists) {
      await ref.update(updateData);
    } else {
      await ref.set({
        email: '',
        displayName: patch.displayName ?? 'AdLens User',
        photoURL: patch.photoURL ?? null,
        photoPath: patch.photoPath ?? null,
        settings: mergedSettings,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const updatedSnap = await ref.get();
    return mapRawUser(updatedSnap.data() ?? {});
  },

  async listWorkspacesForUser(uid: string): Promise<WorkspaceDoc[]> {
    const db = getAdminFirestore();
    const snap = await db
      .collection('workspaces')
      .where('memberIds', 'array-contains', uid)
      .get();
    return snap.docs.map((d) => mapRawWorkspace(d.id, d.data()));
  },

  async getWorkspace(wsId: string): Promise<WorkspaceDoc | null> {
    const db = getAdminFirestore();
    const snap = await db.collection('workspaces').doc(wsId).get();
    if (!snap.exists) return null;
    return mapRawWorkspace(snap.id, snap.data() ?? {});
  },

  async updateWorkspace(wsId, patch): Promise<WorkspaceDoc> {
    const db = getAdminFirestore();
    const ref = db.collection('workspaces').doc(wsId);
    const updateData: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.name !== undefined) updateData.name = patch.name;
    if (patch.logoURL !== undefined) updateData.logoURL = patch.logoURL;
    if (patch.logoPath !== undefined) updateData.logoPath = patch.logoPath;
    if (patch.defaults !== undefined) updateData.defaults = patch.defaults;

    await ref.update(updateData);
    const updated = await ref.get();
    return mapRawWorkspace(updated.id, updated.data() ?? {});
  },

  async listProjects(wsId: string): Promise<ProjectDoc[]> {
    const db = getAdminFirestore();
    const snap = await db
      .collection('workspaces')
      .doc(wsId)
      .collection('projects')
      .get();
    return snap.docs
      .map((d) => mapRawProject(wsId, d.id, d.data()))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getProject(wsId: string, projectId: string): Promise<ProjectDoc | null> {
    const db = getAdminFirestore();
    const snap = await db
      .collection('workspaces')
      .doc(wsId)
      .collection('projects')
      .doc(projectId)
      .get();
    if (!snap.exists) return null;
    return mapRawProject(wsId, snap.id, snap.data() ?? {});
  },

  async createProject(wsId, input): Promise<ProjectDoc> {
    const db = getAdminFirestore();
    const colRef = db.collection('workspaces').doc(wsId).collection('projects');
    const docRef = colRef.doc();
    const now = FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();

    const payload = {
      name: input.name,
      domain: input.domain,
      ga4PropertyId: input.ga4PropertyId ?? null,
      ga4PropertyName: input.ga4PropertyName ?? null,
      searchConsoleSite: input.searchConsoleSite ?? null,
      metaAdAccountId: input.metaAdAccountId ?? null,
      metaAdAccountName: input.metaAdAccountName ?? null,
      timezone: input.timezone,
      currency: input.currency,
      brandTerms: input.brandTerms ?? [],
      hostnameFilters: input.hostnameFilters ?? [],
      isDemo: Boolean(input.isDemo),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(payload);

    return {
      id: docRef.id,
      workspaceId: wsId,
      name: payload.name,
      domain: payload.domain,
      ga4PropertyId: payload.ga4PropertyId,
      ga4PropertyName: payload.ga4PropertyName,
      searchConsoleSite: payload.searchConsoleSite,
      metaAdAccountId: payload.metaAdAccountId,
      metaAdAccountName: payload.metaAdAccountName,
      timezone: payload.timezone,
      currency: payload.currency,
      brandTerms: payload.brandTerms,
      hostnameFilters: payload.hostnameFilters,
      isDemo: payload.isDemo,
      createdBy: payload.createdBy,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  },

  async updateProject(wsId, projectId, patch): Promise<ProjectDoc | null> {
    const db = getAdminFirestore();
    const ref = db
      .collection('workspaces')
      .doc(wsId)
      .collection('projects')
      .doc(projectId);
    const snap = await ref.get();
    if (!snap.exists) return null;

    const updateData: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (patch.name !== undefined) updateData.name = patch.name;
    if (patch.domain !== undefined) updateData.domain = patch.domain;
    if (patch.timezone !== undefined) updateData.timezone = patch.timezone;
    if (patch.currency !== undefined) updateData.currency = patch.currency;
    if (patch.brandTerms !== undefined) updateData.brandTerms = patch.brandTerms;
    if (patch.hostnameFilters !== undefined) updateData.hostnameFilters = patch.hostnameFilters;
    if (patch.ga4PropertyId !== undefined) updateData.ga4PropertyId = patch.ga4PropertyId;
    if (patch.ga4PropertyName !== undefined) updateData.ga4PropertyName = patch.ga4PropertyName;
    if (patch.searchConsoleSite !== undefined) updateData.searchConsoleSite = patch.searchConsoleSite;
    if (patch.metaAdAccountId !== undefined) updateData.metaAdAccountId = patch.metaAdAccountId;
    if (patch.metaAdAccountName !== undefined) updateData.metaAdAccountName = patch.metaAdAccountName;

    await ref.update(updateData);
    const updated = await ref.get();
    return mapRawProject(wsId, updated.id, updated.data() ?? {});
  },

  async deleteProject(wsId: string, projectId: string): Promise<boolean> {
    const db = getAdminFirestore();
    const ref = db
      .collection('workspaces')
      .doc(wsId)
      .collection('projects')
      .doc(projectId);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  },
};

export function getFirestoreStore(): FirestoreStoreAdapter {
  return testStoreOverride ?? adminFirestoreStore;
}

/**
 * In-memory Firestore store implementation for fast deterministic unit and route testing
 * when no live Firebase Admin service account is configured.
 */
export function createInMemoryFirestoreStore(): FirestoreStoreAdapter {
  const users = new Map<string, UserDoc>();
  const workspaces = new Map<string, WorkspaceDoc>();
  const projectsByWs = new Map<string, Map<string, ProjectDoc>>();
  let seq = 1;

  return {
    async bootstrapUserAndWorkspace({ uid, email, displayName }) {
      const nowIso = new Date().toISOString();
      let created = false;
      let user = users.get(uid);
      if (!user) {
        created = true;
        user = {
          email: email ?? '',
          displayName,
          photoURL: null,
          photoPath: null,
          settings: {},
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        users.set(uid, user);
      }

      let workspace = Array.from(workspaces.values()).find((w) => w.memberIds.includes(uid));
      if (!workspace) {
        created = true;
        const wsId = `ws_${uid}`;
        workspace = {
          id: wsId,
          name: 'My workspace',
          ownerId: uid,
          plan: 'beta',
          members: { [uid]: 'owner' },
          memberIds: [uid],
          logoURL: null,
          logoPath: null,
          defaults: { currency: 'USD', timezone: 'UTC' },
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        workspaces.set(wsId, workspace);
      }

      return { user: structuredClone(user), workspace: structuredClone(workspace), created };
    },

    async getUser(uid) {
      const u = users.get(uid);
      return u ? structuredClone(u) : null;
    },

    async updateUser(uid, patch) {
      const nowIso = new Date().toISOString();
      const existing = users.get(uid) ?? {
        email: '',
        displayName: 'AdLens User',
        photoURL: null,
        photoPath: null,
        settings: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const updated: UserDoc = {
        ...existing,
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.photoURL !== undefined ? { photoURL: patch.photoURL } : {}),
        ...(patch.photoPath !== undefined ? { photoPath: patch.photoPath } : {}),
        settings:
          patch.settings !== undefined
            ? {
                ...existing.settings,
                ...patch.settings,
                ...(patch.settings.emailNotifications !== undefined
                  ? {
                      emailNotifications: {
                        ...(existing.settings.emailNotifications ?? {}),
                        ...patch.settings.emailNotifications,
                      },
                    }
                  : {}),
              }
            : existing.settings,
        updatedAt: nowIso,
      };
      users.set(uid, updated);
      return structuredClone(updated);
    },

    async listWorkspacesForUser(uid) {
      return Array.from(workspaces.values())
        .filter((w) => w.memberIds.includes(uid))
        .map((w) => structuredClone(w));
    },

    async getWorkspace(wsId) {
      const ws = workspaces.get(wsId);
      return ws ? structuredClone(ws) : null;
    },

    async updateWorkspace(wsId, patch) {
      const existing = workspaces.get(wsId);
      if (!existing) {
        throw new Error(`Workspace ${wsId} not found`);
      }
      const updated: WorkspaceDoc = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.logoURL !== undefined ? { logoURL: patch.logoURL } : {}),
        ...(patch.logoPath !== undefined ? { logoPath: patch.logoPath } : {}),
        ...(patch.defaults !== undefined ? { defaults: { ...patch.defaults } } : {}),
        updatedAt: new Date().toISOString(),
      };
      workspaces.set(wsId, updated);
      return structuredClone(updated);
    },

    async listProjects(wsId) {
      const map = projectsByWs.get(wsId);
      if (!map) return [];
      return Array.from(map.values()).map((p) => structuredClone(p));
    },

    async getProject(wsId, projectId) {
      const p = projectsByWs.get(wsId)?.get(projectId);
      return p ? structuredClone(p) : null;
    },

    async createProject(wsId, input) {
      const nowIso = new Date().toISOString();
      let map = projectsByWs.get(wsId);
      if (!map) {
        map = new Map();
        projectsByWs.set(wsId, map);
      }
      const id = `proj_${seq++}`;
      const project: ProjectDoc = {
        id,
        workspaceId: wsId,
        name: input.name,
        domain: input.domain,
        ga4PropertyId: input.ga4PropertyId ?? null,
        ga4PropertyName: input.ga4PropertyName ?? null,
        searchConsoleSite: input.searchConsoleSite ?? null,
        metaAdAccountId: input.metaAdAccountId ?? null,
        metaAdAccountName: input.metaAdAccountName ?? null,
        timezone: input.timezone,
        currency: input.currency,
        brandTerms: input.brandTerms ?? [],
        hostnameFilters: input.hostnameFilters ?? [],
        isDemo: Boolean(input.isDemo),
        createdBy: input.createdBy,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      map.set(id, project);
      return structuredClone(project);
    },

    async updateProject(wsId, projectId, patch) {
      const map = projectsByWs.get(wsId);
      const existing = map?.get(projectId);
      if (!map || !existing) return null;
      const updated: ProjectDoc = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.brandTerms !== undefined ? { brandTerms: [...patch.brandTerms] } : {}),
        ...(patch.hostnameFilters !== undefined
          ? { hostnameFilters: [...patch.hostnameFilters] }
          : {}),
        ...(patch.ga4PropertyId !== undefined ? { ga4PropertyId: patch.ga4PropertyId } : {}),
        ...(patch.ga4PropertyName !== undefined ? { ga4PropertyName: patch.ga4PropertyName } : {}),
        ...(patch.searchConsoleSite !== undefined
          ? { searchConsoleSite: patch.searchConsoleSite }
          : {}),
        ...(patch.metaAdAccountId !== undefined ? { metaAdAccountId: patch.metaAdAccountId } : {}),
        ...(patch.metaAdAccountName !== undefined
          ? { metaAdAccountName: patch.metaAdAccountName }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      map.set(projectId, updated);
      return structuredClone(updated);
    },

    async deleteProject(wsId, projectId) {
      const map = projectsByWs.get(wsId);
      if (!map || !map.has(projectId)) return false;
      map.delete(projectId);
      return true;
    },
  };
}
