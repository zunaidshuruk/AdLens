/**
 * Data connectors: pull a small table from an outside service and keep it as an uploaded table (see datasets.ts).
 * Every request goes through the guarded request function (public addresses only, no redirects, size and time limits).
 * Pure apart from the injected request function, so tests never touch the network.
 */
import { validateOutboundUrl, guardedRequest, type RequestFn, SsrfError } from './ssrfGuard.js';
import { buildTable, tableFromGrid, DatasetError, MAX_CSV_CHARS, MAX_DATASET_ROWS, type DataCell, type DataColumn } from './datasets.js';

export interface ConnectorField { key: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string; help?: string }
export interface ConnectorInfo {
  id: string;
  label: string;
  group: 'Ads' | 'Store' | 'Spreadsheet' | 'Email and CRM' | 'Payments' | 'Video' | 'Custom';
  status: 'live' | 'soon';
  blurb: string;
  fields: ConnectorField[];
  /** Plain-language steps for getting the details this connector asks for. */
  steps?: string[];
  /** A ready-made setup that runs through another connector (for platforms that give you a report link or an API address and token). */
  base?: string;
}


/** Platforms offered as ready-made starting points for the custom connector: [id, name, group, where to find an export, usual sign-in header]. */
const PLATFORM_PRESETS: readonly (readonly [string, string, ConnectorInfo['group'], string, string])[] = [
  ['linkedin_ads', 'LinkedIn Ads', 'Ads', 'open Campaign Manager, then Analyze, then Export, and choose a date range.', 'Authorization'],
  ['tiktok_ads', 'TikTok Ads', 'Ads', 'open Ads Manager, then Reporting, then Download.', 'Access-Token'],
  ['google_ads', 'Google Ads', 'Ads', 'open Reports, build a table, then Download as CSV.', 'Authorization'],
  ['microsoft_ads', 'Microsoft Advertising', 'Ads', 'open Reports, run a report, then Download as CSV.', 'Authorization'],
  ['x_ads', 'X (Twitter) Ads', 'Ads', 'open Ads Manager, then Analytics, then Export data.', 'Authorization'],
  ['pinterest_ads', 'Pinterest Ads', 'Ads', 'open Ads Manager, then Reporting, then Download.', 'Authorization'],
  ['snapchat_ads', 'Snapchat Ads', 'Ads', 'open Ads Manager, then Export.', 'Authorization'],
  ['reddit_ads', 'Reddit Ads', 'Ads', 'open Reporting, then Download CSV.', 'Authorization'],
  ['youtube', 'YouTube Analytics', 'Video', 'open YouTube Studio, then Analytics, then Advanced mode, then Export current view.', 'Authorization'],
  ['mailchimp', 'Mailchimp', 'Email and CRM', 'open Reports, pick a campaign, then Download.', 'Authorization'],
  ['klaviyo', 'Klaviyo', 'Email and CRM', 'open Analytics, pick a report, then Export.', 'Authorization'],
  ['hubspot', 'HubSpot', 'Email and CRM', 'open Reports, pick a report, then Export.', 'Authorization'],
  ['stripe', 'Stripe', 'Payments', 'open Payments, then Export.', 'Authorization'],
  ['other_platform', 'Any other platform', 'Custom', 'find its Export or Download CSV button.', 'Authorization'],
];

export const SHOPIFY_API_VERSION = '2026-07';
const DAYS_BACK = 90;

export const CONNECTORS: ConnectorInfo[] = [
  {
    id: 'google_sheets', label: 'Google Sheets', group: 'Spreadsheet', status: 'live',
    blurb: 'Read one tab of a spreadsheet by its link. Refresh any time to pick up new rows.',
    fields: [{ key: 'url', label: 'Sheet link', placeholder: 'https://docs.google.com/spreadsheets/d/…' }],
    steps: ['Open the sheet and click Share.', 'Under General access choose “Anyone with the link” as Viewer.', 'Copy the link (open the tab you want first, so its tab id is in the link) and paste it here.', 'Use a header row; dates like 2026-10-31.'],
  },
  {
    id: 'shopify', label: 'Shopify', group: 'Store', status: 'live',
    blurb: `Orders from the last ${DAYS_BACK} days: date, total, discounts, items, country and source.`,
    fields: [
      { key: 'shop', label: 'Store address', placeholder: 'your-store.myshopify.com' },
      { key: 'token', label: 'Admin API access token', secret: true, placeholder: 'shpat_…' },
    ],
    steps: ['In Shopify admin open Settings, Apps and sales channels, Develop apps.', 'Create an app, and under Admin API scopes tick read_orders only.', 'Install the app and copy the Admin API access token.', 'Paste the store address and token here. The token is stored encrypted and is only used to read orders.'],
  },
  {
    id: 'woocommerce', label: 'WooCommerce', group: 'Store', status: 'live',
    blurb: `Orders from the last ${DAYS_BACK} days: date, total, discounts, items, country and source.`,
    fields: [
      { key: 'site', label: 'Website address', placeholder: 'https://your-shop.com' },
      { key: 'key', label: 'Consumer key', secret: true, placeholder: 'ck_…' },
      { key: 'secret', label: 'Consumer secret', secret: true, placeholder: 'cs_…' },
    ],
    steps: ['In WordPress open WooCommerce, Settings, Advanced, REST API.', 'Add a key with Read permission only.', 'Copy the consumer key and secret (shown once) and paste them here. The site must use https.'],
  },
  {
    id: 'custom_url', label: 'Custom link (CSV or JSON)', group: 'Custom', status: 'live',
    blurb: 'Connect anything that has a web address returning a CSV file or a JSON list, for example a report link, an internal API or a published feed. Refresh any time.',
    fields: [
      { key: 'url', label: 'Address (https)', placeholder: 'https://example.com/report.csv' },
      { key: 'headerName', label: 'Sign-in header name (optional)', optional: true, placeholder: 'Authorization or X-Api-Key' },
      { key: 'headerValue', label: 'Sign-in header value (optional)', secret: true, optional: true, placeholder: 'Bearer abc123… or the key itself' },
      { key: 'path', label: 'Where the rows are inside the JSON (optional)', optional: true, placeholder: 'data.items' },
    ],
    steps: ['Paste the https address. It must answer a plain GET request with CSV text or JSON.', 'If it needs a key, enter the header name and value your provider gives you. The value is stored encrypted.', 'For JSON, rows are a list of objects. If the list is not at the top, type where it is (for example data.items); otherwise we look for it.', 'Up to 5,000 rows and 20 columns. Only read access is used.'],
  },
  ...PLATFORM_PRESETS.map(([id, label, group, where, header]): ConnectorInfo => ({
    id, label, group, status: 'live', base: 'custom_url',
    blurb: `Bring ${label} numbers in as a table, using a report link or an API address and your own access token. One-click sign-in is added later once ${label} approves AdLens.`,
    fields: [
      { key: 'url', label: 'Report or API address (https)', placeholder: 'https://…' },
      { key: 'headerName', label: 'Sign-in header name (optional)', optional: true, placeholder: header },
      { key: 'headerValue', label: 'Access token or key (optional)', secret: true, optional: true, placeholder: header === 'Authorization' ? 'Bearer your-token' : 'your-token' },
      { key: 'path', label: 'Where the rows are inside the JSON (optional)', optional: true, placeholder: 'data.items' },
    ],
    steps: [
      `Easiest: in ${label}, ${where} Save the CSV and upload it in Explore. Nothing to connect.`,
      `To refresh by itself, use an address that answers a plain GET request with CSV or a JSON list, for example a scheduled-report link from ${label}.`,
      'If it needs a token, enter the header name and value your platform shows. The value is stored encrypted and never shown again.',
      'Tokens that expire quickly (some platforms expire them in a day) stop working until you paste a new one. Refresh shows a clear message when that happens.',
    ],
  })),
];

export const connectorById = (id: string): ConnectorInfo | undefined => CONNECTORS.find((c) => c.id === id);

export interface FetchedTable { columns: DataColumn[]; rows: DataCell[][]; note?: string }

const fail = (message: string) => new DatasetError('CONNECTOR_FAILED', message, 400);

function mapNetworkError(e: unknown, who: string): DatasetError {
  if (e instanceof DatasetError) return e;
  if (e instanceof SsrfError) {
    if (e.code === 'REQUEST_TIMEOUT') return fail(`${who} took too long to answer. Try again in a minute.`);
    if (e.code === 'RESPONSE_TOO_LARGE') return fail(`${who} sent more data than we can handle. Try a smaller date range or tab.`);
    if (e.code === 'REDIRECT_BLOCKED') return fail(`${who} redirected the request, which is not allowed. Check the address.`);
    return fail(`Could not reach ${who}. Check the address and try again.`);
  }
  return fail(`Could not reach ${who}. Try again.`);
}

// ---------------------------------------------------------------------------
// Google Sheets (public link, CSV export)
// ---------------------------------------------------------------------------

export function parseSheetLink(raw: string): { id: string; gid: string | null } | null {
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#].*)?$/.exec(raw.trim());
  if (!m) return null;
  const gid = /[#?&]gid=(\d{1,12})/.exec(raw)?.[1] ?? null;
  return { id: m[1], gid };
}

const GOOGLE_HOSTS = /(^|\.)(google\.com|googleusercontent\.com)$/;

export async function fetchGoogleSheet(params: Record<string, string>, request: RequestFn): Promise<FetchedTable> {
  const link = parseSheetLink(params.url ?? '');
  if (!link) throw fail('That does not look like a Google Sheets link. It should start with https://docs.google.com/spreadsheets/d/');
  let url = new URL(`https://docs.google.com/spreadsheets/d/${link.id}/export?format=csv${link.gid ? `&gid=${link.gid}` : ''}`);
  for (let hop = 0; hop < 4; hop += 1) {
    let res;
    try {
      res = await request(url, { method: 'GET', headers: { accept: 'text/csv' }, timeoutMs: 20_000, maxResponseBytes: MAX_CSV_CHARS * 2 });
    } catch (e) {
      // Google answers with redirects (to its own download host, or to a sign-in page); follow only Google hosts.
      if (e instanceof SsrfError && e.code === 'REDIRECT_BLOCKED') {
        const loc = (e as SsrfError & { location?: string }).location;
        if (loc) {
          const next = new URL(loc, url);
          if (next.protocol === 'https:' && GOOGLE_HOSTS.test(next.hostname) && next.hostname !== 'accounts.google.com') { url = next; continue; }
        }
        throw fail('Google asked for a sign-in. Set the sheet’s sharing to “Anyone with the link can view” and try again.');
      }
      throw mapNetworkError(e, 'Google Sheets');
    }
    if (res.status === 404) throw fail('That sheet or tab was not found. Check the link.');
    if (res.status === 401 || res.status === 403) throw fail('Google would not share that sheet. Set sharing to “Anyone with the link can view”.');
    if (res.status !== 200) throw fail('Google Sheets did not return the data. Try again.');
    if (/^\s*<(!doctype|html)/i.test(res.text)) throw fail('Google returned a web page instead of data. Set sharing to “Anyone with the link can view”.');
    return buildTable(res.text);
  }
  throw fail('Google Sheets redirected too many times.');
}

// ---------------------------------------------------------------------------
// Shopify and WooCommerce orders
// ---------------------------------------------------------------------------

const ORDER_COLUMNS: DataColumn[] = [
  { key: 'c1', label: 'Date', type: 'date' },
  { key: 'c2', label: 'Order', type: 'text' },
  { key: 'c3', label: 'Status', type: 'text' },
  { key: 'c4', label: 'Total', type: 'number' },
  { key: 'c5', label: 'Discounts', type: 'number' },
  { key: 'c6', label: 'Items', type: 'number' },
  { key: 'c7', label: 'Country', type: 'text' },
  { key: 'c8', label: 'Source', type: 'text' },
  { key: 'c9', label: 'Currency', type: 'text' },
];

const num = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) ? n : null; };
const str = (v: unknown, max = 80): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const day = (v: unknown): string | null => { const s = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(v)?.[1] : null; return s ?? null; };
const itemCount = (items: unknown): number => (Array.isArray(items) ? items.reduce((s: number, i: { quantity?: unknown }) => s + (num(i?.quantity) ?? 0), 0) : 0);
const since = (now: Date) => new Date(now.getTime() - DAYS_BACK * 86_400_000).toISOString();

export function normaliseShop(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const host = t.endsWith('.myshopify.com') ? t : `${t}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(host) ? host : null;
}

function nextLink(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header.join(',') : header ?? '';
  const m = /<([^>]+)>;\s*rel="next"/.exec(h);
  return m ? m[1] : null;
}

export async function fetchShopify(params: Record<string, string>, secrets: Record<string, string>, request: RequestFn, now = new Date()): Promise<FetchedTable> {
  const host = normaliseShop(params.shop ?? '');
  if (!host) throw fail('Enter your store address like your-store.myshopify.com.');
  const token = secrets.token ?? '';
  if (!/^[\x21-\x7e]{10,200}$/.test(token)) throw fail('Paste the Admin API access token (it starts with shpat_).');
  const fields = 'created_at,name,financial_status,total_price,total_discounts,currency,line_items,shipping_address,billing_address,source_name';
  let url: URL | null = new URL(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since(now))}&fields=${fields}`);
  const rows: DataCell[][] = [];
  let note: string | undefined;
  for (let page = 0; page < 25 && url; page += 1) {
    let res;
    try {
      res = await request(url, { method: 'GET', headers: { 'X-Shopify-Access-Token': token }, timeoutMs: 25_000, maxResponseBytes: 12_000_000 });
    } catch (e) { throw mapNetworkError(e, 'Shopify'); }
    if (res.status === 401) throw fail('Shopify rejected the access token. Check it and try again.');
    if (res.status === 403) throw fail('The token is missing the read_orders permission. Add it to the app and reinstall.');
    if (res.status === 404) throw fail('Shopify could not find that store. Check the address.');
    if (res.status === 429) throw fail('Shopify is asking us to slow down. Try again in a minute.');
    if (res.status !== 200) throw fail('Shopify did not return the orders. Try again.');
    let body: { orders?: Record<string, any>[] };
    try { body = JSON.parse(res.text); } catch { throw fail('Shopify sent an answer we could not read.'); }
    for (const o of body.orders ?? []) {
      const addr = o.shipping_address ?? o.billing_address ?? {};
      rows.push([day(o.created_at), str(o.name), str(o.financial_status), num(o.total_price), num(o.total_discounts), itemCount(o.line_items), str(addr.country), str(o.source_name), str(o.currency, 10)]);
    }
    const link = nextLink(res.headers.link);
    url = null;
    if (link) {
      const next = new URL(link);
      if (next.protocol === 'https:' && next.hostname === host && next.pathname.startsWith('/admin/api/')) url = next;
    }
    if (rows.length >= MAX_DATASET_ROWS) { if (url) note = `Showing the newest ${MAX_DATASET_ROWS.toLocaleString()} orders from the last ${DAYS_BACK} days.`; break; }
  }
  if (rows.length === 0) throw fail(`No orders in the last ${DAYS_BACK} days (Shopify only shares the last 60 days unless the app has the read_all_orders permission).`);
  return { columns: ORDER_COLUMNS, rows: rows.slice(0, MAX_DATASET_ROWS), ...(note ? { note } : {}) };
}

export function normaliseSite(raw: string): URL | null {
  try {
    const u = validateOutboundUrl(raw.trim(), { allowedPorts: [443] });
    if (u.protocol !== 'https:') return null;
    u.search = ''; u.hash = ''; u.username = ''; u.password = '';
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u;
  } catch { return null; }
}

export async function fetchWooCommerce(params: Record<string, string>, secrets: Record<string, string>, request: RequestFn, now = new Date()): Promise<FetchedTable> {
  const site = normaliseSite(params.site ?? '');
  if (!site) throw fail('Enter your website address starting with https:// (the site must use https).');
  const key = secrets.key ?? '';
  const secret = secrets.secret ?? '';
  if (!/^[\x21-\x7e]{8,200}$/.test(key) || !/^[\x21-\x7e]{8,200}$/.test(secret)) throw fail('Paste both the consumer key (ck_…) and the consumer secret (cs_…).');
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
  const rows: DataCell[][] = [];
  let note: string | undefined;
  for (let page = 1; page <= 60; page += 1) {
    const url = new URL(`${site.origin}${site.pathname}/wp-json/wc/v3/orders`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('after', since(now));
    url.searchParams.set('orderby', 'date');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('_fields', 'date_created,number,status,total,total_discount,currency,line_items,billing,shipping,created_via');
    let res;
    try {
      res = await request(url, { method: 'GET', headers: { Authorization: auth }, timeoutMs: 25_000, maxResponseBytes: 8_000_000 });
    } catch (e) { throw mapNetworkError(e, 'your shop'); }
    if (res.status === 401 || res.status === 403) throw fail('The shop rejected the key. Check the consumer key and secret, and that the key has Read permission.');
    if (res.status === 404) throw fail('Could not find the WooCommerce API at that address. Check the website address and that WooCommerce is installed.');
    if (res.status !== 200) throw fail('Your shop did not return the orders. Try again.');
    let list: Record<string, any>[];
    try { list = JSON.parse(res.text); } catch { throw fail('Your shop sent an answer we could not read.'); }
    if (!Array.isArray(list)) throw fail('Your shop sent an answer we could not read.');
    for (const o of list) {
      const country = str(o.shipping?.country) ?? str(o.billing?.country);
      rows.push([day(o.date_created), str(o.number), str(o.status), num(o.total), num(o.total_discount), itemCount(o.line_items), country, str(o.created_via), str(o.currency, 10)]);
    }
    if (list.length < 100) break;
    if (rows.length >= MAX_DATASET_ROWS) { note = `Showing the newest ${MAX_DATASET_ROWS.toLocaleString()} orders from the last ${DAYS_BACK} days.`; break; }
  }
  if (rows.length === 0) throw fail(`No orders in the last ${DAYS_BACK} days.`);
  return { columns: ORDER_COLUMNS, rows: rows.slice(0, MAX_DATASET_ROWS), ...(note ? { note } : {}) };
}

// ---------------------------------------------------------------------------
// Custom link (CSV or JSON)
// ---------------------------------------------------------------------------

const BLOCKED_HEADERS = /^(host|content-length|transfer-encoding|connection|upgrade|te|trailer|proxy-.*|keep-alive|expect)$/i;

function scalar(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Finds the list of row objects: at the given path, at the top, or in the first list-valued property. */
export function findJsonRows(data: unknown, path: string | undefined): Record<string, unknown>[] | null {
  let node: unknown = data;
  if (path) {
    for (const part of path.split('.').filter(Boolean)) {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
      node = (node as Record<string, unknown>)[part];
    }
  }
  if (!Array.isArray(node) && typeof node === 'object' && node !== null && !path) {
    // No path given: look for the first list of objects, up to three levels down.
    const search = (n: unknown, depth: number): unknown[] | undefined => {
      if (Array.isArray(n)) return n.length > 0 && typeof n[0] === 'object' && n[0] !== null ? n : undefined;
      if (depth === 0 || typeof n !== 'object' || n === null) return undefined;
      for (const v of Object.values(n as Record<string, unknown>)) { const f = search(v, depth - 1); if (f) return f; }
      return undefined;
    };
    node = search(node, 3);
  }
  if (!Array.isArray(node)) return null;
  const rows = node.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r));
  return rows.length > 0 ? rows : null;
}

/** Turns a list of objects into a grid: columns are the keys (one level of nested objects becomes "a.b"), values must be simple. */
export function jsonRowsToGrid(rows: Record<string, unknown>[]): string[][] {
  const flat = rows.slice(0, MAX_DATASET_ROWS + 1).map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out[`${k}.${k2}`] = scalar(v2);
      } else out[k] = scalar(v);
    }
    return out;
  });
  const keys: string[] = [];
  for (const r of flat.slice(0, 200)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return [keys, ...flat.map((r) => keys.map((k) => r[k] ?? ''))];
}

export async function fetchCustomUrl(params: Record<string, string>, secrets: Record<string, string>, request: RequestFn): Promise<FetchedTable> {
  let url: URL;
  try {
    url = validateOutboundUrl((params.url ?? '').trim(), { allowedPorts: [443] });
  } catch { throw fail('Enter an address starting with https:// that is reachable on the public internet.'); }
  if (url.protocol !== 'https:') throw fail('The address must start with https://.');
  const headers: Record<string, string> = { accept: 'text/csv, application/json;q=0.9, */*;q=0.1' };
  const name = (params.headerName ?? '').trim();
  const value = (secrets.headerValue ?? '').trim();
  if (name || value) {
    if (!name || !value) throw fail('Fill in both the sign-in header name and its value, or leave both empty.');
    if (!/^[A-Za-z0-9-]{1,40}$/.test(name) || BLOCKED_HEADERS.test(name)) throw fail('That header name is not allowed. Use something like Authorization or X-Api-Key.');
    if (!/^[\x20-\x7e]{1,400}$/.test(value)) throw fail('The header value has characters that are not allowed.');
    headers[name] = value;
  }
  let res;
  try {
    res = await request(url, { method: 'GET', headers, timeoutMs: 25_000, maxResponseBytes: 3_000_000 });
  } catch (e) { throw mapNetworkError(e, 'that address'); }
  if (res.status === 401 || res.status === 403) throw fail('That address refused the request. Check the sign-in header name and value.');
  if (res.status === 404) throw fail('Nothing was found at that address.');
  if (res.status === 429) throw fail('That service is asking us to slow down. Try again in a minute.');
  if (res.status !== 200) throw fail('That address did not return data. Try opening it in a browser first.');
  const body = res.text.replace(/^\uFEFF/, '').trim();
  if (body === '') throw fail('That address returned nothing.');
  if (body.startsWith('{') || body.startsWith('[')) {
    let data: unknown;
    try { data = JSON.parse(body); } catch { throw fail('That address returned JSON we could not read.'); }
    const rows = findJsonRows(data, (params.path ?? '').trim() || undefined);
    if (!rows) throw fail('Could not find a list of rows in that JSON. Type where the list is (for example data.items).');
    const grid = jsonRowsToGrid(rows);
    const table = tableFromGrid(grid);
    return rows.length > MAX_DATASET_ROWS ? { ...table, note: `Showing the first ${MAX_DATASET_ROWS.toLocaleString()} rows.` } : table;
  }
  if (/^<(!doctype|html)/i.test(body)) throw fail('That address returned a web page, not data. Use a link that returns CSV or JSON.');
  return buildTable(body);
}

/** Runs one connector. `secrets` holds only the fields the connector marks secret. */
export async function fetchConnectorTable(id: string, params: Record<string, string>, secrets: Record<string, string>, request: RequestFn = (u, o) => guardedRequest(u, o), now = new Date()): Promise<FetchedTable> {
  switch (connectorById(id)?.base ?? id) {
    case 'google_sheets': return fetchGoogleSheet(params, request);
    case 'shopify': return fetchShopify(params, secrets, request, now);
    case 'woocommerce': return fetchWooCommerce(params, secrets, request, now);
    case 'custom_url': return fetchCustomUrl(params, secrets, request);
    default: throw fail('That connector is not available yet.');
  }
}

/** Splits submitted values into plain parameters and secrets according to the connector's field list. Rejects anything unexpected. */
export function splitConnectorInput(info: ConnectorInfo, values: unknown): { params: Record<string, string>; secrets: Record<string, string> } {
  if (typeof values !== 'object' || values === null) throw fail('Fill in the details.');
  const params: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of info.fields) {
    const v = (values as Record<string, unknown>)[f.key];
    if (f.optional && (v === undefined || v === null || (typeof v === 'string' && v.trim() === ''))) continue;
    if (typeof v !== 'string' || v.trim() === '' || v.length > 400) throw fail(`Fill in “${f.label}”.`);
    (f.secret ? secrets : params)[f.key] = v.trim();
  }
  return { params, secrets };
}

export { MAX_CSV_CHARS };
