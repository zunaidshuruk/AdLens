import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LogOut,
  Megaphone,
  Save,
  Search,
  X,
} from 'lucide-react';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ErrorState } from '../components/ErrorState';
import { APP_NAME, DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useConnections } from '../hooks';
import type { GA4PropertyOption } from '../types';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    'Google sign-in was cancelled or access was denied. Please grant read-only access to connect your properties.',
  invalid_state:
    'OAuth security state verification failed or expired. Please start the Google sign-in flow again.',
  no_refresh_token:
    'Google did not return a refresh token. Please try connecting again and accept the consent prompt.',
  token_exchange_failed:
    'Failed to exchange the authorization code with Google. Verify your GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and Redirect URI.',
};

export const ConnectionsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeProject } = useAppContext();
  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: activeProject?.domain || DEMO_PROJECT.domain,
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
    refresh,
  } = useConnections();

  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [selectedGa4Id, setSelectedGa4Id] = useState<string>('');
  const [selectedGscUrl, setSelectedGscUrl] = useState<string>('');

  // Read ?connected and ?error query parameters once, display banner, and clean the URL
  useEffect(() => {
    const connectedParam = searchParams.get('connected');
    const errorParam = searchParams.get('error');

    if (connectedParam === 'google') {
      setBanner({
        type: 'success',
        message: 'Google account connected! Select your GA4 property and Search Console site below.',
      });
      const next = new URLSearchParams(searchParams);
      next.delete('connected');
      setSearchParams(next, { replace: true });
    } else if (errorParam) {
      const msg =
        OAUTH_ERROR_MESSAGES[errorParam] ||
        `Google authentication failed (${errorParam}). Please try again.`;
      setBanner({
        type: 'error',
        message: msg,
      });
      const next = new URLSearchParams(searchParams);
      next.delete('error');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Synchronize dropdown state with saved session selection
  useEffect(() => {
    setSelectedGa4Id(connections?.google.ga4Property?.id ?? '');
    setSelectedGscUrl(connections?.google.searchConsoleSite?.url ?? '');
  }, [
    connections?.google.ga4Property?.id,
    connections?.google.searchConsoleSite?.url,
  ]);

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

  const handleSaveSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await saveSelection({
      ga4PropertyId: selectedGa4Id || null,
      searchConsoleSiteUrl: selectedGscUrl || null,
    });
    if (ok) {
      setBanner({
        type: 'success',
        message: 'Google Analytics 4 property and Search Console site selection saved to your encrypted session.',
      });
    }
  };

  const handleDisconnect = async () => {
    const ok = await disconnectGoogle();
    if (ok) {
      setSelectedGa4Id('');
      setSelectedGscUrl('');
      setBanner({
        type: 'success',
        message: 'Google account disconnected and token revoked.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
          Data Source Connections
        </h1>
        <p className="text-xs sm:text-sm text-fg-muted mt-0.5">
          Manage OAuth credentials and property bindings powering {APP_NAME} for {TRACKED_SITE.name} (
          {TRACKED_SITE.domain})
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
          aria-label="Google OAuth Setup Notice"
          data-testid="google-unconfigured-notice"
          className="p-5 rounded-xl border border-warning-line bg-warning-soft space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-warning-soft text-warning flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-warning">
                Google OAuth Environment Configuration Required
              </h2>
              <p className="text-xs text-warning leading-relaxed">
                To enable Google sign-in for Google Analytics 4 and Google Search Console, configure the following missing environment secrets:
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
                    Google Marketing Platform (GA4 & Search Console)
                  </h2>
                </div>
                <p className="text-xs text-fg-muted">
                  Single Google OAuth 2.0 connection authorizing read-only access to Google Analytics 4 and Google Search Console.
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

            {/* Source Status Summary Rows */}
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line py-1">
              {/* GA4 Status Column */}
              <div className="pb-4 sm:pb-0 sm:pr-6 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-fg">
                  <BarChart3 className="w-4 h-4 text-accent-text shrink-0" />
                  <span>Google Analytics 4</span>
                </div>
                <div
                  data-testid="ga4-connection-status"
                  className={`text-xs font-medium ${
                    googleConnected && connections?.google.ga4Property
                      ? 'text-success'
                      : 'text-warning'
                  }`}
                >
                  {googleConnected
                    ? connections?.google.ga4Property
                      ? 'Connected — Live data active'
                      : 'Connected — select a GA4 property below'
                    : 'Mock data'}
                </div>
                {googleConnected && connections?.google.ga4Property && (
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
                    googleConnected && connections?.google.searchConsoleSite
                      ? 'text-success'
                      : 'text-warning'
                  }`}
                >
                  {googleConnected
                    ? connections?.google.searchConsoleSite
                      ? 'Connected — Live data active'
                      : 'Connected — select a verified site below'
                    : 'Mock data'}
                </div>
                {googleConnected && connections?.google.searchConsoleSite && (
                  <div className="text-[11px] font-mono text-fg-muted truncate">
                    Selected: {connections.google.searchConsoleSite.url}
                  </div>
                )}
              </div>
            </div>

            {/* When Connected: GA4 Property Dropdown & Search Console Site Dropdown */}
            {googleConnected && (
              <form onSubmit={handleSaveSelection} className="space-y-4 pt-2">
                {optionsError && (
                  <div className="p-3 rounded-lg border border-danger-line bg-danger-soft text-xs text-danger">
                    {optionsError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* GA4 Property Selector */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="ga4-property-select"
                      className="block text-xs font-semibold text-fg"
                    >
                      GA4 Property (grouped by account)
                    </label>
                    {loadingOptions ? (
                      <div className="h-9 rounded-lg bg-fill-2 animate-pulse" />
                    ) : ga4Properties.length === 0 ? (
                      <div
                        data-testid="ga4-empty-properties"
                        className="p-3 rounded-lg border border-dashed border-line-strong bg-fill-1 text-xs text-fg-muted space-y-1"
                      >
                        <div className="font-semibold text-fg">
                          This Google account has no GA4 properties
                        </div>
                        <p className="text-[11px] text-fg-muted">
                          Ask your Google Analytics administrator to grant your email Viewer access to the property for {TRACKED_SITE.domain}.
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
                        <option value="">Select a GA4 property...</option>
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
                          Ask a Search Console administrator to grant Viewer or Full access for {TRACKED_SITE.domain}.
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
                        <option value="">Select a verified site...</option>
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
          </div>

          {/* When Not Connected: Connect / Reconnect Google CTA */}
          {!googleConnected && (
            <div className="pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-fg-muted">
                {connections?.google.needsReconnect ? (
                  <span className="text-warning font-medium">
                    Google access expired or was revoked
                    {connections.google.email ? ` (${connections.google.email})` : ''}. Please reconnect your account.
                  </span>
                ) : (
                  <>
                    Scopes requested: <code className="font-mono">analytics.readonly</code>,{' '}
                    <code className="font-mono">webmasters.readonly</code>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={connectGoogle}
                disabled={!googleConfigured || loading}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:bg-fill-3 disabled:text-fg-muted disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{connections?.google.needsReconnect ? 'Reconnect Google' : 'Connect Google'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Meta Ads Card (System User configuration or missing secrets notice; no connect button) */}
        <div className="p-6 rounded-xl border border-line bg-surface flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent-text flex items-center justify-center shrink-0">
                  <Megaphone className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-fg">
                    Meta Ads
                  </h2>
                  <div
                    data-testid="meta-connection-status"
                    className={`text-xs font-medium mt-0.5 ${
                      metaConfigured && !metaNotAvailable
                        ? 'text-success'
                        : 'text-warning'
                    }`}
                  >
                    {metaNotAvailable
                      ? 'Connecting your own Facebook account is coming soon'
                      : metaConfigured
                        ? 'Connected via system user'
                        : 'Mock data'}
                  </div>
                </div>
              </div>
              {metaConfigured && !metaNotAvailable && (
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-1" />
              )}
            </div>

            <p className="text-xs text-fg-muted leading-relaxed">
              Campaign, Ad Set, and Ad delivery metrics including spend, reach, frequency, clicks, CPC, CPM, and lead generation for {TRACKED_SITE.name}.
            </p>

            {metaConfigured ? (
              <div
                data-testid="meta-account-details"
                className="p-3.5 rounded-lg border border-line bg-fill-1 space-y-2 text-xs"
              >
                {metaAccountError ? (
                  <div className="text-danger font-medium">
                    {metaAccountError}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-fg-muted">Account Name</span>
                      <span className="font-semibold text-fg text-right">
                        {metaAccountInfo?.name ?? 'Loading...'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-fg-muted">Account ID</span>
                      <span className="font-mono text-fg">
                        {metaAccountInfo?.accountId ?? connections?.meta.adAccountId ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-fg-muted">Currency</span>
                      <span className="font-mono font-semibold text-fg">
                        {metaAccountInfo?.currency ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-fg-muted">Time Zone</span>
                      <span className="font-mono text-fg">
                        {metaAccountInfo?.timezoneName ?? '—'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div
                role="region"
                aria-label="Meta Marketing API Setup Notice"
                data-testid="meta-unconfigured-notice"
                className="p-3.5 rounded-lg border border-warning-line bg-warning-soft space-y-2"
              >
                <div className="text-xs font-semibold text-warning">
                  System User Setup Required
                </div>
                <p className="text-[11px] text-warning leading-relaxed">
                  Configure the following environment variables with a read-only Meta System User token (<code className="font-mono">ads_read</code>):
                </p>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {(metaMissingSecrets.length > 0
                    ? metaMissingSecrets
                    : ['META_ACCESS_TOKEN', 'META_APP_SECRET', 'META_AD_ACCOUNT_ID']
                  ).map((secretName) => (
                    <code
                      key={secretName}
                      className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-warning-soft text-warning border border-warning-line"
                    >
                      {secretName}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
