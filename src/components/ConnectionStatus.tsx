import React from 'react';
import { CheckCircle2, Database, RefreshCw, XCircle } from 'lucide-react';
import { useConnections } from '../hooks/useConnections';
import { useHealth } from '../hooks/useHealth';

interface ConnectionStatusProps {
  compact?: boolean;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ compact = false }) => {
  const { data: health, loading: healthLoading, error: healthError, refetch: refetchHealth } = useHealth();
  const {
    connections,
    googleConfigured,
    googleConnected,
    loading: connLoading,
    refresh: refreshConnections,
  } = useConnections();

  const loading = healthLoading || connLoading;

  const handleRefresh = () => {
    refetchHealth();
    void refreshConnections();
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <Database className="w-3.5 h-3.5 text-slate-400" />
        <span>API Server:</span>
        {loading ? (
          <span className="text-slate-500">Checking...</span>
        ) : health?.ok ? (
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            Online ({health.version})
          </span>
        ) : (
          <span className="font-medium text-red-600 dark:text-red-400">Offline</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="flex items-center gap-3">
        {loading ? (
          <RefreshCw className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
        ) : health?.ok ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
        )}
        <div>
          <div className="flex items-center gap-2 flex-wrap text-sm font-medium text-slate-900 dark:text-slate-100">
            <span>Server status</span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span className="font-mono text-xs text-slate-600 dark:text-slate-400">/api/health</span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Google OAuth:{' '}
              {googleConnected
                ? `Connected (${connections?.google.email})`
                : googleConfigured
                  ? 'Configured (Not connected)'
                  : 'Unconfigured'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {loading
              ? 'Verifying backend health endpoint...'
              : health?.ok
                ? `Healthy · ${health.app} v${health.version}`
                : healthError || 'Backend unreachable'}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleRefresh}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors self-start sm:self-center cursor-pointer disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        <span>Refresh Status</span>
      </button>
    </div>
  );
};
