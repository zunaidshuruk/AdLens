import assert from 'node:assert/strict';
import test from 'node:test';
import { ahrefsProvider, parseSemrush, ProviderError, semrushProvider, serpApiProvider, type ProviderDeps } from './lib/dataProviders.js';
import { offersKeywords } from './lib/dataProvider.js';

interface Seen { url: URL; headers?: Record<string, string> }
const deps = (reply: (u: URL) => { status: number; text: string }, seen: Seen[] = []): ProviderDeps => ({
  now: () => Date.parse('2026-11-01T10:00:00Z'),
  request: async (url, o) => { seen.push({ url, ...(o.headers ? { headers: o.headers } : {}) }); const r = reply(url); return { status: r.status, text: r.text } as never; },
});

test('Semrush: batch keyword numbers, competitor keywords and backlinks are read from its semicolon text', async () => {
  const seen: Seen[] = [];
  const p = semrushProvider({ secret: 'KEY12345' }, deps((u) => {
    const type = u.searchParams.get('type');
    if (type === 'phrase_these') return { status: 200, text: 'Keyword;Search Volume;CPC;Competition;Keyword Difficulty Index\ncoffee beans;5400;1.25;0.8;42\ntea;110;;0.1;' };
    if (type === 'domain_organic') return { status: 200, text: 'Keyword;Position;Search Volume;Url\nespresso;3;900;https://x.com/e' };
    if (type === 'backlinks_overview') return { status: 200, text: 'ascore;total;domains_num\n55;40;12' };
    return { status: 404, text: '' };
  }, seen));
  const m = await p.keywordMetrics(['Coffee Beans', 'tea'], 'gb');
  assert.deepEqual(m[0], { keyword: 'coffee beans', volume: 5400, cpc: 1.25, difficulty: 42, competition: 80 });
  assert.deepEqual(m[1], { keyword: 'tea', volume: 110, cpc: null, difficulty: null, competition: 10 });
  assert.equal(seen[0]!.url.searchParams.get('database'), 'uk', 'GB is Semrush "uk"');
  assert.equal(seen[0]!.url.searchParams.get('phrase'), 'coffee beans;tea');
  assert.equal(seen[0]!.url.searchParams.get('key'), 'KEY12345');
  assert.deepEqual(await p.competitorKeywords('x.com', 'us'), [{ keyword: 'espresso', position: 3, volume: 900, url: 'https://x.com/e' }]);
  assert.deepEqual(await p.backlinks('x.com'), { domain: 'x.com', referringDomains: 12, backlinks: 40, authority: 55 });
});

test('Semrush: "nothing found" is an empty answer, a key problem is a plain message, and nothing echoes the key', async () => {
  assert.deepEqual(parseSemrush('ERROR 50 :: NOTHING FOUND'), []);
  assert.throws(() => parseSemrush('ERROR 132 :: API UNITS BALANCE IS ZERO'), (e: unknown) => e instanceof ProviderError && !/132/.test(e.message));
  const p = semrushProvider({ secret: 'SECRETKEY99' }, deps(() => ({ status: 403, text: 'forbidden' })));
  await assert.rejects(() => p.keywordMetrics(['a'], 'us'), (e: unknown) => e instanceof ProviderError && !/SECRETKEY99/.test(e.message));
  const many = Array.from({ length: 250 }, (_, i) => `kw ${i}`);
  const seen: Seen[] = [];
  await semrushProvider({ secret: 'KEY12345' }, deps(() => ({ status: 200, text: 'ERROR 50 :: NOTHING FOUND' }), seen)).keywordMetrics(many, 'us');
  assert.equal(seen.length, 3, '250 keywords are sent 100 at a time');
});

test('Ahrefs: Bearer key, keyword numbers (cost in cents), organic keywords and rating plus links', async () => {
  const seen: Seen[] = [];
  const p = ahrefsProvider({ secret: 'AHKEY1234' }, deps((u) => {
    const j = (x: unknown) => ({ status: 200, text: JSON.stringify(x) });
    if (u.pathname.endsWith('keywords-explorer/overview')) return j({ keywords: [{ keyword: 'Coffee Beans', volume: 5400, difficulty: 42, cpc: 125 }] });
    if (u.pathname.endsWith('organic-keywords')) return j({ keywords: [{ keyword: 'espresso', best_position: 3, best_position_url: 'https://x.com/e', volume: 900 }] });
    if (u.pathname.endsWith('domain-rating')) return j({ domain_rating: { ahrefs_rank: 10, domain_rating: 71.5 } });
    if (u.pathname.endsWith('backlinks-stats')) return j({ metrics: { live: 400, live_refdomains: 12, all_time: 900, all_time_refdomains: 30 } });
    return { status: 404, text: '' };
  }, seen));
  assert.deepEqual(await p.keywordMetrics(['coffee beans'], 'uk'), [{ keyword: 'coffee beans', volume: 5400, cpc: 1.25, difficulty: 42, competition: null }]);
  assert.equal(seen[0]!.headers!.Authorization, 'Bearer AHKEY1234');
  assert.equal(seen[0]!.url.searchParams.get('country'), 'gb');
  assert.equal(seen[0]!.url.searchParams.get('select'), 'keyword,volume,difficulty,cpc');
  assert.deepEqual(await p.competitorKeywords('x.com', 'us'), [{ keyword: 'espresso', position: 3, volume: 900, url: 'https://x.com/e' }]);
  assert.equal(seen[1]!.url.searchParams.get('date'), '2026-11-01');
  assert.deepEqual(await p.backlinks('x.com'), { domain: 'x.com', referringDomains: 12, backlinks: 400, authority: 71.5 });
  const bad = ahrefsProvider({ secret: 'AHKEY1234' }, deps(() => ({ status: 200, text: JSON.stringify({ error: 'Insufficient plan' }) })));
  await assert.rejects(() => bad.keywordMetrics(['a'], 'us'), /Insufficient plan/);
});

test('SerpApi: map results only, and keyword screens do not treat it as a keyword source', async () => {
  const seen: Seen[] = [];
  const p = serpApiProvider({ secret: 'SERPKEY123' }, deps((u) => ({ status: 200, text: JSON.stringify({ local_results: [{ position: 1, title: 'Cafe A', place_id: 'p1', rating: 4.5, reviews: 10, type: 'Cafe', address: '1 Main', website: 'https://a.com' }] }) }), seen));
  const r = await p.mapsSearch!({ keyword: 'coffee', lat: 40.7, lng: -73.9, zoom: 14 });
  assert.deepEqual(r, [{ name: 'Cafe A', placeId: 'p1', rank: 1, rating: 4.5, reviews: 10, category: 'Cafe', address: '1 Main', website: 'https://a.com' }]);
  assert.equal(seen[0]!.url.searchParams.get('ll'), '@40.700000,-73.900000,14z');
  assert.equal(offersKeywords(p), false);
  assert.equal(offersKeywords(semrushProvider({ secret: 'KEY12345' })), true);
});
