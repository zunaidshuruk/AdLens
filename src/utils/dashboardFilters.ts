import type { ExploreFilter, ExploreSource, ExploreSpec } from '../types/explore.js';

/** Filters that sit above a dashboard and apply to every panel that supports them. */
export interface DashboardFilters { country?: string; campaign?: string; device?: string }

export const DEVICE_OPTIONS = ['desktop', 'mobile', 'tablet'] as const;
const MAX_FILTERS_PER_PANEL = 5;
const clip = (v: string | null | undefined) => (v ?? '').trim().slice(0, 100);

export function parseFilters(params: URLSearchParams): DashboardFilters {
  const country = clip(params.get('country'));
  const campaign = clip(params.get('campaign'));
  const device = clip(params.get('device')).toLowerCase();
  return {
    ...(country ? { country } : {}),
    ...(campaign ? { campaign } : {}),
    ...((DEVICE_OPTIONS as readonly string[]).includes(device) ? { device } : {}),
  };
}

export function writeFilters(params: URLSearchParams, f: DashboardFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of ['country', 'campaign', 'device'] as const) {
    const v = clip(f[k]);
    if (v) next.set(k, v); else next.delete(k);
  }
  return next;
}

export const activeFilterCount = (f: DashboardFilters) => (['country', 'campaign', 'device'] as const).filter((k) => clip(f[k])).length;

/** The extra filters one panel receives. Campaign only exists in GA4, so Search Console panels ignore it. */
export function filtersForSource(source: ExploreSource, f: DashboardFilters): ExploreFilter[] {
  const out: ExploreFilter[] = [];
  const country = clip(f.country);
  const campaign = clip(f.campaign);
  const device = clip(f.device).toLowerCase();
  if (country) out.push({ field: 'country', op: 'equals', value: country });
  if (campaign && source === 'ga4') out.push({ field: 'sessionCampaignName', op: 'contains', value: campaign });
  if (device) out.push({ field: source === 'ga4' ? 'deviceCategory' : 'device', op: 'equals', value: source === 'ga4' ? device : device.toUpperCase() });
  return out;
}

/** Adds the dashboard filters to a panel's own filters (never more than the 5 a report may have). */
export function applyDashboardFilters(source: ExploreSource, spec: ExploreSpec, f: DashboardFilters): ExploreSpec {
  const extra = filtersForSource(source, f);
  if (extra.length === 0) return spec;
  const room = Math.max(0, MAX_FILTERS_PER_PANEL - spec.filters.length);
  return { ...spec, filters: [...spec.filters, ...extra.slice(0, room)] };
}
