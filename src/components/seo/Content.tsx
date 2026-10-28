import { Copy } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { apiClient, type AiWriteRequest, type ContentBriefInfo, type TopicMapInfo } from '../../api/client';
import { scoreWriting } from '../../utils/contentScore';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const LANGS = [['en', 'English'], ['bn', 'Bangla'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic']] as const;
const n = (v: number) => v.toLocaleString();

async function copy(text: string) { try { await navigator.clipboard.writeText(text); } catch { /* ignore */ } }

export function TopicResearch({ useInBrief }: { useInBrief: (keyword: string) => void }) {
  const [topic, setTopic] = useState('');
  const [lang, setLang] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<TopicMapInfo | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setMap(null);
    try { setMap((await apiClient.seoTopicResearch(topic.trim(), lang)).map); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void run(e)} className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-fg space-y-1 block flex-1 min-w-[220px]">Subject you want to write about<input className={`${field} block w-full`} placeholder="for example: leather wallet care" maxLength={80} value={topic} onChange={(e) => setTopic(e.target.value)} /></label>
        <label className="text-xs font-medium text-fg space-y-1 block">Language<select className={`${field} block`} value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button type="submit" disabled={busy || topic.trim().length < 2} className={primary}>{busy ? 'Mapping…' : 'Map this topic'}</button>
      </form>
      <p className="text-xs text-fg-muted">Built from what people type into Google, grouped by shared words. No AI is used and nothing here costs an AI question.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <div aria-busy="true" className="h-20 rounded-xl bg-fill-2 animate-pulse" />}
      {map && (
        <div className="space-y-3">
          <section className="space-y-2"><h3 className="text-sm font-semibold text-fg">Sub-topics to cover</h3>
            {map.subtopics.length === 0 ? <p className="text-xs text-fg-muted">Not enough ideas to group. Try a broader subject.</p> : map.subtopics.map((c) => (
              <div key={c.name} className="rounded-xl border border-line bg-surface p-3"><p className="text-sm font-semibold text-fg capitalize">{c.name} <span className="text-xs font-normal text-fg-muted">({c.keywords.length})</span></p><p className="text-xs text-fg-muted pt-1">{c.keywords.join(', ')}</p></div>
            ))}</section>
          {map.questions.length > 0 && <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Questions people ask</h3><ul className="text-sm text-fg-muted list-disc pl-5">{map.questions.map((q) => <li key={q}>{q}</li>)}</ul></section>}
          <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Headline ideas</h3><ul className="text-sm text-fg-muted list-disc pl-5">{map.headlines.map((h) => <li key={h}>{h}</li>)}</ul></section>
          <button type="button" className={secondary} onClick={() => useInBrief(map.topic)}>Build a content brief for “{map.topic}”</button>
        </div>
      )}
    </div>
  );
}

export function ContentBrief({ initialKeyword, sendToWriter }: { initialKeyword: string; sendToWriter: (b: ContentBriefInfo) => void }) {
  const [keyword, setKeyword] = useState(initialKeyword);
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<Awaited<ReturnType<typeof apiClient.seoContentBrief>> | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setR(null);
    try { setR(await apiClient.seoContentBrief(keyword.trim(), urls.split(/[\n,\s]+/).filter(Boolean).slice(0, 5))); } catch (err) { setError(errMessage(err)); }
    setBusy(false);
  };
  const b = r?.brief;
  const asText = b ? [`Content brief: ${b.keyword}`, `Aim for about ${b.length.recommended} words (pages that rank: ${b.length.min} to ${b.length.max}).`, '', 'Outline:', ...b.outline.map((o) => `## ${o.text}`), '', 'Questions to answer:', ...b.questions.map((q) => `- ${q}`), '', `Related words: ${b.terms.map((t) => t.term).join(', ')}`].join('\n') : '';
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void run(e)} className="space-y-2">
        <label className="text-xs font-medium text-fg space-y-1 block">Keyword you want to rank for<input className={`${field} block w-full`} placeholder="for example: leather wallet care" maxLength={100} value={keyword} onChange={(e) => setKeyword(e.target.value)} /></label>
        <label className="text-xs font-medium text-fg space-y-1 block">Pages that already rank for it (up to 5, one per line). Leave empty to let us find them when that is set up.<textarea className={`${field} block w-full min-h-[80px]`} value={urls} onChange={(e) => setUrls(e.target.value)} /></label>
        <button type="submit" disabled={busy || keyword.trim().length < 2} className={primary}>{busy ? 'Reading the pages…' : 'Build brief'}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <div aria-busy="true" className="h-20 rounded-xl bg-fill-2 animate-pulse" />}
      {b && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[['Aim for (words)', n(b.length.recommended)], ['Pages read', String(b.pages.length)], ['Shortest', n(b.length.min)], ['Longest', n(b.length.max)]].map(([k, v]) => <div key={k} className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">{k}</p><p className="text-2xl font-bold text-fg">{v}</p></div>)}
          </div>
          {r!.searched && <p className="text-xs text-fg-muted">We found these pages through Google: {b.pages.map((p) => p.url).join(', ')}</p>}
          {r!.failed.length > 0 && <p className="text-xs text-warning">Could not read: {r!.failed.join(', ')}</p>}
          <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Suggested outline</h3><p className="text-xs text-fg-muted">Headings that appear on the ranking pages. The number is how many of them use it.</p>
            <ol className="text-sm text-fg list-decimal pl-5 space-y-0.5">{b.outline.map((o) => <li key={o.text}>{o.text} <span className="text-xs text-fg-subtle">({o.pages})</span></li>)}</ol></section>
          {b.questions.length > 0 && <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Questions to answer</h3><ul className="text-sm text-fg-muted list-disc pl-5">{b.questions.map((q) => <li key={q}>{q}</li>)}</ul></section>}
          {b.terms.length > 0 && <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Words and phrases to work in</h3><p className="text-sm text-fg-muted">{b.terms.map((t) => `${t.term} (${t.pages})`).join(', ')}</p></section>}
          <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Pages we read</h3><ul className="text-xs text-fg-muted space-y-0.5">{b.pages.map((p) => <li key={p.url} className="break-all">{p.title ?? p.url} · {n(p.words)} words</li>)}</ul></section>
          <div className="flex flex-wrap gap-2"><button type="button" className={primary} onClick={() => sendToWriter(b)}>Write it in the writing assistant</button><button type="button" className={secondary} onClick={() => void copy(asText)}><Copy className="w-4 h-4" /> Copy brief</button></div>
          <p className="text-[11px] text-fg-subtle">{r!.note}</p>
        </div>
      )}
    </div>
  );
}

const MODES = [['draft', 'Write a draft'], ['outline', 'Write an outline'], ['rewrite', 'Improve my text'], ['repurpose', 'Turn into a post or email'], ['meta', 'Page title and description']] as const;
const TARGETS = [['linkedin', 'LinkedIn post'], ['x', 'Post for X'], ['facebook', 'Facebook post'], ['instagram', 'Instagram caption'], ['email', 'Email'], ['summary', 'Short summary']] as const;

export function WritingAssistant({ brief }: { brief: ContentBriefInfo | null }) {
  const [text, setText] = useState('');
  const [keyword, setKeyword] = useState(brief?.keyword ?? '');
  const [mode, setMode] = useState<AiWriteRequest['mode']>('draft');
  const [tone, setTone] = useState('friendly');
  const [language, setLanguage] = useState('en');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [target, setTarget] = useState('linkedin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number | null } | null>(null);
  const terms = useMemo(() => brief?.terms.map((t) => t.term) ?? [], [brief]);
  const s = useMemo(() => scoreWriting(text, { keyword, targetWords: brief?.length.recommended, terms }), [text, keyword, brief, terms]);
  const ask = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await apiClient.seoAiWrite({ mode, keyword: keyword.trim() || undefined, topic: mode === 'draft' || mode === 'outline' ? (keyword.trim() || undefined) : undefined, text: text.trim() || undefined, tone, language, length, ...(mode === 'repurpose' ? { target } : {}), ...(brief ? { brief: { outline: brief.outline.map((o) => o.text), terms: terms.slice(0, 20), questions: brief.questions.slice(0, 8) } } : {}) });
      setResult(r.text); setQuota(r.quota);
    } catch (e) { setError(errMessage(e)); }
    setBusy(false);
  };
  const tone_ = [['friendly', 'Friendly'], ['professional', 'Professional'], ['simple', 'Simple'], ['persuasive', 'Persuasive'], ['playful', 'Playful']] as const;
  const color = s.score >= 80 ? 'text-success' : s.score >= 50 ? 'text-warning' : 'text-danger';
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs font-medium text-fg space-y-1 block flex-1 min-w-[200px]">Keyword or topic<input className={`${field} block w-full`} maxLength={100} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="what this piece is about" /></label>
          {brief && <span className="text-xs text-fg-muted pb-2">Using your brief: about {n(brief.length.recommended)} words.</span>}
        </div>
        <textarea aria-label="Your text" className={`${field} w-full min-h-[320px] font-sans`} placeholder={'Write or paste your text here. Start a line with "## " for a heading.'} value={text} onChange={(e) => setText(e.target.value.slice(0, 20000))} />
        <section className="rounded-xl border border-line bg-surface p-3 space-y-2">
          <h3 className="text-sm font-semibold text-fg">AI helper</h3>
          <div className="flex flex-wrap gap-2">
            <select aria-label="What to do" className={field} value={mode} onChange={(e) => setMode(e.target.value as AiWriteRequest['mode'])}>{MODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {mode === 'repurpose' && <select aria-label="Turn it into" className={field} value={target} onChange={(e) => setTarget(e.target.value)}>{TARGETS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
            <select aria-label="Tone" className={field} value={tone} onChange={(e) => setTone(e.target.value)}>{tone_.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select aria-label="Language" className={field} value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {mode === 'draft' && <select aria-label="Length" className={field} value={length} onChange={(e) => setLength(e.target.value as 'short' | 'medium' | 'long')}><option value="short">Short (about 400 words)</option><option value="medium">Medium (about 900)</option><option value="long">Long (about 1,500)</option></select>}
            <button type="button" className={primary} disabled={busy} onClick={() => void ask()}>{busy ? 'Writing…' : 'Ask the AI'}</button>
          </div>
          <p className="text-xs text-fg-muted">Each request uses one of your workspace's monthly AI questions{quota ? ` (${quota.used}${quota.limit ? ` of ${quota.limit}` : ''} used)` : ''}. Drafts need your facts and your voice: check every claim before publishing.</p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {result && (
            <div className="space-y-2"><pre className="text-sm text-fg whitespace-pre-wrap font-sans rounded-lg bg-fill-2 p-3 max-h-96 overflow-auto">{result}</pre>
              <div className="flex gap-2"><button type="button" className={secondary} onClick={() => setText(result)}>Use in the editor</button><button type="button" className={secondary} onClick={() => setText((t) => (t ? `${t}\n\n${result}` : result))}>Add to the end</button><button type="button" className={secondary} onClick={() => void copy(result)}><Copy className="w-4 h-4" /> Copy</button></div></div>
          )}
        </section>
      </div>
      <aside aria-label="Live score" className="space-y-3 lg:sticky lg:top-4 self-start">
        <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">Writing score</p><p className={`text-3xl font-bold ${color}`}>{s.score}</p><p className="text-[11px] text-fg-subtle">{n(s.words)} words{keyword ? `, keyword ${s.occurrences}×` : ''}</p></div>
        <ul className="space-y-1.5">{s.checks.map((c) => <li key={c.id} className="rounded-lg border border-line bg-surface p-2 text-xs"><span className={c.status === 'good' ? 'text-success font-medium' : c.status === 'warn' ? 'text-warning font-medium' : 'text-danger font-medium'}>{c.status === 'good' ? 'Good' : c.status === 'warn' ? 'Improve' : 'Fix'}</span> <span className="text-fg">{c.title}</span>{c.fix && c.status !== 'good' && <span className="block text-fg-muted pt-0.5">{c.fix}</span>}</li>)}</ul>
        {terms.length > 0 && <div className="rounded-xl border border-line bg-surface p-3 space-y-1"><p className="text-xs font-semibold text-fg">Related words</p><p className="text-xs flex flex-wrap gap-x-2 gap-y-1">{terms.map((t) => { const used = scoreWriting(text, { keyword: t }).occurrences > 0; return <span key={t} className={used ? 'text-success' : 'text-fg-muted'}>{used ? '✓ ' : ''}{t}</span>; })}</p></div>}
      </aside>
    </div>
  );
}
