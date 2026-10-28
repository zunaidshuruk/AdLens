/**
 * Backlink audit and gap (Sprint 41). Runs in the browser on files you provide, for example the Search Console "Links" export
 * or a referring-domain list from any tool you already use. We do not own a link database, so nothing here is discovered by us.
 */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

export function domainOf(input: string): string | null {
  const raw = input.trim().replace(/^["']|["']$/g, '');
  if (!raw || /\s/.test(raw)) return null;
  let host: string;
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname; } catch { return null; }
  host = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  const parts = host.split('.');
  if (parts.length >= 3 && parts[parts.length - 1]!.length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]!)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); if (row.some((x) => x.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export interface LinkEntry { domain: string; source: string; count: number; anchor: string; target: string }

/** Accepts a CSV with a header (Site/Domain/Source…, optional count, anchor and target columns) or a plain list of addresses. */
export function parseLinks(text: string): { entries: LinkEntry[]; skipped: number } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { entries: [], skipped: 0 };
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const srcIdx = find(/^(site|domain|referring domain|source( url| page)?|linking (site|page|domain)|from|url|top linking sites)$|linking.*(site|page|domain)|referring/);
  const hasHeader = srcIdx >= 0 && head.some((h) => /[a-z]/.test(h)) && domainOf(rows[0]![srcIdx]!) === null;
  const idx = hasHeader ? srcIdx : 0;
  const cntIdx = hasHeader ? find(/(linking pages|links|backlinks|count|incoming|number)/) : -1;
  const ancIdx = hasHeader ? find(/(anchor|link text|text)/) : -1;
  const tgtIdx = hasHeader ? find(/(target|linked page|destination|to url)/) : -1;
  const entries: LinkEntry[] = []; let skipped = 0;
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const src = (r[idx] ?? '').trim();
    const d = domainOf(src);
    if (!d) { skipped++; continue; }
    const c = cntIdx >= 0 ? Number((r[cntIdx] ?? '').replace(/[^\d.]/g, '')) : NaN;
    entries.push({ domain: d, source: src, count: Number.isFinite(c) && c > 0 ? Math.round(c) : 1, anchor: ancIdx >= 0 ? (r[ancIdx] ?? '').trim() : '', target: tgtIdx >= 0 ? (r[tgtIdx] ?? '').trim() : '' });
  }
  return { entries, skipped };
}

const RISKY_TLD = new Set(['xyz', 'top', 'click', 'loan', 'work', 'gq', 'cf', 'tk', 'ml', 'ga', 'icu', 'buzz', 'rest', 'monster', 'cyou', 'bid', 'win', 'stream', 'download', 'men', 'date', 'party', 'review', 'cam', 'sbs']);
const RISKY_WORDS = /(casino|porn|xxx|sex|viagra|cialis|payday|loan|betting|poker|escort|pharma|replica|essay|backlink|seo-?service|crack|torrent|adult|dating|slot)/i;
const SPAM_ANCHOR = /(casino|viagra|cialis|payday|loan|porn|escort|replica|cheap|buy now|click here for|crypto signal|essay)/i;
const GENERIC_ANCHOR = /^(click here|here|read more|more|link|website|visit|this|source|learn more|homepage|home)$/i;

export interface DomainRow { domain: string; links: number; risk: number; reasons: string[] }
export interface AuditReport {
  referringDomains: number; totalLinks: number; skipped: number;
  topDomains: { domain: string; links: number }[]; tlds: { tld: string; domains: number }[];
  anchors: { text: string; links: number; type: 'link address' | 'generic' | 'spammy' | 'descriptive' }[];
  risky: DomainRow[]; riskyCount: number;
}

export function auditLinks(entries: LinkEntry[]): AuditReport {
  const by = new Map<string, number>();
  const anchors = new Map<string, number>();
  for (const e of entries) {
    by.set(e.domain, (by.get(e.domain) ?? 0) + e.count);
    if (e.anchor) anchors.set(e.anchor.toLowerCase(), (anchors.get(e.anchor.toLowerCase()) ?? 0) + e.count);
  }
  const tld = new Map<string, number>();
  const risky: DomainRow[] = [];
  for (const [domain, links] of by) {
    const t = domain.split('.').pop()!;
    tld.set(t, (tld.get(t) ?? 0) + 1);
    const label = domain.split('.')[0]!;
    const reasons: string[] = []; let risk = 0;
    if (RISKY_TLD.has(t)) { risk += 30; reasons.push(`.${t} addresses are often used for spam`); }
    if (RISKY_WORDS.test(domain)) { risk += 45; reasons.push('the name suggests adult, gambling, pills or link-selling content'); }
    if ((label.match(/-/g) ?? []).length >= 3) { risk += 15; reasons.push('many hyphens in the name'); }
    if (label.length > 28) { risk += 10; reasons.push('very long name'); }
    if (/\d/.test(label) && (label.match(/\d/g) ?? []).length / label.length > 0.4) { risk += 20; reasons.push('mostly numbers'); }
    if (links >= 100) { risk += 15; reasons.push(`${links} links from one site (often sitewide or automated)`); }
    if (risk >= 30) risky.push({ domain, links, risk: Math.min(100, risk), reasons });
  }
  risky.sort((a, b) => b.risk - a.risk || b.links - a.links);
  const type = (t: string): AuditReport['anchors'][number]['type'] => (/^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i.test(t) ? 'link address' : GENERIC_ANCHOR.test(t) ? 'generic' : SPAM_ANCHOR.test(t) ? 'spammy' : 'descriptive');
  return {
    referringDomains: by.size, totalLinks: [...by.values()].reduce((a, b) => a + b, 0), skipped: 0,
    topDomains: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([domain, links]) => ({ domain, links })),
    tlds: [...tld.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, domains]) => ({ tld: `.${t}`, domains })),
    anchors: [...anchors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([text, links]) => ({ text, links, type: type(text) })),
    risky: risky.slice(0, 100), riskyCount: risky.length,
  };
}

/** The text file Google's Disavow tool accepts. Disavowing is rarely needed and can hurt; review each line first. */
export function disavowFile(domains: string[]): string {
  return ['# Disavow file made with AdLens. Review every line before uploading to Google Search Console.', ...[...new Set(domains)].sort().map((d) => `domain:${d}`)].join('\n') + '\n';
}

export interface GapRow { domain: string; linksToCompetitors: number; competitors: string[] }
/** Sites that link to your competitors but not to you. Ordered by how many competitors they link to. */
export function linkGap(yours: Set<string>, competitors: { name: string; domains: Set<string> }[], exclude: string[] = []): GapRow[] {
  const skip = new Set(exclude.map((e) => domainOf(e) ?? e));
  const map = new Map<string, string[]>();
  for (const c of competitors) for (const d of c.domains) {
    if (yours.has(d) || skip.has(d)) continue;
    const list = map.get(d) ?? []; list.push(c.name); map.set(d, list);
  }
  return [...map.entries()].map(([domain, names]) => ({ domain, linksToCompetitors: names.length, competitors: names })).sort((a, b) => b.linksToCompetitors - a.linksToCompetitors || a.domain.localeCompare(b.domain));
}
