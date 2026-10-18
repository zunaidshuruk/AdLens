import type { HealthStatusResponse } from '../types';

export class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
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
    throw new ApiClientError(`API request failed: ${response.status} ${response.statusText}`, response.status);
  }

  return (await response.json()) as T;
}

export const apiClient = {
  getHealth(): Promise<HealthStatusResponse> {
    return apiRequest<HealthStatusResponse>('/api/health');
  },
};
