import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type GbpPerformance, type GbpPostInfo, type GbpReviewItem, type GbpStatus } from '../../api/client';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const when = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } };
const Tile = ({ k, v }: { k: string; v: string }) => <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">{k}</p><p className="text-2xl font-bold text-fg">{v}</p></div>;

function useStatus() {
  const [status, setStatus] = useState<GbpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setStatus(await apiClient.gbpStatus()); setError(null); } catch (e) { setError(errMessage(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  return { status, error, load };
}

const RESULT_TEXT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Google Business Profile is connected.' },
  pending_approval: { ok: false, text: 'Signed in, but Google has not approved this app for Business Profile data yet. Your connection is saved; locations will appear once Google approves it.' },
  denied: { ok: false, text: 'Google sign-in was cancelled.' },
  invalid_state: { ok: false, text: 'The sign-in could not be verified. Please try connecting again.' },
  not_allowed: { ok: false, text: 'Only owners and admins can connect Google Business Profile.' },
  no_refresh: { ok: false, text: 'Google did not give long-term access. Remove AdLens in your Google account permissions, then connect again.' },
  vault: { ok: false, text: 'Secure storage is not set up on this server yet.' },
  failed: { ok: false, text: 'Connecting failed. Please try again.' },
};

/** Connect Google Business Profile, pick the location for this project, and see how people find and contact the business. */
export function BusinessProfile() {
  const { status, error: loadError, load } = useStatus();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(28);
  const [perf, setPerf] = useState<GbpPerformance | null>(null);
  const [pick, setPick] = useState('');
  const result = (() => { try { return RESULT_TEXT[new URLSearchParams(window.location.search).get('gbp') ?? ''] ?? null; } catch { return null; } })();

  const act = async (fn: () => Promise<string | void>) => { setBusy(true); setError(null); setNote(null); try { const m = await fn(); if (m) setNote(m); await load(); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); } };
  const linked = Boolean(status?.link);
  useEffect(() => {
    if (!linked) { setPerf(null); return; }
    let cancelled = false;
    apiClient.gbpPerformance(days).then((p) => { if (!cancelled) { setPerf(p); setError(null); } }).catch((e) => { if (!cancelled) setError(errMessage(e)); });
    return () => { cancelled = true; };
  }, [linked, days]);

  if (!status) return loadError ? <p role="alert" className="text-sm text-danger">{loadError}</p> : <p className="text-sm text-fg-muted">Loading…</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Connect your Google Business Profile to see how many people found the business on Google Search and Maps, called, asked for directions or visited the website, and to answer reviews and publish posts from here. AdLens only reads your numbers and acts when you press a button.</p>
      {result && <p role="status" className={`text-sm ${result.ok ? 'text-success' : 'text-warning'}`}>{result.text}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-success">{note}</p>}
      {!status.googleConfigured && <p className="text-sm text-warning">Google sign-in is not configured on this server.</p>}
      {!status.connected ? (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-fg">Before you connect</h3>
          <ol className="list-decimal pl-5 text-sm text-fg-muted space-y-1">
            <li>The business needs a verified Google Business Profile that has been active for a couple of months and has a website.</li>
            <li>Google must approve the app's Google Cloud project for the Business Profile APIs. The owner of this AdLens installation requests that once, in Google's Business Profile API access form.</li>
            <li>Add this address to the Google sign-in client's allowed redirect addresses: <code className="text-fg break-all">{status.redirectUri}</code></li>
          </ol>
          {status.canAdmin ? <button type="button" className={primary} disabled={busy || !status.googleConfigured || !status.vaultReady} onClick={() => void act(async () => { const r = await apiClient.gbpStart(); window.location.href = r.url; })}>Connect Google Business Profile</button> : <p className="text-sm text-fg-muted">Ask an owner or admin of this workspace to connect it.</p>}
          {!status.vaultReady && <p className="text-xs text-warning">Secure storage is not set up on this server yet.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
            <p className="text-sm text-fg">Connected{status.googleEmail ? ` as ${status.googleEmail}` : ''}.</p>
            {status.lastError && <p className="text-sm text-warning">{status.lastError}</p>}
            {status.canAdmin && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-fg-muted block">Business location for this project
                  <select className={`${field} block mt-1 min-w-[220px]`} value={pick || status.link?.location || ''} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Choose a location…</option>
                    {status.locations.map((l) => <option key={l.name} value={l.name}>{l.title}{l.address ? ` (${l.address})` : ''}</option>)}
                  </select>
                </label>
                <button type="button" className={primary} disabled={busy || !pick} onClick={() => void act(async () => { await apiClient.gbpLink(pick); setPick(''); return 'Saved.'; })}>Use this location</button>
                <button type="button" className={secondary} disabled={busy} onClick={() => void act(async () => { const r = await apiClient.gbpRefreshLocations(); return `${r.locations.length} location${r.locations.length === 1 ? '' : 's'} found.`; })}>Refresh list</button>
                <button type="button" className={secondary} disabled={busy} onClick={() => { if (window.confirm('Disconnect Google Business Profile for this workspace?')) void act(async () => { await apiClient.gbpDisconnect(); return 'Disconnected.'; }); }}>Disconnect</button>
              </div>
            )}
          </div>
          {status.link && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-fg">{status.link.title}</h3>
                <select className={field} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"><option value={7}>Last 7 days</option><option value={28}>Last 28 days</option><option value={90}>Last 90 days</option></select>
                {status.canEdit && <button type="button" className={secondary} disabled={busy} onClick={() => void act(async () => { const r = await apiClient.gbpSaveTable(); return `Saved "${r.name}" (${r.rows} days) as a table you can use in dashboards and reports.`; })}>Save as a table for dashboards</button>}
              </div>
              {perf ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Tile k="Views on Search and Maps" v={perf.totals.views.toLocaleString()} /><Tile k="Calls" v={perf.totals.calls.toLocaleString()} /><Tile k="Website visits" v={perf.totals.websiteClicks.toLocaleString()} /><Tile k="Direction requests" v={perf.totals.directions.toLocaleString()} />
                  </div>
                  <p className="text-[11px] text-fg-subtle">Google's numbers arrive about two days late.</p>
                </>
              ) : <p className="text-sm text-fg-muted">Loading numbers…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

function ReviewCard({ r, canEdit, canAi, onChanged }: { r: GbpReviewItem; canEdit: boolean; canAi: boolean; onChanged: () => Promise<void> }) {
  const [text, setText] = useState(r.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); await onChanged(); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); } };
  const low = r.stars <= 3;
  return (
    <li className={`rounded-xl border p-3 space-y-2 ${low && !r.replied ? 'border-warning-line bg-warning-soft' : 'border-line bg-surface'}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className={low ? 'text-warning' : 'text-success'} aria-label={`${r.stars} stars`}>{stars(r.stars)}</span><span className="font-medium text-fg">{r.reviewer}</span><span className="text-xs text-fg-subtle">{when(r.createdAt)}</span>{r.replied && <span className="text-[11px] rounded-full px-2 py-0.5 bg-success-soft text-success">Replied</span>}{r.status === 'dismissed' && <span className="text-[11px] rounded-full px-2 py-0.5 bg-fill-2 text-fg-muted">Dismissed</span>}</div>
      <p className="text-sm text-fg whitespace-pre-wrap">{r.comment || <span className="text-fg-subtle">No written comment.</span>}</p>
      {r.replied ? <p className="text-sm text-fg-muted border-l-2 border-line pl-3 whitespace-pre-wrap">Your reply: {r.replyText}</p> : canEdit && r.status !== 'dismissed' && (
        <div className="space-y-2">
          <textarea className={`${field} w-full min-h-[96px]`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply, or let the AI draft one for you to edit." aria-label={`Reply to ${r.reviewer}`} maxLength={4000} />
          <div className="flex flex-wrap gap-2">
            {canAi && <button type="button" className={secondary} disabled={busy} onClick={() => void act(async () => { const d = await apiClient.gbpDraft(r.id); setText(d.draft); })}>{text ? 'Draft again with AI' : 'Draft with AI'}</button>}
            <button type="button" className={primary} disabled={busy || text.trim().length < 2} onClick={() => { if (window.confirm('Post this reply publicly on Google?')) void act(async () => { await apiClient.gbpApprove(r.id, text); }); }}>Approve and post</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => void act(async () => { await apiClient.gbpDismiss(r.id); })}>Skip</button>
          </div>
          <p className="text-[11px] text-fg-subtle">Nothing is posted until you press "Approve and post".</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </li>
  );
}

/** Reviews of the linked business, with AI-drafted replies that always wait for a person to approve them. */
export function ReviewManager() {
  const { status, error: loadError } = useStatus();
  const [data, setData] = useState<{ items: GbpReviewItem[]; averageRating: number | null; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'todo' | 'low' | 'all'>('todo');
  const linked = Boolean(status?.link);
  const load = useCallback(async () => { try { const r = await apiClient.gbpReviews(); setData(r); setError(null); } catch (e) { setError(errMessage(e)); } }, []);
  useEffect(() => { if (linked) void load(); }, [linked, load]);
  if (!status) return loadError ? <p role="alert" className="text-sm text-danger">{loadError}</p> : <p className="text-sm text-fg-muted">Loading…</p>;
  if (!status.connected || !status.link) return <p className="text-sm text-fg-muted">Connect Google Business Profile and choose this project's location first (Local SEO, Business Profile).</p>;
  const list = (data?.items ?? []).filter((r) => filter === 'all' ? true : filter === 'low' ? r.stars <= 3 : !r.replied && r.status !== 'dismissed');
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">New reviews appear here. For each one the AI can write a first reply in a warm, calm tone; you read it, change it if you like, and press approve. We also email the person who connected the profile when a new review of 3 stars or fewer arrives (checked once a day).</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data && <p className="text-sm text-fg">{data.averageRating !== null ? `Average ${data.averageRating.toFixed(1)} from ${data.total ?? data.items.length} reviews. ` : ''}{data.items.filter((r) => !r.replied && r.status !== 'dismissed').length} waiting for a reply.</p>}
      <div className="flex gap-2" role="group" aria-label="Filter reviews">{(['todo', 'low', 'all'] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1.5 text-sm min-h-[36px] ${filter === f ? 'border-accent bg-accent-soft text-fg font-medium' : 'border-line bg-surface text-fg-muted hover:bg-fill-2'}`}>{f === 'todo' ? 'Needs a reply' : f === 'low' ? '3 stars or fewer' : 'All'}</button>)}</div>
      {!data ? <p className="text-sm text-fg-muted">Loading reviews…</p> : list.length === 0 ? <p className="text-sm text-fg-muted">Nothing here.</p> : <ul className="space-y-3">{list.map((r) => <ReviewCard key={r.id} r={r} canEdit={status.canEdit} canAi={status.canAi} onChanged={load} />)}</ul>}
    </div>
  );
}

/** Posts (offers, news, events) published to the Google listing now or on a chosen date. */
export function BusinessPosts() {
  const { status, error: loadError } = useStatus();
  const [posts, setPosts] = useState<GbpPostInfo[]>([]);
  const [text, setText] = useState(''); const [url, setUrl] = useState(''); const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const linked = Boolean(status?.link);
  const load = useCallback(async () => { try { setPosts((await apiClient.gbpPosts()).posts); } catch (e) { setError(errMessage(e)); } }, []);
  useEffect(() => { if (linked) void load(); }, [linked, load]);
  if (!status) return loadError ? <p role="alert" className="text-sm text-danger">{loadError}</p> : <p className="text-sm text-fg-muted">Loading…</p>;
  if (!status.connected || !status.link) return <p className="text-sm text-fg-muted">Connect Google Business Profile and choose this project's location first (Local SEO, Business Profile).</p>;
  const act = async (fn: () => Promise<string | void>) => { setBusy(true); setError(null); setNote(null); try { const m = await fn(); if (m) setNote(m); await load(); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Posts show on your Google listing and Maps card. Leave the date empty to publish now. Scheduled posts go out the first time the daily job runs on or after the date you choose.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-success">{note}</p>}
      {status.canEdit && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <textarea className={`${field} w-full min-h-[96px]`} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} placeholder="What's new? An offer, an event, new opening hours…" aria-label="Post text" />
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-fg-muted block">"Learn more" link (optional, https)<input className={`${field} w-full mt-1`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
            <label className="text-xs text-fg-muted block">Publish on (optional)<input type="date" className={`${field} w-full mt-1`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          <button type="button" className={primary} disabled={busy || text.trim().length < 5} onClick={() => void act(async () => { const r = await apiClient.gbpPostCreate(text, url, date); setText(''); setUrl(''); setDate(''); return r.status === 'published' ? 'Published to Google.' : 'Scheduled.'; })}>{date ? 'Schedule post' : 'Publish now'}</button>
        </div>
      )}
      {posts.length > 0 && <ul className="space-y-2">{posts.map((p) => <li key={p.id} className="rounded-xl border border-line bg-surface p-3 text-sm space-y-1"><p className="text-fg whitespace-pre-wrap">{p.text}</p><p className="text-xs text-fg-muted">{p.status === 'published' ? `Published ${when(p.publishedAt || p.createdAt)}` : p.status === 'scheduled' ? `Scheduled for ${when(p.publishOn)}` : `Failed: ${p.error}`}</p>{p.status !== 'published' && status.canEdit && <button type="button" className={secondary} disabled={busy} onClick={() => void act(async () => { await apiClient.gbpPostDelete(p.id); })}>Remove</button>}</li>)}</ul>}
    </div>
  );
}
