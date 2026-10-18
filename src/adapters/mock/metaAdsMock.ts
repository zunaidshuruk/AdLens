import { TRACKED_SITE } from '../../config/app.ts';
import type {
  ComputedDateRange,
  MetaAdRow,
  MetaAdSetRow,
  MetaAdsOverview,
  MetaCampaignRow,
  MetaSpendPoint,
} from '../../types/index.ts';
import { enumerateDates } from '../../utils/dateUtils.ts';
import { calculatePercentChange } from '../../utils/formatters.ts';
import type { MetaAdsAdapter } from '../metaAds.ts';
import { dayOfWeekFactor, seededVariance, SHARED_CAMPAIGNS, simulateLatency } from './seed.ts';

interface AdSetBlueprint {
  id: string;
  campaignId: string;
  name: string;
  audience: string;
  status: 'Active' | 'Paused';
  spendWeight: number;
  ads: {
    id: string;
    name: string;
    format: 'Single Image' | 'Video' | 'Carousel';
    status: 'Active' | 'Paused';
    spendWeight: number;
  }[];
}

const AD_SET_BLUEPRINTS: AdSetBlueprint[] = [
  // Campaign 1: Convay Enterprise Lead Gen - BD
  {
    id: 'adset_bd_cto_cio',
    campaignId: 'camp_bd_enterprise_leads',
    name: 'BD CTOs & IT Directors (250+ Employees)',
    audience: 'Dhaka & Chattogram · IT Decision Makers',
    status: 'Active',
    spendWeight: 0.58,
    ads: [
      {
        id: 'ad_bd_cto_video',
        name: `${TRACKED_SITE.name} 60s Architecture Walkthrough`,
        format: 'Video',
        status: 'Active',
        spendWeight: 0.55,
      },
      {
        id: 'ad_bd_cto_carousel',
        name: 'ISO 27001 & Data Sovereignty Carousel',
        format: 'Carousel',
        status: 'Active',
        spendWeight: 0.45,
      },
    ],
  },
  {
    id: 'adset_bd_hr_ops',
    campaignId: 'camp_bd_enterprise_leads',
    name: 'Enterprise Operations & Procurement Heads',
    audience: 'Bangladesh · B2B SaaS Buyers Lookalike 1%',
    status: 'Active',
    spendWeight: 0.42,
    ads: [
      {
        id: 'ad_bd_ops_cost_calc',
        name: 'Cut Video Licensing Costs by 40% - Static',
        format: 'Single Image',
        status: 'Active',
        spendWeight: 0.62,
      },
      {
        id: 'ad_bd_ops_testimonial',
        name: 'Enterprise Client Case Study Quote',
        format: 'Single Image',
        status: 'Active',
        spendWeight: 0.38,
      },
    ],
  },

  // Campaign 2: Secure Gov & Banking Video Suite
  {
    id: 'adset_gov_ministries',
    campaignId: 'camp_secure_gov_video',
    name: 'Public Sector & Digital Governance ICT Teams',
    audience: 'Government ICT & E-Governance Interest',
    status: 'Active',
    spendWeight: 0.52,
    ads: [
      {
        id: 'ad_gov_onprem_video',
        name: 'On-Premise Sovereign Deployment Demo',
        format: 'Video',
        status: 'Active',
        spendWeight: 0.6,
      },
      {
        id: 'ad_gov_security_whitepaper',
        name: 'National Data Center Compliance Guide',
        format: 'Single Image',
        status: 'Active',
        spendWeight: 0.4,
      },
    ],
  },
  {
    id: 'adset_banking_infosec',
    campaignId: 'camp_secure_gov_video',
    name: 'Commercial Banks CISO & Compliance Leaders',
    audience: 'Financial Services · Cybersecurity & Compliance',
    status: 'Active',
    spendWeight: 0.48,
    ads: [
      {
        id: 'ad_bank_boardroom',
        name: 'Encrypted Boardroom & AGM Conferencing',
        format: 'Carousel',
        status: 'Active',
        spendWeight: 0.58,
      },
      {
        id: 'ad_bank_audit_log',
        name: 'Full Compliance Recording & Audit Trail',
        format: 'Single Image',
        status: 'Active',
        spendWeight: 0.42,
      },
    ],
  },

  // Campaign 3: Retargeting - Pricing & Demo Visitors
  {
    id: 'adset_retarget_pricing_30d',
    campaignId: 'camp_retarget_demo_visitors',
    name: 'Pricing Page Visitors — Last 30 Days',
    audience: `Custom Audience · ${TRACKED_SITE.domain}/pricing`,
    status: 'Active',
    spendWeight: 0.6,
    ads: [
      {
        id: 'ad_ret_book_pilot',
        name: 'Book a 14-Day Guided Enterprise Pilot',
        format: 'Single Image',
        status: 'Active',
        spendWeight: 0.65,
      },
      {
        id: 'ad_ret_feature_compare',
        name: `${TRACKED_SITE.name} vs Legacy Tools Matrix`,
        format: 'Carousel',
        status: 'Active',
        spendWeight: 0.35,
      },
    ],
  },
  {
    id: 'adset_retarget_engaged_video',
    campaignId: 'camp_retarget_demo_visitors',
    name: '50%+ Video Viewers & Webinar Attendees',
    audience: 'Custom Engagement Audience · 60 Days',
    status: 'Active',
    spendWeight: 0.4,
    ads: [
      {
        id: 'ad_ret_custom_quote',
        name: 'Get Custom Volume Licensing Quote',
        format: 'Single Image',
        status: 'Active',
        spendWeight: 1.0,
      },
    ],
  },

  // Campaign 4: APAC Enterprise Switchers Awareness
  {
    id: 'adset_apac_it_leaders',
    campaignId: 'camp_zoom_switch_apac',
    name: 'South & Southeast Asia IT Decision Makers',
    audience: 'BD, SG, MY · Unified Communications Interest',
    status: 'Active',
    spendWeight: 1.0,
    ads: [
      {
        id: 'ad_apac_low_bandwidth',
        name: 'HD Crystal Audio on Low-Bandwidth Networks',
        format: 'Video',
        status: 'Active',
        spendWeight: 0.55,
      },
      {
        id: 'ad_apac_300_participants',
        name: 'Host 1,000+ Participant Townhalls Smoothly',
        format: 'Single Image',
        status: 'Active',
        spendWeight: 0.45,
      },
    ],
  },

  // Campaign 5: Hybrid Workplace Security Summit Q4
  {
    id: 'adset_webinar_c_suite',
    campaignId: 'camp_hybrid_workplace_webinar',
    name: 'Executive Roundtable Registration — Dhaka',
    audience: 'C-Suite & VP Engineering · Bangladesh',
    status: 'Active',
    spendWeight: 1.0,
    ads: [
      {
        id: 'ad_webinar_speaker_card',
        name: 'Keynote Panel: Future of Sovereign Collaboration',
        format: 'Single Image',
        status: 'Active',
        spendWeight: 0.6,
      },
      {
        id: 'ad_webinar_teaser_reel',
        name: '30s Summit Highlight Teaser',
        format: 'Video',
        status: 'Active',
        spendWeight: 0.4,
      },
    ],
  },

  // Campaign 6: Higher Ed & Virtual Classroom Rollout
  {
    id: 'adset_uni_deans_it',
    campaignId: 'camp_edu_virtual_classroom',
    name: 'University IT & Distance Learning Admins',
    audience: 'Higher Education Administration · BD',
    status: 'Paused',
    spendWeight: 1.0,
    ads: [
      {
        id: 'ad_edu_lms_integration',
        name: 'Seamless Moodle & LMS Video Integration',
        format: 'Carousel',
        status: 'Paused',
        spendWeight: 1.0,
      },
    ],
  },
];

function computeDailyMeta(dateStr: string) {
  const dow = dayOfWeekFactor(dateStr);
  let spendUsd = 0;
  let impressions = 0;
  let clicks = 0;
  let leads = 0;

  for (const camp of SHARED_CAMPAIGNS) {
    const vSpend = seededVariance(`meta_sp_${camp.id}_${dateStr}`, 0.14);
    const campSpend = camp.dailyBaseSpendUsd * dow * vSpend;
    const cpm = 6.8 * seededVariance(`meta_cpm_${camp.id}_${dateStr}`, 0.08);
    const campImpressions = Math.round((campSpend / cpm) * 1000);
    const ctr = camp.ctrBase * seededVariance(`meta_ctr_${camp.id}_${dateStr}`, 0.1);
    const campClicks = Math.round((campImpressions * ctr) / 100);
    const campLeads = Math.max(
      0,
      Math.round((campClicks * camp.conversionRateBase * seededVariance(`meta_ld_${camp.id}_${dateStr}`, 0.2)) / 100)
    );

    spendUsd += campSpend;
    impressions += campImpressions;
    clicks += campClicks;
    leads += campLeads;
  }

  return {
    spendUsd: Number(spendUsd.toFixed(2)),
    impressions,
    clicks,
    leads: Math.max(1, leads),
  };
}

function aggregateMetaRange(startDate: string, endDate: string) {
  const dates = enumerateDates(startDate, endDate);
  let spendUsd = 0;
  let impressions = 0;
  let clicks = 0;
  let leads = 0;

  for (const d of dates) {
    const day = computeDailyMeta(d);
    spendUsd += day.spendUsd;
    impressions += day.impressions;
    clicks += day.clicks;
    leads += day.leads;
  }

  spendUsd = Number(spendUsd.toFixed(2));
  const frequency = Number((1.42 + Math.min(0.85, dates.length * 0.012)).toFixed(2));
  const reach = Math.max(1, Math.round(impressions / frequency));
  const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;
  const cpcUsd = clicks > 0 ? Number((spendUsd / clicks).toFixed(2)) : 0;
  const cpmUsd = impressions > 0 ? Number(((spendUsd / impressions) * 1000).toFixed(2)) : 0;
  const cplUsd = leads > 0 ? Number((spendUsd / leads).toFixed(2)) : 0;

  return {
    spendUsd,
    impressions,
    reach,
    frequency,
    clicks,
    ctr,
    cpcUsd,
    cpmUsd,
    leads,
    cplUsd,
  };
}

function computeCampaignMetricsForRange(range: ComputedDateRange): MetaCampaignRow[] {
  const dates = enumerateDates(range.startDate, range.endDate);

  return SHARED_CAMPAIGNS.map((camp) => {
    let spendUsd = 0;
    let impressions = 0;
    let clicks = 0;
    let leads = 0;

    for (const d of dates) {
      const dow = dayOfWeekFactor(d);
      const vSpend = seededVariance(`meta_sp_${camp.id}_${d}`, 0.14);
      const cSpend = camp.dailyBaseSpendUsd * dow * vSpend;
      const cpm = 6.8 * seededVariance(`meta_cpm_${camp.id}_${d}`, 0.08);
      const cImp = Math.round((cSpend / cpm) * 1000);
      const ctr = camp.ctrBase * seededVariance(`meta_ctr_${camp.id}_${d}`, 0.1);
      const cClicks = Math.round((cImp * ctr) / 100);
      const cLeads = Math.max(
        0,
        Math.round((cClicks * camp.conversionRateBase * seededVariance(`meta_ld_${camp.id}_${d}`, 0.2)) / 100)
      );

      spendUsd += cSpend;
      impressions += cImp;
      clicks += cClicks;
      leads += cLeads;
    }

    spendUsd = Number(spendUsd.toFixed(2));
    leads = Math.max(1, leads);
    const frequency = Number(
      (1.35 * seededVariance(`meta_freq_${camp.id}_${range.endDate}`, 0.08) + Math.min(0.6, dates.length * 0.01)).toFixed(
        2
      )
    );
    const reach = Math.max(1, Math.round(impressions / frequency));
    const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;
    const cpcUsd = clicks > 0 ? Number((spendUsd / clicks).toFixed(2)) : 0;
    const cpmUsd = impressions > 0 ? Number(((spendUsd / impressions) * 1000).toFixed(2)) : 0;
    const cplUsd = leads > 0 ? Number((spendUsd / leads).toFixed(2)) : 0;

    return {
      id: camp.id,
      name: camp.name,
      objective: camp.objective,
      status: camp.status,
      spendUsd,
      impressions,
      reach,
      frequency,
      clicks,
      ctr,
      cpcUsd,
      cpmUsd,
      leads,
      cplUsd,
    };
  });
}

export const mockMetaAdsAdapter: MetaAdsAdapter = {
  id: 'meta_ads',
  name: 'Meta Ads',
  isMock: true,

  async isConnected(): Promise<boolean> {
    return false;
  },

  async getOverview(range: ComputedDateRange): Promise<MetaAdsOverview> {
    await simulateLatency(`meta_overview_${range.startDate}_${range.endDate}`);
    const curr = aggregateMetaRange(range.startDate, range.endDate);
    const prev = aggregateMetaRange(range.compareStartDate, range.compareEndDate);

    return {
      spendUsd: {
        value: curr.spendUsd,
        previousValue: prev.spendUsd,
        changePercent: calculatePercentChange(curr.spendUsd, prev.spendUsd),
      },
      impressions: {
        value: curr.impressions,
        previousValue: prev.impressions,
        changePercent: calculatePercentChange(curr.impressions, prev.impressions),
      },
      reach: {
        value: curr.reach,
        previousValue: prev.reach,
        changePercent: calculatePercentChange(curr.reach, prev.reach),
      },
      frequency: {
        value: curr.frequency,
        previousValue: prev.frequency,
        changePercent: calculatePercentChange(curr.frequency, prev.frequency),
      },
      clicks: {
        value: curr.clicks,
        previousValue: prev.clicks,
        changePercent: calculatePercentChange(curr.clicks, prev.clicks),
      },
      ctr: {
        value: curr.ctr,
        previousValue: prev.ctr,
        changePercent: calculatePercentChange(curr.ctr, prev.ctr),
      },
      cpcUsd: {
        value: curr.cpcUsd,
        previousValue: prev.cpcUsd,
        changePercent: calculatePercentChange(curr.cpcUsd, prev.cpcUsd),
      },
      cpmUsd: {
        value: curr.cpmUsd,
        previousValue: prev.cpmUsd,
        changePercent: calculatePercentChange(curr.cpmUsd, prev.cpmUsd),
      },
      leads: {
        value: curr.leads,
        previousValue: prev.leads,
        changePercent: calculatePercentChange(curr.leads, prev.leads),
      },
      cplUsd: {
        value: curr.cplUsd,
        previousValue: prev.cplUsd,
        changePercent: calculatePercentChange(curr.cplUsd, prev.cplUsd),
      },
    };
  },

  async getSpendOverTime(range: ComputedDateRange): Promise<MetaSpendPoint[]> {
    await simulateLatency(`meta_spend_${range.startDate}_${range.endDate}`);
    const currDates = enumerateDates(range.startDate, range.endDate);
    const prevDates = enumerateDates(range.compareStartDate, range.compareEndDate);

    return currDates.map((date, idx) => {
      const curr = computeDailyMeta(date);
      const compareDate = prevDates[idx] ?? prevDates[0];
      const prev = computeDailyMeta(compareDate);

      return {
        date,
        compareDate,
        spendUsd: curr.spendUsd,
        previousSpendUsd: prev.spendUsd,
        clicks: curr.clicks,
        leads: curr.leads,
        impressions: curr.impressions,
      };
    });
  },

  async getCampaigns(range: ComputedDateRange): Promise<MetaCampaignRow[]> {
    await simulateLatency(`meta_campaigns_${range.startDate}_${range.endDate}`);
    return computeCampaignMetricsForRange(range).sort((a, b) => b.spendUsd - a.spendUsd);
  },

  async getAdSets(range: ComputedDateRange, campaignId?: string): Promise<MetaAdSetRow[]> {
    await simulateLatency(`meta_adsets_${campaignId ?? 'all'}_${range.startDate}_${range.endDate}`);
    const campaigns = computeCampaignMetricsForRange(range);
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

    const filteredBlueprints = campaignId
      ? AD_SET_BLUEPRINTS.filter((as) => as.campaignId === campaignId)
      : AD_SET_BLUEPRINTS;

    return filteredBlueprints
      .map((bp) => {
        const parent = campaignMap.get(bp.campaignId) ?? campaigns[0];
        const v = seededVariance(`meta_as_${bp.id}_${range.startDate}`, 0.06);
        const spendUsd = Number((parent.spendUsd * bp.spendWeight * v).toFixed(2));
        const impressions = Math.max(100, Math.round(parent.impressions * bp.spendWeight * v));
        const frequency = Number((parent.frequency * seededVariance(`meta_as_f_${bp.id}`, 0.04)).toFixed(2));
        const reach = Math.max(80, Math.round(impressions / frequency));
        const clicks = Math.max(5, Math.round(parent.clicks * bp.spendWeight * v));
        const ctr = Number(((clicks / impressions) * 100).toFixed(2));
        const cpcUsd = Number((spendUsd / clicks).toFixed(2));
        const cpmUsd = Number(((spendUsd / impressions) * 1000).toFixed(2));
        const leads = Math.max(1, Math.round(parent.leads * bp.spendWeight * v));
        const cplUsd = Number((spendUsd / leads).toFixed(2));

        return {
          id: bp.id,
          campaignId: parent.id,
          campaignName: parent.name,
          name: bp.name,
          audience: bp.audience,
          status: bp.status,
          spendUsd,
          impressions,
          reach,
          frequency,
          clicks,
          ctr,
          cpcUsd,
          cpmUsd,
          leads,
          cplUsd,
        };
      })
      .sort((a, b) => b.spendUsd - a.spendUsd);
  },

  async getAds(range: ComputedDateRange, adSetId?: string): Promise<MetaAdRow[]> {
    await simulateLatency(`meta_ads_${adSetId ?? 'all'}_${range.startDate}_${range.endDate}`);
    const allAdSets = await this.getAdSets(range);
    const adSetMap = new Map(allAdSets.map((as) => [as.id, as]));

    const targetBlueprints = adSetId
      ? AD_SET_BLUEPRINTS.filter((as) => as.id === adSetId)
      : AD_SET_BLUEPRINTS;

    const ads: MetaAdRow[] = [];

    for (const asBp of targetBlueprints) {
      const parentAdSet = adSetMap.get(asBp.id);
      if (!parentAdSet) continue;

      for (const adBp of asBp.ads) {
        const v = seededVariance(`meta_ad_${adBp.id}_${range.startDate}`, 0.05);
        const spendUsd = Number((parentAdSet.spendUsd * adBp.spendWeight * v).toFixed(2));
        const impressions = Math.max(50, Math.round(parentAdSet.impressions * adBp.spendWeight * v));
        const frequency = Number((parentAdSet.frequency * seededVariance(`meta_ad_f_${adBp.id}`, 0.03)).toFixed(2));
        const reach = Math.max(40, Math.round(impressions / frequency));
        const clicks = Math.max(2, Math.round(parentAdSet.clicks * adBp.spendWeight * v));
        const ctr = Number(((clicks / impressions) * 100).toFixed(2));
        const cpcUsd = Number((spendUsd / clicks).toFixed(2));
        const cpmUsd = Number(((spendUsd / impressions) * 1000).toFixed(2));
        const leads = Math.max(1, Math.round(parentAdSet.leads * adBp.spendWeight * v));
        const cplUsd = Number((spendUsd / leads).toFixed(2));

        ads.push({
          id: adBp.id,
          adSetId: parentAdSet.id,
          adSetName: parentAdSet.name,
          campaignId: parentAdSet.campaignId,
          campaignName: parentAdSet.campaignName,
          name: adBp.name,
          format: adBp.format,
          status: adBp.status,
          spendUsd,
          impressions,
          reach,
          frequency,
          clicks,
          ctr,
          cpcUsd,
          cpmUsd,
          leads,
          cplUsd,
        });
      }
    }

    return ads.sort((a, b) => b.spendUsd - a.spendUsd);
  },
};
