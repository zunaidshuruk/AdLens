import type {
  ComputedDateRange,
  MetaAdRow,
  MetaAdSetRow,
  MetaAdsOverview,
  MetaCampaignRow,
  MetaSpendPoint,
} from '../types';
import type { DataSourceAdapter } from './ga4';

export interface MetaAdsAdapter extends DataSourceAdapter {
  id: 'meta_ads';
  getOverview(range: ComputedDateRange): Promise<MetaAdsOverview>;
  getSpendOverTime(range: ComputedDateRange): Promise<MetaSpendPoint[]>;
  getCampaigns(range: ComputedDateRange): Promise<MetaCampaignRow[]>;
  getAdSets(range: ComputedDateRange, campaignId?: string): Promise<MetaAdSetRow[]>;
  getAds(range: ComputedDateRange, adSetId?: string): Promise<MetaAdRow[]>;
}
