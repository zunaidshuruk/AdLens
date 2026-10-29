import { Download } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { apiClient, type KeywordMetricInfo } from '../../api/client';
import { buildAdsCsv, groupKeywords, intentOf, notation, parseKeywords, suggestNegatives, type MatchType } from '../../utils/ppcPlanner';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';

export function PpcPlanner() {
  const [text, setText] = useState('');
  const [campaign, setCampaign] = useState('');
  const [matches, setMatches] = useState<Set<MatchType>>(new Set(['phrase', 'exact']));
  const [cpc, setCpc] = useState('');
  const [skipResearch, setSkipResearch] = useState(true);
  const [maxPer, setMaxPer] = useState(20);
  const [negPicked, setNegPicked] = useState<Set<string> | null>(null);
  const [custom, setCustom] = useState('');
  const [negType, setNegType] = useState<'phrase' | 'exact'>('phrase');
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Map<string, KeywordMetricInfo> | null>(null);
  const [metricsBusy, setMetricsBusy] = useState(false);
  const [metricsNote, setMetricsNote] = useState<string | null>(null);
  const [minVolume, setMinVolume] = useState('');

  const parsed = useMemo(() => parseKeywords(text), [text]);
  const minVol = minVolume.trim() === '' ? 0 : Number(minVolume);
  const kept = useMemo(() => parsed.keywords.filter((k) => (!skipResearch || intentOf(k) !== 'research') && !(metrics && Number.isFinite(minVol) && minVol > 0 && (metrics.get(k)?.volume ?? Infinity) < minVol)), [parsed, skipResearch, metrics, minVol]);
  const typicalCpc = useMemo(() => { const v = kept.map((k) => metrics?.get(k)?.cpc).filter((x): x is number => typeof x === 'number' && x > 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)]! : null; }, [kept, metrics]);
  const groups = useMemo(() => groupKeywords(kept, { maxPerGroup: maxPer }), [kept, maxPer]);
  const suggestions = useMemo(() => suggestNegatives(kept), [kept]);
  const picked = negPicked ?? new Set(suggestions.slice(0, 12).map((s) => s.word));
  const customNeg = useMemo(() => parseKeywords(custom).keywords, [custom]);
  const negatives = [...new Set([...suggestions.filter((s) => picked.has(s.word)).map((s) => s.word), ...customNeg])];
  const cpcNum = cpc.trim() === '' ? null : Number(cpc);
  const cpcBad = cpcNum !== null && !(Number.isFinite(cpcNum) && cpcNum > 0);
  const plan = { campaign, groups, matchTypes: [...matches], maxCpc: cpcBad ? null : cpcNum, negatives, negativeType: negType };
  const rows = kept.length * matches.size + negatives.length;

  const fromLists = async () => {
    setError(null);
    try { const { lists } = await apiClient.rankLists(); setText((t) => [t, ...lists.flatMap((l) => l.keywords)].filter(Boolean).join('\n')); } catch (e) { setError(errMessage(e)); }
  };
  const loadMetrics = async () => {
    setMetricsBusy(true); setError(null); setMetricsNote(null);
    try {
      const r = await apiClient.seoKeywordMetrics(parsed.keywords.slice(0, 300), 'us');
      if (!r.connected) { setMetricsNote(r.note ?? 'No data provider is connected. Connect one in Settings.'); return; }
      setMetrics(new Map(r.metrics.map((m) => [m.keyword, m])));
      setMetricsNote(`Numbers from ${r.name ?? 'your data provider'} for the United States${parsed.keywords.length > 300 ? ' (first 300 keywords)' : ''}. Each lookup may cost you credit with the provider; repeats within a day are free.`);
    } catch (e) { setError(errMessage(e)); } finally { setMetricsBusy(false); }
  };
  const download = () => {
    const { csv } = buildAdsCsv(plan);
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${(campaign.trim() || 'campaign').replace(/[^\w-]+/g, '-').slice(0, 40)}-google-ads.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => { const x = new Set(set); if (on) x.add(v); else x.delete(v); return x; };

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Turn a keyword list into a Google Ads campaign plan: ad groups, match types and negative keywords. Download a CSV and import it in Google Ads Editor (Account, Import, Paste or file). This tool does not know search volume or cost per click; add your own maximum bid below, or set bids in Google Ads. Everything is worked out in your browser.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <label className="text-xs font-medium text-fg block">Keywords (one per line or separated by commas)<textarea className={`${field} block w-full min-h-[120px] mt-1`} value={text} onChange={(e) => setText(e.target.value)} placeholder={'leather wallet\nmens leather wallet\nbuy card holder'} /></label>
      <div className="flex flex-wrap gap-2 items-center"><button type="button" className={secondary} onClick={fromLists}>Add my saved keyword lists</button>
        <button type="button" className={secondary} disabled={metricsBusy} onClick={loadMetrics}>{metricsBusy ? 'Looking up…' : 'Add search volume and cost'}</button>
        <span className="text-xs text-fg-muted">{parsed.keywords.length} keyword{parsed.keywords.length === 1 ? '' : 's'}{parsed.dropped.length ? `, ${parsed.dropped.length} skipped (${parsed.dropped[0]!.reason.toLowerCase()})` : ''}</span></div>
      {metricsNote && <p role="status" className="text-xs text-fg-muted">{metricsNote}</p>}
      {parsed.keywords.length > 0 && (
        <>
          <section className="rounded-xl border border-line bg-surface p-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-fg block">Campaign name<input className={`${field} block w-full mt-1`} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Wallets - search" /></label>
            <label className="text-xs font-medium text-fg block">Maximum bid per click (optional)<input className={`${field} block w-full mt-1`} inputMode="decimal" value={cpc} onChange={(e) => setCpc(e.target.value)} placeholder={typicalCpc ? typicalCpc.toFixed(2) : '1.50'} aria-invalid={cpcBad} />{typicalCpc && <span className="block text-fg-muted font-normal">Typical cost per click for these keywords: {typicalCpc.toFixed(2)}</span>}{cpcBad && <span role="alert" className="text-danger font-normal">Enter a number above 0</span>}</label>
            <fieldset className="text-xs text-fg space-y-1"><legend className="font-medium">Match types to create</legend>
              {([['broad', 'Broad (widest, least control)'], ['phrase', 'Phrase ("keyword")'], ['exact', 'Exact ([keyword])']] as [MatchType, string][]).map(([m, l]) => <label key={m} className="flex items-center gap-2"><input type="checkbox" checked={matches.has(m)} onChange={(e) => setMatches((s) => toggle(s, m, e.target.checked))} />{l}</label>)}</fieldset>
            <div className="space-y-2 text-xs text-fg">
              <label className="flex items-center gap-2"><input type="checkbox" checked={skipResearch} onChange={(e) => setSkipResearch(e.target.checked)} />Leave out research phrases (how, what, guide, reviews…)</label>
              {metrics && <label className="block">Drop keywords with fewer searches a month than<input className={`${field} block mt-1 w-28`} inputMode="numeric" value={minVolume} onChange={(e) => setMinVolume(e.target.value)} placeholder="0" /></label>}
              <label className="block">Most keywords in one ad group<select className={`${field} block mt-1`} value={maxPer} onChange={(e) => setMaxPer(Number(e.target.value))}>{[10, 15, 20, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </div>
          </section>
          <section className="space-y-2"><h3 className="text-sm font-semibold text-fg">Ad groups ({groups.length})</h3>
            <div className="grid gap-2 sm:grid-cols-2">{groups.map((g) => (
              <div key={g.name} className="rounded-xl border border-line bg-surface p-3"><p className="text-sm font-medium text-fg">{g.name} <span className="text-xs text-fg-muted font-normal">({g.keywords.length})</span></p>
                <ul className="text-xs text-fg-muted space-y-0.5 mt-1">{g.keywords.slice(0, 8).map((k) => { const m = metrics?.get(k); return <li key={k}>{[...matches].map((x) => notation(k, x)).join('  ')}{m && <span className="text-fg-subtle"> · {m.volume != null ? `${m.volume.toLocaleString()}/mo` : 'no data'}{m.cpc != null ? ` · ${m.cpc.toFixed(2)}` : ''}</span>}</li>; })}{g.keywords.length > 8 && <li>and {g.keywords.length - 8} more</li>}</ul></div>))}</div>
            {groups.length === 0 && <p className="text-xs text-fg-muted">Every keyword was left out. Untick "Leave out research phrases" to include them.</p>}
          </section>
          <section className="rounded-xl border border-line bg-surface p-3 space-y-2"><h3 className="text-sm font-semibold text-fg">Negative keywords</h3>
            <p className="text-xs text-fg-muted">Words that tend to bring clicks that do not buy. We skip any word you bid on yourself. Untick any that fit your business.</p>
            <ul className="grid gap-1 sm:grid-cols-2">{suggestions.map((s) => <li key={s.word} className="text-xs"><label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={picked.has(s.word)} onChange={(e) => setNegPicked(toggle(picked, s.word, e.target.checked))} /><span><span className="text-fg font-medium">{s.word}</span> <span className="text-fg-muted">{s.reason}</span></span></label></li>)}</ul>
            <label className="text-xs font-medium text-fg block">Your own negative words<input className={`${field} block w-full mt-1`} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="cheap, second hand" /></label>
            <label className="text-xs text-fg block">Negative match type <select className={field} value={negType} onChange={(e) => setNegType(e.target.value as 'phrase' | 'exact')}><option value="phrase">Phrase (blocks any search containing the words)</option><option value="exact">Exact (blocks that search only)</option></select></label>
          </section>
          <div className="flex flex-wrap items-center gap-3"><button type="button" className={primary} disabled={rows === 0 || matches.size === 0 || cpcBad} onClick={download}><Download className="h-4 w-4" aria-hidden /> Download Google Ads CSV</button>
            <span className="text-xs text-fg-muted">{rows.toLocaleString()} rows. Review it in Google Ads Editor before you post; you still write the ads and set budgets there.</span></div>
        </>
      )}
    </div>
  );
}
