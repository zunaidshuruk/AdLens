import { Copy, Search } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { apiClient, type SeoCrawlReport, type SeoIssueInfo, type SeoKeywordIdea, type SeoOpportunity, type SeoPageResult } from '../api/client';
import { ErrorState } from '../components/ErrorState';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const SEV: Record<SeoIssueInfo['severity'], { label: string; cls: string }> = {
  error: { label: 'Fix first', cls: 'bg-danger-soft text-danger' },
  warning: { label: 'Should fix', cls: 'bg-warning-soft text-warning' },
  info: { label: 'Nice to have', cls: 'bg-fill-2 text-fg-muted' },
};
const n = (v: number) => v.toLocaleString();

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-danger';
  return <span className={`font-bold tabular-nums ${cls}`}>{score}</span>;
}

function IssueList({ issues }: { issues: SeoIssueInfo[] }) {
  if (issues.length === 0) return <p className="text-sm text-success">No problems found. Nice work.</p>;
  return (
    <ul className="space-y-2">
      {issues.map((i, k) => (
        <li key={`${i.id}-${k}`} className="rounded-xl border border-line bg-surface p-3 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${SEV[i.severity].cls}`}>{SEV[i.severity].label}</span>
            <span className="text-sm font-semibold text-fg">{i.title}</span>
          </div>
          <p className="text-xs text-fg-muted">{i.detail}</p>
          <p className="text-xs text-fg"><span className="font-medium">How to fix: </span>{i.fix}</p>
        </li>
      ))}
    </ul>
  );
}

function PageChecker() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<SeoPageResult | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setR(null);
    try { setR(await apiClient.seoPage(url.trim())); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  const f = r?.facts;
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void run(e)} className="flex flex-wrap gap-2">
        <input aria-label="Page address" className={`${field} flex-1 min-w-[220px]`} placeholder="example.com/some-page" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" disabled={busy || url.trim().length < 3} className={primary}><Search className="w-4 h-4" /> {busy ? 'Checking…' : 'Check page'}</button>
      </form>
      <p className="text-xs text-fg-muted">Works on any public page, yours or a competitor's. We read the page the way Google would and list what to fix.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {r && f && (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 flex flex-wrap items-center gap-6">
            <div><p className="text-xs text-fg-muted">Page score</p><p className="text-4xl"><ScoreBadge score={r.score} /><span className="text-base text-fg-subtle"> / 100</span></p></div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold text-fg truncate">{f.title ?? '(no title)'}</p>
              <p className="text-xs text-fg-muted break-all">{r.url}{r.redirected ? ' (after a redirect)' : ''}</p>
              <p className="text-xs text-fg-muted">{r.issues.filter((i) => i.severity === 'error').length} to fix first · {r.issues.filter((i) => i.severity === 'warning').length} should fix · {r.issues.filter((i) => i.severity === 'info').length} nice to have</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              ['Title length', `${f.titleLength} characters`], ['Description length', `${f.descriptionLength} characters`], ['Words on page', n(f.wordCount)], ['Server time', `${(f.ms / 1000).toFixed(1)} s`],
              ['Main headings (H1)', String(f.h1.length)], ['Sub headings (H2)', String(f.h2Count)], ['Images', `${f.images.total} (${f.images.missingAlt} without alt)`], ['Links', `${f.internalLinks} inside, ${f.externalLinks} outside`],
            ].map(([k, v]) => <div key={k} className="rounded-lg border border-line bg-surface p-3"><dt className="text-fg-muted">{k}</dt><dd className="text-sm font-semibold text-fg mt-0.5">{v}</dd></div>)}
          </dl>
          {f.description && <p className="text-xs text-fg-muted"><span className="font-medium text-fg">Description: </span>{f.description}</p>}
          <IssueList issues={r.issues} />
        </div>
      )}
    </div>
  );
}

function SiteAudit() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ report: SeoCrawlReport; maxPages: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setRes(null); setShowAll(false);
    try { setRes(await apiClient.seoCrawl(url.trim() || undefined)); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  const r = res?.report;
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void run(e)} className="flex flex-wrap gap-2">
        <input aria-label="Site address (optional)" className={`${field} flex-1 min-w-[220px]`} placeholder="Leave empty to audit this project's website" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" disabled={busy} className={primary}><Search className="w-4 h-4" /> {busy ? 'Auditing… up to a minute' : 'Audit my site'}</button>
      </form>
      <p className="text-xs text-fg-muted">Visits your home page and sitemap, follows links on your own site, respects robots.txt, and reports broken links, missing titles, duplicates and more. It only runs on this project's website.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <div aria-busy="true" className="h-20 rounded-xl bg-fill-2 animate-pulse" />}
      {r && res && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Pages checked</p><p className="text-2xl font-bold text-fg">{r.crawled}</p></div>
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Average score</p><p className="text-2xl"><ScoreBadge score={r.averageScore} /></p></div>
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Problems to fix first</p><p className="text-2xl font-bold text-danger">{r.groups.filter((g) => g.severity === 'error').reduce((a, g) => a + g.count, 0)}</p></div>
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Took</p><p className="text-2xl font-bold text-fg">{r.seconds}s</p></div>
          </div>
          <p className="text-xs text-fg-muted">
            {r.stoppedBecause === 'finished' ? 'Every page we could find was checked.' : r.stoppedBecause === 'page_limit' ? `Stopped at your plan's limit of ${res.maxPages} pages, so bigger sites are only partly covered.` : 'Stopped after the time limit, so some pages were not checked.'}
            {r.sitemapFound ? ' A sitemap was found.' : ' No sitemap was found: add one so Google finds every page.'}
            {r.robotsBlocked > 0 ? ` ${r.robotsBlocked} pages are blocked by robots.txt and were skipped.` : ''}
            {' '}Statuses: {Object.entries(r.statusCounts).map(([k, v]) => `${v} × ${k}`).join(', ') || 'none'}.
          </p>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">What to fix</h3>
            {r.groups.length === 0 && <p className="text-sm text-success">No problems found.</p>}
            {r.groups.map((g) => (
              <details key={g.id} className="rounded-xl border border-line bg-surface p-3">
                <summary className="cursor-pointer flex flex-wrap items-center gap-2">
                  <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${SEV[g.severity].cls}`}>{SEV[g.severity].label}</span>
                  <span className="text-sm font-semibold text-fg">{g.title}</span>
                  <span className="text-xs text-fg-muted">{g.count} {g.count === 1 ? 'page' : 'pages'}</span>
                </summary>
                <p className="text-xs text-fg mt-2"><span className="font-medium">How to fix: </span>{g.fix}</p>
                <ul className="mt-2 space-y-0.5 text-xs text-fg-muted break-all">{g.urls.map((u) => <li key={u}>{u}</li>)}{g.count > g.urls.length && <li>…and {g.count - g.urls.length} more</li>}</ul>
              </details>
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">Pages (worst first)</h3>
            <div className="overflow-auto rounded-xl border border-line bg-surface">
              <table className="min-w-full text-xs">
                <thead className="text-fg-muted"><tr><th className="p-2 text-left font-medium">Page</th><th className="p-2 text-right font-medium">Score</th><th className="p-2 text-right font-medium">Problems</th><th className="p-2 text-right font-medium">Words</th><th className="p-2 text-right font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {(showAll ? r.pages : r.pages.slice(0, 25)).map((p) => (
                    <tr key={p.url}>
                      <td className="p-2 max-w-[22rem]"><div className="truncate text-fg" title={p.title ?? ''}>{p.title ?? '(no title)'}</div><div className="truncate text-fg-subtle" title={p.url}>{p.url}</div></td>
                      <td className="p-2 text-right"><ScoreBadge score={p.score} /></td><td className="p-2 text-right tabular-nums">{p.issues}</td><td className="p-2 text-right tabular-nums">{n(p.words)}</td><td className="p-2 text-right tabular-nums">{p.status || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.pages.length > 25 && <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-accent-text underline">{showAll ? 'Show fewer' : `Show all ${r.pages.length} pages`}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const KIND_INFO: Record<SeoOpportunity['kind'], { title: string; blurb: string }> = {
  striking: { title: 'Almost on page one', blurb: 'Searches where you rank around positions 8 to 20. A small push can bring real clicks.' },
  low_ctr: { title: 'Ranking well but not clicked', blurb: 'You rank on page one, but fewer people click than usual. Better titles and descriptions help.' },
  no_clicks: { title: 'Seen but never clicked', blurb: 'Many views and zero clicks. The page may not match what people want.' },
  cannibal: { title: 'Pages competing with each other', blurb: 'More than one of your pages shows for the same search, which splits your strength.' },
};

function Opportunities() {
  const [days, setDays] = useState<28 | 90>(28);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof apiClient.seoOpportunities>> | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { setData(await apiClient.seoOpportunities(days)); } catch (err) { setError(errMessage(err)); setData(null); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-fg space-y-1 block">Look at the last
          <select className={`${field} block`} value={days} onChange={(e) => setDays(Number(e.target.value) as 28 | 90)}><option value={28}>28 days</option><option value={90}>90 days</option></select>
        </label>
        <button type="button" disabled={busy} onClick={() => void run()} className={primary}><Search className="w-4 h-4" /> {busy ? 'Reading Search Console…' : 'Find opportunities'}</button>
      </div>
      <p className="text-xs text-fg-muted">Uses your Search Console data to point at the pages and searches most worth improving. “Possible extra clicks” is a rough planning estimate, not a promise.</p>
      {error && <ErrorState title="SEO opportunities" message={error} onRetry={() => void run()} />}
      {data && (['striking', 'low_ctr', 'no_clicks', 'cannibal'] as const).map((k) => {
        const list = data.opportunities[k];
        return (
          <section key={k} className="space-y-2">
            <div><h3 className="text-sm font-semibold text-fg">{KIND_INFO[k].title} <span className="text-xs font-normal text-fg-muted">({list.length})</span></h3><p className="text-xs text-fg-muted">{KIND_INFO[k].blurb}</p></div>
            {list.length === 0 ? <p className="text-xs text-fg-muted">Nothing found here for this period.</p> : (
              <div className="space-y-2">
                {list.map((o, i) => (
                  <details key={`${o.query}-${o.page}-${i}`} className="rounded-xl border border-line bg-surface p-3">
                    <summary className="cursor-pointer flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-fg">{o.query}</span>
                      <span className="text-xs text-fg-muted">{n(o.impressions)} views · {n(o.clicks)} clicks · position {o.position.toFixed(1)} · <span className="text-success font-medium">+{n(o.potentialClicks)} possible clicks</span></span>
                    </summary>
                    <div className="mt-2 space-y-1 text-xs">
                      <p className="text-fg-muted break-all">{o.pages && o.pages.length > 1 ? o.pages.join('  ·  ') : o.page}</p>
                      <p className="text-fg-muted">{o.why}</p>
                      <p className="text-fg"><span className="font-medium">What to do: </span>{o.action}</p>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {data?.truncated && <p className="text-xs text-fg-muted">Only your top 1,000 query and page pairs were read, so smaller opportunities may be missing.</p>}
    </div>
  );
}

const INTENT: Record<SeoKeywordIdea['intent'], string> = { informational: 'Learning', commercial: 'Comparing', transactional: 'Ready to buy', navigational: 'Other' };
function Keywords() {
  const [seed, setSeed] = useState('');
  const [lang, setLang] = useState('en');
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ seed: string; ideas: SeoKeywordIdea[]; note: string } | null>(null);
  const [intent, setIntent] = useState<'all' | SeoKeywordIdea['intent']>('all');
  const [copied, setCopied] = useState(false);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setData(null);
    try { setData(await apiClient.seoKeywords(seed.trim(), lang, deep)); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  const shown = useMemo(() => (data?.ideas ?? []).filter((i) => intent === 'all' || i.intent === intent), [data, intent]);
  const copy = async () => { try { await navigator.clipboard.writeText(shown.map((i) => i.keyword).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void run(e)} className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-fg space-y-1 block flex-1 min-w-[220px]">Topic or keyword
          <input className={`${field} block w-full`} placeholder="for example: leather wallet" value={seed} maxLength={80} onChange={(e) => setSeed(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-fg space-y-1 block">Language
          <select className={`${field} block`} value={lang} onChange={(e) => setLang(e.target.value)}>
            {[['en', 'English'], ['bn', 'Bangla'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || seed.trim().length < 2} className={primary}><Search className="w-4 h-4" /> {busy ? 'Searching…' : 'Get ideas'}</button>
        <label className="flex items-center gap-2 text-xs text-fg w-full"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Dig deeper (A to Z, takes longer)</label>
      </form>
      <p className="text-xs text-fg-muted">Ideas come from what people type into Google. They show what people ask, not how often: search volumes are not included. Ideas you already get views for in Search Console are marked.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <div aria-busy="true" className="h-20 rounded-xl bg-fill-2 animate-pulse" />}
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-muted">{data.ideas.length} ideas</span>
            {(['all', 'informational', 'commercial', 'transactional', 'navigational'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={intent === k} onClick={() => setIntent(k)} className={`text-xs rounded-full border px-3 py-1 ${intent === k ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted hover:text-fg'}`}>{k === 'all' ? 'All' : INTENT[k]}</button>
            ))}
            <button type="button" onClick={() => void copy()} className="ml-auto inline-flex items-center gap-1 text-xs rounded-lg border border-line px-2.5 py-1.5 text-fg hover:bg-fill-2"><Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy list'}</button>
          </div>
          {shown.length === 0 ? <p className="text-sm text-fg-muted">No ideas found. Try a broader word.</p> : (
            <div className="overflow-auto rounded-xl border border-line bg-surface">
              <table className="min-w-full text-xs">
                <thead className="text-fg-muted"><tr><th className="p-2 text-left font-medium">Keyword</th><th className="p-2 text-left font-medium">What people want</th><th className="p-2 text-right font-medium">Your views (90 days)</th><th className="p-2 text-right font-medium">Your position</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {shown.map((i) => (
                    <tr key={i.keyword}>
                      <td className="p-2 text-fg">{i.keyword}</td><td className="p-2 text-fg-muted">{INTENT[i.intent]}</td>
                      <td className="p-2 text-right tabular-nums">{i.ranking ? n(i.ranking.impressions) : '—'}</td><td className="p-2 text-right tabular-nums">{i.ranking ? i.ranking.position.toFixed(1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: 'page', label: 'Page checker' },
  { key: 'site', label: 'Site audit' },
  { key: 'opps', label: 'Search opportunities' },
  { key: 'keywords', label: 'Keyword ideas' },
] as const;

export const SeoPage: React.FC = () => {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('page');
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">SEO tools</h1>
        <p className="text-xs sm:text-sm text-fg-muted">Check a page, audit your whole site, find what to improve in Google, and get keyword ideas.</p>
      </div>
      <div role="tablist" aria-label="SEO tools" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t.key ? 'border-accent text-accent-text font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'page' && <PageChecker />}
        {tab === 'site' && <SiteAudit />}
        {tab === 'opps' && <Opportunities />}
        {tab === 'keywords' && <Keywords />}
      </div>
    </div>
  );
};
