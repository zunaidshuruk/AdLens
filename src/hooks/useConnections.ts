import { useCallback, useEffect, useState } from 'react';
import { setSourceLiveMode } from '../adapters';
import { ApiClientError, apiClient, startMetaLogin } from '../api/client';
import { useApp } from '../context/AppContext';
import type {
  ConnectionsResponse,
  GA4PropertyOption,
  GoogleSourceDiscoveryResponse,
  HealthStatusResponse,
  MetaAccountInfo,
  MetaAdAccountOption,
  MetaReconnectState,
  MetaReturnStatus,
  SearchConsoleSiteOption,
} from '../types';

const CONNECTIONS_SYNC_EVENT = 'adlens_connections_updated';

export const META_RETURN_MESSAGES: Record<MetaReturnStatus, string> = {
  connected: 'Facebook connected. Now choose your ad account.',
  denied: 'You cancelled Facebook sign-in. Nothing was connected.',
  failed: 'Facebook sign-in did not finish. Please try again.',
};

export interface ParsedMetaReturn {
  status: MetaReturnStatus | null;
  message: string | null;
  cleanedSearch: string;
}

/**
 * Pure helper: inspects URL search params (?connected=meta or ?error=meta_denied | invalid_state | meta_exchange_failed | meta_not_configured)
 * and returns the mapped MetaReturnStatus, plain-English message, and the cleaned query string with the consumed param removed.
 */
export function parseMetaReturnParams(search: string | URLSearchParams): ParsedMetaReturn {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : new URLSearchParams(search);

  const connectedParam = params.get('connected');
  const errorParam = params.get('error');

  if (connectedParam === 'meta') {
    params.delete('connected');
    const qs = params.toString();
    return {
      status: 'connected',
      message: META_RETURN_MESSAGES.connected,
      cleanedSearch: qs ? `?${qs}` : '',
    };
  }

  if (errorParam === 'meta_denied') {
    params.delete('error');
    const qs = params.toString();
    return {
      status: 'denied',
      message: META_RETURN_MESSAGES.denied,
      cleanedSearch: qs ? `?${qs}` : '',
    };
  }

  if (
    errorParam === 'invalid_state' ||
    errorParam === 'meta_exchange_failed' ||
    errorParam === 'meta_not_configured'
  ) {
    params.delete('error');
    const qs = params.toString();
    return {
      status: 'failed',
      message: META_RETURN_MESSAGES.failed,
      cleanedSearch: qs ? `?${qs}` : '',
    };
  }

  const qs = params.toString();
  return {
    status: null,
    message: null,
    cleanedSearch: qs ? `?${qs}` : '',
  };
}

/**
 * True only when the signed-in user has their OWN Facebook connection saved.
 * `meta.connected` can also be true because of the shared company token, so it must not be used alone:
 * the server sets `connectedAt` only when the user's own connection exists.
 */
export function isMetaUserConnected(
  meta: { loginConfigured?: boolean; connectedAt?: string | null } | null | undefined
): boolean {
  return Boolean(meta?.loginConfigured && meta?.connectedAt);
}

/**
 * Pure helper: decides whether 'meta_ads' should run in live mode.
 * True when the user has their own Facebook connected (meta.connected && meta.loginConfigured),
 * otherwise falls back to the existing shared-token rule.
 */
export function resolveMetaAdsLiveMode(
  conn: ConnectionsResponse | null,
  health?: HealthStatusResponse | null,
  isDemo?: boolean
): boolean {
  if (isDemo) {
    return false;
  }
  const userConnected = isMetaUserConnected(conn?.meta);
  if (userConnected) {
    return true;
  }
  if (conn?.meta.notAvailable === true) {
    return false;
  }
  return Boolean(conn?.meta.connected ?? health?.metaConfigured ?? conn?.meta.configured);
}

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
  setSourceLiveMode('meta_ads', resolveMetaAdsLiveMode(conn, health, isDemo));
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
  metaLoginConfigured: boolean;
  metaUserConnected: boolean;
  metaReconnect: MetaReconnectState;
  metaExpiresAt: string | null;
  metaAdAccounts: MetaAdAccountOption[];
  metaAdAccountsLoading: boolean;
  metaAdAccountsError: string | null;
  metaReturnStatus: MetaReturnStatus | null;
  metaReturnMessage: string | null;
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
  connectFacebook: () => Promise<void>;
  loadMetaAdAccounts: () => Promise<MetaAdAccountOption[]>;
  chooseMetaAdAccount: (adAccountId: string) => Promise<boolean>;
  disconnectFacebook: () => Promise<boolean>;
  clearMetaReturnStatus: () => void;
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
  const [metaAdAccounts, setMetaAdAccounts] = useState<MetaAdAccountOption[]>([]);
  const [metaAdAccountsLoading, setMetaAdAccountsLoading] = useState<boolean>(false);
  const [metaAdAccountsError, setMetaAdAccountsError] = useState<string | null>(null);
  const [metaReturnStatus, setMetaReturnStatus] = useState<MetaReturnStatus | null>(null);
  const [metaReturnMessage, setMetaReturnMessage] = useState<string | null>(null);
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

  // Read ?connected=meta and ?error=meta_denied|invalid_state|meta_exchange_failed once and clear query params
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const parsed = parseMetaReturnParams(window.location.search);
    if (parsed.status !== null) {
      setMetaReturnStatus(parsed.status);
      setMetaReturnMessage(parsed.message);
      const nextUrl = `${window.location.pathname}${parsed.cleanedSearch}${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, []);

  const clearMetaReturnStatus = useCallback(() => {
    setMetaReturnStatus(null);
    setMetaReturnMessage(null);
  }, []);

  const loadMetaAdAccounts = useCallback(async (): Promise<MetaAdAccountOption[]> => {
    setMetaAdAccountsLoading(true);
    setMetaAdAccountsError(null);
    try {
      const res = await apiClient.getMetaAdAccounts();
      const list = Array.isArray(res?.accounts) ? res.accounts : [];
      setMetaAdAccounts(list);
      return list;
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to load your Facebook ad accounts right now.';
      setMetaAdAccountsError(message);
      return [];
    } finally {
      setMetaAdAccountsLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connRes, healthRes] = await Promise.all([
        apiClient.getConnections(),
        apiClient.getHealth().catch(() => null),
      ]);

      setConnections(connRes);
      const isDemo = Boolean(isDemoMode || activeProject?.isDemo);
      applyConnectionLiveModes(connRes, healthRes, isDemo);

      const missing = connRes.google.missing ?? healthRes?.missing ?? [];
      setMissingSecrets(missing);

      const userMetaConnected = isMetaUserConnected(connRes.meta);
      const isMetaCfg = Boolean(
        healthRes?.metaConfigured ?? connRes.meta.configured ?? connRes.meta.connected
      );
      const isMetaBlocked = !userMetaConnected && Boolean(connRes.meta.notAvailable);
      const mMissing =
        healthRes?.metaMissing ??
        connRes.meta.missing ??
        (isMetaCfg ? [] : ['META_ACCESS_TOKEN', 'META_APP_SECRET', 'META_AD_ACCOUNT_ID']);

      setMetaConfigured(isMetaCfg);
      setMetaNotAvailable(isMetaBlocked);
      setMetaMissingSecrets(mMissing);

      if (userMetaConnected) {
        if (connRes.meta.adAccountId) {
          setMetaAccountError(null);
          apiClient
            .getMetaAccount()
            .then((acct) => {
              setMetaAccountInfo(acct);
            })
            .catch((err) => {
              setMetaAccountInfo(null);
              setMetaAccountError(
                err instanceof Error ? err.message : 'Unable to fetch Meta ad account details.'
              );
            });
        } else {
          setMetaAccountInfo(null);
          setMetaAccountError(null);
        }
      } else if (isMetaBlocked) {
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
            applyConnectionLiveModes(refreshed, healthRes, isDemo);
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

  const connectFacebook = useCallback(async () => {
    setError(null);
    setMetaAdAccountsError(null);
    try {
      await startMetaLogin();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to start Facebook connection flow.';
      setError(message);
      setMetaAdAccountsError(message);
    }
  }, []);

  const chooseMetaAdAccount = useCallback(
    async (adAccountId: string): Promise<boolean> => {
      setSaving(true);
      setError(null);
      setMetaAdAccountsError(null);
      try {
        await apiClient.selectMetaAdAccount(adAccountId);
        await loadData();
        await refreshMe().catch(() => {});
        notifyConnectionsChanged();
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to save Facebook ad account selection.';
        setError(message);
        setMetaAdAccountsError(message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadData, refreshMe]
  );

  const disconnectFacebook = useCallback(async (): Promise<boolean> => {
    setDisconnecting(true);
    setError(null);
    setMetaAdAccountsError(null);
    try {
      await apiClient.disconnectMeta();
      setMetaAdAccounts([]);
      setMetaAccountInfo(null);
      await loadData();
      notifyConnectionsChanged();
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to disconnect Facebook account.';
      setError(message);
      setMetaAdAccountsError(message);
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

  const metaLoginConfigured = Boolean(connections?.meta.loginConfigured);
  const metaUserConnected = isMetaUserConnected(connections?.meta);
  const metaReconnect: MetaReconnectState = connections?.meta.reconnect ?? 'no_expiry';
  const metaExpiresAt = connections?.meta.expiresAt ?? null;

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
    metaLoginConfigured,
    metaUserConnected,
    metaReconnect,
    metaExpiresAt,
    metaAdAccounts,
    metaAdAccountsLoading,
    metaAdAccountsError,
    metaReturnStatus,
    metaReturnMessage,
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
    connectFacebook,
    loadMetaAdAccounts,
    chooseMetaAdAccount,
    disconnectFacebook,
    clearMetaReturnStatus,
    saveSelection,
    refresh: loadData,
  };
}


