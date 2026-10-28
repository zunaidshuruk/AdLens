/** EyeOn (Sprint 43): watch a competitor's public website. Checks the sitemap and a few key pages daily and records what changed. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getAdminFirestore } from './firestore.js';
import type { ProjectDocsStore } from './projectDocs.js';
import { fetchFollowing, normaliseInputUrl, type PageFetcher } from './seoFetch.js';
import { analyzeHtml } from './seoPage.js';
import { collectSitemap } from './seoSitemap.js';
import { visibleText } from './seoTopics.js';

export interface WatchRecord {
  id: string; workspaceId: string; projectId: string; domain: string; sitemapUrl: string | null; pages: string[];
  enabled: boolean; createdBy: string; createdAt: string; lastCheckedAt: string | null; lastError: string | null;
}
export interface WatchStore {
  listAll(): Promise<WatchRecord[]>;
  get(id: string): Promise<WatchRecord | null>;
  put(w: WatchRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
}
const COLLECTION = 'seoWatches';
const firestoreStore: WatchStore = {
  async listAll() { const snap = await getAdminFirestore().collection(COLLECTION).get(); return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as WatchRecord); },
  async get(id) { const s = await getAdminFirestore().collection(COLLECTION).doc(id).get(); return s.exists ? ({ ...(s.data() as object), id: s.id } as WatchRecord) : null; },
  async put(w) { const { id, ...rest } = w; await getAdminFirestore().collection(COLLECTION).doc(id).set(rest); },
  async delete(id) { const ref = getAdminFirestore().collection(COLLECTION).doc(id); const s = await ref.get(); if (!s.exists) return false; await ref.delete(); return true; },
};
export function createInMemoryWatchStore(): WatchStore {
  const m = new Map<string, WatchRecord>();
  return {
    async listAll() { return [...m.values()].map((v) => ({ ...v, pages: [...v.pages] })); },
    async get(id) { const v = m.get(id); return v ? { ...v, pages: [...v.pages] } : null; },
    async put(w) { m.set(w.id, { ...w, pages: [...w.pages] }); },
    async delete(id) { return m.delete(id); },
  };
}
let testStore: WatchStore | null = null;
export const setTestWatchStore = (s: WatchStore | null): void => { testStore = s; };
export const getWatchStore = (): WatchStore => testStore ?? firestoreStore;

export const watchInputSchema = z.object({
  domain: z.string().trim().min(3, 'Type the competitor website').max(253),
  sitemapUrl: z.string().trim().max(2000).optional().or(z.literal('')),
  pages: z.array(z.string().trim().min(3).max(2000)).max(3).default([]),
});

// ---------------------------------------------------------------------------
// Snapshots and differences
// ---------------------------------------------------------------------------
export interface PageSnap { title: string | null; description: string | null; h1: string | null; words: number; hash: string }
export interface Snapshot { at: string; urls: { u: string; m?: string }[]; truncated: boolean; found: boolean; pages: Record<string, PageSnap> }
export type WatchEventType = 'new_page' | 'removed_page' | 'updated_page' | 'title_changed' | 'description_changed' | 'h1_changed' | 'content_changed' | 'more';
export interface WatchEvent { id: string; watchId: string; at: string; type: WatchEventType; url: string; detail: string }

const MAX_PER_TYPE = 20;
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

export function diffSnapshots(prev: Snapshot, next: Snapshot): Omit<WatchEvent, 'id' | 'watchId' | 'at'>[] {
  const out: Omit<WatchEvent, 'id' | 'watchId' | 'at'>[] = [];
  const add = (type: WatchEventType, list: { url: string; detail: string }[], noun: string) => {
    for (const e of list.slice(0, MAX_PER_TYPE)) out.push({ type, url: e.url, detail: e.detail });
    if (list.length > MAX_PER_TYPE) out.push({ type: 'more', url: '', detail: `and ${list.length - MAX_PER_TYPE} more ${noun}` });
  };
  const before = new Map(prev.urls.map((e) => [e.u, e.m]));
  const after = new Map(next.urls.map((e) => [e.u, e.m]));
  if (prev.found && next.found) {
    add('new_page', [...after.keys()].filter((u) => !before.has(u)).map((url) => ({ url, detail: 'New page in the sitemap' })), 'new pages');
    // Missing pages only count when both reads were complete; a cut-short read would invent removals.
    if (!prev.truncated && !next.truncated) add('removed_page', [...before.keys()].filter((u) => !after.has(u)).map((url) => ({ url, detail: 'No longer in the sitemap' })), 'removed pages');
    add('updated_page', [...after.entries()].filter(([u, m]) => before.has(u) && m && before.get(u) && m !== before.get(u)).map(([url, m]) => ({ url, detail: `Marked as updated on ${m!.slice(0, 10)}` })), 'updated pages');
  }
  for (const [url, n] of Object.entries(next.pages)) {
    const o = prev.pages[url];
    if (!o) continue;
    if (o.title !== n.title) out.push({ type: 'title_changed', url, detail: `Title: "${o.title ?? ''}" became "${n.title ?? ''}"` });
    if (o.description !== n.description) out.push({ type: 'description_changed', url, detail: `Description changed to "${(n.description ?? '').slice(0, 140)}"` });
    if (o.h1 !== n.h1) out.push({ type: 'h1_changed', url, detail: `Main heading: "${o.h1 ?? ''}" became "${n.h1 ?? ''}"` });
    const delta = n.words - o.words;
    if (o.hash !== n.hash && (Math.abs(delta) >= 50 || Math.abs(delta) >= o.words * 0.1)) out.push({ type: 'content_changed', url, detail: `Text changed (${delta >= 0 ? '+' : ''}${delta} words)` });
  }
  return out;
}

export interface CheckDeps { docs: ProjectDocsStore; fetcher: PageFetcher; now: () => number }
export interface CheckResult { baseline: boolean; events: number; urls: number; found: boolean; error?: string }
const MAX_EVENTS_KEPT = 300;

export async function checkWatch(deps: CheckDeps, w: WatchRecord): Promise<CheckResult> {
  const base = `https://${w.domain}`;
  const sm = await collectSitemap([...(w.sitemapUrl ? [w.sitemapUrl] : []), `${base}/sitemap.xml`, `${base}/sitemap_index.xml`], deps.fetcher, { maxFiles: 6, maxUrls: 3000 });
  const pages: Record<string, PageSnap> = {};
  let reached = 0;
  for (const raw of (w.pages.length ? w.pages : [`${base}/`]).slice(0, 3)) {
    let url: string; try { url = normaliseInputUrl(raw).toString(); } catch { continue; }
    const r = await fetchFollowing(url, deps.fetcher);
    if (r.error || r.status === 0 || r.status >= 400) continue;
    reached++;
    const f = analyzeHtml(r.text, r.url, { status: r.status, contentType: r.contentType, xRobots: r.xRobots, ms: r.ms, bytes: r.bytes });
    pages[url] = { title: f.title, description: f.description, h1: f.h1[0] ?? null, words: f.wordCount, hash: hash(visibleText(r.text)) };
  }
  if (!sm.found && reached === 0) return { baseline: false, events: 0, urls: 0, found: false, error: 'The website could not be reached.' };
  const at = new Date(deps.now()).toISOString();
  const next: Snapshot = { at, urls: sm.entries.map((e) => ({ u: e.loc, ...(e.lastmod ? { m: e.lastmod } : {}) })), truncated: sm.truncated, found: sm.found, pages };
  const prevDoc = await deps.docs.get(w.workspaceId, w.projectId, 'watchSnapshots', w.id);
  await deps.docs.put(w.workspaceId, w.projectId, 'watchSnapshots', { id: w.id, ...next } as never);
  if (!prevDoc) return { baseline: true, events: 0, urls: next.urls.length, found: sm.found };
  const prev = prevDoc as unknown as Snapshot;
  const events = diffSnapshots({ ...prev, urls: Array.isArray(prev.urls) ? prev.urls : [], pages: prev.pages ?? {} }, next);
  let i = 0;
  for (const e of events) await deps.docs.put(w.workspaceId, w.projectId, 'watchEvents', { id: `${at}-${String(i++).padStart(3, '0')}`, watchId: w.id, at, ...e } as never);
  if (events.length) {
    const mine = (await deps.docs.list(w.workspaceId, w.projectId, 'watchEvents')).filter((d) => d.watchId === w.id).sort((a, b) => String(b.id).localeCompare(String(a.id)));
    for (const old of mine.slice(MAX_EVENTS_KEPT)) await deps.docs.delete(w.workspaceId, w.projectId, 'watchEvents', old.id);
  }
  return { baseline: false, events: events.length, urls: next.urls.length, found: sm.found };
}

export async function removeWatchData(docs: ProjectDocsStore, w: WatchRecord): Promise<void> {
  await docs.delete(w.workspaceId, w.projectId, 'watchSnapshots', w.id);
  for (const d of await docs.list(w.workspaceId, w.projectId, 'watchEvents')) if (d.watchId === w.id) await docs.delete(w.workspaceId, w.projectId, 'watchEvents', d.id);
}

export interface WatchRunDeps { store: WatchStore; docs: ProjectDocsStore; fetcher: PageFetcher; now: () => number; projectExists(ws: string, project: string): Promise<boolean> }
export async function runWatches(deps: WatchRunDeps): Promise<{ checked: number; changes: number; removed: number; failed: number }> {
  const out = { checked: 0, changes: 0, removed: 0, failed: 0 };
  for (const w of await deps.store.listAll()) {
    if (!w.enabled) continue;
    if (!(await deps.projectExists(w.workspaceId, w.projectId))) { await deps.store.delete(w.id); out.removed++; continue; }
    try {
      const r = await checkWatch(deps, w);
      await deps.store.put({ ...w, lastCheckedAt: new Date(deps.now()).toISOString(), lastError: r.error ?? null });
      if (r.error) out.failed++; else { out.checked++; out.changes += r.events; }
    } catch { out.failed++; await deps.store.put({ ...w, lastError: 'The check failed. It will try again tomorrow.' }); }
  }
  return out;
}
