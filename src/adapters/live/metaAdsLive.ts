import { apiClient } from '../../api/client';
import type {
  ComputedDateRange,
  MetaAdRow,
  MetaAdSetRow,
  MetaAdsOverview,
  MetaCampaignRow,
  MetaSpendPoint,
} from '../../types';
import type { MetaAdsAdapter } from '../metaAds';

export const liveMetaAdsAdapter: MetaAdsAdapter = {
  id: 'meta_ads',
  name: 'Meta Ads',
  isMock: false,

  async isConnected(): Promise<boolean> {
    try {
      const health = await apiClient.getHealth();
      return Boolean(health.metaConfigured);
    } catch {
      return false;
    }
  },

  getOverview(range: ComputedDateRange): Promise<MetaAdsOverview> {
    return apiClient.getMetaOverview(range);
  },

  getSpendOverTime(range: ComputedDateRange): Promise<MetaSpendPoint[]> {
    return apiClient.getMetaSpendOverTime(range);
  },

  getCampaigns(range: ComputedDateRange): Promise<MetaCampaignRow[]> {
    return apiClient.getMetaCampaigns(range);
  },

  getAdSets(range: ComputedDateRange, campaignId?: string): Promise<MetaAdSetRow[]> {
    return apiClient.getMetaAdSets(range, campaignId);
  },

  getAds(range: ComputedDateRange, adSetId?: string): Promise<MetaAdRow[]> {
    return apiClient.getMetaAds(range, adSetId);
  },
};
