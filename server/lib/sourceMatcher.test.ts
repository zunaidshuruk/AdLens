import test from 'node:test';
import assert from 'node:assert/strict';
import { brandLabel, matchSourcesForDomain, normalizeDomain } from './sourceMatcher.js';

test('normalizeDomain handles URLs, sc-domain and junk', () => {
  assert.equal(normalizeDomain('https://www.Acme.com/pricing?x=1'), 'acme.com');
  assert.equal(normalizeDomain('sc-domain:acme.com'), 'acme.com');
  assert.equal(normalizeDomain('  shop.example.co.uk  '), 'shop.example.co.uk');
  assert.equal(normalizeDomain('not a domain'), '');
  assert.equal(normalizeDomain(''), '');
  assert.equal(brandLabel('synesisit.com.bd'), 'synesisit');
  assert.equal(brandLabel('acme.com'), 'acme');
});

test('ranks GA4 by data stream, then name; suggests the best pair with reasons', () => {
  const r = matchSourcesForDomain(
    'https://www.acme.com',
    [
      { propertyId: '1', displayName: 'Old Acme site', streamUris: [] },
      { propertyId: '2', displayName: 'Main website', accountName: 'Synesis IT', streamUris: ['https://www.acme.com'] },
      { propertyId: '3', displayName: 'Acme App', streamUris: ['https://app.acme.com'] },
      { propertyId: '4', displayName: 'Unrelated', streamUris: ['https://example.org'] },
    ],
    [
      { siteUrl: 'https://app.acme.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://www.acme.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:hidden.com', permissionLevel: 'siteUnverifiedUser' },
    ]
  );
  assert.equal(r.domain, 'acme.com');
  assert.deepEqual(r.ga4.map((p) => [p.propertyId, p.strength]), [
    ['2', 'exact'], ['3', 'strong'], ['1', 'partial'], ['4', 'weak'],
  ]);
  assert.match(r.ga4[0].reasons[0], /web data stream tracks acme\.com/);
  assert.deepEqual(r.searchConsole.map((s) => s.siteUrl), [
    'sc-domain:acme.com', 'https://www.acme.com/', 'https://app.acme.com/',
  ]);
  assert.deepEqual(r.suggested, { ga4PropertyId: '2', searchConsoleSiteUrl: 'sc-domain:acme.com' });
});

test('no confident match → no suggestion, helpful notes', () => {
  const r = matchSourcesForDomain('newsite.com', [{ propertyId: '9', displayName: 'Something', streamUris: ['https://other.com'] }], []);
  assert.deepEqual(r.suggested, { ga4PropertyId: null, searchConsoleSiteUrl: null });
  assert.ok(r.notes.some((n) => n.includes('No GA4 property clearly tracks newsite.com')));
  assert.ok(r.notes.some((n) => n.includes('no verified Search Console sites')));
  assert.equal(matchSourcesForDomain('???', [], []).notes[0], 'Enter a website domain such as example.com.');
});

test('http:// URL-prefix property is ranked below https and explained', () => {
  const r = matchSourcesForDomain('acme.com', [], [
    { siteUrl: 'http://acme.com/', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://acme.com/', permissionLevel: 'siteRestrictedUser' },
  ]);
  assert.equal(r.searchConsole[0].siteUrl, 'https://acme.com/');
  assert.ok(r.searchConsole[1].reasons.some((x) => x.includes('http://')));
  assert.ok(r.searchConsole[0].reasons.some((x) => x.includes('restricted access')));
});
