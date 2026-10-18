import { apiClient } from '../../api/client.ts';
import type {
  ComputedDateRange,
  GA4AcquisitionReport,
  GA4CampaignRow,
  GA4ConversionEventRow,
  GA4Overview,
  GA4PageRow,
  GA4TrafficPoint,
} from '../../types/index.ts';
import type { GA4Adapter } from '../ga4.ts';

export const liveGA4Adapter: GA4Adapter = {
  id: 'ga4',
  name: 'Google Analytics 4',
  isMock: false,

  async isConnected(): Promise<boolean> {
    try {
      const conn = await apiClient.getConnections();
      return Boolean(conn.google.connected && conn.google.ga4Property?.id);
    } catch {
      return false;
    }
  },

  getOverview(range: ComputedDateRange): Promise<GA4Overview> {
    return apiClient.getGA4Overview(range);
  },

  getTrafficOverTime(range: ComputedDateRange): Promise<GA4TrafficPoint[]> {
    return apiClient.getGA4TrafficOverTime(range);
  },

  getAcquisition(range: ComputedDateRange): Promise<GA4AcquisitionReport> {
    return apiClient.getGA4Acquisition(range);
  },

  getCampaigns(range: ComputedDateRange): Promise<GA4CampaignRow[]> {
    return apiClient.getGA4Campaigns(range);
  },

  getTopPages(range: ComputedDateRange): Promise<GA4PageRow[]> {
    return apiClient.getGA4TopPages(range);
  },

  getConversions(range: ComputedDateRange): Promise<GA4ConversionEventRow[]> {
    return apiClient.getGA4Conversions(range);
  },
};
