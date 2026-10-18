import type {
  ConnectionsResponse,
  GA4PropertyOption,
  GA4SelectedProperty,
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
};
