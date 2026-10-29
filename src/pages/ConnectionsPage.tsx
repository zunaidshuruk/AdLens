import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ErrorState } from '../components/ErrorState';
import { ConnectedSources } from '../components/ConnectedSources';
import { DataProviderCard } from '../components/DataProviderCard';
import { MetaConnectCard } from '../components/MetaConnectCard';
import { GbpConnectionCard } from '../components/seo/BusinessProfile';
import { APP_NAME, DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useConnections } from '../hooks';
import { parseMetaReturnParams } from '../hooks/useConnections';
import type { GA4PropertyOption } from '../types';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    'Google sign-in was cancelled or access was denied. Please allow read-only access to connect your accounts.',
  invalid_state:
    'Security check expired. Please start the Google sign-in flow again.',
  no_refresh_token:
    'Google did not finish connecting. Please try again and accept the prompt.',
  token_exchange_failed:
    'Could not finish connecting with Google. Please check your server settings and try again.',
};

export const ConnectionsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeProject } = useAppContext();
  const projectDomain = (activeProject?.domain ?? '').trim();
  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: projectDomain || DEMO_PROJECT.domain,
  };
  const {
    connections,
    missingSecrets,
    googleConfigured,
    googleConnected,
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
    connectFacebook,
    loadMetaAdAccounts,
    chooseMetaAdAccount,
    disconnectFacebook,
    clearMetaReturnStatus,
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
    refresh,
  } = useConnections();

  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [selectedGa4Id, setSelectedGa4Id] = useState<string>('');
  const [selectedGscUrl, setSelectedGscUrl] = useState<string>('');
  const [manualMode, setManualMode] = useState<boolean>(false);
  const [checkingAgain, setCheckingAgain] = useState<boolean>(false);
  const [domainInput, setDomainInput] = useState<string>(projectDomain);
  const autoDiscoveredRef = useRef<string | null>(null);

  const hasSavedSelection = Boolean(
    connections?.google.ga4Property?.id || connections?.google.searchConsoleSite?.url
  );

  // Links such as /connections#gbp, #provider and #sources jump to that card once the page is drawn.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 400);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    setDomainInput((activeProject?.domain ?? '').trim());
  }, [activeProject?.id, activeProject?.domain]);

  // Read ?connected and ?error query parameters once, display banner, and clean the URL
  useEffect(() => {
    if (parseMetaReturnParams(searchParams).status !== null) return; // Facebook return is shown by the Facebook banner
    const connectedParam = searchParams.get('connected');
    const errorParam = searchParams.get('error');

    if (connectedParam === 'google') {
      setBanner({
        type: 'success',
        message: 'Google account connected! Looking for your website now.',
      });
      const next = new URLSearchParams(searchParams);
      next.delete('connected');
      setSearchParams(next, { replace: true });
    } else if (errorParam) {
      const msg =
        OAUTH_ERROR_MESSAGES[errorParam] ||
        `Google sign-in could not be completed (${errorParam}). Please try again.`;
      setBanner({
        type: 'error',
        message: msg,
      });
      const next = new URLSearchParams(searchParams);
      next.delete('error');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Show the Facebook return message (connected / cancelled / failed) and clean the address bar
  useEffect(() => {
    if (!metaReturnStatus || !metaReturnMessage) return;
    setBanner({ type: metaReturnStatus === 'connected' ? 'success' : 'error', message: metaReturnMessage });
    const next = new URLSearchParams(searchParams);
    next.delete('connected');
    next.delete('error');
    setSearchParams(next, { replace: true });
    clearMetaReturnStatus();
  }, [metaReturnStatus, metaReturnMessage, searchParams, setSearchParams, clearMetaReturnStatus]);

  // Synchronize dropdown state with saved selection
  useEffect(() => {
    setSelectedGa4Id(connections?.google.ga4Property?.id ?? '');
    setSelectedGscUrl(connections?.google.searchConsoleSite?.url ?? '');
  }, [
    connections?.google.ga4Property?.id,
    connections?.google.searchConsoleSite?.url,
  ]);

  // Automatically run discovery when connected and no property is chosen yet
  useEffect(() => {
    if (!googleConnected || loading || hasSavedSelection) {
      return;
    }
    if (!projectDomain) {
      return;
    }
    const key = `${activeProject?.id ?? 'default'}:${projectDomain}`;
    if (autoDiscoveredRef.current === key) {
      return;
    }
    autoDiscoveredRef.current = key;
    void discoverSources(projectDomain);
  }, [googleConnected, loading, hasSavedSelection, projectDomain, activeProject?.id, discoverSources]);

  // Group GA4 properties by accountName
  const groupedGa4Properties = useMemo(() => {
    const groups = new Map<string, GA4PropertyOption[]>();
    for (const prop of ga4Properties) {
      const existing = groups.get(prop.accountName) ?? [];
      existing.push(prop);
      groups.set(prop.accountName, existing);
    }
    return Array.from(groups.entries());
  }, [ga4Properties]);

  const suggestedGa4Item = useMemo(() => {
    if (!discovery?.suggested.ga4PropertyId) return null;
    return (
      discovery.ga4.find((p) => p.propertyId === discovery.suggested.ga4PropertyId) ?? null
    );
  }, [discovery]);

  const suggestedScItem = useMemo(() => {
    if (!discovery?.suggested.searchConsoleSiteUrl) return null;
    return (
      discovery.searchConsole.find(
        (s) => s.siteUrl === discovery.suggested.searchConsoleSiteUrl
      ) ?? null
    );
  }, [discovery]);

  const hasAnySuggestion = Boolean(suggestedGa4Item || suggestedScItem);
  const noSuggestionsFound = Boolean(discovery && !discovering && !hasAnySuggestion);

  const handleFindByDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetDomain = domainInput.trim();
    if (!targetDomain) return;
    setManualMode(false);
    await discoverSources(targetDomain);
  };

  const handleCheckAgain = async () => {
    setManualMode(false);
    setCheckingAgain(true);
    const targetDomain = projectDomain || domainInput.trim();
    if (targetDomain) {
      await discoverSources(targetDomain);
    }
  };

  const handleAcceptSuggested = async () => {
    if (!discovery) return;
    const payload: {
      ga4PropertyId?: string | null;
      searchConsoleSiteUrl?: string | null;
    } = {};
    if (discovery.suggested.ga4PropertyId) {
      payload.ga4PropertyId = discovery.suggested.ga4PropertyId;
    }
    if (discovery.suggested.searchConsoleSiteUrl) {
      payload.searchConsoleSiteUrl = discovery.suggested.searchConsoleSiteUrl;
    }
    const ok = await saveSelection(payload);
    if (ok) {
      setCheckingAgain(false);
      setManualMode(false);
      setBanner({
        type: 'success',
        message: 'Your Google Analytics and Search Console choices have been saved.',
      });
    }
  };

  const handleSaveSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await saveSelection({
      ga4PropertyId: selectedGa4Id || null,
      searchConsoleSiteUrl: selectedGscUrl || null,
    });
    if (ok) {
      setCheckingAgain(false);
      setManualMode(false);
      setBanner({
        type: 'success',
        message: 'Your Google Analytics and Search Console choices have been saved.',
      });
    }
  };

  const handleDisconnect = async () => {
    const ok = await disconnectGoogle();
    if (ok) {
      setSelectedGa4Id('');
      setSelectedGscUrl('');
      setManualMode(false);
      setCheckingAgain(false);
      autoDiscoveredRef.current = null;
      setBanner({
        type: 'success',
        message: 'Google account disconnected.',
      });
    }
  };

  const showDiscoveryFlow = googleConnected && (!hasSavedSelection || checkingAgain);
  const showManualForm = googleConnected && (manualMode || noSuggestionsFound);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
          Data Source Connections
        </h1>
        <p className="text-xs sm:text-sm text-fg-muted mt-0.5">
          Connect your website and advertising accounts for {TRACKED_SITE.name} ({TRACKED_SITE.domain})
        </p>
      </div>

      {/* Callback or Action Banner */}
      {banner && (
        <div
          role="status"
          data-testid="connections-banner"
          className={`flex items-start justify-between gap-3 p-4 rounded-xl border text-xs sm:text-sm ${
            banner.type === 'success'
              ? 'bg-success-soft border-success-line text-success'
              : 'bg-danger-soft border-danger-line text-danger'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            )}
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded hover:bg-fill-2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Missing Secrets Setup Notice when googleConfigured is false */}
      {!loading && !googleConfigured && (
        <div
          role="region"
          aria-label="Google Setup Notice"
          data-testid="google-unconfigured-notice"
          className="p-5 rounded-xl border border-warning-line bg-warning-soft space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-warning-soft text-warning flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-warning">
                Google Environment Configuration Required
              </h2>
              <p className="text-xs text-warning leading-relaxed">
                To enable Google sign-in for Google Analytics and Search Console, configure the following missing environment secrets:
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {(missingSecrets.length > 0
                  ? missingSecrets
                  : [
                      'GOOGLE_CLIENT_ID',
                      'GOOGLE_CLIENT_SECRET',
                      'TOKEN_ENCRYPTION_KEY',
                      'APP_BASE_URL',
                    ]
                ).map((secretName) => (
                  <code
                    key={secretName}
                    className="px-2.5 py-1 text-xs font-mono font-semibold rounded bg-warning-soft text-warning border border-warning-line"
                  >
                    {secretName}
                  </code>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => void refresh()} />}

      {/* Main Connections Grid: Google Integration Card (spans 2 cols) + Meta Ads Card (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Google Integration Card (GA4 + Search Console) */}
        <div className="lg:col-span-2 p-6 rounded-xl border border-line bg-surface flex flex-col justify-between gap-6">
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-line pb-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-fg">
                    Google Analytics & Search Console
                  </h2>
                </div>
                <p className="text-xs text-fg-muted">
                  Connect once with your Google account to see your website traffic and Google search results.
                </p>
              </div>

              {googleConnected ? (
                <div className="flex items-center gap-2 text-xs font-medium text-success shrink-0">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span data-testid="connected-google-email">
                    {connections?.google.email || 'Google account'}
                  </span>
                </div>
              ) : (
                <span className="text-xs font-medium text-warning shrink-0">
                  {connections?.google.needsReconnect
                    ? 'Reconnect required · Mock data active'
                    : googleConfigured
                      ? 'Not connected · Mock data active'
                      : 'Setup required · Mock data active'}
                </span>
              )}
            </div>

            {/* NOT connected: ONE large primary button + plain sentence */}
            {!googleConnected && (
              <div className="py-2 space-y-2.5" data-testid="google-not-connected-cta">
                {connections?.google.needsReconnect && (
                  <p className="text-xs font-medium text-warning">
                    Your Google access expired
                    {connections.google.email ? ` (${connections.google.email})` : ''}. Please connect again.
                  </p>
                )}
                <button
                  type="button"
                  onClick={connectGoogle}
                  disabled={!googleConfigured || loading}
                  data-testid="connect-google-button"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:bg-fill-3 disabled:text-fg-muted disabled:cursor-not-allowed"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span>Connect Google Analytics and Search Console</span>
                </button>
                <p className="text-xs text-fg-muted">
                  AdLens only reads your numbers. It can never change anything in your accounts.
                </p>
              </div>
            )}

            {/* When Connected: Source Status Summary Rows */}
            {googleConnected && (
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line py-1">
                {/* GA4 Status Column */}
                <div className="pb-4 sm:pb-0 sm:pr-6 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-fg">
                    <BarChart3 className="w-4 h-4 text-accent-text shrink-0" />
                    <span>Google Analytics</span>
                  </div>
                  <div
                    data-testid="ga4-connection-status"
                    className={`text-xs font-medium ${
                      connections?.google.ga4Property ? 'text-success' : 'text-warning'
                    }`}
                  >
                    {connections?.google.ga4Property
                      ? 'Connected — Live data active'
                      : 'Connected — choose your website below'}
                  </div>
                  {connections?.google.ga4Property && (
                    <div className="text-[11px] font-mono text-fg-muted truncate">
                      Selected: {connections.google.ga4Property.name} ({connections.google.ga4Property.id})
                    </div>
                  )}
                </div>

                {/* Search Console Status Column */}
                <div className="pt-4 sm:pt-0 sm:pl-6 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-fg">
                    <Search className="w-4 h-4 text-accent-text shrink-0" />
                    <span>Google Search Console</span>
                  </div>
                  <div
                    data-testid="gsc-connection-status"
                    className={`text-xs font-medium ${
                      connections?.google.searchConsoleSite ? 'text-success' : 'text-warning'
                    }`}
                  >
                    {connections?.google.searchConsoleSite
                      ? 'Connected — Live data active'
                      : 'Connected — choose your website below'}
                  </div>
                  {connections?.google.searchConsoleSite && (
                    <div className="text-[11px] font-mono text-fg-muted truncate">
                      Selected: {connections.google.searchConsoleSite.url}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Discovery Flow (when just connected / no saved selection / Check again clicked) */}
            {showDiscoveryFlow && (
              <div className="space-y-4 pt-2" data-testid="google-discovery-section">
                {/* Domain box if project has no domain */}
                {!projectDomain && !discovering && !discovery && (
                  <form
                    onSubmit={handleFindByDomain}
                    className="p-4 rounded-xl border border-line bg-fill-1 space-y-3"
                    data-testid="discover-domain-form"
                  >
                    <label
                      htmlFor="discover-domain-input"
                      className="block text-xs font-semibold text-fg"
                    >
                      Your website address (example.com)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id="discover-domain-input"
                        type="text"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        placeholder="example.com"
                        aria-label="Your website address (example.com)"
                        className="flex-1 px-3 py-2 text-xs rounded-lg border border-line bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                      />
                      <button
                        type="submit"
                        disabled={!domainInput.trim() || discovering}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>Find</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* While discovery runs */}
                {discovering && (
                  <div
                    role="status"
                    data-testid="google-discovering-indicator"
                    className="flex items-center gap-2.5 p-4 rounded-xl border border-line bg-fill-1 text-xs font-medium text-fg"
                  >
                    <Loader2 className="w-4 h-4 text-accent-text animate-spin shrink-0" />
                    <span>Looking for your website…</span>
                  </div>
                )}

                {discoverError && (
                  <div className="p-3 rounded-lg border border-danger-line bg-danger-soft text-xs text-danger">
                    {discoverError}
                  </div>
                )}

                {/* Result card: "We found your website" */}
                {!discovering && discovery && hasAnySuggestion && (
                  <div
                    data-testid="google-discovered-card"
                    className="p-4 rounded-xl border border-accent-line bg-accent-soft/40 space-y-4"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-accent-text shrink-0" />
                      <h3 className="text-sm font-bold text-fg">
                        We found your website
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Suggested Google Analytics */}
                      <div className="p-3 rounded-lg border border-line bg-surface space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                          Google Analytics
                        </div>
                        {suggestedGa4Item ? (
                          <>
                            <div className="text-xs font-semibold text-fg">
                              {suggestedGa4Item.displayName}{' '}
                              <span className="font-mono text-fg-muted">
                                ({suggestedGa4Item.propertyId})
                              </span>
                            </div>
                            {suggestedGa4Item.reasons[0] && (
                              <p className="text-xs text-fg-muted">
                                {suggestedGa4Item.reasons[0]}
                              </p>
                            )}
                          </>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-warning">
                              Google Analytics is missing for this website
                            </div>
                            <p className="text-xs text-fg-muted">
                              {discovery.notes.find((n) => /GA4|Analytics/i.test(n)) ||
                                'Ask the site owner to give you Viewer access in Google Analytics.'}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Suggested Search Console */}
                      <div className="p-3 rounded-lg border border-line bg-surface space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                          Search Console
                        </div>
                        {suggestedScItem ? (
                          <>
                            <div className="text-xs font-semibold font-mono text-fg break-all">
                              {suggestedScItem.siteUrl}
                            </div>
                            {suggestedScItem.reasons[0] && (
                              <p className="text-xs text-fg-muted">
                                {suggestedScItem.reasons[0]}
                              </p>
                            )}
                          </>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-warning">
                              Search Console is missing for this website
                            </div>
                            <p className="text-xs text-fg-muted">
                              {discovery.notes.find((n) => /Search Console/i.test(n)) ||
                                'Ask the site owner to give you access in Google Search Console.'}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {discovery.notes.length > 0 && (
                      <div className="space-y-1">
                        {discovery.notes.map((note, idx) => (
                          <p key={idx} className="text-xs text-fg-muted">
                            {note}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleAcceptSuggested}
                        disabled={saving}
                        data-testid="accept-suggested-sources-button"
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{saving ? 'Saving...' : 'Yes, use these'}</span>
                      </button>

                      {!manualMode && (
                        <button
                          type="button"
                          onClick={() => setManualMode(true)}
                          data-testid="choose-manually-link"
                          className="text-xs font-medium text-accent-text hover:underline cursor-pointer"
                        >
                          Not right? Choose manually
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Nothing was suggested */}
                {noSuggestionsFound && (
                  <div
                    data-testid="google-no-match-notice"
                    className="p-4 rounded-xl border border-warning-line bg-warning-soft space-y-1.5"
                  >
                    <div className="text-xs font-semibold text-warning">
                      {"We couldn't find a match automatically"}
                    </div>
                    {discovery?.notes.map((note, idx) => (
                      <p key={idx} className="text-xs text-warning">
                        {note}
                      </p>
                    ))}
                  </div>
                )}

                {/* Link to open manual mode when not yet shown */}
                {!manualMode && !noSuggestionsFound && !hasAnySuggestion && !discovering && (
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setManualMode(true)}
                      data-testid="choose-manually-link"
                      className="text-xs font-medium text-accent-text hover:underline cursor-pointer"
                    >
                      Not right? Choose manually
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Already-saved project controls (when not in manual mode) */}
            {googleConnected && hasSavedSelection && !showManualForm && (
              <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCheckAgain}
                    disabled={discovering}
                    data-testid="check-again-button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-line bg-fill-1 text-fg hover:bg-fill-2 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${discovering ? 'animate-spin' : ''}`} />
                    <span>Check again</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setManualMode(true)}
                    data-testid="choose-manually-link"
                    className="text-xs font-medium text-accent-text hover:underline cursor-pointer"
                  >
                    Not right? Choose manually
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-danger bg-danger-soft hover:bg-danger-soft border border-danger-line transition-colors cursor-pointer disabled:opacity-50"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{disconnecting ? 'Disconnecting...' : 'Disconnect'}</span>
                </button>
              </div>
            )}

            {/* Manual Choice Dropdown Form */}
            {showManualForm && (
              <form
                onSubmit={handleSaveSelection}
                data-testid="google-manual-selection-form"
                className="space-y-4 pt-2"
              >
                {optionsError && (
                  <div className="p-3 rounded-lg border border-danger-line bg-danger-soft text-xs text-danger">
                    {optionsError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* GA4 Selector */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="ga4-property-select"
                      className="block text-xs font-semibold text-fg"
                    >
                      Google Analytics Website
                    </label>
                    {loadingOptions ? (
                      <div className="h-9 rounded-lg bg-fill-2 animate-pulse" />
                    ) : ga4Properties.length === 0 ? (
                      <div
                        data-testid="ga4-empty-properties"
                        className="p-3 rounded-lg border border-dashed border-line-strong bg-fill-1 text-xs text-fg-muted space-y-1"
                      >
                        <div className="font-semibold text-fg">
                          This Google account has no Google Analytics websites
                        </div>
                        <p className="text-[11px] text-fg-muted">
                          Ask the site owner to give your email Viewer access in Google Analytics for {TRACKED_SITE.domain}.
                        </p>
                      </div>
                    ) : (
                      <select
                        id="ga4-property-select"
                        aria-label="GA4 Property"
                        value={selectedGa4Id}
                        onChange={(e) => setSelectedGa4Id(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                      >
                        <option value="">Choose a Google Analytics website...</option>
                        {groupedGa4Properties.map(([accountName, props]) => (
                          <optgroup key={accountName} label={accountName}>
                            {props.map((p) => (
                              <option key={p.propertyId} value={p.propertyId}>
                                {p.propertyName} ({p.propertyId})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Search Console Site Selector */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="gsc-site-select"
                      className="block text-xs font-semibold text-fg"
                    >
                      Search Console Verified Site
                    </label>
                    {loadingOptions ? (
                      <div className="h-9 rounded-lg bg-fill-2 animate-pulse" />
                    ) : searchConsoleSites.length === 0 ? (
                      <div
                        data-testid="gsc-empty-sites"
                        className="p-3 rounded-lg border border-dashed border-line-strong bg-fill-1 text-xs text-fg-muted space-y-1"
                      >
                        <div className="font-semibold text-fg">
                          This Google account has no verified Search Console sites
                        </div>
                        <p className="text-[11px] text-fg-muted">
                          Ask the site owner to grant your email access in Search Console for {TRACKED_SITE.domain}.
                        </p>
                      </div>
                    ) : (
                      <select
                        id="gsc-site-select"
                        aria-label="Search Console Site"
                        value={selectedGscUrl}
                        onChange={(e) => setSelectedGscUrl(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                      >
                        <option value="">Choose a verified site...</option>
                        {searchConsoleSites.map((s) => (
                          <option key={s.siteUrl} value={s.siteUrl}>
                            {s.siteUrl} ({s.permissionLevel})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Save & Disconnect Actions */}
                <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-danger bg-danger-soft hover:bg-danger-soft border border-danger-line transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{disconnecting ? 'Disconnecting...' : 'Disconnect'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCheckAgain}
                      disabled={discovering}
                      data-testid="check-again-button"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-line bg-fill-1 text-fg hover:bg-fill-2 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${discovering ? 'animate-spin' : ''}`} />
                      <span>Check again</span>
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={saving || loadingOptions}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving...' : 'Save Selection'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* Disconnect button when connected with no saved selection and manual form is closed */}
            {googleConnected && !hasSavedSelection && !showManualForm && (
              <div className="pt-3 border-t border-line flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-danger bg-danger-soft hover:bg-danger-soft border border-danger-line transition-colors cursor-pointer disabled:opacity-50"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{disconnecting ? 'Disconnecting...' : 'Disconnect'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Facebook / Meta Ads card */}
        <MetaConnectCard
          siteName={TRACKED_SITE.name}
          loginConfigured={metaLoginConfigured}
          userConnected={metaUserConnected}
          reconnect={metaReconnect}
          expiresAt={metaExpiresAt}
          adAccountId={connections?.meta.adAccountId ?? null}
          systemConfigured={metaConfigured}
          notAvailable={metaNotAvailable}
          missingSecrets={metaMissingSecrets}
          accountInfo={metaAccountInfo}
          accountError={metaAccountError}
          adAccounts={metaAdAccounts}
          adAccountsLoading={metaAdAccountsLoading}
          adAccountsError={metaAdAccountsError}
          busy={loading || saving || disconnecting}
          onConnect={connectFacebook}
          onLoadAdAccounts={async () => {
            await loadMetaAdAccounts();
          }}
          onChooseAdAccount={chooseMetaAdAccount}
          onDisconnect={disconnectFacebook}
        />
      </div>

      {/* Everything else you can connect lives here too */}
      <GbpConnectionCard />
      <div id="provider"><DataProviderCard /></div>
      <ConnectedSources />

      {/* Server Status Row from /api/health */}
      <div>
        <h2 className="text-xs font-semibold text-fg-muted mb-2.5">
          Backend Infrastructure Telemetry
        </h2>
        <ConnectionStatus />
      </div>
    </div>
  );
};
