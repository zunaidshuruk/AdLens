export interface PlanLimits {
  maxProjects: number;
}

export const PLANS: Record<string, PlanLimits> = {
  beta: {
    maxProjects: 3,
  },
};

export function getPlanLimits(plan: string | undefined | null): PlanLimits {
  if (plan && Object.prototype.hasOwnProperty.call(PLANS, plan)) {
    return PLANS[plan];
  }
  return PLANS.beta;
}
