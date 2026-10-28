import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectedDataset, refreshConnectedDataset } from './connectedData.js';
import { CONNECTORS, connectorById, fetchConnectorTable, findJsonRows, jsonRowsToGrid, normaliseShop, normaliseSite, parseSheetLink, splitConnectorInput } from './connectors.js';
import { DatasetError, summary } from './datasets.js';
import { createInMemoryProjectDocsStore } from './projectDocs.js';
import { SsrfError, type GuardedResponse, type RequestFn } from './ssrfGuard.js';
import { buildKeyring } from './tokenVault.js';

const ring = buildKeyring('k'.repeat(48));
const ok = (text: string, headers: GuardedResponse['headers'] = {}): GuardedResponse => ({ status: 200, headers, text });
const SHEET = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=42';
const redirect = (location: string): never => { const e = new SsrfError('REDIRECT_BLOCKED', 'redirect'); (e as SsrfError & { location?: string }).location = location; throw e; };

test('Connectors: live ones are Sheets, Shopify and WooCommerce; the rest are listed as coming soon with no fields', () => {
  assert.deepEqual(CONNECTORS.filter((c) => c.status === 'live').map((c) => c.id), ['google_sheets', 'shopify', 'woocommerce', 'custom_url']);
  for (const id of ['linkedin_ads', 'tiktok_ads', 'google_ads']) { const c = connectorById(id)!; assert.equal(c.status, 'soon'); assert.equal(c.fields.length, 0); }
  assert.equal(new Set(CONNECTORS.map((c) => c.id)).size, CONNECTORS.length);
});

test('Sheets link: only real Google Sheets links, with the tab id when present', () => {
  assert.deepEqual(parseSheetLink(SHEET), { id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', gid: '42' });
  assert.equal(parseSheetLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')?.gid, null);
  for (const bad of ['http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'https://evil.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'https://docs.google.com.evil.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'https://docs.google.com/spreadsheets/d/short', 'x']) assert.equal(parseSheetLink(bad), null, bad);
});

test('Sheets: follows redirects only to Google hosts and reads the CSV', async () => {
  const seen: string[] = [];
  const request: RequestFn = async (url) => {
    seen.push(url.href);
    if (url.hostname === 'docs.google.com') return redirect('https://doc-0c-abc.googleusercontent.com/export/xyz');
    return ok('Date,Spend\n2026-10-01,5\n2026-10-02,7');
  };
  const t = await fetchConnectorTable('google_sheets', { url: SHEET }, {}, request);
  assert.equal(t.rows.length, 2);
  assert.match(seen[0], /export\?format=csv&gid=42$/);
  assert.equal(seen.length, 2);
  // a redirect to a sign-in page or to a stranger is refused with advice
  for (const dest of ['https://accounts.google.com/ServiceLogin', 'https://evil.example/steal']) {
    await assert.rejects(fetchConnectorTable('google_sheets', { url: SHEET }, {}, async () => redirect(dest)), /Anyone with the link/);
  }
  await assert.rejects(fetchConnectorTable('google_sheets', { url: SHEET }, {}, async () => ok('<!DOCTYPE html><html>sign in</html>')), /web page instead of data/);
  await assert.rejects(fetchConnectorTable('google_sheets', { url: SHEET }, {}, async () => ({ status: 404, headers: {}, text: '' })), /not found/);
  await assert.rejects(fetchConnectorTable('google_sheets', { url: 'https://evil.com' }, {}, async () => ok('')), DatasetError);
});

test('Shopify: store address is checked, orders are paged with the token only sent to the store, rows are mapped', async () => {
  assert.equal(normaliseShop('My-Store'), 'my-store.myshopify.com');
  assert.equal(normaliseShop('https://my-store.myshopify.com/admin'), 'my-store.myshopify.com');
  for (const bad of ['evil.com', 'a.b.myshopify.com', '127.0.0.1', 'x@evil.com', '']) assert.equal(normaliseShop(bad), null, bad);
  const calls: { url: string; token?: string }[] = [];
  const order = (n: number) => ({ created_at: `2026-10-0${n}T10:00:00+06:00`, name: `#100${n}`, financial_status: 'paid', total_price: '120.50', total_discounts: '5.00', currency: 'USD', line_items: [{ quantity: 2 }, { quantity: 1 }], shipping_address: { country: 'Bangladesh' }, source_name: 'web' });
  const request: RequestFn = async (url, opts) => {
    calls.push({ url: url.href, token: opts.headers?.['X-Shopify-Access-Token'] });
    if (calls.length === 1) return ok(JSON.stringify({ orders: [order(1), order(2)] }), { link: '<https://evil.example/admin/api/x>; rel="next"' });
    return ok(JSON.stringify({ orders: [] }));
  };
  const t = await fetchConnectorTable('shopify', { shop: 'my-store' }, { token: 'shpat_abcdefghijk' }, request, new Date('2026-10-28T00:00:00Z'));
  assert.equal(calls.length, 1, 'a next link to another host is never followed');
  assert.ok(calls.every((c) => new URL(c.url).hostname === 'my-store.myshopify.com'));
  assert.match(calls[0].url, /created_at_min=2026-07-30/);
  assert.deepEqual(t.rows[0], ['2026-10-01', '#1001', 'paid', 120.5, 5, 3, 'Bangladesh', 'web', 'USD']);
  // paging within the same store
  let n = 0;
  const paged: RequestFn = async () => (n++ === 0 ? ok(JSON.stringify({ orders: [order(1)] }), { link: '<https://my-store.myshopify.com/admin/api/2026-07/orders.json?page_info=abc>; rel="next"' }) : ok(JSON.stringify({ orders: [order(2)] })));
  assert.equal((await fetchConnectorTable('shopify', { shop: 'my-store' }, { token: 'shpat_abcdefghijk' }, paged)).rows.length, 2);
  for (const [status, re] of [[401, /rejected the access token/], [403, /read_orders/], [404, /could not find that store/], [429, /slow down/]] as const) {
    await assert.rejects(fetchConnectorTable('shopify', { shop: 'my-store' }, { token: 'shpat_abcdefghijk' }, async () => ({ status, headers: {}, text: '' })), re);
  }
  await assert.rejects(fetchConnectorTable('shopify', { shop: 'my-store' }, { token: 'x' }, async () => ok('{}')), /access token/);
  await assert.rejects(fetchConnectorTable('shopify', { shop: 'my-store' }, { token: 'shpat_abcdefghijk' }, async () => ok(JSON.stringify({ orders: [] }))), /No orders/);
});

test('WooCommerce: https only, key sent as Basic auth, pages until a short page', async () => {
  assert.equal(normaliseSite('http://shop.com'), null);
  assert.equal(normaliseSite('https://localhost'), null);
  assert.equal(normaliseSite('https://10.0.0.5'), null);
  assert.equal(normaliseSite('https://shop.com:8443'), null);
  assert.equal(normaliseSite('https://shop.com/store/?x=1')?.href, 'https://shop.com/store');
  const o = { date_created: '2026-10-05T01:02:03', number: '55', status: 'completed', total: '30.00', total_discount: '0.00', currency: 'BDT', line_items: [{ quantity: 4 }], billing: { country: 'BD' }, shipping: { country: '' }, created_via: 'checkout' };
  const urls: string[] = [];
  let auth = '';
  const request: RequestFn = async (url, opts) => {
    urls.push(url.href); auth = opts.headers?.Authorization ?? '';
    return ok(JSON.stringify(urls.length === 1 ? Array.from({ length: 100 }, () => o) : [o, o]));
  };
  const t = await fetchConnectorTable('woocommerce', { site: 'https://shop.com/store' }, { key: 'ck_12345678', secret: 'cs_12345678' }, request);
  assert.equal(t.rows.length, 102);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /^https:\/\/shop\.com\/store\/wp-json\/wc\/v3\/orders\?.*page=2/);
  assert.equal(auth, `Basic ${Buffer.from('ck_12345678:cs_12345678').toString('base64')}`);
  assert.deepEqual(t.rows[0], ['2026-10-05', '55', 'completed', 30, 0, 4, 'BD', 'checkout', 'BDT']);
  await assert.rejects(fetchConnectorTable('woocommerce', { site: 'https://shop.com' }, { key: 'ck_12345678', secret: 'cs_12345678' }, async () => ({ status: 401, headers: {}, text: '' })), /rejected the key/);
  await assert.rejects(fetchConnectorTable('woocommerce', { site: 'https://shop.com' }, { key: 'ck_12345678', secret: 'cs_12345678' }, async () => { throw new SsrfError('REQUEST_FAILED', 'x'); }), /Could not reach/);
});

test('Connector input: secrets are separated from plain details; missing or odd values are refused', () => {
  const info = connectorById('shopify')!;
  assert.deepEqual(splitConnectorInput(info, { shop: ' s ', token: ' t0k3n0k3n0 ', extra: 'ignored' }), { params: { shop: 's' }, secrets: { token: 't0k3n0k3n0' } });
  assert.throws(() => splitConnectorInput(info, { shop: 's' }), DatasetError);
  assert.throws(() => splitConnectorInput(info, null), DatasetError);
  assert.throws(() => splitConnectorInput(info, { shop: 's', token: 'x'.repeat(401) }), DatasetError);
});

test('Connected tables: secrets are sealed, never exposed, refresh replaces rows, limits and file uploads handled', async () => {
  const store = createInMemoryProjectDocsStore();
  let shopRows = 1;
  const request: RequestFn = async (url, opts) => {
    assert.equal(opts.headers?.['X-Shopify-Access-Token'], 'shpat_supersecret');
    return ok(JSON.stringify({ orders: Array.from({ length: shopRows }, (_, i) => ({ created_at: '2026-10-01T00:00:00Z', name: `#${i}`, financial_status: 'paid', total_price: '10', total_discounts: '0', currency: 'USD', line_items: [], source_name: 'web' })) }));
  };
  const ds = await createConnectedDataset(store, 'w', 'p', 'u1', { name: 'Shop', connector: 'shopify', values: { shop: 'my-store', token: 'shpat_supersecret' } }, 2, { keyring: ring, request });
  assert.equal(ds.rowCount, 1);
  assert.ok(ds.sealedSecret && !ds.sealedSecret.includes('supersecret'));
  assert.equal(JSON.stringify(summary(ds)).includes('supersecret'), false);
  assert.equal('sealedSecret' in summary(ds), false);
  assert.deepEqual(ds.connector?.params, { shop: 'my-store' });
  const stored = JSON.stringify(await store.get('w', 'p', 'datasets', ds.id));
  assert.equal(stored.includes('supersecret'), false);

  shopRows = 3;
  const again = await refreshConnectedDataset(store, 'w', 'p', ds.id, { keyring: ring, request });
  assert.equal(again.rowCount, 3);
  assert.equal(again.id, ds.id);
  // a different key cannot open the secret
  await assert.rejects(refreshConnectedDataset(store, 'w', 'p', ds.id, { keyring: buildKeyring('z'.repeat(48)), request }), /could not be read/);
  // unknown, coming-soon and over-limit
  await assert.rejects(createConnectedDataset(store, 'w', 'p', 'u1', { name: 'x', connector: 'tiktok_ads', values: {} }, 2, { keyring: ring, request }), /not available yet/);
  await createConnectedDataset(store, 'w', 'p', 'u1', { name: 'S2', connector: 'google_sheets', values: { url: SHEET } }, 2, { keyring: ring, request: async () => ok('A,B\n1,2') });
  await assert.rejects(createConnectedDataset(store, 'w', 'p', 'u1', { name: 'S3', connector: 'google_sheets', values: { url: SHEET } }, 2, { keyring: ring, request: async () => ok('A,B\n1,2') }), (e) => e instanceof DatasetError && e.code === 'LIMIT_REACHED');
  // a failed connection saves nothing
  const before = (await store.list('w', 'p', 'datasets')).length;
  await assert.rejects(createConnectedDataset(store, 'w', 'other', 'u1', { name: 'bad', connector: 'shopify', values: { shop: 'my-store', token: 'shpat_supersecret' } }, 2, { keyring: ring, request: async () => ({ status: 401, headers: {}, text: '' }) }));
  assert.equal((await store.list('w', 'other', 'datasets')).length, 0);
  assert.equal(before, 2);
  // a sheet table has no secret and can be refreshed; a table that was never connected cannot
  const sheetId = (await store.list('w', 'p', 'datasets')).find((d) => (d as { name?: string }).name === 'S2')!.id;
  assert.equal((await refreshConnectedDataset(store, 'w', 'p', sheetId, { keyring: ring, request: async () => ok('A,B\n1,2\n3,4') })).rowCount, 2);
  await store.put('w', 'p', 'datasets', { id: 'file1', name: 'f', columns: [], rows: [], rowCount: 0 });
  await assert.rejects(refreshConnectedDataset(store, 'w', 'p', 'file1', { keyring: ring, request }), /uploaded as a file/);
  await assert.rejects(refreshConnectedDataset(store, 'w', 'p', 'nope', { keyring: ring, request }), (e) => e instanceof DatasetError && e.code === 'NOT_FOUND');
});

test('Custom link: reads CSV or JSON, sends the sign-in header, refuses unsafe addresses and odd headers', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const csv: RequestFn = async (url, opts) => { seen.push({ url: url.href, headers: opts.headers ?? {} }); return ok('Day,Spend\n2026-10-01,5\n2026-10-02,7'); };
  const t = await fetchConnectorTable('custom_url', { url: 'https://example.com/r.csv' }, {}, csv);
  assert.equal(t.rows.length, 2);
  assert.equal(seen[0].headers.Authorization, undefined);

  const json: RequestFn = async (url, opts) => { seen.push({ url: url.href, headers: opts.headers ?? {} }); return ok(JSON.stringify({ meta: { n: 2 }, data: { items: [{ day: '2026-10-01', spend: 5, geo: { country: 'BD' } }, { day: '2026-10-02', spend: 7.5, geo: { country: 'IN' }, extra: true }] } })); };
  const j = await fetchConnectorTable('custom_url', { url: 'https://example.com/api', headerName: 'X-Api-Key', path: 'data.items' }, { headerValue: 'k3y-value' }, json);
  assert.deepEqual(j.columns.map((c) => c.label), ['day', 'spend', 'geo.country', 'extra']);
  assert.deepEqual(j.columns.map((c) => c.type), ['date', 'number', 'text', 'text']);
  assert.equal(seen.at(-1)!.headers['X-Api-Key'], 'k3y-value');
  // without a path the first list is found; a top-level list works too
  assert.equal((await fetchConnectorTable('custom_url', { url: 'https://example.com/api' }, {}, json)).rows.length, 2);
  assert.equal((await fetchConnectorTable('custom_url', { url: 'https://example.com/api' }, {}, async () => ok('[{"a":1},{"a":2},{"a":3}]'))).rows.length, 3);

  for (const bad of ['http://example.com/x', 'https://localhost/x', 'https://10.1.2.3/x', 'https://example.com:8443/x', 'ftp://example.com', 'nonsense']) {
    await assert.rejects(fetchConnectorTable('custom_url', { url: bad }, {}, csv), DatasetError, bad);
  }
  await assert.rejects(fetchConnectorTable('custom_url', { url: 'https://example.com/x', headerName: 'Host' }, { headerValue: 'evil' }, csv), /not allowed/);
  await assert.rejects(fetchConnectorTable('custom_url', { url: 'https://example.com/x', headerName: 'bad name' }, { headerValue: 'v' }, csv), /not allowed/);
  await assert.rejects(fetchConnectorTable('custom_url', { url: 'https://example.com/x', headerName: 'Authorization' }, {}, csv), /both/);
  await assert.rejects(fetchConnectorTable('custom_url', { url: 'https://example.com/x' }, {}, async () => ok('<html>login</html>')), /web page/);
  await assert.rejects(fetchConnectorTable('custom_url', { url: 'https://example.com/x' }, {}, async () => ok('{"a": 1}')), /list of rows/);
  await assert.rejects(fetchConnectorTable('custom_url', { url: 'https://example.com/x' }, {}, async () => ok('{bad json')), /Could not|could not/);
  await assert.rejects(fetchConnectorTable('custom_url', { url: 'https://example.com/x' }, {}, async () => ({ status: 403, headers: {}, text: '' })), /refused/);
  await assert.rejects(fetchConnectorTable('custom_url', { url: 'https://example.com/x' }, {}, async () => { throw new SsrfError('REDIRECT_BLOCKED', 'r'); }), /redirected/);
  assert.equal(findJsonRows({ a: { b: [{ x: 1 }] } }, 'a.b')?.length, 1);
  assert.equal(findJsonRows({ a: 1 }, 'a.b.c'), null);
  assert.deepEqual(jsonRowsToGrid([{ a: 1 }, { b: 2 }]), [['a', 'b'], ['1', ''], ['', '2']]);
  // optional fields may be left out, required ones may not
  const info = connectorById('custom_url')!;
  assert.deepEqual(splitConnectorInput(info, { url: ' https://x.com/a ', headerName: '', headerValue: '' }), { params: { url: 'https://x.com/a' }, secrets: {} });
  assert.throws(() => splitConnectorInput(info, { headerName: 'x' }), DatasetError);
});
