import { Router, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { getContentLimits } from '../config/plans.js';
import { getProviderFor, ProviderError } from '../lib/dataProviders.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { businessInputSchema, competitorAccumulator, costFor, findOwn, gridPoints, lookupsFor, MAX_LOOKUPS_PER_SCAN, reviewLinkFor, summarize, zoomFor, type LocalCompetitor, type ScanPoint } from '../lib/localSeo.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore, newDocId, type StoredDoc } from '../lib/projectDocs.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { guardedRequest, type RequestFn } from '../lib/ssrfGuard.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** Local SEO: map rank tracker and local competitors (Sprint 46a, 46b). */
export const localRouter = Router();
const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
const deps: { request: RequestFn; now: () => number } = { request: (u, o) => guardedRequest(u, o), now: Date.now };
export function setLocalTestDeps(d: Partial<typeof deps> | null): void { deps.request = d?.request ?? ((u, o) => guardedRequest(u, o)); deps.now = d?.now ?? Date.now; }

localRouter.use(requireUser);
localRouter.use(verifyGoogleSessionOwnership);
localRouter.use(loadProject);

interface Scope { plan: string | undefined; uid: string; ws: string; project: string; canEdit: boolean }
async function scope(req: Request, res: Response, write: boolean): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  const uid = req.user!.uid;
  if (!ws || !can(ws, uid, write ? 'content.edit' : 'reports.view')) { fail(res, 403, 'NOT_ALLOWED', write ? 'You do not have permission to change local tracking in this project.' : 'You do not have permission to see this project.'); return null; }
  return { plan: ws.plan, uid, ws: project.workspaceId, project: project.id, canEdit: can(ws, uid, 'content.edit') };
}
const idOk = z.string().regex(/^[A-Za-z0-9_-]{1,60}$/);

export interface BusinessDoc { id: string; name: string; matchName: string; address: string; lat: number; lng: number; radiusKm: number; gridSize: 3 | 5 | 7; keywords: string[]; placeId: string; createdAt: string; updatedAt: string }
const toBusiness = (d: StoredDoc): BusinessDoc => ({
  id: d.id, name: String(d.name ?? ''), matchName: String(d.matchName ?? ''), address: String(d.address ?? ''), lat: Number(d.lat ?? 0), lng: Number(d.lng ?? 0), radiusKm: Number(d.radiusKm ?? 3),
  gridSize: d.gridSize === 3 || d.gridSize === 7 ? d.gridSize : 5, keywords: Array.isArray(d.keywords) ? d.keywords.map(String) : [], placeId: String(d.placeId ?? ''), createdAt: String(d.createdAt ?? ''), updatedAt: String(d.updatedAt ?? ''),
});
interface ScanDoc { id: string; businessId: string; at: string; gridSize: number; radiusKm: number; keywords: string[]; points: ScanPoint[]; summary: ReturnType<typeof summarize>; competitors: LocalCompetitor[]; own: LocalCompetitor | null; lookups: number; failed: number }
const toScan = (d: StoredDoc): ScanDoc => d as unknown as ScanDoc;
const brief = (s: ScanDoc) => ({ id: s.id, at: s.at, summary: s.summary, own: s.own ? { rating: s.own.rating, reviews: s.own.reviews } : null, lookups: s.lookups });

const businesses = async (s: Scope) => (await getProjectDocsStore().list(s.ws, s.project, 'localBusinesses')).map(toBusiness).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const scansOf = async (s: Scope, businessId: string) => (await getProjectDocsStore().list(s.ws, s.project, 'localScans')).filter((d) => d.businessId === businessId).map(toScan).sort((a, b) => a.at.localeCompare(b.at));

localRouter.get('/', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const provider = await getProviderFor(s.ws);
    const list = await businesses(s);
    const out = [];
    for (const b of list) {
      const scans = await scansOf(s, b.id);
      const last = scans[scans.length - 1];
      out.push({ ...b, lastScan: last ? brief(last) : null, scanCount: scans.length });
    }
    res.json({ businesses: out, limit: getContentLimits(s.plan).maxLocalBusinesses, canEdit: s.canEdit, providerConnected: provider.connected && Boolean(provider.mapsSearch), providerName: provider.connected ? provider.name : null, maxLookups: MAX_LOOKUPS_PER_SCAN });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

// Turn a street address or place name into map coordinates (OpenStreetMap's free search; no key needed).
localRouter.post('/geocode', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = z.object({ query: z.string().trim().min(3).max(200) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Type an address or place name.');
    const rl = await checkRateLimit('local-geocode', s.uid, 30, 3_600_000);
    if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', 'Too many address searches. Try again later.');
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', parsed.data.query); u.searchParams.set('format', 'jsonv2'); u.searchParams.set('limit', '1');
    let r;
    try { r = await deps.request(u, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'AdLens/1.0 (local rank tracker)' }, timeoutMs: 10_000, maxResponseBytes: 200_000 }); } catch { return fail(res, 502, 'GEOCODE_FAILED', 'The address search could not be reached. Paste the coordinates instead.'); }
    let hit: { lat?: string; lon?: string; display_name?: string } | undefined;
    try { hit = (JSON.parse(r.text) as unknown[])[0] as typeof hit; } catch { /* fall through */ }
    const lat = Number(hit?.lat); const lng = Number(hit?.lon);
    if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 404, 'NOT_FOUND', 'Could not find that place. Try a fuller address, or paste the coordinates from Google Maps.');
    res.json({ lat, lng, label: String(hit.display_name ?? '').slice(0, 200) });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

localRouter.post('/business', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const parsed = businessInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the details and try again.');
    const existing = await businesses(s);
    const limit = getContentLimits(s.plan).maxLocalBusinesses;
    if (existing.length >= limit) return fail(res, 403, 'LIMIT_REACHED', `Your plan allows ${limit} business${limit === 1 ? '' : 'es'} in the local tracker.`);
    const keywords = [...new Set(parsed.data.keywords.map((k) => k.toLowerCase()))];
    const now = new Date(deps.now()).toISOString();
    const doc = { id: newDocId(), ...parsed.data, keywords, createdAt: now, updatedAt: now };
    await getProjectDocsStore().put(s.ws, s.project, 'localBusinesses', doc);
    res.status(201).json({ business: toBusiness(doc) });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

localRouter.put('/business/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid business.');
    const cur = await getProjectDocsStore().get(s.ws, s.project, 'localBusinesses', id.data);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That business was not found.');
    const parsed = businessInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Check the details and try again.');
    const keywords = [...new Set(parsed.data.keywords.map((k) => k.toLowerCase()))];
    const doc = { ...cur, ...parsed.data, keywords, id: id.data, updatedAt: new Date(deps.now()).toISOString() };
    await getProjectDocsStore().put(s.ws, s.project, 'localBusinesses', doc);
    res.json({ business: toBusiness(doc) });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

localRouter.delete('/business/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid business.');
    const docs = getProjectDocsStore();
    if (!(await docs.delete(s.ws, s.project, 'localBusinesses', id.data))) return fail(res, 404, 'NOT_FOUND', 'That business was not found.');
    for (const sc of await scansOf(s, id.data)) await docs.delete(s.ws, s.project, 'localScans', sc.id);
    res.json({ ok: true });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

/** What a scan would do and cost, before anything is spent. */
localRouter.get('/business/:id/estimate', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid business.');
    const cur = await getProjectDocsStore().get(s.ws, s.project, 'localBusinesses', id.data);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That business was not found.');
    const b = toBusiness(cur); const lookups = lookupsFor(b.gridSize, b.keywords.length);
    res.json({ lookups, estimatedCostUsd: costFor(lookups), tooBig: lookups > MAX_LOOKUPS_PER_SCAN, maxLookups: MAX_LOOKUPS_PER_SCAN });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

localRouter.get('/business/:id/scans', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid business.');
    const cur = await getProjectDocsStore().get(s.ws, s.project, 'localBusinesses', id.data);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That business was not found.');
    const scans = await scansOf(s, id.data);
    const latest = scans[scans.length - 1] ?? null;
    res.json({ business: toBusiness(cur), history: scans.map(brief), latest });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

localRouter.get('/business/:id/scans/:scanId', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const id = idOk.safeParse(req.params.id); const sid = idOk.safeParse(req.params.scanId);
    if (!id.success || !sid.success) return fail(res, 400, 'INVALID_ID', 'Not a valid scan.');
    const d = await getProjectDocsStore().get(s.ws, s.project, 'localScans', sid.data);
    if (!d || d.businessId !== id.data) return fail(res, 404, 'NOT_FOUND', 'That scan was not found.');
    res.json({ scan: toScan(d) });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

const scanBody = z.object({ confirmedLookups: z.number().int().min(1) });
localRouter.post('/business/:id/scan', async (req, res) => {
  try {
    const s = await scope(req, res, true); if (!s) return;
    const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid business.');
    const cur = await getProjectDocsStore().get(s.ws, s.project, 'localBusinesses', id.data);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That business was not found.');
    const b = toBusiness(cur);
    const body = scanBody.safeParse(req.body);
    const lookups = lookupsFor(b.gridSize, b.keywords.length);
    if (lookups > MAX_LOOKUPS_PER_SCAN) return fail(res, 400, 'TOO_BIG', `This scan needs ${lookups} lookups, more than the limit of ${MAX_LOOKUPS_PER_SCAN}. Use a smaller grid or fewer phrases.`);
    if (!body.success || body.data.confirmedLookups !== lookups) return fail(res, 400, 'CONFIRM_REQUIRED', `Confirm the scan first: it will use ${lookups} map lookups on your data provider.`);
    const provider = await getProviderFor(s.ws);
    if (!provider.connected || !provider.mapsSearch) return fail(res, 400, 'NOT_CONNECTED', 'Connect a data provider that offers Google Maps results (Settings, Data provider) before scanning.');
    const rl = await checkRateLimit('local-scan', s.ws, 20, 24 * 3_600_000);
    if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', 'This workspace has run many scans today. Try again tomorrow.');

    const pts = gridPoints(b.lat, b.lng, b.radiusKm, b.gridSize);
    const zoom = zoomFor(b.radiusKm, b.gridSize);
    const acc = competitorAccumulator(b);
    const points: ScanPoint[] = pts.map((p) => ({ ...p, ranks: b.keywords.map(() => null) }));
    let failed = 0; let succeeded = 0; let firstError: string | null = null; let learnedPlaceId = b.placeId;
    const jobs = pts.flatMap((_, pi) => b.keywords.map((_, ki) => ({ pi, ki })));
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!;
        // Stop early if the provider is clearly refusing us (wrong key, no credit): nothing would be gained by paying for more failures.
        if (succeeded === 0 && failed >= 3) return;
        try {
          const places = await provider.mapsSearch!({ keyword: b.keywords[job.ki]!, lat: pts[job.pi]!.lat, lng: pts[job.pi]!.lng, zoom });
          succeeded++;
          acc.add(places, null);
          const own = findOwn(places, b);
          points[job.pi]!.ranks[job.ki] = own ? own.rank : null;
          if (own?.placeId && !learnedPlaceId) learnedPlaceId = own.placeId;
        } catch (e) { failed++; firstError ??= e instanceof ProviderError ? e.message : 'A map lookup failed.'; }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (succeeded === 0) return fail(res, 502, 'SCAN_FAILED', firstError ?? 'The data provider did not answer.');
    const at = new Date(deps.now()).toISOString();
    const scan: ScanDoc = { id: newDocId(), businessId: b.id, at, gridSize: b.gridSize, radiusKm: b.radiusKm, keywords: b.keywords, points, summary: summarize(points, b.keywords), competitors: acc.top(15), own: acc.own(), lookups: succeeded + failed, failed };
    const docs = getProjectDocsStore();
    await docs.put(s.ws, s.project, 'localScans', scan as unknown as StoredDoc);
    if (learnedPlaceId && learnedPlaceId !== b.placeId) await docs.put(s.ws, s.project, 'localBusinesses', { ...cur, placeId: learnedPlaceId, updatedAt: at });
    // Keep the 30 most recent scans per business.
    const all = await scansOf(s, b.id);
    for (const old of all.slice(0, Math.max(0, all.length - 30))) await docs.delete(s.ws, s.project, 'localScans', old.id);
    res.json({ scan, note: failed ? `${failed} of ${scan.lookups} lookups failed, so some spots show as not found.` : null });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong while scanning.'); }
});

/** A "leave us a review" link and a QR code to print (needs the Google place id, which the first scan learns when it finds the business). */
localRouter.get('/business/:id/review-link', async (req, res) => {
  try {
    const s = await scope(req, res, false); if (!s) return;
    const id = idOk.safeParse(req.params.id); if (!id.success) return fail(res, 400, 'INVALID_ID', 'Not a valid business.');
    const cur = await getProjectDocsStore().get(s.ws, s.project, 'localBusinesses', id.data);
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'That business was not found.');
    const placeId = String(cur.placeId ?? '');
    if (!placeId) return fail(res, 404, 'NO_PLACE_ID', 'Run a scan first so we can find your listing, or paste your Google place id when editing the business.');
    const url = reviewLinkFor(placeId);
    res.json({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 320 }) });
  } catch { fail(res, 500, 'LOCAL_FAILED', 'Something went wrong.'); }
});

