export interface PlanLimits {
  maxProjects: number;
  aiQuestionsPerMonth: number;
}

/**
 * The plan every new workspace starts on: Free. To give new sign-ups something else (for example the old all-in "beta" plan
 * while testing), set DEFAULT_NEW_WORKSPACE_PLAN to beta, pro or business and redeploy. Existing workspaces are never changed.
 */
export const DEFAULT_NEW_WORKSPACE_PLAN: string = ['beta', 'free', 'pro', 'business'].includes((process.env.DEFAULT_NEW_WORKSPACE_PLAN ?? '').trim())
  ? (process.env.DEFAULT_NEW_WORKSPACE_PLAN as string).trim()
  : 'free';

/** After a paid plan ends the workspace keeps it for this many days, then drops to Free. */
export const GRACE_DAYS = 7;

export const BUILTIN_PLAN_IDS = ['beta', 'free', 'pro', 'business'] as const;
/** Built-in plans plus any custom plans the operator created (see applyPlanConfig). Changes at run time. */
export const PLAN_IDS: string[] = [...BUILTIN_PLAN_IDS];
export type PlanId = string;
/** Plans the operator may hand out with an end date. "beta" is the old all-in plan; "free" never ends. */
export const PAID_PLAN_IDS: string[] = ['pro', 'business'];
export const isPaidPlan = (id: string): boolean => id !== 'beta' && id !== 'free' && PLAN_IDS.includes(id);

export const PLANS: Record<string, PlanLimits> = {
  beta: { maxProjects: 3, aiQuestionsPerMonth: 100 },
  free: { maxProjects: 1, aiQuestionsPerMonth: 10 },
  pro: { maxProjects: 5, aiQuestionsPerMonth: 300 },
  business: { maxProjects: 25, aiQuestionsPerMonth: 1500 },
};

export function isKnownPlan(plan: unknown): plan is PlanId {
  return typeof plan === 'string' && Object.prototype.hasOwnProperty.call(PLANS, plan);
}

export function getPlanLimits(plan: string | undefined | null): PlanLimits {
  return isKnownPlan(plan) ? PLANS[plan] : PLANS.beta;
}

/** Limits for saved content. Kept apart from PlanLimits so the plan shape sent to the app stays unchanged. */
export interface ContentLimits {
  maxDashboards: number;
  maxWidgetsPerDashboard: number;
  /** Saved reports per project. */
  maxSavedReports: number;
  /** Uploaded data tables (CSV) per project. */
  maxDatasets: number;
  /** Alert rules per project. */
  maxAlertRules: number;
  maxShareLinks: number;
  maxEmailSchedules: number;
  maxCrawlPages: number;
  maxAgents: number;
  /** Sprint 39: phrases checked every day, and saved keyword lists. */
  maxTrackedKeywords: number;
  maxKeywordLists: number;
  /** Sprint 41: sites kept in the link building list. */
  maxLinkProspects: number;
}

export const CONTENT_LIMITS: Record<string, ContentLimits> = {
  beta: { maxDashboards: 10, maxWidgetsPerDashboard: 12, maxSavedReports: 50, maxDatasets: 10, maxAlertRules: 10, maxShareLinks: 10, maxEmailSchedules: 10, maxCrawlPages: 100, maxAgents: 3, maxTrackedKeywords: 100, maxKeywordLists: 10, maxLinkProspects: 200 },
  free: { maxDashboards: 2, maxWidgetsPerDashboard: 8, maxSavedReports: 2, maxDatasets: 1, maxAlertRules: 1, maxShareLinks: 1, maxEmailSchedules: 0, maxCrawlPages: 25, maxAgents: 0, maxTrackedKeywords: 10, maxKeywordLists: 1, maxLinkProspects: 20 },
  pro: { maxDashboards: 10, maxWidgetsPerDashboard: 12, maxSavedReports: 50, maxDatasets: 10, maxAlertRules: 10, maxShareLinks: 10, maxEmailSchedules: 10, maxCrawlPages: 100, maxAgents: 3, maxTrackedKeywords: 100, maxKeywordLists: 10, maxLinkProspects: 200 },
  business: { maxDashboards: 30, maxWidgetsPerDashboard: 20, maxSavedReports: 200, maxDatasets: 50, maxAlertRules: 50, maxShareLinks: 50, maxEmailSchedules: 50, maxCrawlPages: 300, maxAgents: 10, maxTrackedKeywords: 500, maxKeywordLists: 50, maxLinkProspects: 1000 },
};

export function getContentLimits(plan: string | undefined | null): ContentLimits {
  return isKnownPlan(plan) ? CONTENT_LIMITS[plan] : CONTENT_LIMITS.beta;
}

/** Everything else a plan changes. */
export interface PlanFeatures {
  maxMembers: number;
  /** Access keys for outside AI tools, per person. */
  maxMcpKeys: number;
  /** How far back the main date range may start, in days. null = no limit. */
  historyDays: number | null;
  /** Weekly summary and unusual-day alert emails. */
  emailSummaries: boolean;
}

export const PLAN_FEATURES: Record<string, PlanFeatures> = {
  beta: { maxMembers: 10, maxMcpKeys: 10, historyDays: null, emailSummaries: true },
  free: { maxMembers: 1, maxMcpKeys: 1, historyDays: 10, emailSummaries: false },
  pro: { maxMembers: 3, maxMcpKeys: 5, historyDays: 487, emailSummaries: true },
  business: { maxMembers: 15, maxMcpKeys: 10, historyDays: 487, emailSummaries: true },
};

export function getPlanFeatures(plan: string | undefined | null): PlanFeatures {
  return isKnownPlan(plan) ? PLAN_FEATURES[plan] : PLAN_FEATURES.beta;
}

/** Names and draft prices shown on the billing page. Prices are per month. */
export const PLAN_INFO: Record<string, { label: string; priceUsd: number; priceBdt: number }> = {
  beta: { label: 'Beta', priceUsd: 0, priceBdt: 0 },
  free: { label: 'Free', priceUsd: 0, priceBdt: 0 },
  pro: { label: 'Pro', priceUsd: 19, priceBdt: 1500 },
  business: { label: 'Business', priceUsd: 79, priceBdt: 6500 },
};

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanStatus = 'none' | 'active' | 'grace' | 'expired';

/** Where a plan stands against its end date. A plan with no end date (beta, free, or handed out without one) never ends. */
export function planStatus(planExpiresAt: string | null | undefined, now: Date = new Date()): { status: PlanStatus; graceEndsAt: string | null } {
  if (!planExpiresAt) return { status: 'none', graceEndsAt: null };
  const end = Date.parse(planExpiresAt);
  if (!Number.isFinite(end)) return { status: 'none', graceEndsAt: null };
  const graceEnd = end + GRACE_DAYS * DAY_MS;
  const graceEndsAt = new Date(graceEnd).toISOString();
  if (now.getTime() <= end) return { status: 'active', graceEndsAt };
  if (now.getTime() <= graceEnd) return { status: 'grace', graceEndsAt };
  return { status: 'expired', graceEndsAt };
}

/** The plan whose limits apply right now: the stored plan, or Free once the grace period is over. */
export function effectivePlan(storedPlan: string | null | undefined, planExpiresAt: string | null | undefined, now: Date = new Date()): string {
  const plan = isKnownPlan(storedPlan) ? storedPlan : 'beta';
  if (plan === 'free') return 'free';
  return planStatus(planExpiresAt, now).status === 'expired' ? 'free' : plan;
}

/**
 * The oldest day the main date range may start on, or null for no limit.
 * Counted in UTC with one extra day of room, so a person in an earlier time zone is not refused for "yesterday".
 */
export function historyCutoff(plan: string | undefined | null, now: Date = new Date()): string | null {
  const days = getPlanFeatures(plan).historyDays;
  if (days === null) return null;
  return new Date(now.getTime() - (days + 1) * DAY_MS).toISOString().slice(0, 10);
}

/** A plain-language refusal if the range starts too far back for the plan, otherwise null. */
export function historyViolation(plan: string | undefined | null, startDate: unknown, now: Date = new Date()): string | null {
  if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const cutoff = historyCutoff(plan, now);
  if (!cutoff || startDate >= cutoff) return null;
  const days = getPlanFeatures(plan).historyDays;
  const label = isKnownPlan(plan) ? PLAN_INFO[plan].label : 'current';
  return `Your ${label} plan shows the last ${days} days of data. Choose a shorter date range or upgrade to see older data.`;
}

// ---------------------------------------------------------------------------
// Run-time editing (admin panel). The tables above are the defaults; the operator's saved changes are laid on top.
// ---------------------------------------------------------------------------

/** What the admin panel may change for one plan. Every number is a whole number; historyDays null = unlimited. */
export interface PlanSetting {
  label?: string;
  priceUsd?: number;
  priceBdt?: number;
  limits?: Partial<PlanLimits>;
  content?: Partial<ContentLimits>;
  features?: Partial<PlanFeatures>;
  /** A plan made for one customer: hidden from the public plan list. */
  custom?: boolean;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const DEFAULTS = {
  PLANS: clone(PLANS), CONTENT_LIMITS: clone(CONTENT_LIMITS), PLAN_FEATURES: clone(PLAN_FEATURES), PLAN_INFO: clone(PLAN_INFO),
};
export const CUSTOM_PLAN_IDS = new Set<string>();
export const CUSTOM_ID_RE = /^[a-z][a-z0-9-]{1,23}$/;

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), min), max) : undefined;

function pickNums<T extends object>(base: T, src: Record<string, unknown> | undefined, max = 1_000_000): T {
  const out = { ...base } as Record<string, unknown>;
  if (!src) return out as T;
  for (const k of Object.keys(base)) {
    const n = num(src[k], 0, max);
    if (n !== undefined) out[k] = n;
  }
  return out as T;
}

/** Throws a plain-language message if the proposed settings are not allowed. Used by the admin panel before saving. */
export function validatePlanSettings(settings: Record<string, PlanSetting>): void {
  for (const [id, st] of Object.entries(settings)) {
    const builtin = (BUILTIN_PLAN_IDS as readonly string[]).includes(id);
    if (!builtin && !CUSTOM_ID_RE.test(id)) throw new Error(`"${id}" is not a valid plan id. Use 2 to 24 lower-case letters, numbers or dashes, starting with a letter.`);
    if (st.label !== undefined && (typeof st.label !== 'string' || !st.label.trim() || st.label.length > 40)) throw new Error('A plan name must be 1 to 40 characters.');
    for (const key of ['priceUsd', 'priceBdt'] as const) {
      const v = st[key];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000_000)) throw new Error('Prices must be numbers from 0 up.');
    }
    const groups: [Record<string, unknown> | undefined][] = [[st.limits as never], [st.content as never], [st.features as never]];
    for (const [g] of groups) {
      for (const [k, v] of Object.entries(g ?? {})) {
        if (k === 'emailSummaries') { if (typeof v !== 'boolean') throw new Error('Email summaries must be on or off.'); continue; }
        if (k === 'historyDays' && v === null) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1_000_000) throw new Error(`"${k}" must be a whole number from 0 up.`);
      }
    }
  }
}

/** Rebuilds every plan table from the defaults plus the saved settings. Safe to call again and again. */
export function applyPlanConfig(settings: Record<string, PlanSetting> | null | undefined): void {
  for (const id of [...CUSTOM_PLAN_IDS]) {
    delete PLANS[id]; delete CONTENT_LIMITS[id]; delete PLAN_FEATURES[id]; delete PLAN_INFO[id];
  }
  CUSTOM_PLAN_IDS.clear();
  PLAN_IDS.length = 0;
  PLAN_IDS.push(...BUILTIN_PLAN_IDS);
  for (const id of BUILTIN_PLAN_IDS) {
    PLANS[id] = clone(DEFAULTS.PLANS[id]); CONTENT_LIMITS[id] = clone(DEFAULTS.CONTENT_LIMITS[id]);
    PLAN_FEATURES[id] = clone(DEFAULTS.PLAN_FEATURES[id]); PLAN_INFO[id] = clone(DEFAULTS.PLAN_INFO[id]);
  }
  for (const [id, st] of Object.entries(settings ?? {})) {
    if (!st || typeof st !== 'object') continue;
    const builtin = (BUILTIN_PLAN_IDS as readonly string[]).includes(id);
    if (!builtin && !CUSTOM_ID_RE.test(id)) continue;
    const baseFrom = builtin ? id : 'pro';
    const baseLimits = builtin ? PLANS[id] : DEFAULTS.PLANS[baseFrom];
    const baseContent = builtin ? CONTENT_LIMITS[id] : DEFAULTS.CONTENT_LIMITS[baseFrom];
    const baseFeatures = builtin ? PLAN_FEATURES[id] : DEFAULTS.PLAN_FEATURES[baseFrom];
    const info = builtin ? PLAN_INFO[id] : { label: id, priceUsd: 0, priceBdt: 0 };
    PLANS[id] = pickNums(baseLimits, st.limits as Record<string, unknown>);
    CONTENT_LIMITS[id] = pickNums(baseContent, st.content as Record<string, unknown>);
    const f = pickNums({ ...baseFeatures, historyDays: baseFeatures.historyDays ?? 0 }, st.features as Record<string, unknown>);
    const rawHist = (st.features as Record<string, unknown> | undefined)?.historyDays;
    PLAN_FEATURES[id] = {
      maxMembers: f.maxMembers, maxMcpKeys: f.maxMcpKeys,
      historyDays: rawHist === null ? null : rawHist === undefined ? baseFeatures.historyDays : f.historyDays,
      emailSummaries: typeof (st.features as Record<string, unknown> | undefined)?.emailSummaries === 'boolean' ? Boolean((st.features as Record<string, unknown>).emailSummaries) : baseFeatures.emailSummaries,
    };
    PLAN_INFO[id] = {
      label: typeof st.label === 'string' && st.label.trim() ? st.label.trim().slice(0, 40) : info.label,
      priceUsd: num(st.priceUsd, 0, 10_000_000) ?? info.priceUsd,
      priceBdt: num(st.priceBdt, 0, 10_000_000) ?? info.priceBdt,
    };
    if (!builtin) { CUSTOM_PLAN_IDS.add(id); PLAN_IDS.push(id); }
  }
}

/** Everything the admin panel shows about plans: the live values, the shipped defaults and which plans are custom. */
export function describePlans(): { id: string; custom: boolean; label: string; priceUsd: number; priceBdt: number; limits: PlanLimits; content: ContentLimits; features: PlanFeatures }[] {
  return PLAN_IDS.map((id) => ({
    id, custom: CUSTOM_PLAN_IDS.has(id), ...PLAN_INFO[id], limits: { ...PLANS[id] }, content: { ...CONTENT_LIMITS[id] }, features: { ...PLAN_FEATURES[id] },
  }));
}

export const PLAN_DEFAULTS = DEFAULTS;
