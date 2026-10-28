import assert from 'node:assert/strict';
import test from 'node:test';
import { botFor, createLogAnalyzer, neverCrawled, parseLine } from './logAnalyzer.js';

const L = (ip: string, when: string, path: string, status: number, agent: string, method = 'GET') => `${ip} - - [${when}] "${method} ${path} HTTP/1.1" ${status} 512 "-" "${agent}"`;
const G = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

test('parseLine reads combined log lines and rejects junk', () => {
  const p = parseLine(L('1.2.3.4', '27/Oct/2026:10:00:01 +0000', '/blog/a?x=1', 404, G))!;
  assert.deepEqual({ day: p.day, path: p.path, status: p.status, method: p.method }, { day: '2026-10-27', path: '/blog/a?x=1', status: 404, method: 'GET' });
  assert.equal(parseLine('not a log line'), null);
  assert.equal(parseLine('1.1.1.1 - - [99/Foo/2026:10:00:01 +0000] "GET / HTTP/1.1" 200 1'), null);
});

test('botFor recognises search, AI and SEO crawlers', () => {
  assert.equal(botFor(G)?.id, 'googlebot');
  assert.equal(botFor('Mozilla/5.0; compatible; GPTBot/1.1')?.kind, 'ai');
  assert.equal(botFor('Mozilla/5.0 (Windows NT 10.0) Chrome/120'), null);
});

test('analyzer: bot shares, status mix, wasted crawling and ignored human traffic', () => {
  const a = createLogAnalyzer();
  const d = '27/Oct/2026:10:00:01 +0000';
  const lines = [
    L('1.1.1.1', d, '/', 200, G), L('1.1.1.1', d, '/blog/post-1', 200, G), L('1.1.1.1', d, '/blog/post-1', 200, G),
    L('1.1.1.1', d, '/old-page', 404, G), L('1.1.1.1', d, '/shop?sort=price', 200, G), L('1.1.1.1', d, '/moved', 301, G),
    L('1.1.1.1', d, '/assets/app.js', 200, G), L('1.1.1.1', d, '/api', 500, G),
    L('2.2.2.2', '28/Oct/2026:09:00:00 +0000', '/blog/post-1', 200, 'Mozilla/5.0 GPTBot/1.1'),
    L('3.3.3.3', d, '/', 200, 'Mozilla/5.0 Chrome/120'), 'garbage', '',
  ];
  for (const l of lines) a.add(l);
  const r = a.result();
  assert.equal(r.lines, 11); assert.equal(r.parsed, 10); assert.equal(r.unparsed, 1);
  assert.equal(r.botHits, 9); assert.equal(r.humanOrOtherHits, 1);
  assert.equal(r.firstDay, '2026-10-27'); assert.equal(r.lastDay, '2026-10-28');
  const g = r.bots.find((b) => b.id === 'googlebot')!;
  assert.equal(g.hits, 8); assert.deepEqual(g.status, { '2xx': 5, '3xx': 1, '4xx': 1, '5xx': 1 });
  assert.equal(g.topUrls[0]!.path, '/blog/post-1');
  assert.equal(r.crawl.ai.hits, 1);
  const kinds = Object.fromEntries(r.issues.map((i) => [i.kind, i.hits]));
  assert.deepEqual(kinds, { server: 1, errors: 1, redirects: 1, parameters: 1, static: 1 });
  assert.deepEqual(r.crawl.search.sectionHits.map((s) => s.section), ['/', '/blog/', '/assets/']);
});

test('neverCrawled compares with the sitemap addresses', () => {
  assert.deepEqual(neverCrawled(['/a', '/b/?x=1'], ['https://s.com/a/', 'https://s.com/b', 'https://s.com/c']), ['/c']);
});
