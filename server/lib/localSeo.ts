/**
 * Local SEO (Sprint 46): where a business shows on Google Maps, seen from a grid of spots around it.
 * Pure helpers here; the routes (routes/local.ts) do the storage and the paid lookups.
 */
import { z } from 'zod';
import type { MapsPlace } from './dataProvider.js';

export const GRID_SIZES = [3, 5, 7] as const;
export const MAX_KEYWORDS = 10;
export const MAX_LOOKUPS_PER_SCAN = 500;
/** Rough price of one live Maps lookup at DataForSEO, in US dollars. Shown as an estimate only. */
export const COST_PER_LOOKUP_USD = 0.002;

export const businessInputSchema = z.object({
  name: z.string().trim().min(2, 'Type the business name').max(100),
  /** Part of the name as it appears on Google, used to spot your own listing in the results. */
  matchName: z.string().trim().max(100).default(''),
  address: z.string().trim().max(200).default(''),
  lat: z.number().finite().min(-85).max(85),
  lng: z.number().finite().min(-180).max(180),
  radiusKm: z.number().finite().min(0.5).max(50).default(3),
  gridSize: z.union([z.literal(3), z.literal(5), z.literal(7)]).default(5),
  keywords: z.array(z.string().trim().min(2).max(80)).min(1, 'Add at least one search phrase').max(MAX_KEYWORDS, `Up to ${MAX_KEYWORDS} phrases`),
  placeId: z.string().trim().max(200).default(''),
});
export type BusinessInput = z.infer<typeof businessInputSchema>;

export interface GridPoint { row: number; col: number; lat: number; lng: number }

/** An even grid of size x size spots centred on the business, covering `radiusKm` out to the edge. */
export function gridPoints(lat: number, lng: number, radiusKm: number, size: number): GridPoint[] {
  const out: GridPoint[] = [];
  const half = (size - 1) / 2;
  const stepKm = size === 1 ? 0 : radiusKm / half;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const dy = (half - r) * stepKm; // north is the top row
      const dx = (c - half) * stepKm;
      out.push({ row: r, col: c, lat: round6(lat + dy / kmPerDegLat), lng: round6(lng + dx / kmPerDegLng) });
    }
  }
  return out;
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Map zoom that roughly fits one grid cell, so each spot sees its own neighbourhood. */
export function zoomFor(radiusKm: number, size: number): number {
  const cellKm = size <= 1 ? radiusKm * 2 : radiusKm / ((size - 1) / 2);
  if (cellKm <= 0.6) return 16;
  if (cellKm <= 1.2) return 15;
  if (cellKm <= 2.5) return 14;
  if (cellKm <= 5) return 13;
  if (cellKm <= 10) return 12;
  return 11;
}

export const lookupsFor = (size: number, keywords: number) => size * size * keywords;
export const costFor = (lookups: number) => Math.round(lookups * COST_PER_LOOKUP_USD * 1000) / 1000;

const norm = (s: string) => s.toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9ঀ-৿ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Which result is the business itself: by Google place id when we know it, otherwise by name. */
export function findOwn(places: MapsPlace[], biz: { name: string; matchName: string; placeId: string }): MapsPlace | null {
  if (biz.placeId) { const byId = places.find((p) => p.placeId && p.placeId === biz.placeId); if (byId) return byId; }
  const needle = norm(biz.matchName || biz.name);
  if (!needle) return null;
  return places.find((p) => { const n = norm(p.name); return n === needle || n.includes(needle) || (needle.length >= 6 && needle.includes(n) && n.length >= 6); }) ?? null;
}

export interface ScanPoint extends GridPoint { ranks: (number | null)[] }
export interface KeywordSummary { keyword: string; avgRank: number | null; top3Share: number; foundShare: number; best: number | null }
export interface ScanSummary { avgRank: number | null; top3Share: number; foundShare: number; keywords: KeywordSummary[] }

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => Math.round(n * 1000) / 10;
/** Average rank counts only the spots where the business appears; "found" is the share of spots where it appears at all. */
export function summarize(points: ScanPoint[], keywords: string[]): ScanSummary {
  const per: KeywordSummary[] = keywords.map((keyword, i) => {
    const all = points.map((p) => p.ranks[i] ?? null);
    const seen = all.filter((x): x is number => x !== null);
    return { keyword, avgRank: seen.length ? r1(seen.reduce((a, b) => a + b, 0) / seen.length) : null, top3Share: all.length ? pct(seen.filter((x) => x <= 3).length / all.length) : 0, foundShare: all.length ? pct(seen.length / all.length) : 0, best: seen.length ? Math.min(...seen) : null };
  });
  const flat = points.flatMap((p) => p.ranks);
  const seen = flat.filter((x): x is number => x !== null);
  return { avgRank: seen.length ? r1(seen.reduce((a, b) => a + b, 0) / seen.length) : null, top3Share: flat.length ? pct(seen.filter((x) => x <= 3).length / flat.length) : 0, foundShare: flat.length ? pct(seen.length / flat.length) : 0, keywords: per };
}

export interface LocalCompetitor { name: string; placeId: string | null; appearances: number; avgRank: number; rating: number | null; reviews: number | null; category: string | null; address: string | null; website: string | null }
export interface CompetitorAccumulator { add(places: MapsPlace[], ownKey: string | null): void; top(limit: number): LocalCompetitor[]; own(): LocalCompetitor | null }
/** Collects who shows up around the business: how often, how high, and their rating and review count from the same lookups. */
export function competitorAccumulator(biz: { name: string; matchName: string; placeId: string }): CompetitorAccumulator {
  const m = new Map<string, { c: LocalCompetitor; sum: number; isOwn: boolean }>();
  return {
    add(places) {
      const own = findOwn(places, biz);
      for (const p of places.slice(0, 20)) {
        const key = p.placeId || norm(p.name);
        if (!key) continue;
        const cur = m.get(key);
        const isOwn = own === p;
        if (cur) { cur.c.appearances++; cur.sum += p.rank; if (p.rating !== null) cur.c.rating = p.rating; if (p.reviews !== null) cur.c.reviews = p.reviews; cur.isOwn = cur.isOwn || isOwn; }
        else m.set(key, { c: { name: p.name, placeId: p.placeId, appearances: 1, avgRank: p.rank, rating: p.rating, reviews: p.reviews, category: p.category, address: p.address, website: p.website }, sum: p.rank, isOwn });
      }
    },
    top(limit) {
      return [...m.values()].filter((x) => !x.isOwn).map((x) => ({ ...x.c, avgRank: r1(x.sum / x.c.appearances) })).sort((a, b) => b.appearances - a.appearances || a.avgRank - b.avgRank).slice(0, limit);
    },
    own() { const x = [...m.values()].find((v) => v.isOwn); return x ? { ...x.c, avgRank: r1(x.sum / x.c.appearances) } : null; },
  };
}

/** Link that opens Google's "write a review" box for a place. */
export const reviewLinkFor = (placeId: string): string => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
