/**
 * Google Business Profile (Sprint 46c, 46d): locations, performance numbers, reviews, replies and posts.
 * One connection per workspace, sealed to the person who connected. Google only allows these APIs for Cloud projects it has approved,
 * so every call here reports Google's refusal in plain words instead of failing silently.
 * All network access goes through the injected `fetchFn` so tests never touch Google.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getAdminFirestore } from './firestore.js';
import { openAgentSecret, sealAgentSecret } from './tokenVault.js';
import { getAgentKeyring } from './vault.js';

export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';
export class GbpError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

export interface GbpLocation { account: string; name: string; title: string; address: string; website: string }
export interface GbpRecord {
  id: string; // the workspace id
  sealedRefresh: string; googleEmail: string | null; connectedBy: string; connectedByEmail: string | null; connectedAt: string;
  locations: GbpLocation[]; links: Record<string, { account: string; location: string; title: string }>;
  lastError: string | null; lastRunAt: string | null;
}
export interface GbpStore { get(id: string): Promise<GbpRecord | null>; put(r: GbpRecord): Promise<void>; delete(id: string): Promise<boolean>; listAll(): Promise<GbpRecord[]> }
const COLLECTION = 'gbpConnections';
const firestoreStore: GbpStore = {
  async get(id) { const s = await getAdminFirestore().collection(COLLECTION).doc(id).get(); return s.exists ? ({ ...(s.data() as object), id: s.id } as GbpRecord) : null; },
  async put(r) { const { id, ...rest } = r; await getAdminFirestore().collection(COLLECTION).doc(id).set(rest); },
  async delete(id) { const ref = getAdminFirestore().collection(COLLECTION).doc(id); const s = await ref.get(); if (!s.exists) return false; await ref.delete(); return true; },
  async listAll() { const s = await getAdminFirestore().collection(COLLECTION).get(); return s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as GbpRecord); },
};
export function createInMemoryGbpStore(): GbpStore {
  const m = new Map<string, GbpRecord>();
  return { async get(id) { const v = m.get(id); return v ? structuredClone(v) : null; }, async put(r) { m.set(r.id, structuredClone(r)); }, async delete(id) { return m.delete(id); }, async listAll() { return [...m.values()].map((v) => structuredClone(v)); } };
}
let testStore: GbpStore | null = null;
export const setTestGbpStore = (s: GbpStore | null): void => { testStore = s; };
export const getGbpStore = (): GbpStore => testStore ?? firestoreStore;
export const gbpScope = (wsId: string) => `gbp-${wsId}`;
export const sealRefresh = (token: string, uid: string, wsId: string) => sealAgentSecret(token, uid, gbpScope(wsId), getAgentKeyring());
export const openRefresh = (r: GbpRecord) => openAgentSecret(r.sealedRefresh, r.connectedBy, gbpScope(r.id), getAgentKeyring());

// ---------------------------------------------------------------------------
// Talking to Google
// ---------------------------------------------------------------------------
export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
export interface GbpDeps { fetchFn: FetchFn; now: () => number }
export const defaultGbpDeps = (): GbpDeps => ({ fetchFn: (u, i) => fetch(u, i as RequestInit), now: Date.now });

export const APPROVAL_HINT = 'Google has not approved this Google Cloud project for Business Profile access yet. Apply for access in Google\'s Business Profile API request form, then try again (approval can take days to weeks).';

async function readJson(r: { status: number; text(): Promise<string> }): Promise<unknown> {
  const text = await r.text();
  if (r.status === 401) throw new GbpError('GBP_REAUTH', 'Google no longer accepts the saved connection. Disconnect and connect again.', 401);
  if (r.status === 403) throw new GbpError('GBP_NOT_APPROVED', /quota|disabled|not been used|PERMISSION_DENIED|forbidden|approved/i.test(text) ? APPROVAL_HINT : 'Google refused this request. Check that the connected Google account manages this business.', 403);
  if (r.status === 429) throw new GbpError('GBP_RATE_LIMITED', 'Google says too many requests were sent (Business Profile quotas are small). Try again in a few minutes.', 429);
  if (r.status >= 400) throw new GbpError('GBP_ERROR', `Google answered with an error (${r.status}).`, 502);
  try { return text ? JSON.parse(text) : {}; } catch { throw new GbpError('GBP_BAD_REPLY', 'Google did not answer with data we can read.', 502); }
}

export async function exchangeCode(deps: GbpDeps, o: { code: string; clientId: string; clientSecret: string; redirectUri: string }): Promise<{ refreshToken: string | null; accessToken: string | null; idToken: string | null }> {
  const body = new URLSearchParams({ code: o.code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirectUri, grant_type: 'authorization_code' }).toString();
  const r = await deps.fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = (await r.text().then((t) => { try { return JSON.parse(t); } catch { return {}; } })) as { refresh_token?: string; access_token?: string; id_token?: string };
  if (r.status >= 400) throw new GbpError('GBP_TOKEN', 'Google did not accept the sign-in. Try connecting again.', 400);
  return { refreshToken: j.refresh_token ?? null, accessToken: j.access_token ?? null, idToken: j.id_token ?? null };
}
export async function refreshAccessToken(deps: GbpDeps, o: { refreshToken: string; clientId: string; clientSecret: string }): Promise<string> {
  const body = new URLSearchParams({ refresh_token: o.refreshToken, client_id: o.clientId, client_secret: o.clientSecret, grant_type: 'refresh_token' }).toString();
  const r = await deps.fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const text = await r.text(); let j: { access_token?: string } = {}; try { j = JSON.parse(text) as typeof j; } catch { /* handled below */ }
  if (r.status >= 400 || !j.access_token) throw new GbpError('GBP_REAUTH', 'Google no longer accepts the saved connection. Disconnect and connect again.', 401);
  return j.access_token;
}
export function revokeToken(deps: GbpDeps, token: string): Promise<unknown> {
  return deps.fetchFn('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }).catch(() => undefined);
}

const auth = (t: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${t}`, Accept: 'application/json', ...extra });
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const NAME_RE = /^(accounts|locations)\/[A-Za-z0-9_-]{1,40}$/;
export const accountOk = (s: string) => /^accounts\/[A-Za-z0-9_-]{1,40}$/.test(s);
export const locationOk = (s: string) => /^locations\/[A-Za-z0-9_-]{1,40}$/.test(s);
void NAME_RE;

export async function listLocations(deps: GbpDeps, token: string): Promise<GbpLocation[]> {
  const acc = (await readJson(await deps.fetchFn('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', { headers: auth(token) }))) as { accounts?: { name?: string }[] };
  const out: GbpLocation[] = [];
  for (const a of (acc.accounts ?? []).slice(0, 10)) {
    const account = str(a.name); if (!accountOk(account)) continue;
    const j = (await readJson(await deps.fetchFn(`https://mybusinessbusinessinformation.googleapis.com/v1/${account}/locations?readMask=name,title,storefrontAddress,websiteUri&pageSize=100`, { headers: auth(token) }))) as { locations?: { name?: string; title?: string; websiteUri?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }[] };
    for (const l of j.locations ?? []) {
      const name = str(l.name); if (!locationOk(name)) continue;
      const sa = l.storefrontAddress; out.push({ account, name, title: str(l.title).slice(0, 120), address: [...(sa?.addressLines ?? []), sa?.locality ?? ''].filter(Boolean).join(', ').slice(0, 200), website: str(l.websiteUri).slice(0, 200) });
    }
  }
  return out.slice(0, 100);
}

export const METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS'] as const;
export interface PerformanceDay { date: string; views: number; calls: number; websiteClicks: number; directions: number }
export interface Performance { days: PerformanceDay[]; totals: { views: number; calls: number; websiteClicks: number; directions: number } }
const iso = (d: Date) => d.toISOString().slice(0, 10);
export async function fetchPerformance(deps: GbpDeps, token: string, location: string, days: number): Promise<Performance> {
  const end = new Date(deps.now() - 2 * 86_400_000); // Google's numbers lag by a couple of days
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const q = new URLSearchParams();
  for (const m of METRICS) q.append('dailyMetrics', m);
  q.set('dailyRange.startDate.year', String(start.getUTCFullYear())); q.set('dailyRange.startDate.month', String(start.getUTCMonth() + 1)); q.set('dailyRange.startDate.day', String(start.getUTCDate()));
  q.set('dailyRange.endDate.year', String(end.getUTCFullYear())); q.set('dailyRange.endDate.month', String(end.getUTCMonth() + 1)); q.set('dailyRange.endDate.day', String(end.getUTCDate()));
  const j = (await readJson(await deps.fetchFn(`https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries?${q.toString()}`, { headers: auth(token) }))) as { multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: { datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: string }[] } }[] }[] };
  const byDay = new Map<string, PerformanceDay>();
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) byDay.set(iso(new Date(t)), { date: iso(new Date(t)), views: 0, calls: 0, websiteClicks: 0, directions: 0 });
  for (const group of j.multiDailyMetricTimeSeries ?? []) for (const s of group.dailyMetricTimeSeries ?? []) {
    const metric = str(s.dailyMetric);
    for (const v of s.timeSeries?.datedValues ?? []) {
      const d = v.date; if (!d?.year || !d.month || !d.day) continue;
      const row = byDay.get(`${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`); if (!row) continue;
      const n = Number(v.value ?? 0); if (!Number.isFinite(n)) continue;
      if (metric.startsWith('BUSINESS_IMPRESSIONS')) row.views += n; else if (metric === 'CALL_CLICKS') row.calls += n; else if (metric === 'WEBSITE_CLICKS') row.websiteClicks += n; else if (metric === 'BUSINESS_DIRECTION_REQUESTS') row.directions += n;
    }
  }
  const rows = [...byDay.values()];
  return { days: rows, totals: rows.reduce((a, r) => ({ views: a.views + r.views, calls: a.calls + r.calls, websiteClicks: a.websiteClicks + r.websiteClicks, directions: a.directions + r.directions }), { views: 0, calls: 0, websiteClicks: 0, directions: 0 }) };
}
/** Rows as a CSV the dashboards and reports can use as an uploaded table. */
export const performanceCsv = (p: Performance): string => ['date,views,calls,website_clicks,direction_requests', ...p.days.map((d) => `${d.date},${d.views},${d.calls},${d.websiteClicks},${d.directions}`)].join('\n');

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export interface GbpReview { reviewId: string; reviewer: string; stars: number; comment: string; createdAt: string; reply: string | null }
export async function fetchReviews(deps: GbpDeps, token: string, account: string, location: string): Promise<{ reviews: GbpReview[]; averageRating: number | null; total: number | null }> {
  if (!accountOk(account) || !locationOk(location)) throw new GbpError('GBP_BAD_LOCATION', 'That location is not valid.', 400);
  const out: GbpReview[] = []; let page = ''; let avg: number | null = null; let total: number | null = null;
  for (let i = 0; i < 3; i++) {
    const u = `https://mybusiness.googleapis.com/v4/${account}/${location}/reviews?pageSize=50&orderBy=${encodeURIComponent('updateTime desc')}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const j = (await readJson(await deps.fetchFn(u, { headers: auth(token) }))) as { reviews?: { reviewId?: string; reviewer?: { displayName?: string }; starRating?: string; comment?: string; createTime?: string; reviewReply?: { comment?: string } }[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string };
    if (typeof j.averageRating === 'number') avg = j.averageRating; if (typeof j.totalReviewCount === 'number') total = j.totalReviewCount;
    for (const r of j.reviews ?? []) {
      const reviewId = str(r.reviewId); const stars = STARS[str(r.starRating)]; if (!reviewId || !stars) continue;
      out.push({ reviewId, reviewer: str(r.reviewer?.displayName).slice(0, 80) || 'A customer', stars, comment: str(r.comment).slice(0, 4000), createdAt: str(r.createTime), reply: r.reviewReply?.comment ? str(r.reviewReply.comment) : null });
    }
    page = str(j.nextPageToken); if (!page) break;
  }
  return { reviews: out, averageRating: avg, total };
}
export async function replyToReview(deps: GbpDeps, token: string, account: string, location: string, reviewId: string, comment: string): Promise<void> {
  if (!accountOk(account) || !locationOk(location) || !/^[A-Za-z0-9_-]{1,200}$/.test(reviewId)) throw new GbpError('GBP_BAD_LOCATION', 'That review is not valid.', 400);
  await readJson(await deps.fetchFn(`https://mybusiness.googleapis.com/v4/${account}/${location}/reviews/${reviewId}/reply`, { method: 'PUT', headers: auth(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ comment }) }));
}
export async function createLocalPost(deps: GbpDeps, token: string, account: string, location: string, p: { summary: string; url?: string }): Promise<void> {
  if (!accountOk(account) || !locationOk(location)) throw new GbpError('GBP_BAD_LOCATION', 'That location is not valid.', 400);
  const body: Record<string, unknown> = { languageCode: 'en', summary: p.summary, topicType: 'STANDARD' };
  if (p.url) body.callToAction = { actionType: 'LEARN_MORE', url: p.url };
  await readJson(await deps.fetchFn(`https://mybusiness.googleapis.com/v4/${account}/${location}/localPosts`, { method: 'POST', headers: auth(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) }));
}

// ---------------------------------------------------------------------------
// Review items (what we keep per review: draft, status, alert flag)
// ---------------------------------------------------------------------------
export const reviewDocId = (reviewId: string): string => createHash('sha1').update(reviewId).digest('hex').slice(0, 24);
export type ReviewStatus = 'new' | 'drafted' | 'replied' | 'dismissed';
export interface ReviewItem { id: string; reviewId: string; reviewer: string; stars: number; comment: string; createdAt: string; replied: boolean; replyText: string; draft: string; status: ReviewStatus; alerted: boolean; firstSeenAt: string }
export const LOW_STAR = 3;

export const postInputSchema = z.object({
  text: z.string().trim().min(5, 'Write at least a short sentence').max(1500, 'Posts can be up to 1,500 characters'),
  url: z.string().trim().max(500).default(''),
  publishOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date').default(''),
});
export const replyInputSchema = z.object({ text: z.string().trim().min(2, 'Write the reply first').max(4000, 'Replies can be up to 4,000 characters') });

export const REPLY_SYSTEM = [
  'You write public replies from a business owner to a customer review on Google.',
  'Be warm, specific and brief (40 to 90 words). Thank the customer by first name if one is given. Mention one concrete detail from the review.',
  'For a 4 or 5 star review, show real appreciation and invite them back. For a 3 star or lower review, apologise sincerely without making excuses, do not argue, never reveal private details, and offer to make it right by inviting them to contact the business directly.',
  'Never promise refunds, discounts or outcomes. Do not mention that you are an AI. Return only the reply text.',
].join('\n');
export const replyPrompt = (r: { reviewer: string; stars: number; comment: string }, business: string): string => `Business: ${business}\nReviewer: ${r.reviewer}\nStars: ${r.stars} out of 5\nReview: ${r.comment || '(no written comment)'}\n\nWrite the reply.`;
