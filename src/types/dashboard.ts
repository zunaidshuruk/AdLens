import type { ExploreSource, ExploreSpec } from './explore.js';

export type WidgetKind = 'kpi' | 'bar' | 'line' | 'table';
export interface WidgetLayout { x: number; y: number; w: number; h: number }

export interface QueryWidget {
  id: string;
  title: string;
  layout: WidgetLayout;
  kind: WidgetKind;
  /** Optional own time range: the last N days, ending on the dashboard's end date. Leave out to follow the page. */
  days?: number;
  source: ExploreSource;
  spec: ExploreSpec;
}
export interface TextWidget { id: string; title: string; layout: WidgetLayout; kind: 'text'; text: string }
export type DashboardWidget = QueryWidget | TextWidget;

export interface DashboardInput { name: string; description: string; widgets: DashboardWidget[] }
export interface Dashboard extends DashboardInput {
  id: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
