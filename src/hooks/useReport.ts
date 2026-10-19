import { useCallback, useEffect, useState } from 'react';
import {
  adapters,
  type AdapterRegistry,
  ensureAdapterRegistryInitialized,
  subscribeAdapterRegistry,
} from '../adapters';
import { ApiClientError, apiClient } from '../api/client';
import { useApp } from '../context/AppContext';
import type {
  ComputedDateRange,
  DataSourceId,
  GA4PropertyInfo,
  MetaAccountInfo,
  SearchConsoleSiteInfo,
} from '../types';
import { useDateRange } from './useDateRange';

export interface UseReportResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  refetch: () => void;
  simulateError: () => void;
}

/**
 * Generic report hook that talks exclusively to the adapter registry and re-runs
 * whenever the selected date range, active project, adapter live/mock state, or extra dependency keys change.
 */
export function useReport<T>(
  fetcher: (registry: AdapterRegistry, range: ComputedDateRange) => Promise<T>,
  deps: readonly unknown[] = []
): UseReportResult<T> {
  const { dateRange } = useDateRange();
  const { activeProject, isDemoMode } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);

  useEffect(() => {
    return subscribeAdapterRegistry(() => {
      setReloadTrigger((n) => n + 1);
    });
  }, []);

  const execute = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      await ensureAdapterRegistryInitialized();
      const result = await fetcher(adapters, dateRange);
      if (!cancelled) {
        setData(result);
      }
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to load report data');
        setErrorCode(err instanceof ApiClientError ? err.code : 'REPORT_ERROR');
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
    activeProject?.id,
    isDemoMode,
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
    setErrorCode('SIMULATED_ERROR');
  }, []);

  return {
    data,
    loading,
    error,
    errorCode,
    refetch,
    simulateError,
  };
}

export function useAdapterStatus() {
  const [, setVersion] = useState(0);

  useEffect(() => {
    void ensureAdapterRegistryInitialized().then(() => {
      setVersion((v) => v + 1);
    });
    return subscribeAdapterRegistry(() => {
      setVersion((v) => v + 1);
    });
  }, []);

  const sources = adapters.getAll();
  const isMocked = adapters.isAnyMocked();
  const isSourceLive = (id: DataSourceId): boolean => {
    const found = sources.find((s) => s.id === id);
    return Boolean(found && !found.isMock);
  };

  return {
    isMocked,
    sources,
    isGA4Live: !adapters.ga4.isMock,
    isSearchConsoleLive: !adapters.searchConsole.isMock,
    isMetaAdsLive: !adapters.metaAds.isMock,
    isSourceLive,
  };
}

export function useGA4PropertyInfo() {
  const { isGA4Live } = useAdapterStatus();
  const { activeProject } = useApp();
  const [info, setInfo] = useState<GA4PropertyInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isGA4Live) {
      setInfo(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    apiClient
      .getGA4PropertyInfo()
      .then((res) => {
        if (!cancelled) {
          setInfo(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isGA4Live, activeProject?.id, activeProject?.ga4PropertyId]);

  return {
    propertyInfo: info,
    loading,
  };
}

export function useSearchConsoleSiteInfo() {
  const { isSearchConsoleLive } = useAdapterStatus();
  const { activeProject } = useApp();
  const [info, setInfo] = useState<SearchConsoleSiteInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isSearchConsoleLive) {
      setInfo(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    apiClient
      .getSearchConsoleSiteInfo()
      .then((res) => {
        if (!cancelled) {
          setInfo(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isSearchConsoleLive, activeProject?.id, activeProject?.searchConsoleSite]);

  return {
    siteInfo: info,
    loading,
  };
}

export function useMetaAccountInfo() {
  const { isMetaAdsLive } = useAdapterStatus();
  const { activeProject } = useApp();
  const [info, setInfo] = useState<MetaAccountInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isMetaAdsLive) {
      setInfo(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    apiClient
      .getMetaAccount()
      .then((res) => {
        if (!cancelled) {
          setInfo(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isMetaAdsLive, activeProject?.id, activeProject?.metaAdAccountId]);

  return {
    accountInfo: info,
    loading,
  };
}
