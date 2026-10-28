import assert from 'node:assert/strict';
import test from 'node:test';
import { crawlSite, normaliseCrawlUrl, parseRobots, robotsAllows, sitemapUrls } from './seoCrawl.js';
import type { FetchedPage, PageFetcher } from './seoFetch.js';
import { classifyIntent, keywordIdeas } from './seoKeywords.js';
import { expectedCtr, findOpportunities, type QueryPageRow } from './seoOpportunities.js';
import { analyzeHtml, pageIssues, scoreFor } from './seoPage.js';

const meta = { status: 200, ms: 200, bytes: 5000 };
const GOOD = `<!doctype html><html lang="en"><head><title>Handmade leather wallets for everyday carry</title>
<meta name="description" content="Browse our handmade leather wallets, built to last for years. Free shipping on every order over fifty dollars, plus a lifetime guarantee on stitching.">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="https://shop.example.com/wallets">
<meta property="og:title" content="x"><meta property="og:description" content="y"><meta property="og:image" content="z">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product"},{"@type":["Organization","Brand"]}]}</script></head>
<body><nav><a href="/">Home</a></nav><h1>Leather wallets</h1><h2>Why leather</h2><p>${'word '.repeat(350)}</p>
<img src="a.jpg" alt="Brown wallet" width="10" height="10"><img src="b.jpg" alt="" width="10" height="10">
<a href="/about">About us</a> <a href="https://other.com/x" rel="nofollow">Partner</a> <a href="mailto:a@b.c">mail</a></body></html>`;

test('Page analysis: reads titles, descriptions, headings, images, links, schema and finds no problems on a good page', () => {
  const f = analyzeHtml(GOOD, 'https://shop.example.com/wallets', meta);
  assert.equal(f.title, 'Handmade leather wallets for everyday carry');
  assert.equal(f.h1.length, 1);
  assert.equal(f.canonical, 'https://shop.example.com/wallets');
  assert.deepEqual(f.images, { total: 2, missingAlt: 0, missingSize: 0 });
  assert.equal(f.links.filter((l) => l.internal).length, 2);
  assert.equal(f.links.find((l) => l.nofollow)?.internal, false);
  assert.deepEqual([...new Set(f.structuredData)].sort(), ['Brand', 'Organization', 'Product']);
  assert.ok(f.wordCount > 300);
  assert.deepEqual(pageIssues(f), []);
  assert.equal(scoreFor([]), 100);
});

test('Page analysis: finds the common problems and ranks errors first', () => {
  const bad = `<html><head><title>Hi</title><meta name="robots" content="noindex"></head><body><h1>A</h1><h1>B</h1><img src="x.jpg"><a href="/x"></a><p>few words</p></body></html>`;
  const f = analyzeHtml(bad, 'https://shop.example.com/Bad_Page', { status: 200, ms: 3500, bytes: 500 });
  const issues = pageIssues(f);
  const ids = issues.map((i) => i.id);
  for (const id of ['title-short', 'description-missing', 'h1-multiple', 'thin-content', 'viewport-missing', 'img-alt', 'noindex', 'slow', 'canonical-missing', 'schema-missing', 'url-style', 'og-missing', 'lang-missing', 'no-internal-links'.replace('no-internal-links', 'empty-anchor')]) assert.ok(ids.includes(id), `missing ${id}`);
  assert.equal(issues[0].severity, 'error');
  assert.ok(scoreFor(issues) < 50);
  assert.equal(pageIssues(analyzeHtml('', 'https://x.com/a', { status: 404, ms: 10, bytes: 0 })).some((i) => i.id === 'status-4xx'), true);
  assert.equal(pageIssues(analyzeHtml('<html><head><title>x</title></head></html>', 'https://x.com/', { ...meta, xRobots: 'noindex, nofollow' })).some((i) => i.id === 'noindex'), true);
});

test('Page analysis: a hostile page cannot break the reader', () => {
  const f = analyzeHtml('<title>' + '<'.repeat(50) + '</title><a href="javascript:alert(1)">x</a><a href="http://[bad">y</a><img alt=">"><script>var a="<h1>fake</h1>"</script>', 'https://x.com/', meta);
  assert.equal(f.h1.length, 0);
  assert.equal(f.links.length, 0);
});

test('robots.txt: groups, longest match, wildcards, sitemaps', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\nSitemap: https://x.com/sm.xml\n\nUser-agent: badbot\nDisallow: /');
  assert.equal(robotsAllows(r, '/private/a'), false);
  assert.equal(robotsAllows(r, '/private/ok/a'), true);
  assert.equal(robotsAllows(r, '/a/b.pdf'), false);
  assert.equal(robotsAllows(r, '/a/b.pdf?x=1'), true);
  assert.equal(robotsAllows(r, '/blog'), true);
  assert.deepEqual(r.sitemaps, ['https://x.com/sm.xml']);
  assert.equal(robotsAllows(parseRobots('User-agent: AdLensBot\nDisallow: /'), '/'), false);
  assert.deepEqual(sitemapUrls('<urlset><url><loc> https://x.com/a?x=1&amp;y=2 </loc></url></urlset>'), ['https://x.com/a?x=1&y=2']);
  assert.equal(normaliseCrawlUrl(new URL('https://X.com/a/?utm_source=z&b=2&a=1#top')), 'https://x.com/a?a=1&b=2');
});

function site(pages: Record<string, Partial<FetchedPage> & { html?: string }>): PageFetcher {
  return async (url) => {
    const u = new URL(url);
    const key = `${u.pathname}${u.search}`;
    const p = pages[key];
    if (!p) return { url, status: 404, contentType: 'text/html', ms: 20, bytes: 0, text: '' };
    const text = p.html ?? p.text ?? '';
    return { url, status: 200, contentType: p.html !== undefined ? 'text/html' : 'text/plain', ms: 20, bytes: text.length, text, ...p } as FetchedPage;
  };
}
const page = (title: string, body: string) => `<html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width"></head><body><h1>${title}</h1>${body}<p>${'text '.repeat(320)}</p></body></html>`;

test('Site audit: crawls a small site, follows links, honours robots, finds broken links and duplicates', async () => {
  const fetcher = site({
    '/robots.txt': { text: 'User-agent: *\nDisallow: /secret\nSitemap: https://shop.example.com/sitemap.xml' },
    '/sitemap.xml': { text: '<urlset><url><loc>https://shop.example.com/from-sitemap</loc></url></urlset>' },
    '/': { html: page('Home page of the shop', '<a href="/a">A</a><a href="/b">B</a><a href="/missing">Gone</a><a href="/secret/x">S</a><a href="/old">Old</a><a href="https://other.com">Out</a><a href="/file.pdf">pdf</a>') },
    '/a': { html: page('Duplicate title here for pages', '') },
    '/b': { html: page('Duplicate title here for pages', '<a href="/a">A</a>') },
    '/from-sitemap': { html: page('Only found through the sitemap', '') },
    '/old': { status: 301, html: '', redirectTo: 'https://shop.example.com/a' },
  });
  const r = await crawlSite('https://shop.example.com/', fetcher, { maxPages: 50, timeBudgetMs: 10_000 });
  const ids = r.groups.map((g) => g.id);
  assert.ok(r.sitemapFound);
  assert.equal(r.robotsBlocked, 1);
  assert.ok(r.pages.some((p) => p.url.endsWith('/from-sitemap')));
  assert.equal(r.pages.some((p) => p.url.includes('/secret') || p.url.endsWith('.pdf')), false);
  assert.ok(ids.includes('title-duplicate'));
  assert.ok(ids.includes('broken-link'));
  assert.ok(ids.includes('redirect'));
  assert.equal(r.groups.find((g) => g.id === 'title-duplicate')!.count, 2);
  assert.equal(r.stoppedBecause, 'finished');
  assert.ok(r.statusCounts['4xx'] >= 1);
});

test('Site audit: stops at the page cap and at the time budget', async () => {
  const links = Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join('');
  const pages: Record<string, { html: string }> = { '/': { html: page('Root of a big site', links) } };
  for (let i = 0; i < 30; i++) pages[`/p${i}`] = { html: page(`Page number ${i} of the site`, '') };
  const fetcher = site(pages);
  const capped = await crawlSite('https://big.example.com/', fetcher, { maxPages: 10, timeBudgetMs: 10_000 });
  assert.equal(capped.crawled, 10);
  assert.equal(capped.stoppedBecause, 'page_limit');
  let t = 0;
  const slow = await crawlSite('https://big.example.com/', fetcher, { maxPages: 100, timeBudgetMs: 5, concurrency: 1, now: () => (t += 10) });
  assert.equal(slow.stoppedBecause, 'time_limit');
});

test('Opportunities: sizes striking-distance, low-CTR, no-click and competing-page cases', () => {
  assert.ok(expectedCtr(1) > expectedCtr(3) && expectedCtr(3) > expectedCtr(12));
  const rows: QueryPageRow[] = [
    { query: 'leather wallet', page: '/w', clicks: 3, impressions: 900, ctr: 0.3, position: 11.2 },
    { query: 'best wallet', page: '/best', clicks: 8, impressions: 2000, ctr: 0.4, position: 3 },
    { query: 'wallet repair', page: '/repair', clicks: 0, impressions: 400, ctr: 0, position: 14 },
    { query: 'wallet care', page: '/care-a', clicks: 5, impressions: 300, ctr: 1.7, position: 9 },
    { query: 'wallet care', page: '/care-b', clicks: 4, impressions: 250, ctr: 1.6, position: 10 },
    { query: 'tiny', page: '/t', clicks: 0, impressions: 5, ctr: 0, position: 12 },
    { query: 'great', page: '/g', clicks: 100, impressions: 500, ctr: 20, position: 1.2 },
  ];
  const o = findOpportunities(rows);
  assert.deepEqual([...new Set(o.striking.map((x) => x.query))].sort(), ['leather wallet', 'wallet care', 'wallet repair']);
  assert.equal(o.striking.find((x) => x.query === 'leather wallet')!.potentialClicks > 0, true);
  assert.deepEqual(o.low_ctr.map((x) => x.query), ['best wallet']);
  assert.deepEqual(o.no_clicks.map((x) => x.query), ['wallet repair']);
  assert.equal(o.cannibal.length, 1);
  assert.deepEqual(o.cannibal[0].pages?.sort(), ['/care-a', '/care-b']);
  assert.equal([...o.striking, ...o.low_ctr, ...o.no_clicks].some((x) => x.query === 'tiny' || x.query === 'great'), false);
});

test('Keyword ideas: groups, intent, dedupes, and survives a failing source', async () => {
  const fake = async (q: string) => q === 'wallet' ? ['wallet size', 'how to clean a wallet'] : q.startsWith('how ') ? ['how to clean a wallet', 'how to fold a wallet'] : q.endsWith(' price') ? ['wallet price in dhaka'] : q.endsWith(' best') ? ['best wallet brands'] : [];
  const ideas = await keywordIdeas('  Wallet ', fake);
  const by = Object.fromEntries(ideas.map((i) => [i.keyword, i]));
  assert.equal(ideas.filter((i) => i.keyword === 'how to clean a wallet').length, 1);
  assert.equal(by['how to clean a wallet'].group, 'questions');
  assert.equal(by['wallet price in dhaka'].intent, 'transactional');
  assert.equal(by['best wallet brands'].intent, 'commercial');
  assert.equal(by['wallet size'].intent, 'navigational');
  assert.equal(classifyIntent('how to fold a wallet'), 'informational');
  assert.deepEqual(await keywordIdeas('wallet', async () => { throw new Error('down'); }), []);
  assert.deepEqual(await keywordIdeas('   ', fake), []);
});
