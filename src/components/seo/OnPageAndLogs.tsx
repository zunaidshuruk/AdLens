import React, { useState } from 'react';
import { apiClient, type OnPageReportInfo } from '../../api/client';
import { createLogAnalyzer, neverCrawled, type LogReport } from '../../utils/logAnalyzer';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const n = (v: number) => v.toLocaleString();
const STATUS = { good: { label: 'Good', cls: 'bg-success-soft text-success' }, warn: { label: 'Improve', cls: 'bg-warning-soft text-warning' }, bad: { label: 'Fix', cls: 'bg-danger-soft text-danger' } } as const;

export function OnPageChecker() {
  const [url, setUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [rivals, setRivals] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<{ report: OnPageReportInfo; competitorErrors: string[] } | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setR(null);
    try { setR(await apiClient.seoOnPage(url.trim(), keyword.trim(), rivals.split(/[\n,\s]+/).filter(Boolean).slice(0, 3))); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  const rep = r?.report;
  const order = { bad: 0, warn: 1, good: 2 } as const;
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void run(e)} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <label className="text-xs font-medium text-fg space-y-1 block flex-1 min-w-[220px]">Page address<input className={`${field} block w-full`} placeholder="yoursite.com/page" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <label className="text-xs font-medium text-fg space-y-1 block flex-1 min-w-[180px]">Keyword this page should rank for<input className={`${field} block w-full`} placeholder="for example: leather wallet" maxLength={100} value={keyword} onChange={(e) => setKeyword(e.target.value)} /></label>
        </div>
        <label className="text-xs font-medium text-fg space-y-1 block">Competitor pages for related words (optional, up to 3, one per line)<textarea className={`${field} block w-full min-h-[64px]`} value={rivals} onChange={(e) => setRivals(e.target.value)} /></label>
        <button type="submit" disabled={busy || url.trim().length < 3 || keyword.trim().length < 2} className={primary}>{busy ? 'Checking…' : 'Check this page'}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <div aria-busy="true" className="h-24 rounded-xl bg-fill-2 animate-pulse" />}
      {rep && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">On-page score</p><p className={`text-2xl font-bold ${rep.score >= 80 ? 'text-success' : rep.score >= 50 ? 'text-warning' : 'text-danger'}`}>{rep.score}</p></div>
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Keyword used</p><p className="text-2xl font-bold text-fg">{rep.occurrences}×</p><p className="text-[11px] text-fg-subtle">{rep.density}% of words</p></div>
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Words on page</p><p className="text-2xl font-bold text-fg">{n(rep.facts.wordCount)}</p></div>
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Reading</p><p className="text-2xl font-bold text-fg capitalize">{rep.readability.level}</p><p className="text-[11px] text-fg-subtle">{rep.readability.avgSentenceWords ? `${rep.readability.avgSentenceWords} words a sentence` : 'not enough text'}</p></div>
          </div>
          <ul className="space-y-2">
            {[...rep.checks].sort((a, b) => order[a.status] - order[b.status]).map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-surface p-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2"><span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span><span className="text-sm font-semibold text-fg">{c.title}</span></div>
                {c.detail && <p className="text-xs text-fg-muted">{c.detail}</p>}
                {c.fix && <p className="text-xs text-fg"><span className="font-medium">How to fix: </span>{c.fix}</p>}
              </li>
            ))}
          </ul>
          {rep.related && (
            <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Related words to work in</h3><p className="text-xs text-fg-muted">{rep.related.note}</p>
              <p className="text-sm text-fg">{rep.related.missing.length ? rep.related.missing.map((m) => m.term).join(', ') : 'You already cover the common words.'}</p></section>
          )}
          {r!.competitorErrors.length > 0 && <p className="text-xs text-warning">Could not read: {r!.competitorErrors.join(', ')}</p>}
        </div>
      )}
    </div>
  );
}

async function readLog(file: File, onProgress: (pct: number) => void): Promise<LogReport> {
  const a = createLogAnalyzer();
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let tail = ''; let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.length;
    const parts = (tail + value).split('\n');
    tail = parts.pop() ?? '';
    for (const l of parts) a.add(l);
    onProgress(Math.min(99, Math.round((read / Math.max(file.size, 1)) * 100)));
  }
  if (tail) a.add(tail);
  return a.result();
}

export function LogAnalyzer() {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<LogReport | null>(null);
  const [sitemap, setSitemap] = useState('');
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setError(null); setR(null); setPct(0);
    try {
      const rep = await readLog(f, setPct);
      if (rep.parsed === 0) setError('No lines could be read. We understand the standard "combined" access log format (nginx, Apache and most CDNs).');
      else setR(rep);
    } catch { setError('The file could not be read.'); }
    setBusy(false);
  };
  const missing = r && sitemap.trim() ? neverCrawled(r.crawl.search.paths, sitemap.split(/\s+/).filter(Boolean)) : [];
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Upload your website's access log to see which crawlers visit, which pages they read, and where they waste time. The file is read inside your browser and is never uploaded. We spot crawlers by their name in the log, so a faker using Googlebot's name would be counted too.</p>
      <input type="file" aria-label="Access log file" accept=".log,.txt,.gz-not-supported,text/plain" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} className="text-sm text-fg" />
      {busy && <p role="status" className="text-xs text-fg-muted">Reading… {pct}%</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {r && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[['Requests read', n(r.parsed)], ['From crawlers', n(r.botHits)], ['Period', r.firstDay === r.lastDay ? (r.firstDay ?? '') : `${r.firstDay} to ${r.lastDay}`], ['Not understood', n(r.unparsed)]].map(([k, v]) => <div key={k} className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">{k}</p><p className="text-lg font-bold text-fg">{v}</p></div>)}
          </div>
          <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-xs"><thead className="bg-fill-2 text-fg-muted"><tr><th className="text-left p-2">Crawler</th><th className="text-left p-2">Kind</th><th className="text-right p-2">Requests</th><th className="text-right p-2">Share</th><th className="text-right p-2">OK</th><th className="text-right p-2">Redirect</th><th className="text-right p-2">Not found</th><th className="text-right p-2">Server error</th><th className="text-right p-2">Pages</th></tr></thead>
            <tbody>{r.bots.map((b) => <tr key={b.id} className="border-t border-line"><td className="p-2 text-fg">{b.label}</td><td className="p-2 text-fg-muted">{b.kind === 'search' ? 'Search' : b.kind === 'ai' ? 'AI' : b.kind === 'seo-tool' ? 'SEO tool' : 'Other'}</td><td className="p-2 text-right tabular-nums">{n(b.hits)}</td><td className="p-2 text-right tabular-nums">{b.share}%</td><td className="p-2 text-right tabular-nums">{n(b.status['2xx'])}</td><td className="p-2 text-right tabular-nums">{n(b.status['3xx'])}</td><td className="p-2 text-right tabular-nums">{n(b.status['4xx'])}</td><td className="p-2 text-right tabular-nums">{n(b.status['5xx'])}</td><td className="p-2 text-right tabular-nums">{n(b.uniqueUrls)}</td></tr>)}
              {r.bots.length === 0 && <tr><td colSpan={9} className="p-3 text-fg-muted">No known crawlers found in this log.</td></tr>}</tbody></table></div>
          {r.issues.length > 0 && (
            <section className="space-y-2"><h3 className="text-sm font-semibold text-fg">Where crawling is wasted</h3>
              {r.issues.map((i) => (
                <div key={i.kind} className="rounded-xl border border-line bg-surface p-3 space-y-1"><p className="text-sm font-semibold text-fg">{i.label} <span className="text-xs font-normal text-fg-muted">{n(i.hits)} requests, {i.share}% of search and AI crawling</span></p><p className="text-xs text-fg-muted">{i.advice}</p>
                  <ul className="text-xs text-fg space-y-0.5">{i.examples.map((e) => <li key={e.path} className="break-all">{e.path} <span className="text-fg-subtle">× {e.hits}{e.status ? ` (${e.status})` : ''}</span></li>)}</ul></div>
              ))}
            </section>
          )}
          {r.bots.filter((b) => b.kind === 'search' || b.kind === 'ai').slice(0, 3).map((b) => (
            <section key={b.id} className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Pages {b.label} reads most</h3>
              <ul className="text-xs text-fg space-y-0.5">{b.topUrls.map((u) => <li key={u.path} className="break-all">{u.path} <span className="text-fg-subtle">× {u.hits}</span></li>)}</ul></section>
          ))}
          <section className="rounded-xl border border-line bg-surface p-3 space-y-2"><h3 className="text-sm font-semibold text-fg">Pages crawlers have not read</h3><p className="text-xs text-fg-muted">Paste the addresses you want crawled (for example from your sitemap), one per line. Compared with the pages search crawlers read in this log, so use a log that covers several weeks.</p>
            <textarea aria-label="Addresses to compare" className={`${field} w-full min-h-[80px]`} value={sitemap} onChange={(e) => setSitemap(e.target.value)} />
            {sitemap.trim() && <p className="text-xs text-fg">{missing.length === 0 ? 'Search crawlers read all of them.' : <>Not read by search crawlers in this log: <span className="break-all">{missing.slice(0, 40).join(', ')}</span></>}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
