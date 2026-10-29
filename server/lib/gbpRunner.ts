/**
 * Business Profile review sync and the daily job (Sprint 46d): bring in new reviews, email about low-star ones, publish scheduled posts.
 */
import { createLocalPost, fetchReviews, LOW_STAR, refreshAccessToken, openRefresh, reviewDocId, GbpError, type GbpDeps, type GbpRecord, type GbpStore, type ReviewItem } from './gbp.js';
import type { ProjectDocsStore, StoredDoc } from './projectDocs.js';

export const MAX_REVIEW_ITEMS = 300;
export interface Credentials { clientId: string; clientSecret: string }

export async function accessTokenFor(deps: GbpDeps, rec: GbpRecord, cred: Credentials): Promise<string> {
  let refreshToken: string;
  try { refreshToken = openRefresh(rec); } catch { throw new GbpError('GBP_SECRET_UNREADABLE', 'The saved Google connection could not be read. Disconnect and connect again.', 422); }
  return refreshAccessToken(deps, { refreshToken, ...cred });
}

export const toReviewItem = (d: StoredDoc): ReviewItem => ({
  id: d.id, reviewId: String(d.reviewId ?? ''), reviewer: String(d.reviewer ?? ''), stars: Number(d.stars ?? 0), comment: String(d.comment ?? ''), createdAt: String(d.createdAt ?? ''),
  replied: Boolean(d.replied), replyText: String(d.replyText ?? ''), draft: String(d.draft ?? ''),
  status: (['new', 'drafted', 'replied', 'dismissed'] as const).includes(d.status as never) ? (d.status as ReviewItem['status']) : 'new', alerted: Boolean(d.alerted), firstSeenAt: String(d.firstSeenAt ?? ''),
});

/** Reads the latest reviews from Google and merges them with what we keep. The very first sync marks old reviews as already seen, so only later low-star reviews raise an alert. */
export async function syncReviews(o: { deps: GbpDeps; docs: ProjectDocsStore; token: string; ws: string; project: string; account: string; location: string }): Promise<{ items: ReviewItem[]; added: ReviewItem[]; averageRating: number | null; total: number | null }> {
  const got = await fetchReviews(o.deps, o.token, o.account, o.location);
  const existing = new Map((await o.docs.list(o.ws, o.project, 'reviewItems')).map((d) => [d.id, toReviewItem(d)]));
  const baseline = existing.size === 0;
  const nowIso = new Date(o.deps.now()).toISOString();
  const added: ReviewItem[] = [];
  for (const r of got.reviews) {
    const id = reviewDocId(r.reviewId);
    const cur = existing.get(id);
    const next: ReviewItem = cur
      ? { ...cur, reviewer: r.reviewer, stars: r.stars, comment: r.comment, replied: r.reply !== null || cur.replied, replyText: r.reply ?? cur.replyText, status: r.reply !== null ? 'replied' : cur.status }
      : { id, reviewId: r.reviewId, reviewer: r.reviewer, stars: r.stars, comment: r.comment, createdAt: r.createdAt, replied: r.reply !== null, replyText: r.reply ?? '', draft: '', status: r.reply !== null ? 'replied' : 'new', alerted: baseline, firstSeenAt: nowIso };
    if (!cur) added.push(next);
    if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) await o.docs.put(o.ws, o.project, 'reviewItems', next as unknown as StoredDoc);
    existing.set(id, next);
  }
  const all = [...existing.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const old of all.slice(MAX_REVIEW_ITEMS)) { await o.docs.delete(o.ws, o.project, 'reviewItems', old.id); existing.delete(old.id); }
  return { items: all.slice(0, MAX_REVIEW_ITEMS), added, averageRating: got.averageRating, total: got.total };
}

export interface GbpRunDeps {
  store: GbpStore; docs: ProjectDocsStore; gbp: GbpDeps; cred: Credentials;
  projectInfo(ws: string, project: string): Promise<{ name: string } | null>;
  send(m: { to: string; subject: string; text: string; html: string }): Promise<{ ok: boolean }>;
  appUrl: string;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function runGbp(d: GbpRunDeps): Promise<{ checked: number; newLowStar: number; emailed: number; posted: number; failed: number }> {
  const out = { checked: 0, newLowStar: 0, emailed: 0, posted: 0, failed: 0 };
  for (const rec of await d.store.listAll()) {
    let token: string;
    try { token = await accessTokenFor(d.gbp, rec, d.cred); } catch (e) { out.failed++; await d.store.put({ ...rec, lastError: e instanceof GbpError ? e.message : 'The check failed.', lastRunAt: new Date(d.gbp.now()).toISOString() }); continue; }
    let lastError: string | null = null;
    for (const [projectId, link] of Object.entries(rec.links)) {
      const info = await d.projectInfo(rec.id, projectId);
      if (!info) continue;
      try {
        const r = await syncReviews({ deps: d.gbp, docs: d.docs, token, ws: rec.id, project: projectId, account: link.account, location: link.location });
        out.checked++;
        const low = r.added.filter((x) => x.stars <= LOW_STAR && !x.alerted);
        out.newLowStar += low.length;
        if (low.length && rec.connectedByEmail) {
          const lines = low.map((x) => `${x.stars} star${x.stars === 1 ? '' : 's'} from ${x.reviewer}: ${x.comment || '(no written comment)'}`);
          const link2 = `${d.appUrl}/seo`;
          const sent = await d.send({ to: rec.connectedByEmail, subject: `New ${low.length === 1 ? 'low-star review' : `${low.length} low-star reviews`} for ${link.title || info.name}`, text: `${lines.join('\n\n')}\n\nDraft a reply in AdLens (SEO, Local SEO, Reviews): ${link2}`, html: `<p>${lines.map(esc).join('</p><p>')}</p><p><a href="${esc(link2)}">Draft a reply in AdLens</a> (SEO, Local SEO, Reviews). Replies are never sent without your approval.</p>` });
          if (sent.ok) out.emailed++;
        }
        for (const x of low) await d.docs.put(rec.id, projectId, 'reviewItems', { ...x, alerted: true } as unknown as StoredDoc);
      } catch (e) { out.failed++; lastError = e instanceof GbpError ? e.message : 'The review check failed.'; }
      // Posts that are due (planned for today or earlier).
      const today = new Date(d.gbp.now()).toISOString().slice(0, 10);
      for (const p of await d.docs.list(rec.id, projectId, 'gbpPosts')) {
        if (p.status !== 'scheduled' || !p.publishOn || String(p.publishOn) > today) continue;
        try { await createLocalPost(d.gbp, token, link.account, link.location, { summary: String(p.text), ...(p.url ? { url: String(p.url) } : {}) }); await d.docs.put(rec.id, projectId, 'gbpPosts', { ...p, status: 'published', publishedAt: new Date(d.gbp.now()).toISOString(), error: '' }); out.posted++; }
        catch (e) { out.failed++; await d.docs.put(rec.id, projectId, 'gbpPosts', { ...p, status: 'failed', error: e instanceof GbpError ? e.message : 'Publishing failed.' }); }
      }
    }
    await d.store.put({ ...rec, lastError, lastRunAt: new Date(d.gbp.now()).toISOString() });
  }
  return out;
}
