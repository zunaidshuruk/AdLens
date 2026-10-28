import { getServerConfig } from '../config.js';
import { createAgentProvider } from '../lib/agentProviders.js';
import { summarise, summaryInputSchema, type SummaryOutcome } from '../lib/seoSummary.js';
import { aiRateLimitMiddleware, getAiRequest } from './ai.js';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getContentLimits } from '../config/plans.js';
import { requireGoogleConfigured } from '../config.js';
import { MetaApiError } from '../lib/meta.js';
import { GoogleApiError } from '../lib/google.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { can } from '../lib/permissions.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { buildReportContext } from '../lib/reportContext.js';
import { crawlSite } from '../lib/seoCrawl.js';
import { fetchFollowing, fetchOnce, normaliseInputUrl, type PageFetcher } from '../lib/seoFetch.js';
import { countRawElements, parsePageSpeed, runPageSpeed, SpeedError, type PsiRequest } from '../lib/seoSpeed.js';
import { getDataProvider, NOT_CONNECTED_NOTE } from '../lib/dataProvider.js';
import { clusterKeywords } from '../lib/rankTracking.js';
import { onPageReport } from '../lib/seoOnPage.js';
import { topicGap, visibleText } from '../lib/seoTopics.js';
import { classifyIntent, keywordIdeas, googleSuggest, type SuggestFetcher } from '../lib/seoKeywords.js';
import { findOpportunities, type QueryPageRow } from '../lib/seoOpportunities.js';
import { analyzeHtml, pageIssues, scoreFor } from '../lib/seoPage.js';
import { SsrfError } from '../lib/ssrfGuard.js';
import { mapVaultError } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import { searchConsoleExploreReport } from '../reports/exploreReports.js';

/** SEO tools: page checker, site audit, Search Console opportunities, keyword ideas. */
export const seoRouter = Router();

const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };

// Swappable in tests so no test touches the internet.
const deps: { fetcher: PageFetcher; suggest: SuggestFetcher; now: () => number; psi: PsiRequest | undefined } = { fetcher: fetchOnce, suggest: googleSuggest, now: Date.now, psi: undefined };
export function setSeoTestDeps(d: Partial<typeof deps> | null): void {
  deps.fetcher = d?.fetcher ?? fetchOnce; deps.suggest = d?.suggest ?? googleSuggest; deps.now = d?.now ?? Date.now; deps.psi = d?.psi;
}

seoRouter.use(requireUser);
seoRouter.use(verifyGoogleSessionOwnership);
seoRouter.use(loadProject);

interface Scope { plan: string | undefined; uid: string }
async function scope(req: Request, res: Response): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  if (!ws || !can(ws, req.user!.uid, 'reports.view')) { fail(res, 403, 'NOT_ALLOWED', 'You do not have permission to use SEO tools in this project.'); return null; }
  return { plan: ws.plan, uid: req.user!.uid };
}
async function limited(res: Response, uid: string, name: string, limit: number, windowMs: number): Promise<boolean> {
  const r = await checkRateLimit(`seo-${name}`, uid, limit, windowMs);
  if (r.allowed) return false;
  fail(res, 429, 'RATE_LIMITED', `You have used this tool a lot. Try again in ${Math.ceil(r.retryAfterSeconds / 60)} minutes.`);
  return true;
}
const urlError = (res: Response, e: unknown): void => fail(res, 400, 'INVALID_URL', e instanceof SsrfError ? e.message : 'Enter a valid web address, for example example.com/page.');

const hostKey = (h: string) => h.toLowerCase().replace(/^www\./, '');
function projectHosts(req: Request): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (!v) return;
    try { out.add(hostKey(new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`).hostname)); } catch { /* ignore */ }
  };
  add(req.project?.domain);
  const sc = req.project?.searchConsoleSite;
  if (sc) add(sc.startsWith('sc-domain:') ? sc.slice('sc-domain:'.length) : sc);
  return [...out];
}

seoRouter.post('/page', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s || (await limited(res, s.uid, 'page', 60, 3_600_000))) return;
    const parsed = z.object({ url: z.string().min(3).max(2000) }).safeParse(req.body);
    if (!parsed.success) return urlError(res, null);
    let start: URL;
    try { start = normaliseInputUrl(parsed.data.url); } catch (e) { return urlError(res, e); }
    const page = await fetchFollowing(start.toString(), deps.fetcher);
    if (page.error || page.status === 0) return fail(res, 502, 'FETCH_FAILED', page.error || 'The page could not be reached.');
    if (page.contentType && !/html|xml/.test(page.contentType)) return fail(res, 422, 'NOT_HTML', 'That address is not a web page (it did not return HTML).');
    const facts = analyzeHtml(page.text, page.url, { status: page.status, contentType: page.contentType, xRobots: page.xRobots, ms: page.ms, bytes: page.bytes, ...(page.chain.length ? { redirectTo: page.url } : {}) });
    const issues = pageIssues(facts);
    const links = facts.links;
    res.json({
      url: page.url, requested: start.toString(), redirected: page.chain.length > 0, score: scoreFor(issues), issues,
      facts: {
        status: facts.status, ms: facts.ms, title: facts.title, titleLength: facts.title?.length ?? 0, description: facts.description, descriptionLength: facts.description?.length ?? 0,
        h1: facts.h1, h2Count: facts.h2Count, canonical: facts.canonical, wordCount: facts.wordCount, images: facts.images,
        internalLinks: links.filter((l) => l.internal).length, externalLinks: links.filter((l) => !l.internal).length, noindex: facts.noindex,
        structuredData: [...new Set(facts.structuredData)], lang: facts.lang,
      },
    });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong while checking the page.'); }
});

seoRouter.post('/crawl', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s || (await limited(res, s.uid, 'crawl', 6, 3_600_000))) return;
    const hosts = projectHosts(req);
    const parsed = z.object({ url: z.string().min(3).max(2000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return urlError(res, null);
    const target = parsed.data.url || (req.project?.domain ?? '');
    if (!target) return fail(res, 409, 'NO_SITE', 'Add your website address to the project first.');
    let start: URL;
    try { start = normaliseInputUrl(target); } catch (e) { return urlError(res, e); }
    if (!hosts.includes(hostKey(start.hostname))) return fail(res, 403, 'NOT_YOUR_SITE', `Site audits only run on this project's own website (${hosts.join(', ') || 'none set'}). Use the page checker for other sites.`);
    const maxPages = getContentLimits(s.plan).maxCrawlPages;
    const report = await crawlSite(start.toString(), deps.fetcher, { maxPages, timeBudgetMs: 45_000, now: deps.now });
    res.json({ report, maxPages });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong while auditing the site.'); }
});

seoRouter.post('/speed', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s || (await limited(res, s.uid, 'speed', 10, 3_600_000))) return;
    const parsed = z.object({ url: z.string().min(3).max(2000), strategy: z.enum(['mobile', 'desktop']).default('mobile') }).safeParse(req.body);
    if (!parsed.success) return urlError(res, null);
    let start: URL;
    try { start = normaliseInputUrl(parsed.data.url); } catch (e) { return urlError(res, e); }
    // Google runs the page in a real browser; at the same time we read the first HTML ourselves to see what only appears after JavaScript.
    const [psi, first] = await Promise.all([
      runPageSpeed(start.toString(), parsed.data.strategy, { request: deps.psi, apiKey: process.env.PAGESPEED_API_KEY?.trim() || undefined }).then((json) => ({ json }), (error: unknown) => ({ error })),
      fetchFollowing(start.toString(), deps.fetcher).catch(() => null),
    ]);
    if ('error' in psi) {
      if (psi.error instanceof SpeedError) return fail(res, psi.error.status, psi.error.code, psi.error.message);
      return fail(res, 502, 'SPEED_FAILED', 'The speed test could not run right now. Try again in a minute.');
    }
    let raw: { elements: number; title: string | null; description: string | null } | undefined;
    if (first && !first.error && first.status >= 200 && first.status < 300 && /html|xml/.test(first.contentType || 'html')) {
      const facts = analyzeHtml(first.text, first.url, { status: first.status, contentType: first.contentType, xRobots: first.xRobots, ms: first.ms, bytes: first.bytes });
      raw = { elements: countRawElements(first.text), title: facts.title, description: facts.description };
    }
    res.json({ report: parsePageSpeed(psi.json, parsed.data.strategy, raw, new Date(deps.now())) });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong while testing the page.'); }
});

function mapErr(res: Response, err: unknown): void {
  if (err instanceof MetaApiError) return fail(res, err.status, err.code, err.message);
  const mapped = mapVaultError(err) ?? (err instanceof GoogleApiError ? err : null);
  if (mapped) return fail(res, mapped.status, mapped.code, mapped.message);
  fail(res, 502, 'SEO_FAILED', 'Could not read your Search Console data right now.');
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
async function queryPageRows(req: Request, days: number, limit: number): Promise<QueryPageRow[]> {
  const end = new Date(deps.now() - 3 * 86_400_000); // Search Console data lags by a couple of days
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const ctx = buildReportContext(req.user!.uid, req.project);
  const result = await searchConsoleExploreReport.run(ctx, { startDate: isoDay(start), endDate: isoDay(end), dimensions: ['query', 'page'], metrics: ['clicks', 'impressions', 'ctr', 'position'], filters: [], limit, orderBy: { field: 'impressions', desc: true } });
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return result.rows.map((r) => ({ query: String(r.query ?? ''), page: String(r.page ?? ''), clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.ctr), position: num(r.position) }));
}

seoRouter.use(requireGoogleConfigured);

seoRouter.post('/opportunities', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    if (!req.project?.searchConsoleSite) return fail(res, 409, 'SC_NOT_SELECTED', 'Choose a Search Console site on the Connections page first.');
    const parsed = z.object({ days: z.union([z.literal(28), z.literal(90)]).default(28) }).safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Choose 28 or 90 days.');
    if (await limited(res, s.uid, 'opps', 30, 3_600_000)) return;
    let rows: QueryPageRow[];
    try { rows = await queryPageRows(req, parsed.data.days, 1000); } catch (err) { return mapErr(res, err); }
    const found = findOpportunities(rows, { minImpressions: parsed.data.days === 90 ? 100 : 50 });
    res.json({ days: parsed.data.days, rowsRead: rows.length, truncated: rows.length >= 1000, opportunities: found });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong.'); }
});

seoRouter.post('/keywords', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const parsed = z.object({ seed: z.string().trim().min(2, 'Type a word or phrase').max(80), lang: z.enum(['en', 'bn', 'hi', 'es', 'fr', 'de', 'ar']).default('en'), deep: z.boolean().default(false) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Type a word or phrase.');
    if (await limited(res, s.uid, 'keywords', 20, 3_600_000)) return;
    const ideas = await keywordIdeas(parsed.data.seed, deps.suggest, { lang: parsed.data.lang, alphabet: parsed.data.deep });
    // Mark the ideas you already get impressions for (best effort: skipped when Search Console is not connected).
    const known = new Map<string, { impressions: number; position: number; clicks: number }>();
    if (req.project?.searchConsoleSite) {
      try {
        const ctx = buildReportContext(req.user!.uid, req.project);
        const end = new Date(deps.now() - 3 * 86_400_000);
        const start = new Date(end.getTime() - 89 * 86_400_000);
        const r = await searchConsoleExploreReport.run(ctx, { startDate: isoDay(start), endDate: isoDay(end), dimensions: ['query'], metrics: ['clicks', 'impressions', 'position'], filters: [], limit: 1000, orderBy: { field: 'impressions', desc: true } });
        for (const row of r.rows) known.set(String(row.query ?? '').toLowerCase(), { impressions: Number(row.impressions) || 0, position: Number(row.position) || 0, clicks: Number(row.clicks) || 0 });
      } catch { /* optional */ }
    }
    const provider = getDataProvider();
    const metrics = new Map<string, { volume: number | null; cpc: number | null; difficulty: number | null }>();
    if (provider.connected) { try { for (const m of await provider.keywordMetrics(ideas.map((i) => i.keyword).slice(0, 300), 'us')) metrics.set(m.keyword, m); } catch { /* optional */ } }
    res.json({
      seed: parsed.data.seed,
      ideas: ideas.map((i) => ({ ...i, ranking: known.get(i.keyword) ?? null, metrics: metrics.get(i.keyword) ?? null })),
      clusters: clusterKeywords(ideas.map((i) => i.keyword)),
      providerConnected: provider.connected,
      note: provider.connected ? 'Ideas come from what people type into Google; volumes come from your connected data source.' : `Ideas come from what people type into Google. ${NOT_CONNECTED_NOTE}`,
    });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong.'); }
});

// One phrase in detail: what people want, how you do for it in Search Console, which pages show up, and related ideas.
seoRouter.post('/keyword-overview', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const parsed = z.object({ keyword: z.string().trim().min(2, 'Type a keyword').max(100), lang: z.enum(['en', 'bn', 'hi', 'es', 'fr', 'de', 'ar']).default('en') }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Type a keyword.');
    if (await limited(res, s.uid, 'overview', 40, 3_600_000)) return;
    const keyword = parsed.data.keyword.toLowerCase().replace(/\s+/g, ' ');
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    let own: { clicks: number; impressions: number; ctr: number; position: number; pages: { page: string; clicks: number; impressions: number; position: number }[]; daily: { date: string; clicks: number; impressions: number; position: number }[] } | null = null;
    if (req.project?.searchConsoleSite) {
      try {
        const ctx = buildReportContext(req.user!.uid, req.project);
        const end = new Date(deps.now() - 3 * 86_400_000);
        const start = new Date(end.getTime() - 89 * 86_400_000);
        const base = { startDate: isoDay(start), endDate: isoDay(end), filters: [{ field: 'query' as const, op: 'equals' as const, value: keyword }] };
        const [total, pages, daily] = await Promise.all([
          searchConsoleExploreReport.run(ctx, { ...base, dimensions: [], metrics: ['clicks', 'impressions', 'ctr', 'position'], limit: 1 }),
          searchConsoleExploreReport.run(ctx, { ...base, dimensions: ['page'], metrics: ['clicks', 'impressions', 'position'], limit: 10, orderBy: { field: 'impressions', desc: true } }),
          searchConsoleExploreReport.run(ctx, { ...base, dimensions: ['date'], metrics: ['clicks', 'impressions', 'position'], limit: 100 }),
        ]);
        const t = total.rows[0];
        if (t && num(t.impressions) > 0) {
          own = {
            clicks: num(t.clicks), impressions: num(t.impressions), ctr: num(t.ctr), position: Math.round(num(t.position) * 10) / 10,
            pages: pages.rows.map((r) => ({ page: String(r.page ?? ''), clicks: num(r.clicks), impressions: num(r.impressions), position: Math.round(num(r.position) * 10) / 10 })),
            daily: daily.rows.map((r) => ({ date: String(r.date ?? ''), clicks: num(r.clicks), impressions: num(r.impressions), position: Math.round(num(r.position) * 10) / 10 })).sort((a, b) => a.date.localeCompare(b.date)),
          };
        }
      } catch (err) { return mapErr(res, err); }
    }
    const ideas = await keywordIdeas(keyword, deps.suggest, { lang: parsed.data.lang });
    const provider = getDataProvider();
    let metrics: { volume: number | null; cpc: number | null; difficulty: number | null } | null = null;
    if (provider.connected) { try { metrics = (await provider.keywordMetrics([keyword], 'us'))[0] ?? null; } catch { /* optional */ } }
    res.json({
      keyword, intent: classifyIntent(keyword), words: keyword.split(' ').length, own, metrics, providerConnected: provider.connected,
      questions: ideas.filter((i) => i.group === 'questions').slice(0, 10).map((i) => i.keyword),
      related: ideas.filter((i) => i.group !== 'questions').slice(0, 15).map((i) => i.keyword),
      note: provider.connected ? '' : NOT_CONNECTED_NOTE,
    });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong.'); }
});

// Words and phrases that competitors' pages use and yours does not. Fetches up to 5 competitor pages (public pages only).
seoRouter.post('/topic-gap', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s || (await limited(res, s.uid, 'gap', 15, 3_600_000))) return;
    const parsed = z.object({ yourUrl: z.string().min(3).max(2000), competitors: z.array(z.string().min(3).max(2000)).min(1, 'Add at least one competitor page').max(5) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Enter your page and up to 5 competitor pages.');
    const read = async (input: string): Promise<{ url: string; text: string; words: number } | { url: string; error: string }> => {
      let u: URL;
      try { u = normaliseInputUrl(input); } catch (e) { return { url: input, error: e instanceof SsrfError ? e.message : 'Not a valid web address.' }; }
      const page = await fetchFollowing(u.toString(), deps.fetcher);
      if (page.error || page.status === 0) return { url: u.toString(), error: page.error || 'The page could not be reached.' };
      if (page.status >= 400) return { url: u.toString(), error: `The page answered with an error (${page.status}).` };
      if (page.contentType && !/html|xml/.test(page.contentType)) return { url: u.toString(), error: 'That address is not a web page.' };
      const text = visibleText(page.text);
      return { url: page.url, text, words: text.split(' ').filter(Boolean).length };
    };
    const [you, ...comps] = await Promise.all([parsed.data.yourUrl, ...parsed.data.competitors].map(read));
    if (!you || 'error' in you) return fail(res, 422, 'YOUR_PAGE_FAILED', `Your page could not be read: ${you && 'error' in you ? you.error : 'unknown problem'}`);
    const good = comps.filter((c): c is { url: string; text: string; words: number } => !('error' in c));
    if (good.length === 0) return fail(res, 422, 'COMPETITORS_FAILED', 'None of the competitor pages could be read. Check the addresses.');
    const gap = topicGap(you.text, good.map((c) => c.text));
    res.json({
      you: { url: you.url, words: you.words },
      competitors: comps.map((c) => ('error' in c ? { url: c.url, error: c.error } : { url: c.url, words: c.words })),
      gap,
      note: 'Based on the words on each page. It shows what competitors cover that you do not; it does not prove those words will help you rank.',
    });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong while comparing the pages.'); }
});


// One page against one target keyword (optionally with competitor pages for related words).
seoRouter.post('/onpage', async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s || (await limited(res, s.uid, 'onpage', 30, 3_600_000))) return;
    const parsed = z.object({ url: z.string().min(3).max(2000), keyword: z.string().trim().min(2, 'Type the keyword this page should rank for').max(100), competitors: z.array(z.string().min(3).max(2000)).max(3).default([]) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', parsed.error.issues[0]?.message || 'Enter a page and a keyword.');
    let start: URL;
    try { start = normaliseInputUrl(parsed.data.url); } catch (e) { return urlError(res, e); }
    const page = await fetchFollowing(start.toString(), deps.fetcher);
    if (page.error || page.status === 0) return fail(res, 502, 'FETCH_FAILED', page.error || 'The page could not be reached.');
    if (page.status >= 400) return fail(res, 422, 'PAGE_ERROR', `The page answered with an error (${page.status}).`);
    if (page.contentType && !/html|xml/.test(page.contentType)) return fail(res, 422, 'NOT_HTML', 'That address is not a web page (it did not return HTML).');
    const rivalTexts: string[] = [];
    const rivalErrors: string[] = [];
    for (const input of parsed.data.competitors) {
      try {
        const r = await fetchFollowing(normaliseInputUrl(input).toString(), deps.fetcher);
        if (r.error || r.status === 0 || r.status >= 400 || (r.contentType && !/html|xml/.test(r.contentType))) rivalErrors.push(input); else rivalTexts.push(visibleText(r.text));
      } catch { rivalErrors.push(input); }
    }
    res.json({ report: onPageReport(page.text, page.url, parsed.data.keyword, rivalTexts, { status: page.status, ms: page.ms, bytes: page.bytes }), competitorErrors: rivalErrors });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong while checking the page.'); }
});

seoRouter.get('/provider', async (req, res) => {
  const s = await scope(req, res);
  if (!s) return;
  const p = getDataProvider();
  res.json({ connected: p.connected, name: p.name, note: p.connected ? '' : NOT_CONNECTED_NOTE });
});

// POST /api/seo/summary: the built-in AI explains a tool result in plain words (uses one AI question, refunded if it fails).
seoRouter.post('/summary', aiRateLimitMiddleware, async (req, res) => {
  try {
    const s = await scope(req, res);
    if (!s) return;
    const parsed = summaryInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'There is nothing to summarise.');
    const cfg = getServerConfig();
    const keys = [cfg.geminiApiKey, cfg.geminiApiKey2].filter((k): k is string => Boolean(k));
    if (keys.length === 0 || !cfg.geminiModel) return fail(res, 503, 'CLOUD_NOT_CONFIGURED', 'The built-in AI is not set up on this server yet.');
    const store = getFirestoreStore();
    const ws = req.project!.workspaceId;
    const quota = await store.consumeAiQuota(ws);
    if (!quota.ok) return fail(res, 429, 'QUOTA_EXCEEDED', "You've used all AI questions for this month.");
    let outcome: SummaryOutcome | null = null;
    for (const apiKey of keys) {
      const provider = createAgentProvider({ kind: 'gemini', model: cfg.geminiModel, apiKey, agent: { id: 'seo-summary', name: 'SEO summary' }, temperature: 0.3 }, { request: getAiRequest() });
      outcome = await summarise(parsed.data, provider);
      const retryable = !outcome.ok && outcome.code === 'PROVIDER_ERROR' && ['PROVIDER_AUTH', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(outcome.providerCode ?? '');
      if (!retryable) break;
    }
    if (!outcome || !outcome.ok) {
      await store.refundAiQuota(ws);
      return fail(res, 502, 'AI_FAILED', outcome && !outcome.ok ? outcome.message : 'The AI could not be reached.');
    }
    res.json({ summary: outcome.text, quota: { used: quota.used, limit: quota.limit } });
  } catch { fail(res, 500, 'SEO_FAILED', 'Something went wrong.'); }
});
