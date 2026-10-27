export type ExploreSource = 'ga4' | 'search_console';
export type ExploreColumnType = 'text' | 'integer' | 'decimal' | 'percent' | 'seconds' | 'date' | 'position';
export type ExploreFilterOp = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'startsWith';

export interface ExploreFieldInfo { key: string; label: string; type: ExploreColumnType; group: string }
export interface ExploreCatalogSource { dimensions: ExploreFieldInfo[]; metrics: ExploreFieldInfo[]; maxDimensions: number; maxMetrics: number }
export interface ExploreCatalog { maxRows: number; ga4: ExploreCatalogSource; search_console: ExploreCatalogSource }

export interface ExploreFilter { field: string; op: ExploreFilterOp; value: string }
export interface ExploreOrderBy { field: string; desc: boolean }

/** What a person builds on screen (and what a saved report remembers). Dates are added from the date picker when it runs. */
export interface ExploreSpec {
  dimensions: string[];
  metrics: string[];
  filters: ExploreFilter[];
  orderBy?: ExploreOrderBy;
  limit: number;
}

export interface ExploreColumn { key: string; label: string; type: ExploreColumnType; role: 'dimension' | 'metric' }
export type ExploreCell = string | number | null;
export interface ExploreResult {
  source: ExploreSource;
  columns: ExploreColumn[];
  rows: Record<string, ExploreCell>[];
  totals: Record<string, ExploreCell> | null;
  rowCount: number;
  truncated: boolean;
}

export interface SavedReport {
  id: string;
  name: string;
  source: ExploreSource;
  spec: ExploreSpec;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
