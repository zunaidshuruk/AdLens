import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** What one incoming lead looks like once cleaned up. */
export interface IncomingLead { name: string; website: string; email: string; phone: string; value: number; notes: string }

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const key = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, '');

const NAME = ['name', 'fullname', 'leadname', 'contactname', 'customername'];
const FIRST = ['firstname', 'givenname'];
const LAST = ['lastname', 'surname', 'familyname'];
const COMPANY = ['company', 'companyname', 'business', 'businessname', 'organization', 'organisation'];
const EMAIL = ['email', 'emailaddress', 'workemail', 'mail'];
const PHONE = ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'tel', 'cell'];
const SITE = ['website', 'site', 'url', 'websiteurl', 'web', 'companywebsite'];
const VALUE = ['value', 'dealvalue', 'amount', 'budget'];
const NOTES = ['notes', 'note', 'message', 'comments', 'comment', 'details'];

/**
 * Turns whatever a tool sent (a flat object from Zapier or Make, a Google Ads lead form, a Facebook-style field list, or a CSV row)
 * into a lead. Unknown fields are kept in the notes so nothing is lost. Returns null when there is nothing to call the lead.
 */
export function normaliseIncoming(raw: unknown): IncomingLead | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const flat = new Map<string, string>();
  const extra: string[] = [];
  const add = (k: string, v: unknown) => { const s = text(v, 2000); if (s && !flat.has(key(k))) flat.set(key(k), s); };
  const o = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || typeof v === 'object') continue;
    add(k, v);
  }
  // Google Ads lead forms: user_column_data [{ column_id, column_name, string_value }]
  const ucd = o.user_column_data;
  if (Array.isArray(ucd)) for (const c of ucd.slice(0, 40)) { if (c && typeof c === 'object') { const r = c as Record<string, unknown>; add(String(r.column_id ?? r.column_name ?? ''), r.string_value); } }
  // Facebook/Meta style: field_data [{ name, values: [] }]
  const fd = o.field_data;
  if (Array.isArray(fd)) for (const c of fd.slice(0, 40)) { if (c && typeof c === 'object') { const r = c as Record<string, unknown>; add(String(r.name ?? ''), Array.isArray(r.values) ? r.values[0] : r.value); } }
  const pick = (names: string[]): string => { for (const n of names) { const v = flat.get(n); if (v) return v; } return ''; };
  const first = pick(FIRST); const last = pick(LAST);
  const company = pick(COMPANY);
  const name = text(pick(NAME) || [first, last].filter(Boolean).join(' ') || company, 100);
  const email = text(pick(EMAIL), 120);
  const phone = text(pick(PHONE), 40);
  if (!name && !email && !phone) return null;
  const used = new Set([...NAME, ...FIRST, ...LAST, ...COMPANY, ...EMAIL, ...PHONE, ...SITE, ...VALUE, ...NOTES, 'leadid', 'googlekey', 'key', 'gclid', 'formid', 'campaignid', 'adgroupid', 'creativeid', 'apiversion', 'isfortest']);
  for (const [k, v] of flat) if (!used.has(k) && extra.length < 8) extra.push(`${k}: ${v}`);
  const rawValue = Number(pick(VALUE).replace(/[^0-9.]/g, ''));
  const noteParts = [pick(NOTES), company && name !== company ? `Company: ${company}` : '', ...extra].filter(Boolean);
  return {
    name: name || email || phone, website: text(pick(SITE), 200), email, phone,
    value: Number.isFinite(rawValue) && rawValue > 0 && rawValue <= 1_000_000_000 ? rawValue : 0,
    notes: text(noteParts.join('\n'), 2000),
  };
}

const norm = (s: string) => s.trim().toLowerCase();
/** The same person twice: same email, or the same phone digits, or the same name and website. */
export function duplicateOf(c: IncomingLead, existing: { name: string; email: string; phone: string; website: string }[]): boolean {
  const digits = (p: string) => p.replace(/\D/g, '');
  return existing.some((e) => (c.email && norm(e.email) === norm(c.email)) || (digits(c.phone).length >= 7 && digits(e.phone) === digits(c.phone)) || (!c.email && norm(e.name) === norm(c.name) && norm(e.website) === norm(c.website)));
}

export const newCaptureKey = (): string => `ll_${randomBytes(24).toString('base64url')}`;
export const hashCaptureKey = (k: string): string => createHash('sha256').update(k).digest('hex');
export function captureKeyMatches(given: string, storedHash: string): boolean {
  if (!given || !storedHash) return false;
  const a = Buffer.from(hashCaptureKey(given)); const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
