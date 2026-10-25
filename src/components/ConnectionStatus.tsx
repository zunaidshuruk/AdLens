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
    metaConfigured,
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
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Database className="w-3.5 h-3.5 text-fg-subtle" />
        <span>API Server:</span>
        {loading ? (
          <span className="text-fg-muted">Checking...</span>
        ) : health?.ok ? (
          <span className="font-medium text-success">
            Online ({health.version})
          </span>
        ) : (
          <span className="font-medium text-danger">Offline</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-3">
        {loading ? (
          <RefreshCw className="w-4 h-4 text-fg-subtle animate-spin shrink-0" />
        ) : health?.ok ? (
          <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-danger shrink-0" />
        )}
        <div>
          <div className="flex items-center gap-2 flex-wrap text-sm font-medium text-fg">
            <span>Server status</span>
            <span aria-hidden="true" className="text-line-strong">·</span>
            <span className="font-mono text-xs text-fg-muted">/api/health</span>
            <span aria-hidden="true" className="text-line-strong">·</span>
            <span className="text-xs text-fg-muted">
              Google OAuth:{' '}
              {googleConnected
                ? `Connected (${connections?.google.email || 'Google account'})`
                : googleConfigured
                  ? 'Configured (Not connected)'
                  : 'Unconfigured'}
            </span>
            <span aria-hidden="true" className="text-line-strong">·</span>
            <span className="text-xs text-fg-muted">
              Meta Ads: {metaConfigured ? 'Connected via system user' : 'Unconfigured (Mock)'}
            </span>
          </div>
          <p className="text-xs text-fg-muted mt-0.5">
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-fg bg-fill-2 hover:bg-fill-3 rounded-lg transition-colors self-start sm:self-center cursor-pointer disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        <span>Refresh Status</span>
      </button>
    </div>
  );
};
