import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError, apiClient, isNetworkDownError, OFFLINE_ERROR_MESSAGE } from '../api/client';
import { useApp } from '../context/AppContext';
import { useDateRange } from './useDateRange';

export interface UseRunReportResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  refetch: () => void;
}

/**
 * Runs one registered report (POST /api/reports/run) for the date range chosen in the header.
 * Re-runs when the dates, the active project or `args` change.
 */
export function useRunReport<T>(id: string, args?: Record<string, unknown>, enabled = true): UseRunReportResult<T> {
  const { dateRange, compareEnabled } = useDateRange();
  const { activeProject } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const argsKey = JSON.stringify(args ?? {});
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const run = ++latest.current;
    setLoading(true);
    setError(null);
    setErrorCode(null);
    apiClient
      .runReport({
        id,
        ...(args ? { args } : {}),
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        ...(compareEnabled ? { compareStartDate: dateRange.compareStartDate, compareEndDate: dateRange.compareEndDate } : {}),
      })
      .then((res) => {
        if (run === latest.current) setData(res.result as T);
      })
      .catch((err: unknown) => {
        if (run !== latest.current) return;
        setData(null);
        if (isNetworkDownError(err)) {
          setError(OFFLINE_ERROR_MESSAGE);
          setErrorCode('NETWORK_OFFLINE');
        } else {
          setError(err instanceof Error ? err.message : 'Could not load this report.');
          setErrorCode(err instanceof ApiClientError ? err.code : 'REPORT_ERROR');
        }
      })
      .finally(() => {
        if (run === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, argsKey, enabled, dateRange.startDate, dateRange.endDate, dateRange.compareStartDate, dateRange.compareEndDate, compareEnabled, activeProject?.id, tick]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, errorCode, refetch };
}
