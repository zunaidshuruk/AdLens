/**
 * Host breakdown for AdLens (Sprint 7). Pure functions, no network calls.
 *
 * Merges, per hostname:
 * - GA4 rows with dimension "hostName" (sessions, active users, key events)
 * - Search Console rows with dimension "page" (clicks, impressions, position), host taken from the URL
 * - Submitted sitemaps (Search Console sitemaps.list), host taken from the sitemap URL
 * and flags hosts with traffic but no sitemap, a sitemap but no traffic, or sitemap errors.
 */

export interface GA4HostRow {
  hostName: string;
  sessions: number;
  activeUsers: number;
  keyEvents: number;
}

export interface SearchPageRow {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface SitemapInfo {
  path: string;
  errors?: number;
  warnings?: number;
  lastSubmitted?: string;
  isPending?: boolean;
  submittedUrls?: number;
}

export type HostFlag = 'traffic_without_sitemap' | 'sitemap_without_traffic' | 'sitemap_errors';

export interface HostRow {
  host: string;
  sessions: number;
  activeUsers: number;
  keyEvents: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  sitemaps: SitemapInfo[];
  flags: HostFlag[];
}

export interface HostBreakdown {
  hosts: HostRow[];
  totals: { sessions: number; activeUsers: number; keyEvents: number; clicks: number; impressions: number };
  excludedHosts: string[];
}

/** Local and test hosts that run the GA4 tag but are not real site traffic. */
const EXCLUDED_HOST_PATTERNS = [/^localhost$/, /^127\.0\.0\.1$/, /^0\.0\.0\.0$/, /^\[?::1\]?$/, /\.local$/, /\.test$/, /^\(not set\)$/];

export function normalizeHost(raw: string | undefined | null): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  try {
    if (/^[a-z]+:\/\//.test(s)) s = new URL(s).hostname;
  } catch {
    // fall through to manual cleanup
  }
  return s.split('/')[0].split(':')[0].replace(/^www\./, '').replace(/\.+$/, '');
}

export function isExcludedHost(host: string): boolean {
  return EXCLUDED_HOST_PATTERNS.some((re) => re.test(host));
}

export function buildHostBreakdown(
  ga4Rows: GA4HostRow[],
  searchRows: SearchPageRow[],
  sitemaps: SitemapInfo[]
): HostBreakdown {
  const hosts = new Map<string, HostRow & { positionWeight: number }>();
  const excluded = new Set<string>();

  const get = (host: string) => {
    let h = hosts.get(host);
    if (!h) {
      h = {
        host, sessions: 0, activeUsers: 0, keyEvents: 0, clicks: 0, impressions: 0,
        ctr: 0, position: null, sitemaps: [], flags: [], positionWeight: 0,
      };
      hosts.set(host, h);
    }
    return h;
  };

  for (const r of ga4Rows) {
    const host = normalizeHost(r.hostName);
    if (!host || isExcludedHost(host)) {
      if (r.hostName) excluded.add(r.hostName);
      continue;
    }
    const h = get(host);
    h.sessions += r.sessions;
    h.activeUsers += r.activeUsers;
    h.keyEvents += r.keyEvents;
  }

  for (const r of searchRows) {
    const host = normalizeHost(r.page);
    if (!host) continue;
    const h = get(host);
    h.clicks += r.clicks;
    h.impressions += r.impressions;
    h.positionWeight += r.position * r.impressions; // impression-weighted position
  }

  for (const sm of sitemaps) {
    const host = normalizeHost(sm.path);
    if (!host) continue;
    get(host).sitemaps.push(sm);
  }

  const rows: HostRow[] = [...hosts.values()].map(({ positionWeight, ...h }) => {
    const ctr = h.impressions > 0 ? Math.round((h.clicks / h.impressions) * 10000) / 100 : 0;
    const position = h.impressions > 0 ? Math.round((positionWeight / h.impressions) * 10) / 10 : null;
    const hasTraffic = h.sessions > 0 || h.impressions > 0;
    const flags: HostFlag[] = [];
    if (hasTraffic && h.sitemaps.length === 0) flags.push('traffic_without_sitemap');
    if (!hasTraffic && h.sitemaps.length > 0) flags.push('sitemap_without_traffic');
    if (h.sitemaps.some((s) => (s.errors ?? 0) > 0)) flags.push('sitemap_errors');
    return { ...h, ctr, position, flags };
  });

  rows.sort((a, b) => b.sessions - a.sessions || b.clicks - a.clicks);

  return {
    hosts: rows,
    totals: rows.reduce(
      (t, r) => ({
        sessions: t.sessions + r.sessions,
        activeUsers: t.activeUsers + r.activeUsers,
        keyEvents: t.keyEvents + r.keyEvents,
        clicks: t.clicks + r.clicks,
        impressions: t.impressions + r.impressions,
      }),
      { sessions: 0, activeUsers: 0, keyEvents: 0, clicks: 0, impressions: 0 }
    ),
    excludedHosts: [...excluded].sort(),
  };
}

export const HOST_FLAG_LABELS: Record<HostFlag, string> = {
  traffic_without_sitemap: 'Gets traffic but has no submitted sitemap',
  sitemap_without_traffic: 'Has a sitemap but no traffic in this period',
  sitemap_errors: 'Sitemap has errors in Search Console',
};
