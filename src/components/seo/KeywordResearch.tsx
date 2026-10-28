import { Download, Search, X } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { apiClient, type SeoKeywordIdea, type SeoKeywordOverview, type SeoTopicGap } from '../../api/client';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const n = (v: number) => v.toLocaleString();
const INTENT: Record<SeoKeywordIdea['intent'], string> = { informational: 'Learning', commercial: 'Comparing', transactional: 'Ready to buy', navigational: 'Other' };
const GROUP: Record<SeoKeywordIdea['group'], string> = { seed: 'Seed', questions: 'Questions', modifiers: 'With a word added', prepositions: 'Prepositions', comparisons: 'Comparisons', alphabet: 'A to Z' };
const MATCH = [['all', 'All ideas'], ['questions', 'Questions'], ['long', '4+ words'], ['mine', 'You already show for'], ['new', 'New for you']] as const;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
const csvCell = (v: string | number | null) => { const s = v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function Overview({ keyword, lang, onClose }: { keyword: string; lang: string; onClose: () => void }) {
  const [d, setD] = useState<SeoKeywordOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  React.useEffect(() => { let live = true; apiClient.seoKeywordOverview(keyword, lang).then((r) => { if (live) setD(r); }, (e) => { if (live) setError(errMessage(e)); }); return () => { live = false; }; }, [keyword, lang]);
  return (
    <div role="dialog" aria-label={`Details for ${keyword}`} className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-2"><div><p className="text-xs text-fg-muted">Keyword overview</p><h3 className="text-lg font-semibold text-fg">{keyword}</h3></div><button type="button" aria-label="Close" onClick={onClose} className={secondary}><X className="w-4 h-4" /></button></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!d && !error && <div aria-busy="true" className="h-20 rounded-xl bg-fill-2 animate-pulse" />}
      {d && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-line p-2"><p className="text-xs text-fg-muted">People want</p><p className="text-sm font-semibold text-fg">{INTENT[d.intent]}</p></div>
            <div className="rounded-lg border border-line p-2"><p className="text-xs text-fg-muted">Monthly searches</p><p className="text-sm font-semibold text-fg">{d.metrics?.volume != null ? n(d.metrics.volume) : <span className="text-fg-subtle font-normal">needs data source</span>}</p></div>
            <div className="rounded-lg border border-line p-2"><p className="text-xs text-fg-muted">Difficulty</p><p className="text-sm font-semibold text-fg">{d.metrics?.difficulty != null ? `${d.metrics.difficulty}%` : <span className="text-fg-subtle font-normal">needs data source</span>}</p></div>
            <div className="rounded-lg border border-line p-2"><p className="text-xs text-fg-muted">Cost per click</p><p className="text-sm font-semibold text-fg">{d.metrics?.cpc != null ? d.metrics.cpc.toFixed(2) : <span className="text-fg-subtle font-normal">needs data source</span>}</p></div>
          </div>
          {d.note && <p className="text-xs text-fg-muted">{d.note}</p>}
          <section className="space-y-1"><h4 className="text-sm font-semibold text-fg">How you do for it (last 90 days, Search Console)</h4>
            {!d.own ? <p className="text-xs text-fg-muted">No views for this exact phrase yet, or Search Console is not connected.</p> : (
              <>
                <p className="text-sm text-fg">Average position <b>{d.own.position}</b>, {n(d.own.impressions)} views, {n(d.own.clicks)} clicks ({(d.own.ctr * 100).toFixed(1)}%).</p>
                <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-xs"><thead className="bg-fill-2 text-fg-muted"><tr><th className="text-left p-2">Page that shows</th><th className="text-right p-2">Position</th><th className="text-right p-2">Views</th><th className="text-right p-2">Clicks</th></tr></thead><tbody>{d.own.pages.map((p) => <tr key={p.page} className="border-t border-line"><td className="p-2 break-all text-fg">{p.page}</td><td className="p-2 text-right tabular-nums">{p.position}</td><td className="p-2 text-right tabular-nums">{n(p.impressions)}</td><td className="p-2 text-right tabular-nums">{n(p.clicks)}</td></tr>)}</tbody></table></div>
              </>
            )}
          </section>
          {d.questions.length > 0 && <section><h4 className="text-sm font-semibold text-fg">Questions people ask</h4><ul className="text-sm text-fg-muted list-disc pl-5">{d.questions.map((q) => <li key={q}>{q}</li>)}</ul></section>}
          {d.related.length > 0 && <section><h4 className="text-sm font-semibold text-fg">Related searches</h4><p className="text-sm text-fg-muted">{d.related.join(', ')}</p></section>}
        </div>
      )}
    </div>
  );
}

function SaveToList({ keywords, onDone }: { keywords: string[]; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<Awaited<ReturnType<typeof apiClient.rankLists>> | null>(null);
  const [target, setTarget] = useState('new');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = async () => { setOpen(true); setError(null); try { const l = await apiClient.rankLists(); setLists(l); setTarget(l.lists[0]?.id ?? 'new'); } catch (e) { setError(errMessage(e)); } };
  const save = async () => {
    if (!lists) return;
    setBusy(true); setError(null);
    try {
      const existing = lists.lists.find((l) => l.id === target);
      if (existing) await apiClient.rankSaveList({ id: existing.id, name: existing.name, text: [...existing.keywords, ...keywords].join('\n'), tracked: existing.tracked });
      else await apiClient.rankSaveList({ name: name.trim() || 'Keyword ideas', text: keywords.join('\n'), tracked: false });
      setOpen(false); onDone(`Saved ${keywords.length} keywords. Find them under Keyword lists.`);
    } catch (e) { setError(errMessage(e)); }
    setBusy(false);
  };
  if (!lists?.canEdit && lists) return null;
  return (
    <span className="inline-block">
      {!open ? <button type="button" className={secondary} disabled={keywords.length === 0} onClick={() => void show()}>Save to a list</button> : (
        <span className="flex flex-wrap items-center gap-2">
          <select aria-label="Which list" className={field} value={target} onChange={(e) => setTarget(e.target.value)}>{lists?.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}<option value="new">New list…</option></select>
          {target === 'new' && <input aria-label="New list name" className={field} placeholder="List name" value={name} onChange={(e) => setName(e.target.value)} />}
          <button type="button" className={primary} disabled={busy || !lists} onClick={() => void save()}>{busy ? 'Saving…' : `Save ${keywords.length}`}</button>
          <button type="button" className={secondary} onClick={() => setOpen(false)}>Cancel</button>
          {error && <span role="alert" className="text-xs text-danger">{error}</span>}
        </span>
      )}
    </span>
  );
}

export function KeywordResearch() {
  const [seed, setSeed] = useState('');
  const [lang, setLang] = useState('en');
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof apiClient.seoKeywords>> | null>(null);
  const [intent, setIntent] = useState<'all' | SeoKeywordIdea['intent']>('all');
  const [match, setMatch] = useState<(typeof MATCH)[number][0]>('all');
  const [view, setView] = useState<'list' | 'groups'>('list');
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setData(null); setOpen(null); setSaved(null);
    try { setData(await apiClient.seoKeywords(seed.trim(), lang, deep)); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  const shown = useMemo(() => (data?.ideas ?? []).filter((i) => (intent === 'all' || i.intent === intent) && (match === 'all' || (match === 'questions' && i.group === 'questions') || (match === 'long' && i.words >= 4) || (match === 'mine' && i.ranking !== null) || (match === 'new' && i.ranking === null))), [data, intent, match]);
  const csv = () => download(`keywords-${seed.trim().replace(/\W+/g, '-').toLowerCase() || 'ideas'}.csv`, ['Keyword,Type,What people want,Words,Your views (90 days),Your position,Monthly searches,Difficulty,Cost per click', ...shown.map((i) => [i.keyword, GROUP[i.group], INTENT[i.intent], i.words, i.ranking?.impressions ?? null, i.ranking ? i.ranking.position.toFixed(1) : null, i.metrics?.volume ?? null, i.metrics?.difficulty ?? null, i.metrics?.cpc ?? null].map(csvCell).join(','))].join('\n'));
  const chip = (active: boolean) => `text-xs rounded-full border px-3 py-1 ${active ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted hover:text-fg'}`;
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
        <button type="submit" disabled={busy || seed.trim().length < 2} className={primary}><Search className="w-4 h-4" /> {busy ? 'Searching…' : 'Find keywords'}</button>
        <label className="flex items-center gap-2 text-xs text-fg w-full"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Dig deeper (A to Z, takes longer)</label>
      </form>
      <p className="text-xs text-fg-muted">{data?.note ?? 'Ideas come from what people type into Google: questions, comparisons, and words added before or after your topic. Ideas you already get views for in Search Console are marked. Click a keyword for details.'}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <div aria-busy="true" className="h-20 rounded-xl bg-fill-2 animate-pulse" />}
      {open && <Overview keyword={open} lang={lang} onClose={() => setOpen(null)} />}
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-muted">{shown.length} of {data.ideas.length} ideas</span>
            {(['all', 'informational', 'commercial', 'transactional', 'navigational'] as const).map((k) => <button key={k} type="button" aria-pressed={intent === k} onClick={() => setIntent(k)} className={chip(intent === k)}>{k === 'all' ? 'Any intent' : INTENT[k]}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {MATCH.map(([k, label]) => <button key={k} type="button" aria-pressed={match === k} onClick={() => setMatch(k)} className={chip(match === k)}>{label}</button>)}
            <span className="flex-1" />
            <button type="button" aria-pressed={view === 'groups'} onClick={() => setView(view === 'list' ? 'groups' : 'list')} className={secondary}>{view === 'list' ? 'Group by topic' : 'Show as list'}</button>
            <button type="button" onClick={csv} disabled={shown.length === 0} className={secondary}><Download className="w-4 h-4" /> CSV</button>
            <SaveToList keywords={shown.map((i) => i.keyword)} onDone={setSaved} />
          </div>
          {saved && <p role="status" className="text-xs text-success">{saved}</p>}
          {shown.length === 0 ? <p className="text-sm text-fg-muted">No ideas match. Try another filter or a broader word.</p> : view === 'groups' ? (
            <div className="space-y-2">{data.clusters.map((c) => {
              const members = c.keywords.filter((k) => shown.some((i) => i.keyword === k));
              if (members.length === 0) return null;
              return <div key={c.name} className="rounded-xl border border-line bg-surface p-3"><p className="text-sm font-semibold text-fg">{c.name} <span className="text-xs text-fg-muted font-normal">({members.length})</span></p><p className="text-xs flex flex-wrap gap-x-3 gap-y-1 pt-1">{members.map((k) => <button key={k} type="button" onClick={() => setOpen(k)} className="text-fg-muted hover:text-accent-text underline-offset-2 hover:underline">{k}</button>)}</p></div>;
            })}</div>
          ) : (
            <div className="overflow-auto rounded-xl border border-line bg-surface">
              <table className="min-w-full text-xs">
                <thead className="text-fg-muted"><tr><th className="p-2 text-left font-medium">Keyword</th><th className="p-2 text-left font-medium">Type</th><th className="p-2 text-left font-medium">What people want</th>{data.providerConnected && <><th className="p-2 text-right font-medium">Searches</th><th className="p-2 text-right font-medium">Difficulty</th></>}<th className="p-2 text-right font-medium">Your views (90 days)</th><th className="p-2 text-right font-medium">Your position</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {shown.map((i) => (
                    <tr key={i.keyword}>
                      <td className="p-2"><button type="button" onClick={() => setOpen(i.keyword)} className="text-fg text-left hover:text-accent-text hover:underline underline-offset-2">{i.keyword}</button></td><td className="p-2 text-fg-muted">{GROUP[i.group]}</td><td className="p-2 text-fg-muted">{INTENT[i.intent]}</td>
                      {data.providerConnected && <><td className="p-2 text-right tabular-nums">{i.metrics?.volume != null ? n(i.metrics.volume) : '—'}</td><td className="p-2 text-right tabular-nums">{i.metrics?.difficulty != null ? `${i.metrics.difficulty}%` : '—'}</td></>}
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

export function TopicGap() {
  const [mine, setMine] = useState('');
  const [rivals, setRivals] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<SeoTopicGap | null>(null);
  const urls = rivals.split(/[\n,\s]+/).map((x) => x.trim()).filter(Boolean);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setR(null);
    try { setR(await apiClient.seoTopicGap(mine.trim(), urls.slice(0, 5))); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  const Terms = ({ title, hint, rows }: { title: string; hint: string; rows: SeoTopicGap['gap']['missing'] }) => (
    <section className="rounded-xl border border-line bg-surface p-3 space-y-2"><div><h3 className="text-sm font-semibold text-fg">{title}</h3><p className="text-xs text-fg-muted">{hint}</p></div>
      {rows.length === 0 ? <p className="text-xs text-fg-muted">Nothing here.</p> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-fg-muted"><tr><th className="text-left p-1.5 font-medium">Word or phrase</th><th className="text-right p-1.5 font-medium">Rival pages using it</th><th className="text-right p-1.5 font-medium">Rivals avg uses</th><th className="text-right p-1.5 font-medium">Your uses</th></tr></thead><tbody className="divide-y divide-line">{rows.map((t) => <tr key={t.term}><td className="p-1.5 text-fg">{t.term}</td><td className="p-1.5 text-right tabular-nums">{t.competitors}</td><td className="p-1.5 text-right tabular-nums">{t.avgCount}</td><td className="p-1.5 text-right tabular-nums">{t.yourCount}</td></tr>)}</tbody></table></div>}
    </section>
  );
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void run(e)} className="space-y-2">
        <label className="text-xs font-medium text-fg space-y-1 block">Your page
          <input className={`${field} block w-full`} placeholder="yoursite.com/page" value={mine} onChange={(e) => setMine(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-fg space-y-1 block">Competitor pages that rank for the same topic (up to 5, one per line)
          <textarea className={`${field} block w-full min-h-[96px]`} placeholder={'rival.com/their-page\nother.com/guide'} value={rivals} onChange={(e) => setRivals(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || mine.trim().length < 3 || urls.length === 0} className={primary}>{busy ? 'Reading the pages…' : 'Compare pages'}</button>
        {urls.length > 5 && <span className="text-xs text-warning ml-2">Only the first 5 are used.</span>}
      </form>
      <p className="text-xs text-fg-muted">We read the public text of each page and show which words and phrases your competitors use that you do not. Use it as a checklist for what to cover, not as a promise of rankings.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <div aria-busy="true" className="h-20 rounded-xl bg-fill-2 animate-pulse" />}
      {r && (
        <div className="space-y-3">
          <ul className="text-xs text-fg-muted space-y-0.5"><li>Your page: {n(r.you.words)} words</li>{r.competitors.map((c) => <li key={c.url}>{'error' in c ? <span className="text-danger">{c.url}: {c.error}</span> : <>{c.url}: {n(c.words)} words</>}</li>)}</ul>
          <Terms title="Competitors cover this, you do not" hint="Used by at least two competitor pages (or the one you gave) and missing from your page." rows={r.gap.missing} />
          <Terms title="You mention it, but far less" hint="Competitors use these at least three times more than you." rows={r.gap.underused} />
          <Terms title="You already cover these well" hint="Shared with competitors, so keep them." rows={r.gap.sharedStrengths} />
          <p className="text-[11px] text-fg-subtle">{r.note}</p>
        </div>
      )}
    </div>
  );
}
