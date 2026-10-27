/** Joins Google Analytics 4 page rows with Search Console page rows by URL path. Pure functions. */

export interface Ga4PageInput {
  path: string;
  title?: string;
  views: number;
  users: number;
  engagementSeconds: number; // total user engagement duration
  keyEvents: number;
}

export interface SearchPageInput {
  page: string; // full URL
  clicks: number;
  impressions: number;
  position: number;
}

export type PageFlag = 'search_only' | 'analytics_only' | 'seen_not_clicked';

export interface JoinedPageRow {
  path: string;
  title: string | null;
  views: number | null;
  users: number | null;
  avgEngagementSeconds: number | null;
  keyEvents: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null; // percent
  position: number | null;
  flags: PageFlag[];
}

export const PAGE_FLAG_LABELS: Record<PageFlag, string> = {
  search_only: 'Appears in Google Search but has no recorded visits in analytics',
  analytics_only: 'Gets visits but does not appear in Google Search results',
  seen_not_clicked: 'Shown often in Google Search but rarely clicked',
};

/** "https://www.example.com/a/b/?x=1#top" and "/a/b" both become "/a/b". The home page stays "/". */
export function normalisePath(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      return '';
    }
  }
  s = s.split('#')[0].split('?')[0];
  try {
    s = decodeURI(s);
  } catch {
    // keep as is
  }
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s || '/';
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function joinPages(
  ga4Rows: Ga4PageInput[],
  searchRows: SearchPageInput[],
  opts: { limit?: number; seenNotClickedImpressions?: number; seenNotClickedCtrPercent?: number } = {},
): JoinedPageRow[] {
  const minImpr = opts.seenNotClickedImpressions ?? 200;
  const maxCtr = opts.seenNotClickedCtrPercent ?? 1;
  const map = new Map<string, JoinedPageRow & { engagementTotal: number; positionWeight: number }>();
  const get = (path: string) => {
    let r = map.get(path);
    if (!r) {
      r = {
        path, title: null, views: null, users: null, avgEngagementSeconds: null, keyEvents: null,
        clicks: null, impressions: null, ctr: null, position: null, flags: [], engagementTotal: 0, positionWeight: 0,
      };
      map.set(path, r);
    }
    return r;
  };

  for (const g of ga4Rows) {
    const path = normalisePath(g.path);
    if (!path) continue;
    const r = get(path);
    r.views = (r.views ?? 0) + g.views;
    r.users = (r.users ?? 0) + g.users;
    r.keyEvents = (r.keyEvents ?? 0) + g.keyEvents;
    r.engagementTotal += g.engagementSeconds;
    if (!r.title && g.title && g.title !== '(not set)') r.title = g.title;
  }
  for (const s of searchRows) {
    const path = normalisePath(s.page);
    if (!path) continue;
    const r = get(path);
    r.clicks = (r.clicks ?? 0) + s.clicks;
    r.impressions = (r.impressions ?? 0) + s.impressions;
    r.positionWeight += s.position * s.impressions;
  }

  const rows = [...map.values()].map(({ engagementTotal, positionWeight, ...r }) => {
    if (r.users && r.users > 0) r.avgEngagementSeconds = round(engagementTotal / r.users, 1);
    else if (r.users !== null) r.avgEngagementSeconds = 0;
    if (r.impressions !== null) {
      r.ctr = r.impressions > 0 ? round(((r.clicks ?? 0) / r.impressions) * 100, 2) : 0;
      r.position = r.impressions > 0 ? round(positionWeight / r.impressions, 1) : null;
    }
    const flags: PageFlag[] = [];
    if (r.views === null && (r.impressions ?? 0) > 0) flags.push('search_only');
    if (r.impressions === null && (r.views ?? 0) > 0) flags.push('analytics_only');
    if ((r.impressions ?? 0) >= minImpr && (r.ctr ?? 0) < maxCtr) flags.push('seen_not_clicked');
    return { ...r, flags };
  });

  rows.sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || (b.clicks ?? 0) - (a.clicks ?? 0) || (b.impressions ?? 0) - (a.impressions ?? 0));
  return rows.slice(0, opts.limit ?? 200);
}
