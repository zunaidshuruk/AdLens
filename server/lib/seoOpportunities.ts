/**
 * SEO tools, part 3: turn Search Console numbers into a to-do list (Sprint 36). Pure functions over rows of
 * { query, page, clicks, impressions, ctr (percent), position }.
 */
export interface QueryPageRow { query: string; page: string; clicks: number; impressions: number; ctr: number; position: number }

export interface Opportunity {
  kind: 'striking' | 'low_ctr' | 'no_clicks' | 'cannibal';
  query: string;
  page: string;
  pages?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** Rough extra clicks per period if the fix works. A planning number, not a promise. */
  potentialClicks: number;
  why: string;
  action: string;
}

/** What a typical page earns at each position (percent). A common industry shape, used only to size opportunities. */
const CTR_CURVE = [0, 28, 15, 10, 7, 5, 4, 3, 2.5, 2, 1.7];
export function expectedCtr(position: number): number {
  const p = Math.max(1, position);
  if (p >= 10.5) return Math.max(0.3, 1.7 - (p - 10) * 0.12);
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return lo === hi ? CTR_CURVE[lo] : CTR_CURVE[lo] + (CTR_CURVE[hi] - CTR_CURVE[lo]) * (p - lo);
}
const round = (n: number) => Math.round(n);

export interface OpportunityOptions { minImpressions?: number; limitPerKind?: number }

export function findOpportunities(rows: QueryPageRow[], o: OpportunityOptions = {}): Record<Opportunity['kind'], Opportunity[]> {
  const minImp = o.minImpressions ?? 50;
  const cap = o.limitPerKind ?? 25;
  const out: Record<Opportunity['kind'], Opportunity[]> = { striking: [], low_ctr: [], no_clicks: [], cannibal: [] };
  const clean = rows.filter((r) => r.query && r.page && Number.isFinite(r.impressions) && r.impressions > 0);

  for (const r of clean) {
    if (r.impressions < minImp) continue;
    const base = { query: r.query, page: r.page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
    if (r.position > 7 && r.position <= 20) {
      const target = expectedCtr(4) / 100;
      out.striking.push({ kind: 'striking', ...base, potentialClicks: round(Math.max(0, r.impressions * target - r.clicks)),
        why: `Ranks around position ${r.position.toFixed(1)}, just off the first page's best spots.`,
        action: 'Improve this page for the query: put the query in the title and H1, answer it fully, add internal links to the page, and update the content.' });
    }
    if (r.position <= 10) {
      const exp = expectedCtr(r.position);
      if (r.ctr < exp * 0.6 && r.impressions >= minImp) {
        out.low_ctr.push({ kind: 'low_ctr', ...base, potentialClicks: round(Math.max(0, r.impressions * (exp / 100) - r.clicks)),
          why: `Gets ${r.ctr.toFixed(1)}% of clicks; pages at position ${r.position.toFixed(1)} usually get about ${exp.toFixed(1)}%.`,
          action: 'Rewrite the title and meta description to match what people want and give a reason to click (a number, a benefit, a year).' });
      }
    }
    if (r.clicks === 0 && r.impressions >= minImp * 2 && r.position <= 30) {
      out.no_clicks.push({ kind: 'no_clicks', ...base, potentialClicks: round(r.impressions * (expectedCtr(Math.min(r.position, 10)) / 100)),
        why: 'Shown many times but never clicked.',
        action: 'Check that the page really answers this query, then improve its title and description or write a page that targets it directly.' });
    }
  }

  const byQuery = new Map<string, QueryPageRow[]>();
  for (const r of clean) byQuery.set(r.query.toLowerCase(), [...(byQuery.get(r.query.toLowerCase()) ?? []), r]);
  for (const list of byQuery.values()) {
    const meaningful = list.filter((r) => r.impressions >= minImp / 2).sort((a, b) => b.impressions - a.impressions);
    if (meaningful.length < 2) continue;
    const total = meaningful.reduce((n, r) => n + r.impressions, 0);
    const share = meaningful[1].impressions / total;
    if (share < 0.15) continue;
    const clicks = meaningful.reduce((n, r) => n + r.clicks, 0);
    const best = Math.min(...meaningful.map((r) => r.position));
    out.cannibal.push({ kind: 'cannibal', query: meaningful[0].query, page: meaningful[0].page, pages: meaningful.map((r) => r.page).slice(0, 5), clicks, impressions: total,
      ctr: total ? (clicks / total) * 100 : 0, position: best, potentialClicks: round(Math.max(0, total * (expectedCtr(Math.max(1, best - 1)) / 100) - clicks)),
      why: `${meaningful.length} of your pages compete for this query, which splits the ranking signals.`,
      action: 'Pick the strongest page. Merge or redirect the others into it, or change their focus so each targets a different query.' });
  }

  for (const k of Object.keys(out) as Opportunity['kind'][]) out[k] = out[k].sort((a, b) => b.potentialClicks - a.potentialClicks || b.impressions - a.impressions).slice(0, cap);
  return out;
}
