import type { ExploreCatalogSource, ExploreFilter, ExploreSource, ExploreSpec } from '../types/explore.js';

export const DEFAULT_LIMIT = 100;

/** A sensible first report for an uploaded table: break down by its first text or date column, count the rows. */
export function defaultDataSpec(ds: { id: string; columns: { key: string; type: string }[] } | undefined): ExploreSpec {
  const dim = ds?.columns.find((c) => c.type !== 'number') ?? ds?.columns[0];
  return { dimensions: dim ? [dim.key] : [], metrics: ['__rows'], filters: [], limit: DEFAULT_LIMIT, datasetId: ds?.id, aggregate: 'sum' };
}

export function defaultSpec(source: ExploreSource): ExploreSpec {
  if (source === 'data') return defaultDataSpec(undefined);
  if (source === 'meta') return { dimensions: ['campaign'], metrics: ['spend', 'impressions', 'clicks'], filters: [], limit: DEFAULT_LIMIT };
  return source === 'ga4'
    ? { dimensions: ['sessionDefaultChannelGroup'], metrics: ['sessions', 'totalUsers'], filters: [], limit: DEFAULT_LIMIT }
    : { dimensions: ['query'], metrics: ['clicks', 'impressions'], filters: [], limit: DEFAULT_LIMIT };
}

/** Adds or removes `key` from a list, respecting the maximum. Returns the same list when the limit is reached. */
export function toggleField(list: string[], key: string, max: number): string[] {
  if (list.includes(key)) return list.filter((k) => k !== key);
  return list.length >= max ? list : [...list, key];
}

export function moveField(list: string[], key: string, delta: -1 | 1): string[] {
  const i = list.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Plain-English problems with the report as built, or an empty list when it can run. */
export function validateSpec(spec: ExploreSpec, cat: ExploreCatalogSource): string[] {
  const problems: string[] = [];
  if (spec.metrics.length === 0) problems.push('Pick at least one number to measure (a metric).');
  if (spec.metrics.length > cat.maxMetrics) problems.push(`Pick at most ${cat.maxMetrics} metrics.`);
  if (spec.dimensions.length > cat.maxDimensions) problems.push(`Pick at most ${cat.maxDimensions} breakdowns (dimensions).`);
  if (spec.filters.some((f) => f.value.trim() === '')) problems.push('Fill in the value of every filter, or remove the empty one.');
  if (spec.orderBy && ![...spec.metrics, ...spec.dimensions].includes(spec.orderBy.field)) problems.push('Sort by a column that is in the report.');
  return problems;
}

/** Keeps the sort column valid after the person adds or removes columns. */
export function normaliseSpec(spec: ExploreSpec): ExploreSpec {
  const cols = [...spec.metrics, ...spec.dimensions];
  const orderBy = spec.orderBy && cols.includes(spec.orderBy.field) ? spec.orderBy : undefined;
  return { ...spec, ...(orderBy ? { orderBy } : { orderBy: undefined }) };
}

export function buildRunRequest(spec: ExploreSpec, range: { startDate: string; endDate: string }) {
  const clean: ExploreFilter[] = spec.filters.map((f) => ({ ...f, value: f.value.trim() }));
  const body: Record<string, unknown> = {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: spec.dimensions,
    metrics: spec.metrics,
    filters: clean,
    limit: spec.limit,
  };
  if (spec.orderBy && [...spec.metrics, ...spec.dimensions].includes(spec.orderBy.field)) body.orderBy = spec.orderBy;
  if (spec.datasetId) { body.datasetId = spec.datasetId; body.aggregate = spec.aggregate ?? 'sum'; }
  return body;
}

/** Removes anything in a saved spec that the current catalogue no longer offers (a field retired in a later version). */
export function sanitiseSavedSpec(spec: ExploreSpec, cat: ExploreCatalogSource): ExploreSpec {
  const dims = new Set(cat.dimensions.map((d) => d.key));
  const mets = new Set(cat.metrics.map((m) => m.key));
  return normaliseSpec({
    ...spec,
    dimensions: spec.dimensions.filter((d) => dims.has(d)),
    metrics: spec.metrics.filter((m) => mets.has(m)),
    filters: spec.filters.filter((f) => dims.has(f.field)),
  });
}

export function sameSpec(a: ExploreSpec, b: ExploreSpec): boolean {
  return JSON.stringify(normaliseSpec(a)) === JSON.stringify(normaliseSpec(b));
}
