import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { HealthStatusResponse } from '../types';

export interface UseHealthResult {
  data: HealthStatusResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useHealth(): UseHealthResult {
  const [data, setData] = useState<HealthStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getHealth();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach backend server');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  return {
    data,
    loading,
    error,
    refetch: fetchHealth,
  };
}
