import { CheckCircle2, ChevronDown, Circle, ExternalLink, Search, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Shot } from '../components/help/HelpShots';
import { CHECKLIST, FAQS, GLOSSARY, GOALS, GROUPS, GUIDES, type Guide, type GroupId } from '../content/helpGuide';

const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm min-h-[36px] ${on ? 'border-accent bg-accent-soft text-fg font-medium' : 'border-line bg-surface text-fg-muted hover:bg-fill-2'}`;
const STORE_KEY = 'adlens.help.done';

function loadDone(): Set<string> { try { const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as unknown; return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []); } catch { return new Set(); } }
function saveDone(s: Set<string>): void { try { localStorage.setItem(STORE_KEY, JSON.stringify([...s])); } catch { /* storage may be blocked; the checklist still works for this visit */ } }

/** Every typed word must start a word in the text ("map" finds "Map rank tracker" but not "sitemap"). */
const matches = (text: string, q: string): boolean => q.split(/\s+/).filter(Boolean).every((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text));
const guideText = (g: Guide) => [g.title, g.summary, ...g.steps.map((s) => s.text), ...(g.tips ?? []), ...(g.limits ?? [])].join(' ').toLowerCase();

function GuideCard({ g, open, onToggle }: { g: Guide; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => { if (open && window.location.hash === `#${g.id}`) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [open, g.id]);
  return (
    <section ref={ref} id={g.id} className="rounded-xl border border-line bg-surface scroll-mt-20">
      <h3>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${g.id}-body`} className="w-full flex items-start justify-between gap-3 text-left px-4 py-3 min-h-[48px]">
          <span><span className="block text-sm font-semibold text-fg">{g.title}</span><span className="block text-xs text-fg-muted mt-0.5">{g.summary}</span></span>
          <ChevronDown className={`w-4 h-4 mt-1 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </h3>
      {open && (
        <div id={`${g.id}-body`} className="px-4 pb-4 space-y-3 border-t border-line pt-3">
          <ol className="space-y-3">
            {g.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-accent-soft text-accent-text text-xs font-semibold flex items-center justify-center" aria-hidden="true">{i + 1}</span>
                <div className="min-w-0 flex-1"><p className="text-sm text-fg"><span className="sr-only">Step {i + 1}: </span>{s.text}</p>{s.shot && <Shot id={s.shot} />}</div>
              </li>
            ))}
          </ol>
          {g.tips && g.tips.length > 0 && <div className="rounded-lg border border-success-line bg-success-soft p-3 text-xs text-fg space-y-1"><p className="font-semibold text-success">Good to know</p>{g.tips.map((t) => <p key={t}>{t}</p>)}</div>}
          {g.limits && g.limits.length > 0 && <div className="rounded-lg border border-warning-line bg-warning-soft p-3 text-xs text-fg space-y-1"><p className="font-semibold text-warning">Limits to be aware of</p>{g.limits.map((t) => <p key={t}>{t}</p>)}</div>}
          {g.path && <Link to={g.path} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px]">Take me there <ExternalLink className="w-4 h-4" aria-hidden="true" /></Link>}
        </div>
      )}
    </section>
  );
}

/** Help and guide: step-by-step instructions in plain words for every feature, a goal picker, a first-run checklist, FAQ and glossary. */
export const HelpPage: React.FC = () => {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GroupId | 'all'>('all');
  const [open, setOpen] = useState<Set<string>>(() => { const h = location.hash.replace('#', ''); return new Set(GUIDES.some((g) => g.id === h) ? [h] : []); });
  const [done, setDone] = useState<Set<string>>(() => loadDone());
  const [goal, setGoal] = useState<number | null>(null);
  const q = query.trim().toLowerCase();

  useEffect(() => { document.title = 'Help and guide — AdLens'; }, []);
  useEffect(() => { const h = location.hash.replace('#', ''); if (GUIDES.some((g) => g.id === h)) { setGroup('all'); setQuery(''); setOpen((o) => new Set(o).add(h)); } }, [location.hash]);

  const toggleDone = (id: string) => setDone((d) => { const n = new Set(d); if (n.has(id)) n.delete(id); else n.add(id); saveDone(n); return n; });
  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openGuide = (id: string) => { setGroup('all'); setQuery(''); setOpen((o) => new Set(o).add(id)); window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };

  const shownGuides = useMemo(() => GUIDES.filter((g) => (group === 'all' || g.group === group) && (!q || matches(guideText(g), q))), [group, q]);
  const shownFaqs = useMemo(() => FAQS.filter((f) => !q || `${f.q} ${f.a}`.toLowerCase().includes(q)), [q]);
  const shownTerms = useMemo(() => GLOSSARY.filter((t) => !q || `${t.word} ${t.meaning}`.toLowerCase().includes(q)), [q]);
  const doneCount = CHECKLIST.filter((c) => done.has(c.id)).length;
  const searching = q.length > 0;

  return (
    <div className="space-y-8 max-w-4xl">
      <header className="space-y-2">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Help and guide</h1>
        <p className="text-sm text-fg-muted">Step-by-step instructions for every part of AdLens, written in plain words. Search for anything, pick what you want to do, or follow the checklist.</p>
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the guide, for example “share a report” or “ranking”" aria-label="Search the guide" className={`${field} w-full pl-9 pr-9`} />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-fg-muted hover:text-fg"><X className="w-4 h-4" /></button>}
        </div>
      </header>

      {!searching && (
        <section aria-labelledby="start-heading" className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="start-heading" className="text-base font-semibold text-fg">Start here: your first six steps</h2><p className="text-xs text-fg-muted" role="status">{doneCount} of {CHECKLIST.length} done</p></div>
          <div className="h-2 rounded-full bg-fill-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={CHECKLIST.length} aria-valuenow={doneCount} aria-label="Checklist progress"><div className="h-full bg-accent transition-all" style={{ width: `${(doneCount / CHECKLIST.length) * 100}%` }} /></div>
          <ul className="space-y-2">
            {CHECKLIST.map((c) => { const on = done.has(c.id); return (
              <li key={c.id} className="flex items-start gap-3 rounded-lg border border-line p-3">
                <button type="button" onClick={() => toggleDone(c.id)} aria-pressed={on} aria-label={`${on ? 'Mark as not done' : 'Mark as done'}: ${c.title}`} className="mt-0.5 text-accent shrink-0 min-h-[24px]">{on ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5 text-fg-subtle" />}</button>
                <div className="min-w-0 flex-1"><p className={`text-sm font-medium ${on ? 'text-fg-muted line-through' : 'text-fg'}`}>{c.title}</p><p className="text-xs text-fg-muted">{c.why}</p>
                  <div className="flex flex-wrap gap-3 mt-1.5 text-xs"><button type="button" className="text-accent-text underline" onClick={() => openGuide(c.guide)}>Show me how</button><Link className="text-accent-text underline" to={c.path}>Take me there</Link></div></div>
              </li>
            ); })}
          </ul>
          {doneCount > 0 && <button type="button" className="text-xs text-fg-muted underline" onClick={() => { setDone(new Set()); saveDone(new Set()); }}>Start the checklist again</button>}
        </section>
      )}

      {!searching && (
        <section aria-labelledby="goal-heading" className="space-y-3">
          <h2 id="goal-heading" className="text-base font-semibold text-fg">What do you want to do?</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pick a goal">{GOALS.map((g, i) => <button key={g.label} type="button" aria-pressed={goal === i} onClick={() => setGoal(goal === i ? null : i)} className={chip(goal === i)}>{g.label}</button>)}</div>
          {goal !== null && (
            <div className="rounded-xl border border-accent bg-accent-soft p-3 space-y-2" role="status">
              <p className="text-sm text-fg font-medium">Start with these, in this order:</p>
              <ol className="list-decimal pl-5 space-y-1 text-sm">{GOALS[goal]!.guides.map((id) => { const g = GUIDES.find((x) => x.id === id); return g ? <li key={id}><button type="button" onClick={() => openGuide(id)} className="text-accent-text underline text-left">{g.title}</button><span className="text-fg-muted">: {g.summary}</span></li> : null; })}</ol>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="guides-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="guides-heading" className="text-base font-semibold text-fg">Step-by-step guides{searching ? ` (${shownGuides.length} found)` : ''}</h2>
          <div className="flex gap-2"><button type="button" className="text-xs text-accent-text underline" onClick={() => setOpen(new Set(shownGuides.map((g) => g.id)))}>Open all shown</button><button type="button" className="text-xs text-accent-text underline" onClick={() => setOpen(new Set())}>Close all</button></div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter guides by area"><button type="button" aria-pressed={group === 'all'} onClick={() => setGroup('all')} className={chip(group === 'all')}>All</button>{GROUPS.map((g) => <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)} className={chip(group === g.id)}>{g.label}</button>)}</div>
        {shownGuides.length === 0 ? <p className="text-sm text-fg-muted">No guide matches. Try fewer or different words.</p> : GROUPS.filter((gr) => shownGuides.some((g) => g.group === gr.id)).map((gr) => (
          <div key={gr.id} className="space-y-2">
            <div><h3 className="text-sm font-semibold text-fg">{gr.label}</h3><p className="text-xs text-fg-muted">{gr.blurb}</p></div>
            {shownGuides.filter((g) => g.group === gr.id).map((g) => <GuideCard key={g.id} g={g} open={open.has(g.id)} onToggle={() => toggleOpen(g.id)} />)}
          </div>
        ))}
      </section>

      <section aria-labelledby="faq-heading" className="space-y-3">
        <h2 id="faq-heading" className="text-base font-semibold text-fg">Frequently asked questions{searching ? ` (${shownFaqs.length} found)` : ''}</h2>
        {shownFaqs.length === 0 ? <p className="text-sm text-fg-muted">No question matches.</p> : <div className="space-y-2">{shownFaqs.map((f) => (
          <details key={f.q} className="rounded-xl border border-line bg-surface group" {...(searching ? { open: true } : {})}>
            <summary className="cursor-pointer list-none px-4 py-3 min-h-[48px] flex items-center justify-between gap-3 text-sm font-medium text-fg">{f.q}<ChevronDown className="w-4 h-4 shrink-0 text-fg-muted group-open:rotate-180 transition-transform" aria-hidden="true" /></summary>
            <p className="px-4 pb-3 text-sm text-fg-muted">{f.a}</p>
          </details>
        ))}</div>}
      </section>

      <section aria-labelledby="gloss-heading" className="space-y-3">
        <h2 id="gloss-heading" className="text-base font-semibold text-fg">Words explained</h2>
        {shownTerms.length === 0 ? <p className="text-sm text-fg-muted">No word matches.</p> : <dl className="grid sm:grid-cols-2 gap-2">{shownTerms.map((t) => <div key={t.word} className="rounded-lg border border-line bg-surface p-3"><dt className="text-sm font-medium text-fg">{t.word}</dt><dd className="text-xs text-fg-muted mt-0.5">{t.meaning}</dd></div>)}</dl>}
      </section>
    </div>
  );
};
export default HelpPage;
