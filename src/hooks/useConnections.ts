import { useCallback, useEffect, useState } from 'react';
import { setSourceLiveMode } from '../adapters';
import { ApiClientError, apiClient } from '../api/client';
import type {
  ConnectionsResponse,
  GA4PropertyOption,
  SearchConsoleSiteOption,
} from '../types';

const CONNECTIONS_SYNC_EVENT = 'adlens_connections_updated';

function notifyConnectionsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CONNECTIONS_SYNC_EVENT));
  }
}

function applyConnectionLiveModes(conn: ConnectionsResponse | null) {
  setSourceLiveMode('ga4', Boolean(conn?.google.connected && conn?.google.ga4Property?.id));
  setSourceLiveMode(
    'search_console',
    Boolean(conn?.google.connected && conn?.google.searchConsoleSite?.url)
  );
}

export interface UseConnectionsResult {
  connections: ConnectionsResponse | null;
  missingSecrets: string[];
  googleConfigured: boolean;
  googleConnected: boolean;
  ga4Properties: GA4PropertyOption[];
  searchConsoleSites: SearchConsoleSiteOption[];
  loading: boolean;
  loadingOptions: boolean;
  saving: boolean;
  disconnecting: boolean;
  error: string | null;
  optionsError: string | null;
  connectGoogle: () => void;
  disconnectGoogle: () => Promise<boolean>;
  saveSelection: (selection: {
    ga4PropertyId?: string | null;
    searchConsoleSiteUrl?: string | null;
  }) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useConnections(): UseConnectionsResult {
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [missingSecrets, setMissingSecrets] = useState<string[]>([]);
  const [ga4Properties, setGa4Properties] = useState<GA4PropertyOption[]>([]);
  const [searchConsoleSites, setSearchConsoleSites] = useState<SearchConsoleSiteOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingOptions, setLoadingOptions] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connRes, healthRes] = await Promise.all([
        apiClient.getConnections(),
        apiClient.getHealth().catch(() => null),
      ]);

      setConnections(connRes);
      applyConnectionLiveModes(connRes);

      const missing = connRes.google.missing ?? healthRes?.missing ?? [];
      setMissingSecrets(missing);

      if (connRes.google.configured && connRes.google.connected) {
        setLoadingOptions(true);
        setOptionsError(null);
        try {
          const [props, sites] = await Promise.all([
            apiClient.getGA4Properties(),
            apiClient.getSearchConsoleSites(),
          ]);
          setGa4Properties(props);
          setSearchConsoleSites(sites);
        } catch (optErr) {
          if (optErr instanceof ApiClientError && optErr.code === 'GOOGLE_REAUTH_REQUIRED') {
            const refreshed = await apiClient.getConnections();
            setConnections(refreshed);
            applyConnectionLiveModes(refreshed);
          }
          setOptionsError(
            optErr instanceof Error ? optErr.message : 'Unable to fetch Google properties or sites.'
          );
        } finally {
          setLoadingOptions(false);
        }
      } else {
        setGa4Properties([]);
        setSearchConsoleSites([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connection status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    const handleSync = () => {
      void loadData();
    };
    window.addEventListener(CONNECTIONS_SYNC_EVENT, handleSync);
    return () => {
      window.removeEventListener(CONNECTIONS_SYNC_EVENT, handleSync);
    };
  }, [loadData]);

  const connectGoogle = useCallback(() => {
    window.location.assign('/api/auth/google/start');
  }, []);

  const disconnectGoogle = useCallback(async (): Promise<boolean> => {
    setDisconnecting(true);
    setError(null);
    try {
      await apiClient.disconnectGoogle();
      applyConnectionLiveModes(null);
      await loadData();
      notifyConnectionsChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Google account');
      return false;
    } finally {
      setDisconnecting(false);
    }
  }, [loadData]);

  const saveSelection = useCallback(
    async (selection: {
      ga4PropertyId?: string | null;
      searchConsoleSiteUrl?: string | null;
    }): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const res = await apiClient.saveGoogleSelection(selection);
        setConnections((prev) => {
          const next = prev
            ? {
                ...prev,
                google: {
                  ...prev.google,
                  ga4Property: res.ga4Property,
                  searchConsoleSite: res.searchConsoleSite,
                },
              }
            : prev;
          applyConnectionLiveModes(next);
          return next;
        });
        notifyConnectionsChanged();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save Google selection');
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    connections,
    missingSecrets,
    googleConfigured: connections?.google.configured ?? false,
    googleConnected: connections?.google.connected ?? false,
    ga4Properties,
    searchConsoleSites,
    loading,
    loadingOptions,
    saving,
    disconnecting,
    error,
    optionsError,
    connectGoogle,
    disconnectGoogle,
    saveSelection,
    refresh: loadData,
  };
}
