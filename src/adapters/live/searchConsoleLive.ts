import { apiClient } from '../../api/client';
import type {
  ComputedDateRange,
  SearchConsoleCountryRow,
  SearchConsoleDeviceRow,
  SearchConsoleOverview,
  SearchConsolePageRow,
  SearchConsolePerformancePoint,
  SearchConsoleQueryRow,
} from '../../types';
import type { SearchConsoleAdapter } from '../searchConsole';

export const liveSearchConsoleAdapter: SearchConsoleAdapter = {
  id: 'search_console',
  name: 'Google Search Console',
  isMock: false,

  async isConnected(): Promise<boolean> {
    try {
      const conn = await apiClient.getConnections();
      return Boolean(conn.google.connected && conn.google.searchConsoleSite?.url);
    } catch {
      return false;
    }
  },

  getOverview(range: ComputedDateRange): Promise<SearchConsoleOverview> {
    return apiClient.getSearchConsoleOverview(range);
  },

  getPerformanceOverTime(range: ComputedDateRange): Promise<SearchConsolePerformancePoint[]> {
    return apiClient.getSearchConsolePerformanceOverTime(range);
  },

  getTopQueries(range: ComputedDateRange): Promise<SearchConsoleQueryRow[]> {
    return apiClient.getSearchConsoleTopQueries(range);
  },

  getTopPages(range: ComputedDateRange): Promise<SearchConsolePageRow[]> {
    return apiClient.getSearchConsoleTopPages(range);
  },

  getCountries(range: ComputedDateRange): Promise<SearchConsoleCountryRow[]> {
    return apiClient.getSearchConsoleCountries(range);
  },

  getDevices(range: ComputedDateRange): Promise<SearchConsoleDeviceRow[]> {
    return apiClient.getSearchConsoleDevices(range);
  },
};
