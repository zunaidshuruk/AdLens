import type {
  ComputedDateRange,
  SearchConsoleCountryRow,
  SearchConsoleDeviceRow,
  SearchConsoleOverview,
  SearchConsolePageRow,
  SearchConsolePerformancePoint,
  SearchConsoleQueryRow,
} from '../types';
import type { DataSourceAdapter } from './ga4';

export interface SearchConsoleAdapter extends DataSourceAdapter {
  id: 'search_console';
  getOverview(range: ComputedDateRange): Promise<SearchConsoleOverview>;
  getPerformanceOverTime(range: ComputedDateRange): Promise<SearchConsolePerformancePoint[]>;
  getTopQueries(range: ComputedDateRange): Promise<SearchConsoleQueryRow[]>;
  getTopPages(range: ComputedDateRange): Promise<SearchConsolePageRow[]>;
  getCountries(range: ComputedDateRange): Promise<SearchConsoleCountryRow[]>;
  getDevices(range: ComputedDateRange): Promise<SearchConsoleDeviceRow[]>;
}
