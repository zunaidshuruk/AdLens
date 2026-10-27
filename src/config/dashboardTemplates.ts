import type { DashboardInput, DashboardWidget } from '../types/dashboard.js';

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  /** Which connections the template needs to show real numbers. */
  needs: ('ga4' | 'search_console')[];
  widgets: DashboardWidget[];
}

const ga = (id: string, title: string, kind: 'kpi' | 'bar' | 'line' | 'table', x: number, y: number, w: number, h: number, dimensions: string[], metrics: string[], extra: { limit?: number; orderBy?: { field: string; desc: boolean } } = {}): DashboardWidget => ({
  id, title, kind, source: 'ga4', layout: { x, y, w, h },
  spec: { dimensions, metrics, filters: [], limit: extra.limit ?? 10, ...(extra.orderBy ? { orderBy: extra.orderBy } : {}) },
});
const sc = (id: string, title: string, kind: 'kpi' | 'bar' | 'line' | 'table', x: number, y: number, w: number, h: number, dimensions: string[], metrics: string[], extra: { limit?: number; orderBy?: { field: string; desc: boolean } } = {}): DashboardWidget => ({
  id, title, kind, source: 'search_console', layout: { x, y, w, h },
  spec: { dimensions, metrics, filters: [], limit: extra.limit ?? 10, ...(extra.orderBy ? { orderBy: extra.orderBy } : {}) },
});

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: 'traffic-health',
    name: 'Website traffic health',
    description: 'Visitors, sessions and engagement at a glance, with where they come from and which pages they read.',
    needs: ['ga4'],
    widgets: [
      ga('k-sessions', 'Sessions', 'kpi', 0, 0, 3, 2, [], ['sessions']),
      ga('k-users', 'Users', 'kpi', 3, 0, 3, 2, [], ['totalUsers']),
      ga('k-engage', 'Engagement rate', 'kpi', 6, 0, 3, 2, [], ['engagementRate']),
      ga('k-events', 'Key events', 'kpi', 9, 0, 3, 2, [], ['keyEvents']),
      ga('l-trend', 'Sessions over time', 'line', 0, 2, 12, 4, ['date'], ['sessions'], { limit: 400, orderBy: { field: 'date', desc: false } }),
      ga('b-channel', 'Sessions by channel', 'bar', 0, 6, 6, 4, ['sessionDefaultChannelGroup'], ['sessions'], { orderBy: { field: 'sessions', desc: true } }),
      ga('t-pages', 'Top pages', 'table', 6, 6, 6, 5, ['pagePath'], ['screenPageViews', 'engagementRate'], { orderBy: { field: 'screenPageViews', desc: true } }),
    ],
  },
  {
    id: 'seo-performance',
    name: 'Search performance',
    description: 'Clicks, impressions and position from Google Search, with your best queries and pages.',
    needs: ['search_console'],
    widgets: [
      sc('k-clicks', 'Clicks', 'kpi', 0, 0, 3, 2, [], ['clicks']),
      sc('k-impr', 'Impressions', 'kpi', 3, 0, 3, 2, [], ['impressions']),
      sc('k-ctr', 'Click-through rate', 'kpi', 6, 0, 3, 2, [], ['ctr']),
      sc('k-pos', 'Average position', 'kpi', 9, 0, 3, 2, [], ['position']),
      sc('l-clicks', 'Clicks over time', 'line', 0, 2, 12, 4, ['date'], ['clicks'], { limit: 400, orderBy: { field: 'date', desc: false } }),
      sc('t-queries', 'Top queries', 'table', 0, 6, 6, 5, ['query'], ['clicks', 'impressions', 'position'], { orderBy: { field: 'clicks', desc: true } }),
      sc('t-pages', 'Top pages', 'table', 6, 6, 6, 5, ['page'], ['clicks', 'impressions'], { orderBy: { field: 'clicks', desc: true } }),
    ],
  },
  {
    id: 'audience',
    name: 'Audience and devices',
    description: 'Who your visitors are: countries, devices and new versus returning.',
    needs: ['ga4'],
    widgets: [
      ga('k-users', 'Users', 'kpi', 0, 0, 4, 2, [], ['totalUsers']),
      ga('k-new', 'New users', 'kpi', 4, 0, 4, 2, [], ['newUsers']),
      ga('k-dur', 'Avg. session duration', 'kpi', 8, 0, 4, 2, [], ['averageSessionDuration']),
      ga('b-country', 'Users by country', 'bar', 0, 2, 6, 5, ['country'], ['totalUsers'], { orderBy: { field: 'totalUsers', desc: true } }),
      ga('b-device', 'Sessions by device', 'bar', 6, 2, 6, 5, ['deviceCategory'], ['sessions'], { orderBy: { field: 'sessions', desc: true } }),
    ],
  },
  {
    id: 'owner-snapshot',
    name: 'Owner snapshot',
    description: 'One screen for the boss: website visits next to search clicks, plus a note you can edit.',
    needs: ['ga4', 'search_console'],
    widgets: [
      { id: 'note', title: 'This week', kind: 'text', text: 'Edit this note to say what matters this week.', layout: { x: 0, y: 0, w: 12, h: 2 } },
      ga('k-sessions', 'Sessions', 'kpi', 0, 2, 3, 2, [], ['sessions']),
      ga('k-users', 'Users', 'kpi', 3, 2, 3, 2, [], ['totalUsers']),
      sc('k-clicks', 'Search clicks', 'kpi', 6, 2, 3, 2, [], ['clicks']),
      sc('k-impr', 'Search impressions', 'kpi', 9, 2, 3, 2, [], ['impressions']),
      ga('l-sessions', 'Sessions over time', 'line', 0, 4, 6, 4, ['date'], ['sessions'], { limit: 400, orderBy: { field: 'date', desc: false } }),
      sc('l-clicks', 'Search clicks over time', 'line', 6, 4, 6, 4, ['date'], ['clicks'], { limit: 400, orderBy: { field: 'date', desc: false } }),
    ],
  },
];

export function templateToInput(t: DashboardTemplate): DashboardInput {
  return { name: t.name, description: t.description, widgets: JSON.parse(JSON.stringify(t.widgets)) as DashboardWidget[] };
}
