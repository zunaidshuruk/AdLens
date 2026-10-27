/**
 * Settings the operator changes from the admin panel (Sprint 20e): plan limits and prices, custom plans, feature switches
 * and the list of extra operator emails. Stored in one server-only Firestore document (`adminSettings/config`).
 * Defaults live in code; a missing or unreadable document just means "defaults".
 * Every server instance re-reads the document every 30 seconds, so a change reaches everyone within half a minute.
 */
import { applyPlanConfig, validatePlanSettings, type PlanSetting } from '../config/plans.js';
import { getAdminFirestore } from './firestore.js';

export interface FeatureFlags {
  /** false = nobody new can create an account (existing people and invited people can still sign in). */
  signupsOpen: boolean;
  /** true = everybody except operators sees "back soon". */
  maintenanceMode: boolean;
  /** Short message shown during maintenance. */
  maintenanceMessage: string;
  explore: boolean;
  dashboards: boolean;
  agents: boolean;
  mcp: boolean;
  aiAnalyst: boolean;
  team: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  signupsOpen: true, maintenanceMode: false, maintenanceMessage: '',
  explore: true, dashboards: true, agents: true, mcp: true, aiAnalyst: true, team: true,
};

export interface AdminSettings {
  plans: Record<string, PlanSetting>;
  flags: FeatureFlags;
  /** Extra operators added in the panel. The ones in OPERATOR_EMAILS are always operators and cannot be removed here. */
  operators: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export const emptySettings = (): AdminSettings => ({ plans: {}, flags: { ...DEFAULT_FLAGS }, operators: [], updatedAt: null, updatedBy: null });

export interface AdminSettingsStore {
  load(): Promise<AdminSettings | null>;
  save(s: AdminSettings): Promise<void>;
}

export function createInMemoryAdminSettingsStore(): AdminSettingsStore {
  let doc: AdminSettings | null = null;
  return { async load() { return doc ? JSON.parse(JSON.stringify(doc)) : null; }, async save(s) { doc = JSON.parse(JSON.stringify(s)); } };
}

const firestoreStore: AdminSettingsStore = {
  async load() {
    const d = await getAdminFirestore().collection('adminSettings').doc('config').get();
    return d.exists ? (d.data() as AdminSettings) : null;
  },
  async save(s) { await getAdminFirestore().collection('adminSettings').doc('config').set(JSON.parse(JSON.stringify(s))); },
};

let override: AdminSettingsStore | null = null;
export function setTestAdminSettingsStore(s: AdminSettingsStore | null): void { override = s; current = emptySettings(); applyPlanConfig({}); loadedAt = 0; }
const store = () => override ?? firestoreStore;

let current: AdminSettings = emptySettings();
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const REFRESH_MS = 30_000;

function normalise(raw: Partial<AdminSettings> | null): AdminSettings {
  const base = emptySettings();
  if (!raw) return base;
  const flags = { ...DEFAULT_FLAGS };
  for (const k of Object.keys(DEFAULT_FLAGS) as (keyof FeatureFlags)[]) {
    const v = (raw.flags as Partial<FeatureFlags> | undefined)?.[k];
    if (typeof DEFAULT_FLAGS[k] === 'boolean' && typeof v === 'boolean') (flags as Record<string, unknown>)[k] = v;
    if (k === 'maintenanceMessage' && typeof v === 'string') flags.maintenanceMessage = v.slice(0, 200);
  }
  return {
    plans: raw.plans && typeof raw.plans === 'object' ? raw.plans : {},
    flags,
    operators: Array.isArray(raw.operators) ? raw.operators.filter((e): e is string => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter(Boolean) : [],
    updatedAt: raw.updatedAt ?? null,
    updatedBy: raw.updatedBy ?? null,
  };
}

function adopt(s: AdminSettings): void {
  current = s;
  applyPlanConfig(s.plans);
  loadedAt = Date.now();
}

/** Re-reads the saved settings when they are more than 30 seconds old. Never throws: on trouble the last known settings stay. */
export function refreshAdminSettings(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < REFRESH_MS) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try { adopt(normalise(await store().load())); }
    catch { loadedAt = Date.now() - REFRESH_MS + 5_000; /* try again in 5 seconds */ }
    finally { inflight = null; }
  })();
  return inflight;
}

export const getAdminSettings = (): AdminSettings => current;
export const getFlags = (): FeatureFlags => current.flags;
export const extraOperators = (): readonly string[] => current.operators;

export interface SettingsPatch { plans?: Record<string, PlanSetting>; flags?: Partial<FeatureFlags>; operators?: string[] }

/** Validates and saves a change. Throws a plain-language Error when something is not allowed. */
export async function saveAdminSettings(patch: SettingsPatch, by: string): Promise<AdminSettings> {
  await refreshAdminSettings(true);
  const next: AdminSettings = JSON.parse(JSON.stringify(current));
  if (patch.plans) {
    validatePlanSettings(patch.plans);
    next.plans = patch.plans;
  }
  if (patch.flags) next.flags = normalise({ flags: { ...next.flags, ...patch.flags } as FeatureFlags }).flags;
  if (patch.operators) {
    const list = patch.operators.map((e) => e.trim().toLowerCase()).filter(Boolean);
    for (const e of list) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`"${e}" is not an email address.`);
    next.operators = [...new Set(list)].slice(0, 50);
  }
  next.updatedAt = new Date().toISOString();
  next.updatedBy = by;
  await store().save(next);
  adopt(normalise(next));
  return current;
}
