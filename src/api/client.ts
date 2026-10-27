import { getCurrentIdToken } from '../lib/firebase.js';
import type { AgentOptions, AgentTestResult, PublicAgent } from '../types/agents.js';
import type { Dashboard, DashboardInput } from '../types/dashboard.js';
import type { ExploreCatalog, ExploreResult, ExploreSource, ExploreSpec, SavedReport } from '../types/explore.js';
import type {
  AiUsageResponse,
  AskAnalystRequest,
  AskResult,
  ComputedDateRange,
  ConnectionsResponse,
  GA4AcquisitionReport,
  GA4AiTrafficReport,
  GA4CampaignRow,
  GA4ConversionEventRow,
  GA4Overview,
  GA4PageRow,
  GA4PropertyInfo,
  GA4PropertyOption,
  GA4SelectedProperty,
  GA4SourceGroupsReport,
  GA4TrafficBreakdownDimension,
  GA4TrafficBreakdownFilters,
  GA4TrafficBreakdownRow,
  GA4TrafficPoint,
  GoogleSourceDiscoveryResponse,
  HealthStatusResponse,
  MeResponse,
  MetaAccountInfo,
  MetaAdAccountOption,
  MetaAdRow,
  MetaAdSetRow,
  MetaAdsOverview,
  MetaCampaignRow,
  MetaSpendPoint,
  ProjectConfig,
  PublicConfigResponse,
  SearchConsoleCountryRow,
  SearchConsoleDeviceRow,
  SearchConsoleOverview,
  SearchConsolePageRow,
  SearchConsolePerformancePoint,
  SearchConsoleQueryRow,
  SearchConsoleSelectedSite,
  SearchConsoleSiteInfo,
  SearchConsoleSiteOption,
  UserProfile,
  UserSettings,
  WorkspaceSummary,
} from '../types/index.js';

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string = 'API_ERROR') {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

let activeProjectHeader: string | null = null;

export function setActiveProjectHeader(header: string | null): void {
  activeProjectHeader = header && header.trim() ? header.trim() : null;
}

export function getActiveProjectHeader(): string | null {
  return activeProjectHeader;
}

const PUBLIC_AUTH_ROUTES = new Set([
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/auth/action',
  '/sign-in-blocked',
  '/terms',
  '/privacy',
]);

function navigateToAuthRoute(targetPath: '/sign-in' | '/verify-email' | `/sign-in-blocked?reason=${string}`): void {
  if (typeof window === 'undefined') return;
  const currentPath = window.location.pathname;
  if (currentPath === targetPath || PUBLIC_AUTH_ROUTES.has(currentPath)) {
    return;
  }
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const url =
    targetPath === '/sign-in' && returnTo && returnTo !== '/'
      ? `/sign-in?redirect=${encodeURIComponent(returnTo)}`
      : targetPath;
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export const OFFLINE_ERROR_MESSAGE = "You're offline. Check your connection and try again.";

export function isNetworkDownError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  if (err instanceof ApiClientError && err.code === 'NETWORK_OFFLINE') {
    return true;
  }
  if (err instanceof TypeError) {
    return true;
  }
  if (
    err instanceof Error &&
    /failed to fetch|networkerror|network request failed|load failed/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

async function performFetch(
  path: string,
  init: RequestInit | undefined,
  forceRefreshToken: boolean
): Promise<Response> {
  const isPublicEndpoint = path === '/api/public-config' || path === '/api/health';
  const idToken = isPublicEndpoint ? null : await getCurrentIdToken(forceRefreshToken);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  if (!isPublicEndpoint && activeProjectHeader && !headers['X-AdLens-Project']) {
    headers['X-AdLens-Project'] = activeProjectHeader;
  }

  try {
    return await fetch(path, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch (err) {
    if (isNetworkDownError(err)) {
      throw new ApiClientError(OFFLINE_ERROR_MESSAGE, 0, 'NETWORK_OFFLINE');
    }
    throw err;
  }
}

async function parseErrorResponse(response: Response): Promise<{ code: string; message: string }> {
  let errorCode = 'API_ERROR';
  let errorMessage = `API request failed: ${response.status} ${response.statusText}`;

  try {
    const errBody = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    if (errBody?.error?.code) {
      errorCode = errBody.error.code;
    }
    if (errBody?.error?.message) {
      errorMessage = errBody.error.message;
    }
  } catch {
    // fallback to status text
  }

  return { code: errorCode, message: errorMessage };
}

async function parseSuccessResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  options?: { forceRefreshToken?: boolean; allowStatuses?: number[] }
): Promise<T> {
  let response = await performFetch(path, init, Boolean(options?.forceRefreshToken));

  if (!response.ok) {
    if (options?.allowStatuses?.includes(response.status)) {
      const rawJson = (await response.json()) as Record<string, unknown>;
      if (rawJson && typeof rawJson === 'object' && 'ok' in rawJson) {
        return rawJson as unknown as T;
      }
      const errObj =
        rawJson && typeof rawJson.error === 'object' && rawJson.error !== null
          ? (rawJson.error as { code?: string; message?: string })
          : undefined;
      return {
        ok: false,
        answer: '',
        error: {
          code: errObj?.code || 'API_ERROR',
          message: errObj?.message || `API request failed: ${response.status}`,
        },
        engine: null,
        stopReason: 'rejected',
        numbersUsed: [],
        toolsUsed: [],
        quota: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      } as unknown as T;
    }

    let parsedErr = await parseErrorResponse(response);

    // On 401 AUTH_REQUIRED retry once with getIdToken(true), then go to /sign-in
    if (response.status === 401 && parsedErr.code === 'AUTH_REQUIRED') {
      const refreshedToken = await getCurrentIdToken(true);
      if (refreshedToken) {
        response = await performFetch(path, init, true);
        if (response.ok) {
          return parseSuccessResponse<T>(response);
        }
        parsedErr = await parseErrorResponse(response);
      }

      if (response.status === 401 && parsedErr.code === 'AUTH_REQUIRED') {
        navigateToAuthRoute('/sign-in');
      }
      throw new ApiClientError(parsedErr.message, response.status, parsedErr.code);
    }

    // On 401 GOOGLE_SESSION_MISMATCH, the server cleared the stale Google cookie; retry once cleanly
    if (response.status === 401 && parsedErr.code === 'GOOGLE_SESSION_MISMATCH') {
      response = await performFetch(path, init, false);
      if (response.ok) {
        return parseSuccessResponse<T>(response);
      }
      parsedErr = await parseErrorResponse(response);
    }

    // Company sign-in rules (Sprint 19): explain on a page that works without the API.
    if (response.status === 403 && (parsedErr.code === 'SSO_REQUIRED' || parsedErr.code === 'SSO_DOMAIN_MISMATCH' || parsedErr.code === 'MFA_REQUIRED')) {
      navigateToAuthRoute(`/sign-in-blocked?reason=${parsedErr.code}`);
    }

    // On 403 EMAIL_NOT_VERIFIED go to /verify-email
    if (response.status === 403 && parsedErr.code === 'EMAIL_NOT_VERIFIED') {
      navigateToAuthRoute('/verify-email');
    }

    throw new ApiClientError(parsedErr.message, response.status, parsedErr.code);
  }

  return parseSuccessResponse<T>(response);
}

function buildDateRangeParams(range: ComputedDateRange): string {
  const params = new URLSearchParams({
    startDate: range.startDate,
    endDate: range.endDate,
  });
  if (range.compareStartDate && range.compareEndDate) {
    params.set('compareStartDate', range.compareStartDate);
    params.set('compareEndDate', range.compareEndDate);
  }
  return params.toString();
}

export async function startMetaLogin(): Promise<void> {
  const { linkToken } = await apiClient.createGoogleLinkToken();
  if (typeof window !== 'undefined') {
    window.location.href = `/api/auth/meta/start?lt=${encodeURIComponent(linkToken)}`;
  }
}

export interface SsoConfigInfo { domain: string; providerId: string; displayName: string; verified: boolean; enforced: boolean; requireMfa: boolean; autoJoin: boolean; dnsHost?: string; dnsValue?: string }
export interface McpProjectOption { workspaceId: string; projectId: string; workspaceName: string; name: string; domain: string }
export interface McpKeyInfo { id: string; name: string; prefix: string; projects: { workspaceId: string; projectId: string }[]; createdAt: string; lastUsedAt: string | null }
export interface McpConnectedApp { familyId: string; clientName: string; connectedAt: string; projects: { workspaceId: string; projectId: string }[] }

export const apiClient = {
  getHealth(): Promise<HealthStatusResponse> {
    return apiRequest<HealthStatusResponse>('/api/health');
  },

  getPublicConfig(): Promise<PublicConfigResponse> {
    return apiRequest<PublicConfigResponse>('/api/public-config');
  },

  bootstrapMe(displayName?: string): Promise<MeResponse> {
    return apiRequest<MeResponse>('/api/me/bootstrap', {
      method: 'POST',
      body: JSON.stringify(displayName ? { displayName } : {}),
    });
  },

  getMe(): Promise<MeResponse> {
    return apiRequest<MeResponse>('/api/me');
  },

  updateMe(patch: {
    displayName?: string;
    photoURL?: string | null;
    photoPath?: string | null;
    settings?: UserSettings;
  }): Promise<{ user: UserProfile }> {
    return apiRequest<{ user: UserProfile }>('/api/me', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  getUserAvatar(uid: string): Promise<{ avatar: { dataUrl: string; updatedAt: string } | null }> {
    return apiRequest<{ avatar: { dataUrl: string; updatedAt: string } | null }>(
      `/api/me/avatar/${encodeURIComponent(uid)}`
    );
  },

  setUserAvatar(asset: {
    dataUrl: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
  }): Promise<{ avatar: { dataUrl: string; updatedAt: string } }> {
    return apiRequest<{ avatar: { dataUrl: string; updatedAt: string } }>('/api/me/avatar', {
      method: 'PUT',
      body: JSON.stringify(asset),
    });
  },

  deleteUserAvatar(): Promise<{ deleted: boolean }> {
    return apiRequest<{ deleted: boolean }>('/api/me/avatar', {
      method: 'DELETE',
    });
  },

  deleteMyAccount(confirm: string = 'DELETE'): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(
      '/api/me/delete',
      {
        method: 'POST',
        body: JSON.stringify({ confirm }),
      },
      { forceRefreshToken: true }
    );
  },

  updateWorkspace(
    wsId: string,
    patch: {
      name?: string;
      logoURL?: string | null;
      logoPath?: string | null;
      defaults?: { currency: string; timezone: string };
    }
  ): Promise<{ workspace: WorkspaceSummary }> {
    return apiRequest<{ workspace: WorkspaceSummary }>(
      `/api/workspaces/${encodeURIComponent(wsId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }
    );
  },

  getWorkspaceLogo(wsId: string): Promise<{ logo: { dataUrl: string; updatedAt: string } | null }> {
    return apiRequest<{ logo: { dataUrl: string; updatedAt: string } | null }>(
      `/api/workspaces/${encodeURIComponent(wsId)}/logo`
    );
  },

  setWorkspaceLogo(
    wsId: string,
    asset: {
      dataUrl: string;
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      width: number;
      height: number;
    }
  ): Promise<{ logo: { dataUrl: string; updatedAt: string } }> {
    return apiRequest<{ logo: { dataUrl: string; updatedAt: string } }>(
      `/api/workspaces/${encodeURIComponent(wsId)}/logo`,
      {
        method: 'PUT',
        body: JSON.stringify(asset),
      }
    );
  },

  deleteWorkspaceLogo(wsId: string): Promise<{ deleted: boolean }> {
    return apiRequest<{ deleted: boolean }>(
      `/api/workspaces/${encodeURIComponent(wsId)}/logo`,
      {
        method: 'DELETE',
      }
    );
  },

  createProject(
    wsId: string,
    payload: {
      name: string;
      domain?: string;
      timezone?: string;
      currency?: string;
      isDemo?: boolean;
    }
  ): Promise<{ project: ProjectConfig }> {
    return apiRequest<{ project: ProjectConfig }>(
      `/api/workspaces/${encodeURIComponent(wsId)}/projects`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  updateProject(
    wsId: string,
    projectId: string,
    patch: Partial<{
      name: string;
      domain: string;
      timezone: string;
      currency: string;
      brandTerms: string[];
      hostnameFilters: string[];
      ga4PropertyId: string | null;
      ga4PropertyName: string | null;
      searchConsoleSite: string | null;
      metaAdAccountId: string | null;
      metaAdAccountName: string | null;
    }>
  ): Promise<{ project: ProjectConfig }> {
    return apiRequest<{ project: ProjectConfig }>(
      `/api/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }
    );
  },

  deleteProject(wsId: string, projectId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(
      `/api/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}`,
      {
        method: 'DELETE',
      }
    );
  },

  getConnections(): Promise<ConnectionsResponse> {
    return apiRequest<ConnectionsResponse>('/api/connections');
  },

  createGoogleLinkToken(): Promise<{ linkToken: string; expiresInSec: number }> {
    return apiRequest<{ linkToken: string; expiresInSec: number }>(
      '/api/auth/google/link-token',
      {
        method: 'POST',
      }
    );
  },

  clearGoogleSession(): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('/api/session/clear', {
      method: 'POST',
    });
  },

  getGA4Properties(): Promise<GA4PropertyOption[]> {
    return apiRequest<GA4PropertyOption[]>('/api/google/ga4/properties');
  },

  getSearchConsoleSites(): Promise<SearchConsoleSiteOption[]> {
    return apiRequest<SearchConsoleSiteOption[]>('/api/google/search-console/sites');
  },

  discoverGoogleSources(domain: string): Promise<GoogleSourceDiscoveryResponse> {
    return apiRequest<GoogleSourceDiscoveryResponse>(
      `/api/google/discover?domain=${encodeURIComponent(domain.trim())}`
    );
  },

  saveGoogleSelection(payload: {
    ga4PropertyId?: string | null;
    searchConsoleSiteUrl?: string | null;
  }): Promise<{
    ok: boolean;
    ga4Property: GA4SelectedProperty | null;
    searchConsoleSite: SearchConsoleSelectedSite | null;
  }> {
    return apiRequest('/api/google/selection', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  disconnectGoogle(): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>('/api/auth/google/disconnect', {
      method: 'POST',
    });
  },

  getMetaAdAccounts(): Promise<{ accounts: MetaAdAccountOption[] }> {
    return apiRequest<{ accounts: MetaAdAccountOption[] }>('/api/connections/meta/ad-accounts');
  },

  selectMetaAdAccount(adAccountId: string): Promise<{
    ok: boolean;
    adAccountId: string;
    adAccountName?: string;
  }> {
    return apiRequest('/api/connections/meta/selection', {
      method: 'POST',
      body: JSON.stringify({ adAccountId }),
    });
  },

  disconnectMeta(): Promise<void> {
    return apiRequest<void>('/api/connections/meta', {
      method: 'DELETE',
    });
  },

  startMetaLogin(): Promise<void> {
    return startMetaLogin();
  },

  // Live GA4 Data API routes (/api/ga4/*)
  getGA4Overview(range: ComputedDateRange): Promise<GA4Overview> {
    return apiRequest<GA4Overview>(`/api/ga4/overview?${buildDateRangeParams(range)}`);
  },

  getGA4TrafficOverTime(range: ComputedDateRange): Promise<GA4TrafficPoint[]> {
    return apiRequest<GA4TrafficPoint[]>(`/api/ga4/traffic-over-time?${buildDateRangeParams(range)}`);
  },

  getGA4Acquisition(range: ComputedDateRange): Promise<GA4AcquisitionReport> {
    return apiRequest<GA4AcquisitionReport>(`/api/ga4/acquisition?${buildDateRangeParams(range)}`);
  },

  getGA4Campaigns(range: ComputedDateRange): Promise<GA4CampaignRow[]> {
    return apiRequest<GA4CampaignRow[]>(`/api/ga4/campaigns?${buildDateRangeParams(range)}`);
  },

  getGA4TopPages(range: ComputedDateRange): Promise<GA4PageRow[]> {
    return apiRequest<GA4PageRow[]>(`/api/ga4/top-pages?${buildDateRangeParams(range)}`);
  },

  getGA4Conversions(range: ComputedDateRange): Promise<GA4ConversionEventRow[]> {
    return apiRequest<GA4ConversionEventRow[]>(`/api/ga4/conversions?${buildDateRangeParams(range)}`);
  },

  getGA4PropertyInfo(): Promise<GA4PropertyInfo> {
    return apiRequest<GA4PropertyInfo>('/api/ga4/property-info');
  },

  getGA4TrafficBreakdown(
    range: ComputedDateRange,
    dimension: GA4TrafficBreakdownDimension,
    filters?: GA4TrafficBreakdownFilters
  ): Promise<GA4TrafficBreakdownRow[]> {
    const params = new URLSearchParams(buildDateRangeParams(range));
    params.set('dimension', dimension);
    if (filters?.country) params.set('country', filters.country);
    if (filters?.deviceCategory) params.set('deviceCategory', filters.deviceCategory);
    if (filters?.browser) params.set('browser', filters.browser);
    if (filters?.limit) params.set('limit', String(filters.limit));
    return apiRequest<GA4TrafficBreakdownRow[]>(`/api/ga4/traffic-breakdown?${params.toString()}`);
  },

  getGA4SourceGroups(range: ComputedDateRange): Promise<GA4SourceGroupsReport> {
    return apiRequest<GA4SourceGroupsReport>(`/api/ga4/source-groups?${buildDateRangeParams(range)}`);
  },

  getGA4AiTraffic(range: ComputedDateRange): Promise<GA4AiTrafficReport> {
    return apiRequest<GA4AiTrafficReport>(`/api/ga4/ai-traffic?${buildDateRangeParams(range)}`);
  },

  // Live Search Console API routes (/api/search-console/*)
  getSearchConsoleOverview(range: ComputedDateRange): Promise<SearchConsoleOverview> {
    return apiRequest<SearchConsoleOverview>(
      `/api/search-console/overview?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsolePerformanceOverTime(
    range: ComputedDateRange
  ): Promise<SearchConsolePerformancePoint[]> {
    return apiRequest<SearchConsolePerformancePoint[]>(
      `/api/search-console/performance-over-time?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleTopQueries(range: ComputedDateRange): Promise<SearchConsoleQueryRow[]> {
    return apiRequest<SearchConsoleQueryRow[]>(
      `/api/search-console/top-queries?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleTopPages(range: ComputedDateRange): Promise<SearchConsolePageRow[]> {
    return apiRequest<SearchConsolePageRow[]>(
      `/api/search-console/top-pages?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleCountries(range: ComputedDateRange): Promise<SearchConsoleCountryRow[]> {
    return apiRequest<SearchConsoleCountryRow[]>(
      `/api/search-console/countries?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleDevices(range: ComputedDateRange): Promise<SearchConsoleDeviceRow[]> {
    return apiRequest<SearchConsoleDeviceRow[]>(
      `/api/search-console/devices?${buildDateRangeParams(range)}`
    );
  },

  getSearchConsoleSiteInfo(): Promise<SearchConsoleSiteInfo> {
    return apiRequest<SearchConsoleSiteInfo>('/api/search-console/site-info');
  },

  // Live Meta Ads API routes (/api/meta/*)
  getMetaAccount(): Promise<MetaAccountInfo> {
    return apiRequest<MetaAccountInfo>('/api/meta/account');
  },

  getMetaOverview(range: ComputedDateRange): Promise<MetaAdsOverview> {
    return apiRequest<MetaAdsOverview>(`/api/meta/overview?${buildDateRangeParams(range)}`);
  },

  getMetaSpendOverTime(range: ComputedDateRange): Promise<MetaSpendPoint[]> {
    return apiRequest<MetaSpendPoint[]>(
      `/api/meta/spend-over-time?${buildDateRangeParams(range)}`
    );
  },

  getMetaCampaigns(range: ComputedDateRange): Promise<MetaCampaignRow[]> {
    return apiRequest<MetaCampaignRow[]>(`/api/meta/campaigns?${buildDateRangeParams(range)}`);
  },

  getMetaAdSets(range: ComputedDateRange, campaignId?: string): Promise<MetaAdSetRow[]> {
    const query = buildDateRangeParams(range);
    const extra = campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : '';
    return apiRequest<MetaAdSetRow[]>(`/api/meta/adsets?${query}${extra}`);
  },

  getMetaAds(range: ComputedDateRange, adSetId?: string): Promise<MetaAdRow[]> {
    const query = buildDateRangeParams(range);
    const extra = adSetId ? `&adSetId=${encodeURIComponent(adSetId)}` : '';
    return apiRequest<MetaAdRow[]>(`/api/meta/ads?${query}${extra}`);
  },

  getAiUsage(): Promise<AiUsageResponse> {
    return apiRequest<AiUsageResponse>('/api/ai/usage');
  },

  askAnalyst(body: AskAnalystRequest): Promise<AskResult> {
    return apiRequest<AskResult>(
      '/api/ai/ask',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      { allowStatuses: [429] }
    );
  },

  getExploreCatalog(): Promise<ExploreCatalog> {
    return apiRequest<ExploreCatalog>('/api/explore/catalog');
  },

  runExplore(source: ExploreSource, body: Record<string, unknown>): Promise<ExploreResult> {
    const path = source === 'ga4' ? '/api/explore/ga4/run' : '/api/explore/search-console/run';
    return apiRequest<ExploreResult>(path, { method: 'POST', body: JSON.stringify(body) });
  },

  async listSavedReports(): Promise<SavedReport[]> {
    const res = await apiRequest<{ reports: SavedReport[] }>('/api/explore/saved');
    return res.reports;
  },

  async createSavedReport(input: { name: string; source: ExploreSource; spec: ExploreSpec }): Promise<SavedReport> {
    const res = await apiRequest<{ report: SavedReport }>('/api/explore/saved', { method: 'POST', body: JSON.stringify(input) });
    return res.report;
  },

  async updateSavedReport(id: string, input: { name: string; source: ExploreSource; spec: ExploreSpec }): Promise<SavedReport> {
    const res = await apiRequest<{ report: SavedReport }>(`/api/explore/saved/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
    return res.report;
  },

  async deleteSavedReport(id: string): Promise<void> {
    await apiRequest<void>(`/api/explore/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async listDashboards(): Promise<Dashboard[]> {
    const res = await apiRequest<{ dashboards: Dashboard[] }>('/api/dashboards');
    return res.dashboards;
  },

  async getDashboard(id: string): Promise<Dashboard> {
    const res = await apiRequest<{ dashboard: Dashboard }>(`/api/dashboards/${encodeURIComponent(id)}`);
    return res.dashboard;
  },

  async createDashboard(input: DashboardInput): Promise<Dashboard> {
    const res = await apiRequest<{ dashboard: Dashboard }>('/api/dashboards', { method: 'POST', body: JSON.stringify(input) });
    return res.dashboard;
  },

  async updateDashboard(id: string, input: DashboardInput): Promise<Dashboard> {
    const res = await apiRequest<{ dashboard: Dashboard }>(`/api/dashboards/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
    return res.dashboard;
  },

  async deleteDashboard(id: string): Promise<void> {
    await apiRequest<void>(`/api/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async listAgents(): Promise<{ agents: PublicAgent[]; limit: number }> {
    return apiRequest<{ agents: PublicAgent[]; limit: number }>('/api/agents');
  },

  getAgentOptions(): Promise<AgentOptions> {
    return apiRequest<AgentOptions>('/api/agents/options');
  },

  createAgent(body: { agent: Record<string, unknown>; apiKey?: string; consent: boolean }): Promise<{ agent: PublicAgent; webhookSecret?: string }> {
    return apiRequest<{ agent: PublicAgent; webhookSecret?: string }>('/api/agents', { method: 'POST', body: JSON.stringify(body) });
  },

  updateAgent(
    id: string,
    body: { agent: Record<string, unknown>; apiKey?: string; removeApiKey?: boolean; consent?: boolean; rotateWebhookSecret?: boolean }
  ): Promise<{ agent: PublicAgent; webhookSecret?: string }> {
    return apiRequest<{ agent: PublicAgent; webhookSecret?: string }>(`/api/agents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
  },

  async deleteAgent(id: string): Promise<void> {
    await apiRequest<void>(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  testAgent(id: string): Promise<AgentTestResult> {
    return apiRequest<AgentTestResult>(`/api/agents/${encodeURIComponent(id)}/test`, { method: 'POST' });
  },

  suggestWidget(description: string): Promise<{ widget: { title: string; kind: 'kpi' | 'bar' | 'line' | 'table'; source: 'ga4' | 'search_console'; spec: import('../types/explore.js').ExploreSpec }; quota: { used: number; limit: number } }> {
    return apiRequest('/api/dashboards/suggest-widget', { method: 'POST', body: JSON.stringify({ description }) });
  },

  listReports(): Promise<{ id: string; title: string; description: string; source: 'ga4' | 'search_console' | 'meta' | 'combined'; input: Record<string, unknown> }[]> {
    return apiRequest('/api/reports');
  },

  runReport(body: { id: string; args?: Record<string, unknown>; startDate: string; endDate: string; compareStartDate?: string; compareEndDate?: string }): Promise<{ id: string; result: unknown }> {
    return apiRequest('/api/reports/run', { method: 'POST', body: JSON.stringify(body) });
  },

  mcpProjects(): Promise<{ projects: McpProjectOption[] }> {
    return apiRequest('/api/mcp/projects');
  },
  mcpListKeys(): Promise<{ keys: McpKeyInfo[] }> {
    return apiRequest('/api/mcp/keys');
  },
  mcpCreateKey(name: string, projects: { workspaceId: string; projectId: string }[]): Promise<{ key: McpKeyInfo; secret: string }> {
    return apiRequest('/api/mcp/keys', { method: 'POST', body: JSON.stringify({ name, projects }) });
  },
  mcpRevokeKey(id: string): Promise<void> {
    return apiRequest(`/api/mcp/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  mcpListApps(): Promise<{ apps: McpConnectedApp[] }> {
    return apiRequest('/api/mcp/apps');
  },
  mcpRevokeApp(familyId: string): Promise<void> {
    return apiRequest(`/api/mcp/apps/${encodeURIComponent(familyId)}`, { method: 'DELETE' });
  },
  mcpAuthorizeInfo(clientId: string, redirectUri: string): Promise<{ clientName: string; redirectHost: string; projects: McpProjectOption[] }> {
    return apiRequest(`/api/mcp/oauth/authorize-info?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`);
  },
  mcpApprove(body: { client_id: string; redirect_uri: string; code_challenge: string; state?: string; approve: boolean; projects: { workspaceId: string; projectId: string }[] }): Promise<{ redirect: string }> {
    return apiRequest('/api/mcp/oauth/approve', { method: 'POST', body: JSON.stringify(body) });
  },

  digestGet(): Promise<{ emailConfigured: boolean; email: string | null; subscriptions: { workspaceId: string; projectId: string; weekly: boolean; alerts: boolean }[] }> {
    return apiRequest('/api/digest');
  },
  digestSet(body: { workspaceId: string; projectId: string; weekly: boolean; alerts: boolean }): Promise<{ weekly: boolean; alerts: boolean }> {
    return apiRequest('/api/digest', { method: 'PUT', body: JSON.stringify(body) });
  },
  opsAudit(): Promise<{ events: { id: string; at: string; action: string; detail: string | null }[] }> {
    return apiRequest('/api/ops/audit');
  },

  ssoLookup(email: string): Promise<{ sso: { providerId: string; displayName: string } | null }> {
    return apiRequest(`/api/sso/lookup?email=${encodeURIComponent(email)}`);
  },
  ssoJoin(): Promise<{ joined: boolean }> {
    return apiRequest('/api/sso/join', { method: 'POST' });
  },
  ssoGet(wsId: string): Promise<{ config: SsoConfigInfo | null; signedInWith: string | null }> {
    return apiRequest(`/api/sso/workspaces/${encodeURIComponent(wsId)}`);
  },
  ssoSave(wsId: string, body: { domain: string; providerId: string; displayName: string; autoJoin?: boolean }): Promise<{ config: SsoConfigInfo }> {
    return apiRequest(`/api/sso/workspaces/${encodeURIComponent(wsId)}`, { method: 'PUT', body: JSON.stringify(body) });
  },
  ssoVerify(wsId: string): Promise<{ config: SsoConfigInfo }> {
    return apiRequest(`/api/sso/workspaces/${encodeURIComponent(wsId)}/verify`, { method: 'POST' });
  },
  ssoEnforce(wsId: string, body: { enforced: boolean; requireMfa: boolean }): Promise<{ config: SsoConfigInfo }> {
    return apiRequest(`/api/sso/workspaces/${encodeURIComponent(wsId)}/enforce`, { method: 'PUT', body: JSON.stringify(body) });
  },
  ssoRemove(wsId: string): Promise<void> {
    return apiRequest(`/api/sso/workspaces/${encodeURIComponent(wsId)}`, { method: 'DELETE' });
  },
  workspaceAudit(wsId: string): Promise<{ events: { id: string; at: string; action: string; detail: string | null; by: string }[] }> {
    return apiRequest(`/api/sso/workspaces/${encodeURIComponent(wsId)}/audit`);
  },
  signOutEverywhere(): Promise<{ ok: boolean }> {
    return apiRequest('/api/security/sign-out-everywhere', { method: 'POST' });
  },
};
