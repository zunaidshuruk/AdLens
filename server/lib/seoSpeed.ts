/**
 * Speed and "after JavaScript" check (Sprint 38), using Google's free PageSpeed Insights service.
 * Google opens the page in a real Chrome, runs its JavaScript and measures it. We turn the answer into plain words:
 * Core Web Vitals (what Google measured on the page, and what real visitors experienced when Google has that data),
 * the SEO checks Lighthouse ran on the finished page, and how much of the page only exists after JavaScript runs.
 * Set PAGESPEED_API_KEY (free, from Google Cloud) for sensible limits; without it Google allows very few tests.
 */
export type Rating = 'good' | 'needs' | 'poor';
export type Strategy = 'mobile' | 'desktop';

export interface SpeedMetric { key: string; label: string; value: number; display: string; rating: Rating; explain: string }
export interface SpeedReport {
  url: string; strategy: Strategy; fetchedAt: string;
  scores: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null };
  lab: SpeedMetric[];
  field: { available: boolean; scope: 'page' | 'site' | 'none'; overall: Rating | null; metrics: SpeedMetric[] };
  opportunities: { id: string; title: string; savingsMs: number; savingsKb: number }[];
  seoFailed: { id: string; title: string; detail: string }[];
  facts: { pageWeightKb: number | null; requests: number | null; domElements: number | null; scriptTimeMs: number | null };
  javascript: { level: 'none' | 'some' | 'heavy'; notes: string[] };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const THRESH: Record<string, [number, number]> = { lcp: [2500, 4000], cls: [0.1, 0.25], tbt: [200, 600], fcp: [1800, 3000], si: [3400, 5800], tti: [3800, 7300], inp: [200, 500], ttfb: [800, 1800] };
export const rate = (key: string, v: number): Rating => { const t = THRESH[key]; return !t ? 'good' : v <= t[0] ? 'good' : v <= t[1] ? 'needs' : 'poor'; };
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const fmt = (key: string, v: number) => (key === 'cls' ? v.toFixed(2) : key === 'tbt' || key === 'inp' ? `${Math.round(v)} ms` : secs(v));

const LAB: { key: string; audit: string; label: string; explain: string }[] = [
  { key: 'lcp', audit: 'largest-contentful-paint', label: 'Main content appears (LCP)', explain: 'How long until the biggest thing on screen is visible. Aim for under 2.5 seconds.' },
  { key: 'cls', audit: 'cumulative-layout-shift', label: 'Page jumping (CLS)', explain: 'How much the page shifts while loading. Aim for under 0.1.' },
  { key: 'tbt', audit: 'total-blocking-time', label: 'Busy time (TBT)', explain: 'How long the page freezes and ignores taps while loading. Stands in for responsiveness. Aim for under 200 ms.' },
  { key: 'fcp', audit: 'first-contentful-paint', label: 'First thing appears (FCP)', explain: 'How long until anything shows. Aim for under 1.8 seconds.' },
  { key: 'si', audit: 'speed-index', label: 'Speed Index', explain: 'How quickly the page fills in. Aim for under 3.4 seconds.' },
  { key: 'tti', audit: 'interactive', label: 'Ready to use (TTI)', explain: 'When the page reliably responds to taps. Aim for under 3.8 seconds.' },
];
const FIELD: { key: string; id: string; label: string; explain: string; scale?: number }[] = [
  { key: 'lcp', id: 'LARGEST_CONTENTFUL_PAINT_MS', label: 'Main content appears (LCP)', explain: 'Real visitors, slowest 25% excluded. Aim for under 2.5 seconds.' },
  { key: 'inp', id: 'INTERACTION_TO_NEXT_PAINT', label: 'Reaction to taps (INP)', explain: 'How fast the page responds when people tap or click. Aim for under 200 ms.' },
  { key: 'cls', id: 'CUMULATIVE_LAYOUT_SHIFT_SCORE', label: 'Page jumping (CLS)', explain: 'How much the page shifts for real visitors. Aim for under 0.1.', scale: 0.01 },
  { key: 'fcp', id: 'FIRST_CONTENTFUL_PAINT_MS', label: 'First thing appears (FCP)', explain: 'Aim for under 1.8 seconds.' },
  { key: 'ttfb', id: 'EXPERIMENTAL_TIME_TO_FIRST_BYTE', label: 'Server answers (TTFB)', explain: 'How fast your server starts replying. Aim for under 0.8 seconds.' },
];
const CATEGORY: Record<string, Rating> = { FAST: 'good', AVERAGE: 'needs', SLOW: 'poor' };

const score100 = (c: Json | undefined): number | null => (typeof c?.score === 'number' ? Math.round(c.score * 100) : null);
const clean = (s: unknown, max: number): string => String(s ?? '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, max);

/** Rough count of elements in the HTML as first delivered (before any JavaScript). */
export const countRawElements = (html: string): number => (html.match(/<[a-z][a-z0-9-]*[\s>/]/gi) ?? []).length;

export function parsePageSpeed(json: Json, strategy: Strategy, raw?: { elements: number; title: string | null; description: string | null }, now = new Date()): SpeedReport {
  const lh: Json = json.lighthouseResult ?? {};
  const audits: Json = lh.audits ?? {};
  const cats: Json = lh.categories ?? {};

  const lab: SpeedMetric[] = [];
  for (const m of LAB) {
    const v = audits[m.audit]?.numericValue;
    if (typeof v === 'number' && Number.isFinite(v)) lab.push({ key: m.key, label: m.label, value: v, display: fmt(m.key, v), rating: rate(m.key, v), explain: m.explain });
  }

  const exp: Json | undefined = json.loadingExperience?.metrics && Object.keys(json.loadingExperience.metrics).length ? json.loadingExperience : json.originLoadingExperience;
  const fieldMetrics: SpeedMetric[] = [];
  if (exp?.metrics) {
    for (const m of FIELD) {
      const p = exp.metrics[m.id]?.percentile;
      if (typeof p !== 'number') continue;
      const v = p * (m.scale ?? 1);
      fieldMetrics.push({ key: m.key, label: m.label, value: v, display: fmt(m.key, v), rating: CATEGORY[exp.metrics[m.id].category] ?? rate(m.key, v), explain: m.explain });
    }
  }
  const usedOrigin = !json.loadingExperience?.metrics || Object.keys(json.loadingExperience.metrics).length === 0;
  const field = { available: fieldMetrics.length > 0, scope: (fieldMetrics.length === 0 ? 'none' : usedOrigin || json.loadingExperience?.origin_fallback ? 'site' : 'page') as 'page' | 'site' | 'none', overall: CATEGORY[exp?.overall_category ?? ''] ?? null, metrics: fieldMetrics };

  const opportunities = Object.values(audits)
    .filter((a: Json) => a?.details?.type === 'opportunity' && (a.details.overallSavingsMs ?? 0) >= 100)
    .map((a: Json) => ({ id: String(a.id), title: clean(a.title, 90), savingsMs: Math.round(a.details.overallSavingsMs), savingsKb: Math.round((a.details.overallSavingsBytes ?? 0) / 1024) }))
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 6);

  const seoRefs: { id: string }[] = cats.seo?.auditRefs ?? [];
  const seoFailed = seoRefs
    .map((r) => audits[r.id] as Json | undefined)
    .filter((a): a is Json => a !== undefined && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual' && a.scoreDisplayMode !== 'informative' && typeof a.score === 'number' && a.score < 1)
    .map((a) => ({ id: String(a.id), title: clean(a.title, 100), detail: clean(a.description, 200) }))
    .slice(0, 10);

  const num = (id: string, pick: (a: Json) => unknown = (a) => a.numericValue): number | null => { const v = audits[id] ? pick(audits[id]) : null; return typeof v === 'number' && Number.isFinite(v) ? v : null; };
  const weight = num('total-byte-weight');
  const facts = {
    pageWeightKb: weight === null ? null : Math.round(weight / 1024),
    requests: num('network-requests', (a) => (Array.isArray(a.details?.items) ? a.details.items.length : null)),
    domElements: num('dom-size'),
    scriptTimeMs: (() => { const v = num('bootup-time'); return v === null ? null : Math.round(v); })(),
  };

  // How much of the page only exists once JavaScript has run?
  const notes: string[] = [];
  let level: 'none' | 'some' | 'heavy' = 'none';
  if (raw) {
    const rendered = facts.domElements ?? 0;
    if (raw.elements > 0 && rendered - raw.elements > 100 && rendered >= raw.elements * 3) {
      level = 'heavy';
      notes.push(`Most of this page is built by JavaScript after it loads (about ${rendered.toLocaleString()} elements once loaded, but only about ${raw.elements.toLocaleString()} in the first HTML). Google can usually read this but may be slower to index it, and some other crawlers and AI tools may see a nearly empty page.`);
    } else if (raw.elements > 0 && rendered - raw.elements > 100 && rendered >= raw.elements * 1.5) {
      level = 'some';
      notes.push('Part of this page is added by JavaScript after it loads. That is normal, but make sure your main text and links are in the first HTML.');
    }
    const titleOk = audits['document-title']?.score === 1;
    const descOk = audits['meta-description']?.score === 1;
    if (titleOk && !raw.title) { if (level === 'none') level = 'some'; notes.push('The page title is added by JavaScript. It is missing from the first HTML, so tools that do not run JavaScript will not see it.'); }
    if (descOk && !raw.description) { if (level === 'none') level = 'some'; notes.push('The meta description is added by JavaScript. It is missing from the first HTML.'); }
  }
  if (notes.length === 0) notes.push('The important parts of this page are in the first HTML, so search engines and other tools can read it without running JavaScript.');

  return {
    url: String(lh.finalDisplayedUrl ?? lh.finalUrl ?? json.id ?? ''), strategy, fetchedAt: now.toISOString(),
    scores: { performance: score100(cats.performance), seo: score100(cats.seo), accessibility: score100(cats.accessibility), bestPractices: score100(cats['best-practices']) },
    lab, field, opportunities, seoFailed, facts, javascript: { level, notes },
  };
}

export type PsiRequest = (url: string) => Promise<{ status: number; text: string }>;
export class SpeedError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const productionPsiRequest: PsiRequest = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(85_000), headers: { accept: 'application/json' } });
  return { status: res.status, text: await res.text() };
};

export async function runPageSpeed(url: string, strategy: Strategy, deps: { request?: PsiRequest; apiKey?: string } = {}): Promise<Json> {
  const q = new URLSearchParams({ url, strategy, locale: 'en' });
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) q.append('category', c);
  if (deps.apiKey) q.set('key', deps.apiKey);
  let res: { status: number; text: string };
  try { res = await (deps.request ?? productionPsiRequest)(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q.toString()}`); }
  catch { throw new SpeedError(504, 'SPEED_TIMEOUT', 'Google took too long to test this page. Try again in a minute.'); }
  let body: Json = {};
  try { body = JSON.parse(res.text); } catch { /* not JSON */ }
  if (res.status === 429) throw new SpeedError(429, 'SPEED_BUSY', deps.apiKey ? 'Google is limiting speed tests right now. Try again in a few minutes.' : "Google's free speed test is busy. The owner can fix this by adding a free PAGESPEED_API_KEY to the server. Try again in a few minutes.");
  if (res.status === 400 || res.status === 404 || res.status === 500) {
    const reason = String(body?.error?.message ?? '');
    if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS|NO_FCP|UNREACHABLE/i.test(reason) || res.status === 400) throw new SpeedError(422, 'SPEED_PAGE_UNREACHABLE', "Google could not open that page. Check the address is public (not behind a login) and try again.");
  }
  if (res.status === 403) throw new SpeedError(502, 'SPEED_KEY_REJECTED', 'The speed test key was refused by Google. Check PAGESPEED_API_KEY and that the PageSpeed Insights API is turned on for it.');
  if (res.status < 200 || res.status >= 300 || !body.lighthouseResult) throw new SpeedError(502, 'SPEED_FAILED', 'The speed test could not run right now. Try again in a minute.');
  return body;
}
