import { getCurrentIdToken } from '../lib/firebase.js';
import { announceTwoStepRequired, clearProof, getProof } from '../lib/twoStep';
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

  const twoStepProof = isPublicEndpoint ? null : getProof();
  if (twoStepProof) headers['X-AdLens-2FA'] = twoStepProof;

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

function saveBlob(blob: Blob, disposition: string | null): void {
  const name = /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? 'snapshot.pdf';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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

    // Two-step verification (Sprint 22): the saved proof is missing or belongs to an older sign-in, so ask for the code.
    if (response.status === 403 && parsedErr.code === 'TWO_STEP_REQUIRED') {
      clearProof();
      announceTwoStepRequired();
    }

    // Admin panel: the one-hour admin session is over, so ask for the password again on the separate admin login page.
    if (response.status === 403 && (parsedErr.code === 'ADMIN_REAUTH' || parsedErr.code === 'ADMIN_GOOGLE_ONLY') && typeof window !== 'undefined' && window.location.pathname !== '/admin-login') {
      window.location.assign('/admin-login?expired=1');
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
export interface TeamMember { uid: string; role: string; roleName?: string; email: string; displayName: string }
export interface TeamInvite { id: string; email: string; role: string; roleName?: string; createdAt: string }
export interface TeamRole { id: string; name: string; description: string; builtin: boolean; permissions: string[]; memberCount: number; assignable: boolean; editable: boolean }
export interface PermissionInfo { id: string; label: string; help: string; group: string }
export interface TeamView {
  members: TeamMember[]; invites: TeamInvite[]; limit: number; plan: string; joinDomain: string | null;
  roles: TeamRole[]; permissionList: PermissionInfo[]; maxCustomRoles: number;
  yourRole: string; yourRoleName: string; yourPermissions: string[]; canManage: boolean; canManageRoles: boolean;
}
export interface JoinOffer { workspaceId: string; workspaceName: string; ownerName: string; domain: string }

export interface AdminWorkspaceRow { id: string; name: string; ownerId: string; members: number; plan: string; storedPlan: string; planExpiresAt: string | null; status: 'none' | 'active' | 'grace' | 'expired' }
export interface BillingPlanCard {
  id: string; label: string; priceUsd: number; priceBdt: number;
  limits: { maxProjects: number; aiQuestionsPerMonth: number };
  content: { maxDashboards: number; maxWidgetsPerDashboard: number; maxSavedReports: number; maxDatasets: number; maxAlertRules: number; maxShareLinks: number; maxEmailSchedules: number; maxCrawlPages: number; maxAgents: number };
  features: { maxMembers: number; maxMcpKeys: number; historyDays: number | null; emailSummaries: boolean };
}
export interface BillingView {
  workspaceId: string; workspaceName: string; role: string | null; canRequestUpgrade: boolean; isOperator: boolean;
  current: {
    plan: string; label: string; storedPlan: string; status: 'none' | 'active' | 'grace' | 'expired'; expiresAt: string | null; graceEndsAt: string | null;
    limits: BillingPlanCard['limits']; content: BillingPlanCard['content']; features: BillingPlanCard['features'];
  };
  usage: { projects: number; members: number; aiQuestions: number };
  plans: BillingPlanCard[];
  invoices: { id: string; number: string; amount: number; currency: string; plan: string; periodStart: string; periodEnd: string; createdAt: string }[];
  openRequest: { plan: string; createdAt: string } | null;
  refundPolicy: string;
}
export interface AdminSubscriptionRow {
  uid: string; email: string; displayName: string; role: string; workspaceId: string; workspaceName: string;
  plan: string; label: string; status: 'none' | 'active' | 'grace' | 'expired'; planExpiresAt: string | null;
}
export interface AdminPlan {
  id: string; custom: boolean; label: string; priceUsd: number; priceBdt: number;
  limits: { maxProjects: number; aiQuestionsPerMonth: number };
  content: { maxDashboards: number; maxWidgetsPerDashboard: number; maxSavedReports: number; maxDatasets: number; maxAlertRules: number; maxShareLinks: number; maxEmailSchedules: number; maxCrawlPages: number; maxAgents: number };
  features: { maxMembers: number; maxMcpKeys: number; historyDays: number | null; emailSummaries: boolean };
}
export interface AdminFlags {
  signupsOpen: boolean; maintenanceMode: boolean; maintenanceMessage: string;
  explore: boolean; dashboards: boolean; agents: boolean; mcp: boolean; aiAnalyst: boolean; team: boolean;
}
export interface AdminSettingsView {
  plans: AdminPlan[];
  saved: Record<string, unknown>;
  flags: AdminFlags;
  operators: { email: string; locked: boolean; role: string }[];
  staffRoles: { id: string; name: string; description: string; permissions: string[] }[];
  staffPermissions: { id: string; label: string }[];
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface AdminSession { operator: boolean; viaGoogle: boolean; secondsLeft: number; sessionMinutes: number; email: string | null; role: string | null; roleName: string | null; permissions: string[] }
export interface AdminCheck { id: string; title: string; status: 'pass' | 'fail' | 'warn'; detail: string }
export interface AdminOverview {
  counts: { workspaces: number; openRequests: number; endingSoon: number };
  byPlan: Record<string, number>;
  usage: { date: string; counts: Record<string, number> }[];
  health: { sharedStore: string; errorAlertsConfigured: boolean; emailConfigured: boolean; summariesJobConfigured: boolean; operators: number };
  checks: AdminCheck[];
}
export interface AdminInvoice { id: string; number: string; amount: number; currency: 'USD' | 'BDT'; plan: string; periodStart: string; periodEnd: string; note?: string; createdAt: string }
export interface AdminWorkspaceDetail {
  workspace: { id: string; name: string; ownerId: string; createdAt: string; joinDomain: string | null };
  current: { plan: string; label: string; storedPlan: string; status: string; expiresAt: string | null; graceEndsAt: string | null };
  usage: { aiQuestions: number; projects: number };
  projects: { id: string; name: string; domain: string; isDemo: boolean }[];
  members: TeamMember[];
  invites: TeamInvite[];
  roles: { id: string; name: string; builtin: boolean }[];
  invoices: AdminInvoice[];
  openRequest: { plan: string; email: string; message: string; createdAt: string } | null;
}
export interface AdminRequest { id: string; workspaceId: string; email: string; plan: string; message: string; createdAt: string }
export interface AdminUser { uid: string; email: string; displayName: string; createdAt: string; workspaces: { id: string; name: string; role: string; plan: string }[] }
export interface AdminAuditEvent { id: string; at: string; action: string; detail: string | null; workspaceId: string | null; who: string }

export interface McpKeyInfo { id: string; name: string; prefix: string; projects: { workspaceId: string; projectId: string }[]; createdAt: string; lastUsedAt: string | null }
export interface McpConnectedApp { familyId: string; clientName: string; connectedAt: string; projects: { workspaceId: string; projectId: string }[] }

export interface AlertRuleInfo {
  id: string;
  name: string;
  source: 'ga4' | 'search_console' | 'meta' | 'data';
  metric: string;
  filter?: { field: string; op: 'equals' | 'notEquals' | 'contains' | 'notContains' | 'startsWith'; value: string };
  datasetId?: string;
  aggregate?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  condition: 'above' | 'below' | 'rises_pct' | 'falls_pct';
  threshold: number;
  windowDays: 1 | 7 | 28;
  emails: string[];
  webhookHost?: string;
  enabled: boolean;
  status: 'new' | 'ok' | 'triggered' | 'nodata' | 'error';
  lastCheckedAt?: string;
  lastValue?: number | null;
  lastMessage?: string;
  lastTriggeredAt?: string;
  lastError?: string;
}
export type AlertRuleInput = Omit<AlertRuleInfo, 'id' | 'webhookHost' | 'status' | 'lastCheckedAt' | 'lastValue' | 'lastMessage' | 'lastTriggeredAt' | 'lastError'> & { webhookUrl?: string };

export interface ShareInfo {
  id: string;
  kind: 'dashboard' | 'report';
  targetId: string;
  title: string;
  rangeDays: 7 | 28 | 90;
  autoRefresh: boolean;
  hasPassword: boolean;
  expiresAt?: string;
  views: number;
  lastViewedAt?: string;
  createdAt: string;
  refreshedAt: string;
  refreshError?: string;
  url: string | null;
}
export interface ShareInput { kind: 'dashboard' | 'report'; targetId: string; rangeDays: 7 | 28 | 90; password?: string; expiresInDays?: number; autoRefresh: boolean }
export interface SharedSnapshot {
  title: string; description: string; kind: 'dashboard' | 'report'; range: { startDate: string; endDate: string }; generatedAt: string;
  widgets: { id: string; title: string; layout: { x: number; y: number; w: number; h: number }; kind: import('../types/dashboard.js').DashboardWidget['kind']; days?: number; target?: number; text?: string; result?: import('../types/explore.js').ExploreResult; error?: string }[];
}

export interface EmailScheduleInfo { attachPdf?: boolean; id: string; kind: 'dashboard' | 'report'; targetId: string; title: string; frequency: 'weekly' | 'monthly'; rangeDays: 7 | 28 | 90; emails: string[]; enabled: boolean; lastSentAt?: string; lastError?: string }
export interface EmailScheduleInput { attachPdf?: boolean; kind: 'dashboard' | 'report'; targetId: string; frequency: 'weekly' | 'monthly'; rangeDays: 7 | 28 | 90; emails: string[]; enabled: boolean }

export interface SeoIssueInfo { id: string; severity: 'error' | 'warning' | 'info'; title: string; detail: string; fix: string }
export interface SeoPageResult {
  url: string; requested: string; redirected: boolean; score: number; issues: SeoIssueInfo[];
  facts: { status: number; ms: number; title: string | null; titleLength: number; description: string | null; descriptionLength: number; h1: string[]; h2Count: number; canonical: string | null; wordCount: number; images: { total: number; missingAlt: number; missingSize: number }; internalLinks: number; externalLinks: number; noindex: boolean; structuredData: string[]; lang: string | null };
}
export interface SeoCrawlReport {
  startUrl: string; crawled: number; stoppedBecause: 'finished' | 'page_limit' | 'time_limit'; seconds: number; statusCounts: Record<string, number>; averageScore: number; robotsBlocked: number; sitemapFound: boolean;
  groups: { id: string; severity: 'error' | 'warning' | 'info'; title: string; fix: string; count: number; urls: string[] }[];
  pages: { url: string; status: number; title: string | null; words: number; h1: number; ms: number; issues: number; score: number; redirectTo?: string; linkedFrom?: string; error?: string }[];
}
export interface SeoOpportunity { kind: 'striking' | 'low_ctr' | 'no_clicks' | 'cannibal'; query: string; page: string; pages?: string[]; clicks: number; impressions: number; ctr: number; position: number; potentialClicks: number; why: string; action: string }
export interface SeoKeywordIdea { keyword: string; group: 'questions' | 'modifiers' | 'alphabet' | 'seed'; intent: 'informational' | 'commercial' | 'transactional' | 'navigational'; words: number; ranking: { impressions: number; position: number; clicks: number } | null }

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
      requireTwoStep?: boolean;
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

  async listAlerts(): Promise<{ rules: AlertRuleInfo[]; limit: number; emailAllowed: boolean; userEmail: string | null }> {
    return apiRequest('/api/alerts');
  },
  async createAlert(input: AlertRuleInput): Promise<AlertRuleInfo> {
    return (await apiRequest<{ rule: AlertRuleInfo }>('/api/alerts', { method: 'POST', body: JSON.stringify(input) })).rule;
  },
  async updateAlert(id: string, input: AlertRuleInput): Promise<AlertRuleInfo> {
    return (await apiRequest<{ rule: AlertRuleInfo }>(`/api/alerts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) })).rule;
  },
  async deleteAlert(id: string): Promise<void> {
    await apiRequest<void>(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async testAlert(id: string): Promise<{ delivered: unknown; wouldTrigger: boolean; value: number | null; message: string }> {
    return apiRequest(`/api/alerts/${encodeURIComponent(id)}/test`, { method: 'POST' });
  },

  async listShares(): Promise<{ shares: ShareInfo[]; limit: number }> { return apiRequest('/api/shares'); },
  async createShare(input: ShareInput): Promise<ShareInfo> { return (await apiRequest<{ share: ShareInfo }>('/api/shares', { method: 'POST', body: JSON.stringify(input) })).share; },
  async refreshShare(id: string): Promise<ShareInfo> { return (await apiRequest<{ share: ShareInfo }>(`/api/shares/${encodeURIComponent(id)}/refresh`, { method: 'POST' })).share; },
  async deleteShare(id: string): Promise<void> { await apiRequest<void>(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  /** Public: no sign-in. */
  async sharedMeta(token: string): Promise<{ title: string; kind: 'dashboard' | 'report'; needsPassword: boolean }> {
    const r = await fetch(`/api/shared/${encodeURIComponent(token)}`);
    if (!r.ok) throw new Error('This link is not available. It may have expired or been turned off.');
    return r.json();
  },
  async sharedOpen(token: string, password?: string): Promise<{ snapshot: SharedSnapshot; expiresAt: string | null }> {
    const r = await fetch(`/api/shared/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(j?.error?.message || 'This link is not available.');
    }
    return r.json();
  },

  async listEmailSchedules(): Promise<{ schedules: EmailScheduleInfo[]; limit: number; emailAllowed: boolean; userEmail: string | null }> { return apiRequest('/api/email-schedules'); },
  async createEmailSchedule(input: EmailScheduleInput): Promise<EmailScheduleInfo> { return (await apiRequest<{ schedule: EmailScheduleInfo }>('/api/email-schedules', { method: 'POST', body: JSON.stringify(input) })).schedule; },
  async updateEmailSchedule(id: string, patch: Partial<EmailScheduleInput>): Promise<EmailScheduleInfo> { return (await apiRequest<{ schedule: EmailScheduleInfo }>(`/api/email-schedules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) })).schedule; },
  async deleteEmailSchedule(id: string): Promise<void> { await apiRequest<void>(`/api/email-schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  async testEmailSchedule(id: string): Promise<{ sent: boolean; to: string; reason?: string }> { return apiRequest(`/api/email-schedules/${encodeURIComponent(id)}/test`, { method: 'POST' }); },

  async seoPage(url: string): Promise<SeoPageResult> { return apiRequest('/api/seo/page', { method: 'POST', body: JSON.stringify({ url }) }); },
  async seoCrawl(url?: string): Promise<{ report: SeoCrawlReport; maxPages: number }> { return apiRequest('/api/seo/crawl', { method: 'POST', body: JSON.stringify(url ? { url } : {}) }); },
  async seoOpportunities(days: 28 | 90): Promise<{ days: number; rowsRead: number; truncated: boolean; opportunities: Record<SeoOpportunity['kind'], SeoOpportunity[]> }> { return apiRequest('/api/seo/opportunities', { method: 'POST', body: JSON.stringify({ days }) }); },
  async seoSummary(payload: unknown): Promise<{ summary: string; quota: { used: number; limit: number | null } }> { return apiRequest('/api/seo/summary', { method: 'POST', body: JSON.stringify(payload) }); },
  async seoKeywords(seed: string, lang: string, deep: boolean): Promise<{ seed: string; ideas: SeoKeywordIdea[]; note: string }> { return apiRequest('/api/seo/keywords', { method: 'POST', body: JSON.stringify({ seed, lang, deep }) }); },

  /** Downloads a PDF of a dashboard or saved report (numbers as of now). */
  async downloadPdf(kind: 'dashboard' | 'report', targetId: string, rangeDays: 7 | 28 | 90): Promise<void> {
    const res = await performFetch('/api/shares/pdf', { method: 'POST', body: JSON.stringify({ kind, targetId, rangeDays }) }, false);
    if (!res.ok) throw new Error((await parseErrorResponse(res)).message);
    saveBlob(await res.blob(), res.headers.get('content-disposition'));
  },
  /** Public: the PDF of a shared snapshot. */
  async sharedPdf(token: string, password?: string): Promise<void> {
    const res = await fetch(`/api/shared/${encodeURIComponent(token)}/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!res.ok) throw new Error((await parseErrorResponse(res)).message);
    saveBlob(await res.blob(), res.headers.get('content-disposition'));
  },

  getExploreCatalog(): Promise<ExploreCatalog> {
    return apiRequest<ExploreCatalog>('/api/explore/catalog');
  },

  runExplore(source: ExploreSource, body: Record<string, unknown>): Promise<ExploreResult> {
    const path = source === 'ga4' ? '/api/explore/ga4/run' : source === 'meta' ? '/api/explore/meta/run' : source === 'data' ? '/api/explore/data/run' : '/api/explore/search-console/run';
    return apiRequest<ExploreResult>(path, { method: 'POST', body: JSON.stringify(body) });
  },

  async listDatasets(): Promise<{ datasets: import('../types/explore.js').DatasetInfo[]; limit: number }> {
    return apiRequest('/api/datasets');
  },
  async createDataset(name: string, csv: string): Promise<import('../types/explore.js').DatasetInfo> {
    const res = await apiRequest<{ dataset: import('../types/explore.js').DatasetInfo }>('/api/datasets', { method: 'POST', body: JSON.stringify({ name, csv }) });
    return res.dataset;
  },
  async listConnectors(): Promise<import('../types/explore.js').ConnectorInfo[]> {
    return (await apiRequest<{ connectors: import('../types/explore.js').ConnectorInfo[] }>('/api/datasets/connectors')).connectors;
  },
  async connectDataset(name: string, connector: string, values: Record<string, string>): Promise<import('../types/explore.js').DatasetInfo> {
    return (await apiRequest<{ dataset: import('../types/explore.js').DatasetInfo }>('/api/datasets/connect', { method: 'POST', body: JSON.stringify({ name, connector, values }) })).dataset;
  },
  async refreshDataset(id: string): Promise<import('../types/explore.js').DatasetInfo> {
    return (await apiRequest<{ dataset: import('../types/explore.js').DatasetInfo }>(`/api/datasets/${encodeURIComponent(id)}/refresh`, { method: 'POST' })).dataset;
  },
  async deleteDataset(id: string): Promise<void> {
    await apiRequest<void>(`/api/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  suggestWidget(description: string): Promise<{ widget: { title: string; kind: 'kpi' | 'bar' | 'line' | 'table' | 'stacked' | 'pie' | 'gauge' | 'heatmap'; target?: number; source: 'ga4' | 'search_console' | 'meta' | 'data'; spec: Record<string, unknown> }; quota: { used: number; limit: number } }> {
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

  teamGet(wsId: string): Promise<TeamView> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}`);
  },
  teamAdd(wsId: string, email: string, role: string): Promise<TeamView & { added: boolean; invited: boolean }> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}/members`, { method: 'POST', body: JSON.stringify({ email, role }) });
  },
  teamRemove(wsId: string, uid: string): Promise<void> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}/members/${encodeURIComponent(uid)}`, { method: 'DELETE' });
  },
  teamCreateRole(wsId: string, body: { name: string; description: string; permissions: string[] }): Promise<TeamView & { roleId: string }> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}/roles`, { method: 'POST', body: JSON.stringify(body) });
  },
  teamUpdateRole(wsId: string, roleId: string, body: { name: string; description: string; permissions: string[] }): Promise<TeamView> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}/roles/${encodeURIComponent(roleId)}`, { method: 'PUT', body: JSON.stringify(body) });
  },
  teamDeleteRole(wsId: string, roleId: string): Promise<TeamView> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' });
  },
  teamSetRole(wsId: string, uid: string, role: string): Promise<TeamView> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}/members/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify({ role }) });
  },
  teamCancelInvite(wsId: string, inviteId: string): Promise<void> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
  },
  teamSetDomainJoin(wsId: string, enabled: boolean): Promise<TeamView> {
    return apiRequest(`/api/team/${encodeURIComponent(wsId)}/domain-join`, { method: 'PUT', body: JSON.stringify({ enabled }) });
  },
  teamOffers(): Promise<{ offers: JoinOffer[] }> {
    return apiRequest('/api/team/offers/mine');
  },
  teamAcceptOffer(wsId: string): Promise<{ joined: boolean; workspaceId: string }> {
    return apiRequest(`/api/team/offers/${encodeURIComponent(wsId)}/accept`, { method: 'POST', body: '{}' });
  },

  billingGet(workspaceId: string): Promise<BillingView> {
    return apiRequest(`/api/billing?workspaceId=${encodeURIComponent(workspaceId)}`);
  },
  billingRequestUpgrade(body: { workspaceId: string; plan: string; message: string }): Promise<{ requested: boolean; emailed: boolean }> {
    return apiRequest('/api/billing/upgrade-request', { method: 'POST', body: JSON.stringify(body) });
  },
  adminSubscriptions(plan: string, q: string): Promise<{ rows: AdminSubscriptionRow[]; peopleByPlan: Record<string, number>; truncated: boolean }> {
    return apiRequest(`/api/billing/admin/subscriptions?plan=${encodeURIComponent(plan)}&q=${encodeURIComponent(q)}`);
  },
  adminSession(): Promise<AdminSession> {
    return apiRequest('/api/admin/session');
  },
  adminSettings(): Promise<AdminSettingsView> {
    return apiRequest('/api/admin/settings');
  },
  adminSavePlans(plans: Record<string, unknown>): Promise<AdminSettingsView> {
    return apiRequest('/api/admin/plans', { method: 'PUT', body: JSON.stringify({ plans }) });
  },
  adminSaveFlags(flags: Partial<AdminFlags>): Promise<AdminSettingsView> {
    return apiRequest('/api/admin/flags', { method: 'PUT', body: JSON.stringify({ flags }) });
  },
  adminSaveOperators(operators: { email: string; role: string }[]): Promise<AdminSettingsView> {
    return apiRequest('/api/admin/operators', { method: 'PUT', body: JSON.stringify({ operators }) });
  },
  billingWhoAmI(): Promise<{ isOperator: boolean }> {
    return apiRequest('/api/billing/whoami');
  },
  adminOverview(): Promise<AdminOverview> {
    return apiRequest('/api/billing/admin/overview');
  },
  adminWorkspaces(q: string): Promise<{ workspaces: AdminWorkspaceRow[] }> {
    return apiRequest(`/api/billing/admin/workspaces?q=${encodeURIComponent(q)}`);
  },
  adminWorkspace(id: string): Promise<AdminWorkspaceDetail> {
    return apiRequest(`/api/billing/admin/workspaces/${encodeURIComponent(id)}`);
  },
  adminSetPlan(body: { workspaceId: string; plan: string; endsOn: string | null; note: string }): Promise<unknown> {
    return apiRequest('/api/billing/admin/set-plan', { method: 'POST', body: JSON.stringify(body) });
  },
  adminRecordInvoice(body: { workspaceId: string; number: string; amount: number; currency: 'USD' | 'BDT'; plan: string; periodStart: string; periodEnd: string; note: string }): Promise<unknown> {
    return apiRequest('/api/billing/admin/invoices', { method: 'POST', body: JSON.stringify(body) });
  },
  adminRequests(): Promise<{ requests: AdminRequest[] }> {
    return apiRequest('/api/billing/admin/requests');
  },
  adminCloseRequest(id: string): Promise<void> {
    return apiRequest(`/api/billing/admin/requests/${encodeURIComponent(id)}/close`, { method: 'POST', body: '{}' });
  },
  adminSetMemberRole(wsId: string, uid: string, role: string): Promise<void> {
    return apiRequest(`/api/billing/admin/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(uid)}/role`, { method: 'POST', body: JSON.stringify({ role }) });
  },
  adminRemoveMember(wsId: string, uid: string): Promise<void> {
    return apiRequest(`/api/billing/admin/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(uid)}`, { method: 'DELETE' });
  },
  adminUsers(q: string): Promise<{ users: AdminUser[] }> {
    return apiRequest(`/api/billing/admin/users?q=${encodeURIComponent(q)}`);
  },
  adminAudit(workspaceId?: string): Promise<{ events: AdminAuditEvent[] }> {
    return apiRequest(`/api/billing/admin/audit${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`);
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
  twoStepStatus(): Promise<{ enabled: boolean; backupCodesLeft: number; enabledAt: string | null; proven: boolean }> {
    return apiRequest('/api/2fa/status');
  },
  twoStepStart(): Promise<{ secret: string; otpauthUri: string }> {
    return apiRequest('/api/2fa/setup/start', { method: 'POST', body: '{}' });
  },
  twoStepConfirm(code: string): Promise<{ backupCodes: string[]; proof: string }> {
    return apiRequest('/api/2fa/setup/confirm', { method: 'POST', body: JSON.stringify({ code }) });
  },
  twoStepVerify(code: string): Promise<{ proof: string; backupCodesLeft: number; usedBackupCode?: boolean }> {
    return apiRequest('/api/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) });
  },
  twoStepNewBackupCodes(code: string): Promise<{ backupCodes: string[] }> {
    return apiRequest('/api/2fa/backup-codes', { method: 'POST', body: JSON.stringify({ code }) });
  },
  twoStepDisable(code: string): Promise<void> {
    return apiRequest('/api/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) });
  },
  adminResetTwoStep(uid: string): Promise<void> {
    return apiRequest(`/api/billing/admin/users/${encodeURIComponent(uid)}/two-step/reset`, { method: 'POST', body: '{}' });
  },
  signOutEverywhere(): Promise<{ ok: boolean }> {
    return apiRequest('/api/security/sign-out-everywhere', { method: 'POST' });
  },
};
