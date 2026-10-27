export interface PlanLimits {
  maxProjects: number;
  aiQuestionsPerMonth: number;
}

/** The plan every new workspace starts on. Flip to 'free' when the plan screens (Sprint 20d) are live. */
export const DEFAULT_NEW_WORKSPACE_PLAN = 'beta';

/** After a paid plan ends the workspace keeps it for this many days, then drops to Free. */
export const GRACE_DAYS = 7;

export const PLAN_IDS = ['beta', 'free', 'pro', 'business'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
/** Plans the operator may hand out. "beta" is the old all-in plan kept for existing test workspaces. */
export const PAID_PLAN_IDS: readonly PlanId[] = ['pro', 'business'];

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
  maxAgents: number;
}

export const CONTENT_LIMITS: Record<string, ContentLimits> = {
  beta: { maxDashboards: 10, maxWidgetsPerDashboard: 12, maxSavedReports: 50, maxAgents: 3 },
  free: { maxDashboards: 2, maxWidgetsPerDashboard: 8, maxSavedReports: 2, maxAgents: 0 },
  pro: { maxDashboards: 10, maxWidgetsPerDashboard: 12, maxSavedReports: 50, maxAgents: 3 },
  business: { maxDashboards: 30, maxWidgetsPerDashboard: 20, maxSavedReports: 200, maxAgents: 10 },
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
export const PLAN_INFO: Record<PlanId, { label: string; priceUsd: number; priceBdt: number }> = {
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
