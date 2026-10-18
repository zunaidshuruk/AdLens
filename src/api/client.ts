import type {
  ComputedDateRange,
  ConnectionsResponse,
  GA4AcquisitionReport,
  GA4CampaignRow,
  GA4ConversionEventRow,
  GA4Overview,
  GA4PageRow,
  GA4PropertyInfo,
  GA4PropertyOption,
  GA4SelectedProperty,
  GA4TrafficPoint,
  HealthStatusResponse,
  SearchConsoleCountryRow,
  SearchConsoleDeviceRow,
  SearchConsoleOverview,
  SearchConsolePageRow,
  SearchConsolePerformancePoint,
  SearchConsoleQueryRow,
  SearchConsoleSelectedSite,
  SearchConsoleSiteInfo,
  SearchConsoleSiteOption,
} from '../types';

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string = 'API_ERROR') {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let errorCode = 'API_ERROR';
    let errorMessage = `API request failed: ${response.status} ${response.statusText}`;

    try {
      const errBody = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      if (errBody?.error?.code) {
        errorCode = errBody.error.code;
      }
      if (errBody?.error?.message) {
        errorMessage = errBody.error.message;
      }
    } catch {
      // fallback to status text
    }

    throw new ApiClientError(errorMessage, response.status, errorCode);
  }

  return (await response.json()) as T;
}

function buildDateRangeParams(range: ComputedDateRange): string {
  const params = new URLSearchParams({
    startDate: range.startDate,
    endDate: range.endDate,
  });
  if (range.compareStartDate && range.compareEndDate) {
    params.set('compareStartDate', range.compareStartDate);
    params.set('compareEndDate', range.compareEndDate);
  }
  return params.toString();
}

export const apiClient = {
  getHealth(): Promise<HealthStatusResponse> {
    return apiRequest<HealthStatusResponse>('/api/health');
  },

  getConnections(): Promise<ConnectionsResponse> {
    return apiRequest<ConnectionsResponse>('/api/connections');
  },

  getGA4Properties(): Promise<GA4PropertyOption[]> {
    return apiRequest<GA4PropertyOption[]>('/api/google/ga4/properties');
  },

  getSearchConsoleSites(): Promise<SearchConsoleSiteOption[]> {
    return apiRequest<SearchConsoleSiteOption[]>('/api/google/search-console/sites');
  },

  saveGoogleSelection(payload: {
    ga4PropertyId?: string | null;
    searchConsoleSiteUrl?: string | null;
  }): Promise<{
    ok: boolean;
    ga4Property: GA4SelectedProperty | null;
    searchConsoleSite: SearchConsoleSelectedSite | null;
  }> {
    return apiRequest('/api/google/selection', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  disconnectGoogle(): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('/api/auth/google/disconnect', {
      method: 'POST',
    });
  },

  // Live GA4 Data API routes (/api/ga4/*)
  getGA4Overview(range: ComputedDateRange): Promise<GA4Overview> {
    return apiRequest<GA4Overview>(`/api/ga4/overview?${buildDateRangeParams(range)}`);
  },

  getGA4TrafficOverTime(range: ComputedDateRange): Promise<GA4TrafficPoint[]> {
    return apiRequest<GA4TrafficPoint[]>(`/api/ga4/traffic-over-time?${buildDateRangeParams(range)}`);
  },

  getGA4Acquisition(range: ComputedDateRange): Promise<GA4AcquisitionReport> {
    return apiRequest<GA4AcquisitionReport>(`/api/ga4/acquisition?${buildDateRangeParams(range)}`);
  },

  getGA4Campaigns(range: ComputedDateRange): Promise<GA4CampaignRow[]> {
    return apiRequest<GA4CampaignRow[]>(`/api/ga4/campaigns?${buildDateRangeParams(range)}`);
  },

  getGA4TopPages(range: ComputedDateRange): Promise<GA4PageRow[]> {
    return apiRequest<GA4PageRow[]>(`/api/ga4/top-pages?${buildDateRangeParams(range)}`);
  },

  getGA4Conversions(range: ComputedDateRange): Promise<GA4ConversionEventRow[]> {
    return apiRequest<GA4ConversionEventRow[]>(`/api/ga4/conversions?${buildDateRangeParams(range)}`);
  },

  getGA4PropertyInfo(): Promise<GA4PropertyInfo> {
    return apiRequest<GA4PropertyInfo>('/api/ga4/property-info');
  },

  // Live Search Console API routes (/api/search-console/*)
  getSearchConsoleOverview(range: ComputedDateRange): Promise<SearchConsoleOverview> {
    return apiRequest<SearchConsoleOverview>(
      `/api/search-console/overview?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsolePerformanceOverTime(
    range: ComputedDateRange
  ): Promise<SearchConsolePerformancePoint[]> {
    return apiRequest<SearchConsolePerformancePoint[]>(
      `/api/search-console/performance-over-time?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleTopQueries(range: ComputedDateRange): Promise<SearchConsoleQueryRow[]> {
    return apiRequest<SearchConsoleQueryRow[]>(
      `/api/search-console/top-queries?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleTopPages(range: ComputedDateRange): Promise<SearchConsolePageRow[]> {
    return apiRequest<SearchConsolePageRow[]>(
      `/api/search-console/top-pages?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleCountries(range: ComputedDateRange): Promise<SearchConsoleCountryRow[]> {
    return apiRequest<SearchConsoleCountryRow[]>(
      `/api/search-console/countries?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleDevices(range: ComputedDateRange): Promise<SearchConsoleDeviceRow[]> {
    return apiRequest<SearchConsoleDeviceRow[]>(
      `/api/search-console/devices?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleSiteInfo(): Promise<SearchConsoleSiteInfo> {
    return apiRequest<SearchConsoleSiteInfo>('/api/search-console/site-info');
  },
};
