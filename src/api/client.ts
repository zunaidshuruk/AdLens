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
  SearchConsoleSelectedSite,
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

function buildGA4RangeParams(range: ComputedDateRange): string {
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
    return apiRequest<GA4Overview>(`/api/ga4/overview?${buildGA4RangeParams(range)}`);
  },

  getGA4TrafficOverTime(range: ComputedDateRange): Promise<GA4TrafficPoint[]> {
    return apiRequest<GA4TrafficPoint[]>(`/api/ga4/traffic-over-time?${buildGA4RangeParams(range)}`);
  },

  getGA4Acquisition(range: ComputedDateRange): Promise<GA4AcquisitionReport> {
    return apiRequest<GA4AcquisitionReport>(`/api/ga4/acquisition?${buildGA4RangeParams(range)}`);
  },

  getGA4Campaigns(range: ComputedDateRange): Promise<GA4CampaignRow[]> {
    return apiRequest<GA4CampaignRow[]>(`/api/ga4/campaigns?${buildGA4RangeParams(range)}`);
  },

  getGA4TopPages(range: ComputedDateRange): Promise<GA4PageRow[]> {
    return apiRequest<GA4PageRow[]>(`/api/ga4/top-pages?${buildGA4RangeParams(range)}`);
  },

  getGA4Conversions(range: ComputedDateRange): Promise<GA4ConversionEventRow[]> {
    return apiRequest<GA4ConversionEventRow[]>(`/api/ga4/conversions?${buildGA4RangeParams(range)}`);
  },

  getGA4PropertyInfo(): Promise<GA4PropertyInfo> {
    return apiRequest<GA4PropertyInfo>('/api/ga4/property-info');
  },
};
