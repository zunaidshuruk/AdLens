import { findMetricKey, getMetricInfo, type MetricSource } from '../config/metricGlossary.js';

export interface MetricTip {
  key: string;
  title: string;
  definition: string;
  formula: string | null;
  note: string | null;
  sourceName: string;
  /** One short sentence saying which direction is good, or null when it does not matter. */
  direction: string | null;
}

type AppSource = 'ga4' | 'search_console' | 'meta_ads';

const SOURCE_TO_GLOSSARY: Record<AppSource, MetricSource> = {
  ga4: 'ga4',
  search_console: 'search_console',
  meta_ads: 'meta',
};

const SOURCE_NAMES: Record<MetricSource, string> = {
  ga4: 'Google Analytics 4',
  search_console: 'Search Console',
  meta: 'Meta Ads',
  adlens: 'AdLens',
};

const DIRECTION_TEXT = {
  higher: 'A higher number is better.',
  lower: 'A lower number is better.',
  neutral: null,
} as const;

/** Looks up the plain-language explanation for a KPI label. Returns null when we have none (no "i" is shown). */
export function resolveMetricTip(label: string, source?: AppSource, explicitKey?: string): MetricTip | null {
  const key = explicitKey ?? findMetricKey(label, source ? SOURCE_TO_GLOSSARY[source] : undefined);
  if (!key) return null;
  const info = getMetricInfo(key);
  if (!info) return null;
  return {
    key,
    title: info.label,
    definition: info.definition,
    formula: info.formula ?? null,
    note: info.note ?? null,
    sourceName: SOURCE_NAMES[info.source],
    direction: DIRECTION_TEXT[info.better],
  };
}
