import { useCallback, useEffect, useState } from 'react';
import { setSourceLiveMode } from '../adapters';
import { ApiClientError, apiClient } from '../api/client';
import { useApp } from '../context/AppContext';
import type {
  ConnectionsResponse,
  GA4PropertyOption,
  GoogleSourceDiscoveryResponse,
  HealthStatusResponse,
  MetaAccountInfo,
  SearchConsoleSiteOption,
} from '../types';

const CONNECTIONS_SYNC_EVENT = 'adlens_connections_updated';

function notifyConnectionsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CONNECTIONS_SYNC_EVENT));
  }
}

function applyConnectionLiveModes(
  conn: ConnectionsResponse | null,
  health?: HealthStatusResponse | null,
  isDemo?: boolean
) {
  if (isDemo) {
    setSourceLiveMode('ga4', false);
    setSourceLiveMode('search_console', false);
    setSourceLiveMode('meta_ads', false);
    return;
  }
  setSourceLiveMode('ga4', Boolean(conn?.google.connected && conn?.google.ga4Property?.id));
  setSourceLiveMode(
    'search_console',
    Boolean(conn?.google.connected && conn?.google.searchConsoleSite?.url)
  );
  const metaAllowedAndConnected =
    conn?.meta.notAvailable === true
      ? false
      : Boolean(conn?.meta.connected ?? health?.metaConfigured ?? conn?.meta.configured);
  setSourceLiveMode('meta_ads', metaAllowedAndConnected);
}

export interface UseConnectionsResult {
  connections: ConnectionsResponse | null;
  missingSecrets: string[];
  googleConfigured: boolean;
  googleConnected: boolean;
  metaConfigured: boolean;
  metaNotAvailable: boolean;
  metaMissingSecrets: string[];
  metaAccountInfo: MetaAccountInfo | null;
  metaAccountError: string | null;
  ga4Properties: GA4PropertyOption[];
  searchConsoleSites: SearchConsoleSiteOption[];
  loading: boolean;
  loadingOptions: boolean;
  saving: boolean;
  disconnecting: boolean;
  error: string | null;
  optionsError: string | null;
  discovering: boolean;
  discovery: GoogleSourceDiscoveryResponse | null;
  discoverError: string | null;
  discoverSources: (domain: string) => Promise<GoogleSourceDiscoveryResponse | null>;
  connectGoogle: () => Promise<void>;
  disconnectGoogle: () => Promise<boolean>;
  saveSelection: (selection: {
    ga4PropertyId?: string | null;
    searchConsoleSiteUrl?: string | null;
  }) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useConnections(): UseConnectionsResult {
  const { activeProject, isDemoMode, refreshMe } = useApp();
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [missingSecrets, setMissingSecrets] = useState<string[]>([]);
  const [metaConfigured, setMetaConfigured] = useState<boolean>(false);
  const [metaNotAvailable, setMetaNotAvailable] = useState<boolean>(false);
  const [metaMissingSecrets, setMetaMissingSecrets] = useState<string[]>([]);
  const [metaAccountInfo, setMetaAccountInfo] = useState<MetaAccountInfo | null>(null);
  const [metaAccountError, setMetaAccountError] = useState<string | null>(null);
  const [ga4Properties, setGa4Properties] = useState<GA4PropertyOption[]>([]);
  const [searchConsoleSites, setSearchConsoleSites] = useState<SearchConsoleSiteOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingOptions, setLoadingOptions] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [discovery, setDiscovery] = useState<GoogleSourceDiscoveryResponse | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connRes, healthRes] = await Promise.all([
        apiClient.getConnections(),
        apiClient.getHealth().catch(() => null),
      ]);

      setConnections(connRes);
      applyConnectionLiveModes(connRes, healthRes, isDemoMode || activeProject?.isDemo);

      const missing = connRes.google.missing ?? healthRes?.missing ?? [];
      setMissingSecrets(missing);

      const isMetaCfg = Boolean(
        healthRes?.metaConfigured ?? connRes.meta.configured ?? connRes.meta.connected
      );
      const isMetaBlocked = Boolean(connRes.meta.notAvailable);
      const mMissing =
        healthRes?.metaMissing ??
        connRes.meta.missing ??
        (isMetaCfg ? [] : ['META_ACCESS_TOKEN', 'META_APP_SECRET', 'META_AD_ACCOUNT_ID']);

      setMetaConfigured(isMetaCfg);
      setMetaNotAvailable(isMetaBlocked);
      setMetaMissingSecrets(mMissing);

      if (isMetaBlocked) {
        setMetaAccountInfo(null);
        setMetaAccountError('Connecting your own Facebook account is coming soon');
        setSourceLiveMode('meta_ads', false);
      } else if (isMetaCfg) {
        setMetaAccountError(null);
        apiClient
          .getMetaAccount()
          .then((acct) => {
            setMetaAccountInfo(acct);
          })
          .catch((err) => {
            setMetaAccountInfo(null);
            if (err instanceof ApiClientError && err.code === 'META_NOT_AVAILABLE') {
              setMetaNotAvailable(true);
              setSourceLiveMode('meta_ads', false);
            }
            setMetaAccountError(
              err instanceof Error ? err.message : 'Unable to fetch Meta ad account details.'
            );
          });
      } else {
        setMetaAccountInfo(null);
        setMetaAccountError(null);
      }

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
            applyConnectionLiveModes(refreshed, healthRes);
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
  }, [activeProject?.id, activeProject?.isDemo, isDemoMode]);

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

  const discoverSources = useCallback(
    async (domain: string): Promise<GoogleSourceDiscoveryResponse | null> => {
      const trimmed = domain.trim();
      if (!trimmed) {
        setDiscoverError('Enter your website address first.');
        return null;
      }
      setDiscovering(true);
      setDiscoverError(null);
      try {
        const res = await apiClient.discoverGoogleSources(trimmed);
        setDiscovery(res);
        return res;
      } catch (err) {
        setDiscoverError(
          err instanceof Error ? err.message : 'Unable to look up your website right now.'
        );
        return null;
      } finally {
        setDiscovering(false);
      }
    },
    []
  );

  const connectGoogle = useCallback(async () => {
    setError(null);
    try {
      const { linkToken } = await apiClient.createGoogleLinkToken();
      window.location.assign(`/api/auth/google/start?lt=${encodeURIComponent(linkToken)}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to start Google connection flow.'
      );
    }
  }, []);

  const disconnectGoogle = useCallback(async (): Promise<boolean> => {
    setDisconnecting(true);
    setError(null);
    try {
      await apiClient.disconnectGoogle();
      setSourceLiveMode('ga4', false);
      setSourceLiveMode('search_console', false);
      setDiscovery(null);
      setDiscoverError(null);
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
          const isDemo = Boolean(isDemoMode || activeProject?.isDemo);
          setSourceLiveMode(
            'ga4',
            !isDemo && Boolean(next?.google.connected && next?.google.ga4Property?.id)
          );
          setSourceLiveMode(
            'search_console',
            !isDemo && Boolean(next?.google.connected && next?.google.searchConsoleSite?.url)
          );
          return next;
        });
        await refreshMe().catch(() => {});
        notifyConnectionsChanged();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save Google selection');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [activeProject?.isDemo, isDemoMode, refreshMe]
  );

  return {
    connections,
    missingSecrets,
    googleConfigured: connections?.google.configured ?? false,
    googleConnected: connections?.google.connected ?? false,
    metaConfigured,
    metaNotAvailable,
    metaMissingSecrets,
    metaAccountInfo,
    metaAccountError,
    ga4Properties,
    searchConsoleSites,
    loading,
    loadingOptions,
    saving,
    disconnecting,
    error,
    optionsError,
    discovering,
    discovery,
    discoverError,
    discoverSources,
    connectGoogle,
    disconnectGoogle,
    saveSelection,
    refresh: loadData,
  };
}

