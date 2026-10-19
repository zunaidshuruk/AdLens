import test from 'node:test';
import assert from 'node:assert/strict';
import { brandLabel, matchSourcesForDomain, normalizeDomain } from './sourceMatcher.js';

test('normalizeDomain handles URLs, sc-domain and junk', () => {
  assert.equal(normalizeDomain('https://www.Convay.com/pricing?x=1'), 'convay.com');
  assert.equal(normalizeDomain('sc-domain:convay.com'), 'convay.com');
  assert.equal(normalizeDomain('  shop.example.co.uk  '), 'shop.example.co.uk');
  assert.equal(normalizeDomain('not a domain'), '');
  assert.equal(normalizeDomain(''), '');
  assert.equal(brandLabel('synesisit.com.bd'), 'synesisit');
  assert.equal(brandLabel('convay.com'), 'convay');
});

test('ranks GA4 by data stream, then name; suggests the best pair with reasons', () => {
  const r = matchSourcesForDomain(
    'https://www.convay.com',
    [
      { propertyId: '1', displayName: 'Old Convay site', streamUris: [] },
      { propertyId: '2', displayName: 'Main website', accountName: 'Synesis IT', streamUris: ['https://www.convay.com'] },
      { propertyId: '3', displayName: 'Convay App', streamUris: ['https://app.convay.com'] },
      { propertyId: '4', displayName: 'Unrelated', streamUris: ['https://example.org'] },
    ],
    [
      { siteUrl: 'https://app.convay.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:convay.com', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://www.convay.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:hidden.com', permissionLevel: 'siteUnverifiedUser' },
    ]
  );
  assert.equal(r.domain, 'convay.com');
  assert.deepEqual(r.ga4.map((p) => [p.propertyId, p.strength]), [
    ['2', 'exact'], ['3', 'strong'], ['1', 'partial'], ['4', 'weak'],
  ]);
  assert.match(r.ga4[0].reasons[0], /web data stream tracks convay\.com/);
  assert.deepEqual(r.searchConsole.map((s) => s.siteUrl), [
    'sc-domain:convay.com', 'https://www.convay.com/', 'https://app.convay.com/',
  ]);
  assert.deepEqual(r.suggested, { ga4PropertyId: '2', searchConsoleSiteUrl: 'sc-domain:convay.com' });
});

test('no confident match → no suggestion, helpful notes', () => {
  const r = matchSourcesForDomain('newsite.com', [{ propertyId: '9', displayName: 'Something', streamUris: ['https://other.com'] }], []);
  assert.deepEqual(r.suggested, { ga4PropertyId: null, searchConsoleSiteUrl: null });
  assert.ok(r.notes.some((n) => n.includes('No GA4 property clearly tracks newsite.com')));
  assert.ok(r.notes.some((n) => n.includes('no verified Search Console sites')));
  assert.equal(matchSourcesForDomain('???', [], []).notes[0], 'Enter a website domain such as example.com.');
});

test('http:// URL-prefix property is ranked below https and explained', () => {
  const r = matchSourcesForDomain('convay.com', [], [
    { siteUrl: 'http://convay.com/', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://convay.com/', permissionLevel: 'siteRestrictedUser' },
  ]);
  assert.equal(r.searchConsole[0].siteUrl, 'https://convay.com/');
  assert.ok(r.searchConsole[1].reasons.some((x) => x.includes('http://')));
  assert.ok(r.searchConsole[0].reasons.some((x) => x.includes('restricted access')));
});
