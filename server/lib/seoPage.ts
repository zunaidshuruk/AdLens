/**
 * SEO tools, part 1: read one web page and say what is good and what to fix (Sprint 36).
 * Pure functions: `analyzeHtml` pulls facts out of the HTML, `pageIssues` turns facts into a plain-language fix list.
 * Fetching lives elsewhere (seoFetch.ts) so everything here can be tested with plain strings.
 */

export type Severity = 'error' | 'warning' | 'info';
export interface SeoIssue { id: string; severity: Severity; title: string; detail: string; fix: string }

export interface FetchMeta {
  status: number;
  contentType?: string;
  /** x-robots-tag header, if any. */
  xRobots?: string;
  ms: number;
  bytes: number;
  /** Where the address redirected to, when it did. */
  redirectTo?: string;
}

export interface LinkFact { href: string; text: string; nofollow: boolean; internal: boolean }
export interface PageFacts {
  url: string;
  status: number;
  ms: number;
  bytes: number;
  redirectTo?: string;
  title: string | null;
  description: string | null;
  h1: string[];
  h2Count: number;
  canonical: string | null;
  robotsMeta: string | null;
  noindex: boolean;
  lang: string | null;
  viewport: boolean;
  wordCount: number;
  images: { total: number; missingAlt: number; missingSize: number };
  links: LinkFact[];
  og: { title: boolean; description: boolean; image: boolean };
  twitterCard: boolean;
  structuredData: string[];
  hreflangCount: number;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d{1,6});/g, (_, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; });
}
const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

const hostKey = (h: string) => h.toLowerCase().replace(/^www\./, '');

/** Resolves a link against the page address. Returns null for links that are not web pages (mailto, javascript, tel, #). */
export function resolveLink(href: string, base: URL): URL | null {
  const h = href.trim();
  if (!h || h.startsWith('#') || /^(mailto:|tel:|javascript:|data:|sms:|whatsapp:)/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u;
  } catch { return null; }
}

export function analyzeHtml(html: string, pageUrl: string, meta: FetchMeta): PageFacts {
  const base = new URL(pageUrl);
  const noComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const head = /<head[\s>][\s\S]*?<\/head>/i.exec(noComments)?.[0] ?? noComments.slice(0, 60_000);

  const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = titleM ? clean(titleM[1]) : null;

  const metas: Record<string, string>[] = (head.match(/<meta\b[^>]*>/gi) ?? []).map(parseAttrs);
  const metaByName = (n: string) => metas.find((m) => (m.name ?? '').toLowerCase() === n)?.content;
  const metaByProp = (p: string) => metas.find((m) => (m.property ?? '').toLowerCase() === p)?.content;
  const description = (metaByName('description') ?? '').trim() || null;
  const robotsMeta = metaByName('robots') ?? null;

  const linkTags: Record<string, string>[] = (head.match(/<link\b[^>]*>/gi) ?? []).map(parseAttrs);
  const canonical = linkTags.find((l) => (l.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))?.href?.trim() || null;
  const hreflangCount = linkTags.filter((l) => (l.rel ?? '').toLowerCase() === 'alternate' && l.hreflang).length;

  const noindex = /noindex/i.test(robotsMeta ?? '') || /noindex/i.test(meta.xRobots ?? '');
  const lang = /<html\b[^>]*>/i.exec(noComments) ? parseAttrs(/<html\b[^>]*>/i.exec(noComments)![0]).lang?.trim() || null : null;

  const jsonLd = [...noComments.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)];
  const structuredData: string[] = [];
  for (const m of jsonLd) {
    try {
      const walk = (v: unknown) => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          const t = o['@type'];
          if (typeof t === 'string') structuredData.push(t); else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && structuredData.push(x));
          if (o['@graph']) walk(o['@graph']);
        }
      };
      walk(JSON.parse(m[1]));
    } catch { structuredData.push('(unreadable)'); }
  }

  const body = noComments.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const h1 = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1])).filter(Boolean);
  const h2Count = (body.match(/<h2\b/gi) ?? []).length;

  const imgs = (body.match(/<img\b[^>]*>/gi) ?? []).map(parseAttrs);
  const images = {
    total: imgs.length,
    // An empty alt="" is a valid way to mark a decorative image; only a missing alt counts.
    missingAlt: imgs.filter((i) => !('alt' in i)).length,
    missingSize: imgs.filter((i) => !(i.width && i.height)).length,
  };

  const links: LinkFact[] = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = parseAttrs(`<a ${m[1]}>`);
    const u = a.href ? resolveLink(a.href, base) : null;
    if (!u) continue;
    const altText = /<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i.exec(m[2])?.[1] ?? '';
    links.push({ href: u.toString(), text: clean(m[2]) || decodeEntities(altText).trim() || (a['aria-label'] ?? '').trim(), nofollow: /nofollow/i.test(a.rel ?? ''), internal: hostKey(u.hostname) === hostKey(base.hostname) });
  }

  const text = clean(body.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, ' '));
  const wordCount = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;

  return {
    url: pageUrl, status: meta.status, ms: meta.ms, bytes: meta.bytes, ...(meta.redirectTo ? { redirectTo: meta.redirectTo } : {}),
    title, description, h1, h2Count, canonical, robotsMeta, noindex, lang,
    viewport: metas.some((m) => (m.name ?? '').toLowerCase() === 'viewport'),
    wordCount, images, links,
    og: { title: Boolean(metaByProp('og:title')), description: Boolean(metaByProp('og:description')), image: Boolean(metaByProp('og:image')) },
    twitterCard: Boolean(metaByName('twitter:card')),
    structuredData, hreflangCount,
  };
}

const issue = (id: string, severity: Severity, title: string, detail: string, fix: string): SeoIssue => ({ id, severity, title, detail, fix });

export function pageIssues(f: PageFacts): SeoIssue[] {
  const out: SeoIssue[] = [];
  if (f.status >= 500) out.push(issue('status-5xx', 'error', 'The page returns a server error', `The address answered with status ${f.status}.`, 'Check your server or hosting. Visitors and Google see an error page.'));
  else if (f.status >= 400) out.push(issue('status-4xx', 'error', 'The page cannot be found', `The address answered with status ${f.status}.`, 'Fix or remove the links that point here, or redirect this address to a working page.'));
  if (f.redirectTo) out.push(issue('redirect', 'info', 'The address redirects', `It sends visitors to ${f.redirectTo}.`, 'Link to the final address directly so Google and visitors skip the extra step.'));
  if (f.noindex) out.push(issue('noindex', 'error', 'The page tells search engines not to list it', 'A "noindex" instruction was found in the page or its headers.', 'Remove the noindex instruction if you want this page to appear in Google.'));

  if (!f.title) out.push(issue('title-missing', 'error', 'No page title', 'The page has no <title>.', 'Add a clear title of 30 to 60 characters that includes the main topic.'));
  else if (f.title.length < 30) out.push(issue('title-short', 'warning', 'Title is short', `The title is ${f.title.length} characters.`, 'Aim for 30 to 60 characters so it says more about the page.'));
  else if (f.title.length > 60) out.push(issue('title-long', 'warning', 'Title is long', `The title is ${f.title.length} characters; Google usually cuts titles after about 60.`, 'Shorten it and put the most important words first.'));

  if (!f.description) out.push(issue('description-missing', 'warning', 'No meta description', 'The page has no description for search results.', 'Write a description of 70 to 160 characters that makes people want to click.'));
  else if (f.description.length < 70) out.push(issue('description-short', 'info', 'Meta description is short', `It is ${f.description.length} characters.`, 'Use 70 to 160 characters to make the most of the space in search results.'));
  else if (f.description.length > 160) out.push(issue('description-long', 'info', 'Meta description is long', `It is ${f.description.length} characters; Google usually cuts it after about 160.`, 'Shorten it so the important part is not cut off.'));

  if (f.h1.length === 0) out.push(issue('h1-missing', 'error', 'No main heading (H1)', 'The page has no H1 heading.', 'Add one H1 that states what the page is about.'));
  else if (f.h1.length > 1) out.push(issue('h1-multiple', 'warning', 'More than one main heading', `The page has ${f.h1.length} H1 headings.`, 'Keep one H1 and use H2 and H3 for the sections.'));

  if (f.wordCount > 0 && f.wordCount < 100) out.push(issue('thin-content', 'error', 'Very little text', `Only about ${f.wordCount} words of page text were found.`, 'Add useful content. Pages with almost no text rarely rank.'));
  else if (f.wordCount >= 100 && f.wordCount < 300) out.push(issue('thin-content', 'warning', 'Not much text', `About ${f.wordCount} words of page text were found.`, 'Consider adding more helpful detail, examples or questions people ask.'));

  if (!f.viewport) out.push(issue('viewport-missing', 'warning', 'Not set up for phones', 'No viewport tag was found.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> so the page fits phone screens.'));
  if (!f.lang) out.push(issue('lang-missing', 'info', 'Page language not declared', 'The <html> tag has no lang attribute.', 'Add lang="en" (or your language) to the <html> tag.'));

  if (f.images.missingAlt > 0) out.push(issue('img-alt', 'warning', 'Images without descriptions', `${f.images.missingAlt} of ${f.images.total} images have no alt text.`, 'Add short alt text that describes each image. Use alt="" only for pure decoration.'));
  if (f.images.missingSize > 3) out.push(issue('img-size', 'info', 'Images without set size', `${f.images.missingSize} images have no width and height.`, 'Add width and height so the page does not jump while loading.'));

  const internal = f.links.filter((l) => l.internal);
  if (f.status === 200 && internal.length === 0) out.push(issue('no-internal-links', 'warning', 'No links to other pages on your site', 'The page does not link to any other page on the same site.', 'Add links to related pages so visitors and Google can keep exploring.'));
  const emptyAnchors = f.links.filter((l) => !l.text).length;
  if (emptyAnchors > 0) out.push(issue('empty-anchor', 'info', 'Links with no text', `${emptyAnchors} links have no readable text.`, 'Give each link descriptive text (or an aria-label for icon links).'));

  if (!f.canonical) out.push(issue('canonical-missing', 'info', 'No canonical address', 'The page does not say which address is the main one.', 'Add <link rel="canonical"> pointing to this page\'s preferred address.'));
  else {
    try {
      const a = new URL(f.canonical, f.url);
      const b = new URL(f.url);
      if (hostKey(a.hostname) !== hostKey(b.hostname) || a.pathname.replace(/\/$/, '') !== b.pathname.replace(/\/$/, '')) out.push(issue('canonical-other', 'info', 'Canonical points to a different page', `It points to ${a.toString()}.`, 'If that is not intended, change the canonical to this page\'s own address.'));
    } catch { out.push(issue('canonical-bad', 'warning', 'Canonical address is not valid', `Found "${f.canonical}".`, 'Use a full address such as https://example.com/page.')); }
  }

  if (!(f.og.title && f.og.description && f.og.image)) out.push(issue('og-missing', 'info', 'Incomplete social preview', 'Open Graph title, description or image is missing.', 'Add og:title, og:description and og:image so shared links look good.'));
  if (f.structuredData.length === 0) out.push(issue('schema-missing', 'info', 'No structured data', 'No schema.org JSON-LD was found.', 'Add structured data (for example Article, Product, FAQ or Organization) to qualify for rich results.'));

  if (f.ms > 3000) out.push(issue('slow', 'error', 'Very slow response', `The server took ${(f.ms / 1000).toFixed(1)} seconds to answer.`, 'Check hosting, caching and heavy server work. Slow pages lose visitors and rankings.'));
  else if (f.ms > 1500) out.push(issue('slow', 'warning', 'Slow response', `The server took ${(f.ms / 1000).toFixed(1)} seconds to answer.`, 'Try caching, a CDN or lighter server work.'));
  if (f.bytes > 1_000_000) out.push(issue('heavy-html', 'warning', 'Very large page', `The HTML is ${(f.bytes / 1_000_000).toFixed(1)} MB.`, 'Reduce inline data and split very long pages.'));

  try {
    const u = new URL(f.url);
    if (u.pathname.length > 115) out.push(issue('url-long', 'info', 'Long address', 'The address path is over 115 characters.', 'Use shorter, readable addresses.'));
    if (/[A-Z_]/.test(u.pathname)) out.push(issue('url-style', 'info', 'Address has capitals or underscores', 'Search engines prefer lowercase words separated by hyphens.', 'Use lowercase and hyphens in new addresses (redirect the old one).'));
  } catch { /* ignore */ }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function scoreFor(issues: SeoIssue[]): number {
  const w: Record<Severity, number> = { error: 12, warning: 5, info: 1 };
  return Math.max(0, 100 - issues.reduce((n, i) => n + w[i.severity], 0));
}
