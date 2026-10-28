import { Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type AiRunInfo, type AiVisOverview, type DomainOverviewInfo, type WatchEventInfo, type WatchInfo } from '../../api/client';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const when = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } };
const Tile = ({ k, v, hint }: { k: string; v: string; hint?: string }) => <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">{k}</p><p className="text-2xl font-bold text-fg">{v}</p>{hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}</div>;
const sentimentLabel = (s: string | null) => (s === 'positive' ? 'Positive tone' : s === 'negative' ? 'Negative tone' : s === 'neutral' ? 'Neutral tone' : 'No tone (not mentioned)');
const sentimentClass = (s: string | null) => (s === 'positive' ? 'text-success' : s === 'negative' ? 'text-danger' : 'text-fg-muted');

// ---------------------------------------------------------------------------
// AI visibility
// ---------------------------------------------------------------------------
export function AiVisibility() {
  const [data, setData] = useState<AiVisOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [rivals, setRivals] = useState('');
  const [agentId, setAgentId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<AiRunInfo[]>([]);
  const load = useCallback(async () => {
    try { const d = await apiClient.aivisOverview(); setData(d); setRivals(d.competitors.join(', ')); setError(null); } catch (e) { setError(errMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(null); setNote(null);
    try { const m = await fn(); if (m) setNote(m); await load(); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); }
  };
  if (!data) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-sm text-fg-muted">Loading…</p>;
  const run = (ids: string[]) => act(async () => {
    const r = await apiClient.aivisRun(ids, agentId || undefined);
    const bits = [`${r.runs.length} answer${r.runs.length === 1 ? '' : 's'} checked.`];
    if (r.quota) bits.push(r.quota.limit === null ? `${r.quota.used} AI questions used this month.` : `${r.quota.used} of ${r.quota.limit} AI questions used this month.`);
    if (r.errors.length) bits.push(r.errors[0]!);
    return bits.join(' ');
  });
  const s = data.summary;
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Save the questions your customers might ask an AI assistant, such as "best accounting software for small shops". We ask the AI, then check whether it names your brand ({data.brandTerms.join(', ') || 'set a project name'}), who it names beside you, how it speaks about you, and which websites it points to. Each run uses one of your AI questions for the month.</p>
      <p className="text-xs text-fg-muted rounded-lg border border-line bg-fill-2 p-2">Be aware: this asks one AI assistant, not the live ChatGPT, Gemini or Perplexity apps, and an AI can answer differently each time. Treat the numbers as a guide and look at the trend over several runs. {data.agents.length === 0 && 'To ask a different AI, connect an agent with your own key on the AI Agents page.'}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-success">{note}</p>}
      {s.run > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile k="You are mentioned" v={`${s.visibility}%`} hint={`in ${s.run} answer${s.run === 1 ? '' : 's'}`} />
          <Tile k="Share of voice" v={s.shareOfVoice === null ? 'n/a' : `${s.shareOfVoice}%`} hint="you versus named rivals" />
          <Tile k="Your site is linked" v={`${s.citedOwn}`} hint="answers that name your website" />
          <Tile k="Tone" v={`${s.sentiment.positive} up / ${s.sentiment.negative} down`} hint={`${s.sentiment.neutral} neutral`} />
        </div>
      )}
      {data.trend.length > 1 && <p className="text-xs text-fg-muted">Daily mention rate: {data.trend.map((t) => `${t.date.slice(5)} ${t.rate}%`).join(' · ')}</p>}
      {data.canEdit && (
        <section className="rounded-xl border border-line bg-surface p-3 space-y-3">
          <label className="text-xs font-medium text-fg block">Questions to ask (one per line)<textarea className={`${field} block w-full min-h-[80px] mt-1`} value={text} onChange={(e) => setText(e.target.value)} placeholder={'best running shoes for flat feet\nwhich CRM is easiest for a small team'} /></label>
          <div className="flex flex-wrap gap-2 items-end">
            <button type="button" className={primary} disabled={busy || text.trim().length < 8} onClick={() => act(async () => { const r = await apiClient.aivisAddPrompts(text.split('\n').map((t) => t.trim()).filter(Boolean)); setText(''); return `${r.added} added${r.skipped ? `, ${r.skipped} skipped (already saved)` : ''}.`; })}>Save questions</button>
            <span className="text-xs text-fg-muted">{data.prompts.length} of {data.limit} saved</span>
          </div>
          <label className="text-xs font-medium text-fg block">Rival brands to look for (comma separated, up to 10)<input className={`${field} block w-full mt-1`} value={rivals} onChange={(e) => setRivals(e.target.value)} /></label>
          <button type="button" className={secondary} disabled={busy} onClick={() => act(async () => { await apiClient.aivisSetCompetitors(rivals.split(',').map((t) => t.trim()).filter(Boolean)); return 'Rivals saved.'; })}>Save rivals</button>
        </section>
      )}
      {data.prompts.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {data.canAi ? <button type="button" className={primary} disabled={busy} onClick={() => run(data.prompts.slice(0, 10).map((p) => p.id))}>{busy ? 'Asking…' : `Run ${Math.min(10, data.prompts.length)} question${data.prompts.length === 1 ? '' : 's'}`}</button> : <span className="text-xs text-fg-muted">Your role does not allow using the AI.</span>}
          {data.agents.length > 0 && <label className="text-xs text-fg-muted">Ask with <select className={field} value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">Built-in AI</option>{data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        </div>
      )}
      <ul className="space-y-2">
        {data.prompts.map((p) => {
          const a = p.latest?.analysis;
          return (
            <li key={p.id} className="rounded-xl border border-line bg-surface p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-fg">{p.text}</p>
                <div className="flex gap-1 shrink-0">
                  {data.canAi && <button type="button" className={secondary} disabled={busy} onClick={() => run([p.id])}>Run</button>}
                  {data.canEdit && <button type="button" aria-label={`Delete question: ${p.text}`} className={secondary} disabled={busy} onClick={() => act(() => apiClient.aivisDeletePrompt(p.id))}><Trash2 className="h-4 w-4" aria-hidden /></button>}
                </div>
              </div>
              {!a ? <p className="text-xs text-fg-muted">Not run yet.</p> : (
                <div className="text-xs space-y-1">
                  <p><span className={a.mentioned ? 'text-success font-medium' : 'text-danger font-medium'}>{a.mentioned ? `Mentioned${a.rank ? ` (number ${a.rank} named)` : ''}` : 'Not mentioned'}</span> · <span className={sentimentClass(a.sentiment)}>{sentimentLabel(a.sentiment)}</span> · {a.citedOwn ? 'your website is named' : 'your website is not named'} · {when(p.latest!.at)}</p>
                  {a.competitors.length > 0 && <p className="text-fg-muted">Rivals named: {a.competitors.filter((c) => c.mentioned).map((c) => c.name).join(', ') || 'none'}</p>}
                  {a.sources.length > 0 && <p className="text-fg-muted break-all">Websites the answer points to: {a.sources.slice(0, 8).join(', ')}</p>}
                  {a.excerpt && <p className="text-fg-muted italic">"{a.excerpt}"</p>}
                  <button type="button" className="text-accent-text underline" onClick={async () => { if (open === p.id) { setOpen(null); return; } setOpen(p.id); try { setHistory((await apiClient.aivisHistory(p.id)).runs); } catch (e) { setError(errMessage(e)); } }}>{open === p.id ? 'Hide history' : `History (${p.runs} run${p.runs === 1 ? '' : 's'})`}</button>
                  {open === p.id && <ul className="space-y-0.5">{history.map((h) => <li key={h.id} className="text-fg-muted">{when(h.at)}: {h.analysis.mentioned ? 'mentioned' : 'not mentioned'}, {sentimentLabel(h.analysis.sentiment).toLowerCase()}</li>)}</ul>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Domain overview
// ---------------------------------------------------------------------------
export function DomainOverview() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [o, setO] = useState<DomainOverviewInfo | null>(null);
  const go = async () => {
    setBusy(true); setError(null); setO(null);
    try { setO((await apiClient.seoDomainOverview(domain.trim())).overview); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">See what any website shows publicly: its home page, how many pages its sitemap lists, what it is built with, and whether it blocks search or AI crawlers. Traffic and keyword numbers for other websites need a paid data source, which is not connected, so none are shown.</p>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <label className="sr-only" htmlFor="dom-input">Website</label>
        <input id="dom-input" className={`${field} flex-1 min-w-[220px]`} placeholder="competitor.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <button type="submit" className={primary} disabled={busy || domain.trim().length < 3}>{busy ? 'Checking…' : 'Check website'}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {o && (
        <div className="space-y-3">
          <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg break-all">{o.domain}</h3>
            <p className="text-sm text-fg">{o.title ?? 'No page title'}</p><p className="text-xs text-fg-muted">{o.description ?? 'No description set.'}</p>
            <p className="text-xs text-fg-muted">{o.httpsOnly ? 'Secure (https)' : 'Not secure (http)'} · answers in {o.ms} ms · {o.htmlKb} KB page{o.lang ? ` · language ${o.lang}` : ''}</p></section>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Tile k="Pages in sitemap" v={o.sitemap.found ? `${o.sitemap.urls.toLocaleString()}${o.sitemap.truncated ? '+' : ''}` : 'None found'} />
            <Tile k="Latest page change" v={o.sitemap.latestChange ? o.sitemap.latestChange.slice(0, 10) : 'Not listed'} />
            <Tile k="Social links" v={String(o.social.length)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {o.sitemap.sections.length > 0 && <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Biggest sections</h3><ul className="text-xs space-y-0.5">{o.sitemap.sections.map((s) => <li key={s.section} className="flex justify-between gap-2"><span className="text-fg break-all">{s.section}</span><span className="text-fg-muted tabular-nums">{s.urls.toLocaleString()}</span></li>)}</ul></section>}
            <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Built with</h3><p className="text-xs text-fg-muted">{o.tech.length ? o.tech.join(', ') : 'Nothing recognised'}</p><h3 className="text-sm font-semibold text-fg pt-1">Tracking and ads tags</h3><p className="text-xs text-fg-muted">{o.trackers.length ? o.trackers.join(', ') : 'None recognised'}</p></section>
            <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Crawlers</h3>
              <p className="text-xs text-fg-muted">{!o.robots.found ? 'No robots.txt found.' : o.robots.blocksAll ? 'Blocks all crawlers.' : 'Open to search crawlers.'}</p>
              {o.robots.blockedBots.length > 0 && <p className="text-xs text-fg-muted">Blocks AI crawlers: {o.robots.blockedBots.join(', ')}</p>}</section>
            <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Words it leans on</h3><p className="text-xs text-fg-muted">{o.topTerms.join(', ') || 'Not enough text'}</p>
              {o.structuredData.length > 0 && <p className="text-xs text-fg-muted">Structured data: {o.structuredData.join(', ')}</p>}</section>
          </div>
          {o.social.length > 0 && <p className="text-xs text-fg-muted">Social: {o.social.map((s) => s.name).join(', ')}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Competitor watch (EyeOn)
// ---------------------------------------------------------------------------
const EVENT_LABEL: Record<string, string> = { new_page: 'New page', removed_page: 'Page removed', updated_page: 'Page updated', title_changed: 'Title changed', description_changed: 'Description changed', h1_changed: 'Heading changed', content_changed: 'Text changed', more: 'More' };

export function CompetitorWatch() {
  const [watches, setWatches] = useState<WatchInfo[] | null>(null);
  const [events, setEvents] = useState<WatchEventInfo[]>([]);
  const [meta, setMeta] = useState({ limit: 0, canEdit: false });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState('');
  const [pages, setPages] = useState('');
  const load = useCallback(async () => {
    try { const d = await apiClient.watchList(); setWatches(d.watches); setEvents(d.events); setMeta({ limit: d.limit, canEdit: d.canEdit }); setError(null); } catch (e) { setError(errMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(null); setNote(null);
    try { const m = await fn(); if (m) setNote(m); await load(); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); }
  };
  if (!watches) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-sm text-fg-muted">Loading…</p>;
  const nameOf = (id: string) => watches.find((w) => w.id === id)?.domain ?? 'removed site';
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Pick competitor websites to keep an eye on. Once a day we read their sitemap and up to three key pages and tell you about new pages, removed pages and changes to titles, descriptions and headings. The first check only records what is there now, so changes show from the second check on. Only public pages are read.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-success">{note}</p>}
      {meta.canEdit && (
        <form className="rounded-xl border border-line bg-surface p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void act(async () => { await apiClient.watchAdd(domain.trim(), '', pages.split('\n').map((t) => t.trim()).filter(Boolean)); setDomain(''); setPages(''); return 'Now watching. Press Check now to record the starting point.'; }); }}>
          <label className="text-xs font-medium text-fg block">Competitor website<input className={`${field} block w-full mt-1`} placeholder="competitor.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></label>
          <label className="text-xs font-medium text-fg block">Key pages to watch (optional, up to 3, one per line; the home page is used if empty)<textarea className={`${field} block w-full min-h-[64px] mt-1`} value={pages} onChange={(e) => setPages(e.target.value)} placeholder={'competitor.com/pricing'} /></label>
          <div className="flex items-center gap-3"><button type="submit" className={primary} disabled={busy || domain.trim().length < 3}>Start watching</button><span className="text-xs text-fg-muted">{watches.length} of {meta.limit} used</span></div>
        </form>
      )}
      {watches.length === 0 ? <p className="text-sm text-fg-muted">You are not watching any website yet.</p> : (
        <ul className="space-y-2">{watches.map((w) => (
          <li key={w.id} className="rounded-xl border border-line bg-surface p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><p className="text-sm font-medium text-fg break-all">{w.domain}</p>
              <p className="text-xs text-fg-muted">{w.lastCheckedAt ? `Last checked ${when(w.lastCheckedAt)}` : 'Not checked yet'}{!w.enabled ? ' · paused' : ''}</p>
              {w.lastError && <p className="text-xs text-danger">{w.lastError}</p>}</div>
            {meta.canEdit && <div className="flex gap-1">
              <button type="button" className={secondary} disabled={busy} onClick={() => act(async () => { const r = await apiClient.watchCheck(w.id); return r.result.baseline ? `Starting point saved (${r.result.urls.toLocaleString()} pages listed).` : `${r.result.events} change${r.result.events === 1 ? '' : 's'} found.`; })}>Check now</button>
              <button type="button" className={secondary} disabled={busy} onClick={() => act(async () => { await apiClient.watchSetEnabled(w.id, !w.enabled); })}>{w.enabled ? 'Pause' : 'Resume'}</button>
              <button type="button" aria-label={`Stop watching ${w.domain}`} className={secondary} disabled={busy} onClick={() => act(() => apiClient.watchDelete(w.id))}><Trash2 className="h-4 w-4" aria-hidden /></button>
            </div>}
          </li>))}</ul>
      )}
      <section className="space-y-2"><h3 className="text-sm font-semibold text-fg">What changed</h3>
        {events.length === 0 ? <p className="text-xs text-fg-muted">Nothing yet. Changes appear here after the second check.</p> : (
          <ul className="space-y-1">{events.map((e) => (
            <li key={e.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs"><span className="font-medium text-fg">{EVENT_LABEL[e.type] ?? e.type}</span> <span className="text-fg-muted">· {nameOf(e.watchId)} · {when(e.at)}</span>
              {e.url && <p className="text-fg break-all">{e.url}</p>}<p className="text-fg-muted">{e.detail}</p></li>))}</ul>
        )}
      </section>
    </div>
  );
}
