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
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Data Source Connections
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
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
              ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/80 text-emerald-900 dark:text-emerald-200'
              : 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-800/80 text-red-900 dark:text-red-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            )}
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
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
          className="p-5 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/30 space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                Google OAuth Environment Configuration Required
              </h2>
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
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
                    className="px-2.5 py-1 text-xs font-mono font-semibold rounded bg-amber-100/90 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 border border-amber-300/70 dark:border-amber-700/70"
                  >
                    {secretName}
                  </code>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {/* Main Connections Grid: Google Integration Card (spans 2 cols) + Meta Ads Card (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Google Integration Card (GA4 + Search Console) */}
        <div className="lg:col-span-2 p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between gap-6">
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800/80 pb-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Google Marketing Platform (GA4 & Search Console)
                  </h2>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Single Google OAuth 2.0 connection authorizing read-only access to Google Analytics 4 and Google Search Console.
                </p>
              </div>

              {googleConnected ? (
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span data-testid="connected-google-email">
                    {connections?.google.email || 'Google account'}
                  </span>
                </div>
              ) : (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400 shrink-0">
                  {googleConfigured ? 'Not connected · Mock data active' : 'Setup required · Mock data active'}
                </span>
              )}
            </div>

            {/* Source Status Summary Rows */}
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 dark:divide-slate-800/80 py-1">
              {/* GA4 Status Column */}
              <div className="pb-4 sm:pb-0 sm:pr-6 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Google Analytics 4</span>
                </div>
                <div
                  data-testid="ga4-connection-status"
                  className={`text-xs font-medium ${
                    googleConnected && connections?.google.ga4Property
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {googleConnected
                    ? connections?.google.ga4Property
                      ? 'Connected — Live data active'
                      : 'Connected — select a GA4 property below'
                    : 'Mock data'}
                </div>
                {googleConnected && connections?.google.ga4Property && (
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    Selected: {connections.google.ga4Property.name} ({connections.google.ga4Property.id})
                  </div>
                )}
              </div>

              {/* Search Console Status Column */}
              <div className="pt-4 sm:pt-0 sm:pl-6 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <Search className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Google Search Console</span>
                </div>
                <div
                  data-testid="gsc-connection-status"
                  className={`text-xs font-medium ${
                    googleConnected && connections?.google.searchConsoleSite
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {googleConnected
                    ? connections?.google.searchConsoleSite
                      ? 'Connected — Live data active'
                      : 'Connected — select a verified site below'
                    : 'Mock data'}
                </div>
                {googleConnected && connections?.google.searchConsoleSite && (
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    Selected: {connections.google.searchConsoleSite.url}
                  </div>
                )}
              </div>
            </div>

            {/* When Connected: GA4 Property Dropdown & Search Console Site Dropdown */}
            {googleConnected && (
              <form onSubmit={handleSaveSelection} className="space-y-4 pt-2">
                {optionsError && (
                  <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
                    {optionsError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* GA4 Property Selector */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="ga4-property-select"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      GA4 Property (grouped by account)
                    </label>
                    {loadingOptions ? (
                      <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    ) : ga4Properties.length === 0 ? (
                      <div
                        data-testid="ga4-empty-properties"
                        className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 text-xs text-slate-600 dark:text-slate-400 space-y-1"
                      >
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          This Google account has no GA4 properties
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Ask your Google Analytics administrator to grant your email Viewer access to the property for {TRACKED_SITE.domain}.
                        </p>
                      </div>
                    ) : (
                      <select
                        id="ga4-property-select"
                        aria-label="GA4 Property"
                        value={selectedGa4Id}
                        onChange={(e) => setSelectedGa4Id(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      Search Console Verified Site
                    </label>
                    {loadingOptions ? (
                      <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    ) : searchConsoleSites.length === 0 ? (
                      <div
                        data-testid="gsc-empty-sites"
                        className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 text-xs text-slate-600 dark:text-slate-400 space-y-1"
                      >
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          This Google account has no verified Search Console sites
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Ask a Search Console administrator to grant Viewer or Full access for {TRACKED_SITE.domain}.
                        </p>
                      </div>
                    ) : (
                      <select
                        id="gsc-site-select"
                        aria-label="Search Console Site"
                        value={selectedGscUrl}
                        onChange={(e) => setSelectedGscUrl(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/70 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/70 border border-red-200 dark:border-red-900/60 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{disconnecting ? 'Disconnecting...' : 'Disconnect'}</span>
                  </button>

                  <button
                    type="submit"
                    disabled={saving || loadingOptions}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving...' : 'Save Selection'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* When Not Connected: Connect Google CTA */}
          {!googleConnected && (
            <div className="pt-4 border-t border-slate-200/70 dark:border-slate-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Scopes requested: <code className="font-mono">analytics.readonly</code>,{' '}
                <code className="font-mono">webmasters.readonly</code>
              </div>

              <button
                type="button"
                onClick={connectGoogle}
                disabled={!googleConfigured || loading}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-500 dark:disabled:text-slate-400 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Connect Google</span>
              </button>
            </div>
          )}
        </div>

        {/* Meta Ads Card (System User configuration or missing secrets notice; no connect button) */}
        <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Megaphone className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Meta Ads
                  </h2>
                  <div
                    data-testid="meta-connection-status"
                    className={`text-xs font-medium mt-0.5 ${
                      metaConfigured && !metaNotAvailable
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
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
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-1" />
              )}
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Campaign, Ad Set, and Ad delivery metrics including spend, reach, frequency, clicks, CPC, CPM, and lead generation for {TRACKED_SITE.name}.
            </p>

            {metaConfigured ? (
              <div
                data-testid="meta-account-details"
                className="p-3.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2 text-xs"
              >
                {metaAccountError ? (
                  <div className="text-red-700 dark:text-red-300 font-medium">
                    {metaAccountError}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Account Name</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100 text-right">
                        {metaAccountInfo?.name ?? 'Loading...'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Account ID</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {metaAccountInfo?.accountId ?? connections?.meta.adAccountId ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Currency</span>
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {metaAccountInfo?.currency ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Time Zone</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
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
                className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/30 space-y-2"
              >
                <div className="text-xs font-semibold text-amber-950 dark:text-amber-100">
                  System User Setup Required
                </div>
                <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                  Configure the following environment variables with a read-only Meta System User token (<code className="font-mono">ads_read</code>):
                </p>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {(metaMissingSecrets.length > 0
                    ? metaMissingSecrets
                    : ['META_ACCESS_TOKEN', 'META_APP_SECRET', 'META_AD_ACCOUNT_ID']
                  ).map((secretName) => (
                    <code
                      key={secretName}
                      className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-amber-100/90 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 border border-amber-300/70 dark:border-amber-700/70"
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
        <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
          Backend Infrastructure Telemetry
        </h2>
        <ConnectionStatus />
      </div>
    </div>
  );
};
