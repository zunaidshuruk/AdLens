import assert from 'node:assert/strict';
import test from 'node:test';
import { auditLinks, disavowFile, domainOf, linkGap, parseCsv, parseLinks } from './backlinks.js';

test('domainOf normalises addresses and handles two-part endings', () => {
  assert.equal(domainOf('https://www.Blog.Example.com/a?b=1'), 'example.com');
  assert.equal(domainOf('shop.example.co.uk'), 'example.co.uk');
  assert.equal(domainOf('news.site.com.bd/x'), 'site.com.bd');
  assert.equal(domainOf('hello world'), null);
  assert.equal(domainOf('192.168.0.1'), null);
});

test('parseCsv handles quotes, commas inside quotes and blank lines', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('parseLinks: Search Console style export and plain lists', () => {
  const csv = 'Site,Linking pages,Target pages\nexample.com,12,3\n"blog.other.org",4,1\nnot a domain,1,1\n';
  const r = parseLinks(csv);
  assert.equal(r.entries.length, 2); assert.equal(r.skipped, 1);
  assert.deepEqual(r.entries.map((e) => [e.domain, e.count]), [['example.com', 12], ['other.org', 4]]);
  const plain = parseLinks('https://a.com/x\nhttps://b.com\nhttps://a.com/y');
  assert.equal(plain.entries.length, 3); assert.equal(plain.entries[0]!.count, 1);
  const withAnchor = parseLinks('Source URL,Anchor,Target\nhttps://a.com/p,click here,/pricing\nhttps://b.com/q,best vpn,/home');
  assert.deepEqual(withAnchor.entries.map((e) => e.anchor), ['click here', 'best vpn']);
});

test('auditLinks flags risky domains and sorts anchors', () => {
  const { entries } = parseLinks('Source URL,Anchor\nhttps://best-casino-slots.xyz/a,cheap viagra\nhttps://good.com/a,Acme tools\nhttps://good.com/b,click here\nhttps://12345678901.top/x,Acme tools');
  const a = auditLinks(entries);
  assert.equal(a.referringDomains, 3); assert.equal(a.totalLinks, 4);
  assert.equal(a.risky[0]!.domain, 'best-casino-slots.xyz');
  assert.ok(a.risky.some((r) => r.domain === '12345678901.top'));
  assert.equal(a.risky.some((r) => r.domain === 'good.com'), false);
  assert.equal(a.anchors[0]!.text, 'acme tools');
  assert.equal(a.anchors.find((x) => x.text === 'click here')!.type, 'generic');
  assert.equal(a.anchors.find((x) => x.text === 'cheap viagra')!.type, 'spammy');
});

test('disavowFile and linkGap', () => {
  assert.equal(disavowFile(['b.com', 'a.com', 'a.com']).split('\n').filter((l) => l.startsWith('domain:')).join(','), 'domain:a.com,domain:b.com');
  const gap = linkGap(new Set(['mine.com', 'shared.com']), [
    { name: 'Rival A', domains: new Set(['shared.com', 'news.com', 'blog.com', 'rivalb.com']) },
    { name: 'Rival B', domains: new Set(['news.com', 'forum.com']) },
  ], ['rivalb.com']);
  assert.deepEqual(gap.map((g) => [g.domain, g.linksToCompetitors]), [['news.com', 2], ['blog.com', 1], ['forum.com', 1]]);
});
