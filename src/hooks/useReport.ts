import { useCallback, useEffect, useState } from 'react';
import { adapters, type AdapterRegistry } from '../adapters';
import type { ComputedDateRange } from '../types';
import { useDateRange } from './useDateRange';

export interface UseReportResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  simulateError: () => void;
}

/**
 * Generic report hook that talks exclusively to the adapter registry and re-runs
 * whenever the selected date range (or extra dependency keys) change.
 */
export function useReport<T>(
  fetcher: (registry: AdapterRegistry, range: ComputedDateRange) => Promise<T>,
  deps: readonly unknown[] = []
): UseReportResult<T> {
  const { dateRange } = useDateRange();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);

  const execute = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    try {
      const result = await fetcher(adapters, dateRange);
      if (!cancelled) {
        setData(result);
      }
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to load report data');
      }
    } finally {
      if (!cancelled) {
        setLoading(false);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [
    dateRange.startDate,
    dateRange.endDate,
    dateRange.compareStartDate,
    dateRange.compareEndDate,
    dateRange.timezone,
    reloadTrigger,
    ...deps,
  ]);

  useEffect(() => {
    void execute();
  }, [execute]);

  const refetch = useCallback(() => {
    setReloadTrigger((n) => n + 1);
  }, []);

  const simulateError = useCallback(() => {
    setError('Simulated adapter connection timeout. Click Retry to reload.');
  }, []);

  return {
    data,
    loading,
    error,
    refetch,
    simulateError,
  };
}

export function useAdapterStatus() {
  const isMocked = adapters.isAnyMocked();
  const sources = adapters.getAll();
  return {
    isMocked,
    sources,
  };
}
