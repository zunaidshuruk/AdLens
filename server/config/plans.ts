export interface PlanLimits {
  maxProjects: number;
  aiQuestionsPerMonth: number;
}

export const PLANS: Record<string, PlanLimits> = {
  beta: {
    maxProjects: 3,
    aiQuestionsPerMonth: 100,
  },
};

export function getPlanLimits(plan: string | undefined | null): PlanLimits {
  if (plan && Object.prototype.hasOwnProperty.call(PLANS, plan)) {
    return PLANS[plan];
  }
  return PLANS.beta;
}

/** Limits for saved content. Kept apart from PlanLimits so the plan shape sent to the app stays unchanged. */
export interface ContentLimits {
  maxDashboards: number;
  maxWidgetsPerDashboard: number;
  maxSavedReports: number;
  maxAgents: number;
}

export const CONTENT_LIMITS: Record<string, ContentLimits> = {
  beta: { maxDashboards: 10, maxWidgetsPerDashboard: 12, maxSavedReports: 50, maxAgents: 3 },
};

export function getContentLimits(plan: string | undefined | null): ContentLimits {
  if (plan && Object.prototype.hasOwnProperty.call(CONTENT_LIMITS, plan)) return CONTENT_LIMITS[plan];
  return CONTENT_LIMITS.beta;
}
