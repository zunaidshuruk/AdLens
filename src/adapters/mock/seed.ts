import { TRACKED_SITE } from '../../config/app.ts';

/**
 * Deterministic 32-bit hash from a string seed (FNV-1a inspired)
 */
export function hashString(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Returns a deterministic float in [0, 1) for a given key
 */
export function seededUnit(key: string): number {
  const h = hashString(key);
  return (h % 100000) / 100000;
}

/**
 * Returns a deterministic multiplier around 1.0 (e.g., [1 - spread, 1 + spread])
 */
export function seededVariance(key: string, spread: number = 0.18): number {
  const unit = seededUnit(key);
  return 1 - spread + unit * (spread * 2);
}

/**
 * Day-of-week B2B traffic curve (Sunday-Thursday is standard Bangladesh business week,
 * with Friday-Saturday weekend dip, plus global Monday-Friday traffic).
 */
export function dayOfWeekFactor(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
  // Fri (5) & Sat (6) have lighter traffic in Bangladesh B2B
  if (dow === 5) return 0.72;
  if (dow === 6) return 0.78;
  if (dow === 0) return 1.06;
  if (dow === 1 || dow === 2 || dow === 3) return 1.14;
  return 1.08;
}

/**
 * Artificial network delay between 300ms and 600ms (reduced in automated unit test environment)
 */
export async function simulateLatency(seedKey: string): Promise<void> {
  if (typeof process !== 'undefined' && process.env?.NODE_TEST_CONTEXT) {
    return;
  }
  const ms = 310 + Math.floor(seededUnit(seedKey) * 260); // 310–570 ms
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared campaign definitions so GA4 UTM campaigns and Meta Ads campaigns match names cleanly.
 */
export interface SharedCampaignBlueprint {
  id: string;
  name: string;
  utmCampaign: string;
  objective: 'Lead Generation' | 'Brand Awareness' | 'Retargeting';
  status: 'Active' | 'Paused';
  dailyBaseSpendUsd: number;
  ctrBase: number;
  conversionRateBase: number;
}

export const SHARED_CAMPAIGNS: SharedCampaignBlueprint[] = [
  {
    id: 'camp_bd_enterprise_leads',
    name: `${TRACKED_SITE.name} Enterprise Lead Gen - BD`,
    utmCampaign: `${TRACKED_SITE.name} Enterprise Lead Gen - BD`,
    objective: 'Lead Generation',
    status: 'Active',
    dailyBaseSpendUsd: 46,
    ctrBase: 2.45,
    conversionRateBase: 5.8,
  },
  {
    id: 'camp_secure_gov_video',
    name: 'Secure Gov & Banking Video Suite',
    utmCampaign: 'Secure Gov & Banking Video Suite',
    objective: 'Lead Generation',
    status: 'Active',
    dailyBaseSpendUsd: 38,
    ctrBase: 2.15,
    conversionRateBase: 5.2,
  },
  {
    id: 'camp_retarget_demo_visitors',
    name: 'Retargeting - Pricing & Demo Visitors',
    utmCampaign: 'Retargeting - Pricing & Demo Visitors',
    objective: 'Retargeting',
    status: 'Active',
    dailyBaseSpendUsd: 24,
    ctrBase: 3.35,
    conversionRateBase: 8.4,
  },
  {
    id: 'camp_zoom_switch_apac',
    name: 'APAC Enterprise Switchers Awareness',
    utmCampaign: 'APAC Enterprise Switchers Awareness',
    objective: 'Brand Awareness',
    status: 'Active',
    dailyBaseSpendUsd: 31,
    ctrBase: 1.65,
    conversionRateBase: 2.7,
  },
  {
    id: 'camp_hybrid_workplace_webinar',
    name: 'Hybrid Workplace Security Summit Q4',
    utmCampaign: 'Hybrid Workplace Security Summit Q4',
    objective: 'Lead Generation',
    status: 'Active',
    dailyBaseSpendUsd: 19,
    ctrBase: 2.28,
    conversionRateBase: 4.9,
  },
  {
    id: 'camp_edu_virtual_classroom',
    name: 'Higher Ed & Virtual Classroom Rollout',
    utmCampaign: 'Higher Ed & Virtual Classroom Rollout',
    objective: 'Brand Awareness',
    status: 'Paused',
    dailyBaseSpendUsd: 11,
    ctrBase: 1.48,
    conversionRateBase: 2.3,
  },
];
