import type {
  ComputedDateRange,
  DataSourceId,
  GA4AcquisitionReport,
  GA4CampaignRow,
  GA4ConversionEventRow,
  GA4Overview,
  GA4PageRow,
  GA4TrafficPoint,
} from '../types';

export interface DataSourceAdapter {
  id: DataSourceId;
  name: string;
  isMock: boolean;
  isConnected(): Promise<boolean>;
}

export interface GA4Adapter extends DataSourceAdapter {
  id: 'ga4';
  getOverview(range: ComputedDateRange): Promise<GA4Overview>;
  getTrafficOverTime(range: ComputedDateRange): Promise<GA4TrafficPoint[]>;
  getAcquisition(range: ComputedDateRange): Promise<GA4AcquisitionReport>;
  getCampaigns(range: ComputedDateRange): Promise<GA4CampaignRow[]>;
  getTopPages(range: ComputedDateRange): Promise<GA4PageRow[]>;
  getConversions(range: ComputedDateRange): Promise<GA4ConversionEventRow[]>;
}
