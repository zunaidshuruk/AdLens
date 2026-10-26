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
