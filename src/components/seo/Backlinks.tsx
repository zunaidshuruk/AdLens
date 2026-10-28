import { Download } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { apiClient, type LinkProspectInfo } from '../../api/client';
import { auditLinks, disavowFile, domainOf, linkGap, parseLinks, type AuditReport } from '../../utils/backlinks';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const n = (v: number) => v.toLocaleString();

function saveText(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

function FileOrPaste({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-fg block">{label}<textarea className={`${field} block w-full min-h-[96px] mt-1`} placeholder="Paste a list or CSV here, or choose a file below" value={value} onChange={(e) => onChange(e.target.value)} /></label>
      <input type="file" aria-label={`${label}: choose file`} accept=".csv,.txt,.tsv,text/csv,text/plain" className="text-xs text-fg" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await f.text()); }} />
    </div>
  );
}

export function BacklinkAudit() {
  const [text, setText] = useState('');
  const [rep, setRep] = useState<AuditReport | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const run = () => {
    const { entries, skipped } = parseLinks(text);
    const a = auditLinks(entries); a.skipped = skipped;
    setRep(a); setPicked(new Set(a.risky.filter((r) => r.risk >= 45).map((r) => r.domain)));
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">We do not keep a database of the web's links, so bring yours: in Google Search Console open Links, choose "Top linking sites" and export, or paste any list of sites that link to you. Everything is worked out in your browser.</p>
      <FileOrPaste label="Sites that link to you" value={text} onChange={setText} />
      <button type="button" className={primary} disabled={text.trim().length < 3} onClick={run}>Audit these links</button>
      {rep && rep.referringDomains === 0 && <p role="alert" className="text-sm text-danger">No sites could be read from that. Use a CSV with a Site or Source column, or one address per line.</p>}
      {rep && rep.referringDomains > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[['Linking sites', n(rep.referringDomains)], ['Links counted', n(rep.totalLinks)], ['Worth a look', n(rep.riskyCount)], ['Lines skipped', n(rep.skipped)]].map(([k, v]) => <div key={k} className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">{k}</p><p className="text-2xl font-bold text-fg">{v}</p></div>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Sites with the most links</h3>
              <ul className="text-xs space-y-0.5">{rep.topDomains.map((d) => <li key={d.domain} className="flex justify-between gap-2"><span className="text-fg break-all">{d.domain}</span><span className="text-fg-muted tabular-nums">{n(d.links)}</span></li>)}</ul></section>
            <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Where the links come from (endings)</h3>
              <ul className="text-xs space-y-0.5">{rep.tlds.map((t) => <li key={t.tld} className="flex justify-between gap-2"><span className="text-fg">{t.tld}</span><span className="text-fg-muted tabular-nums">{n(t.domains)} sites</span></li>)}</ul></section>
          </div>
          {rep.anchors.length > 0 && <section className="rounded-xl border border-line bg-surface p-3 space-y-1"><h3 className="text-sm font-semibold text-fg">Link text people use</h3>
            <ul className="text-xs space-y-0.5">{rep.anchors.map((a) => <li key={a.text} className="flex justify-between gap-2"><span className="text-fg break-all">{a.text}</span><span className="text-fg-muted shrink-0">{a.type} · {n(a.links)}</span></li>)}</ul></section>}
          <section className="rounded-xl border border-line bg-surface p-3 space-y-2">
            <div><h3 className="text-sm font-semibold text-fg">Sites that look risky</h3><p className="text-xs text-fg-muted">Signs only: an odd name or ending does not prove a link is harmful. Google ignores most bad links by itself, so only disavow ones you are sure about, such as a clear spam network or links you paid for.</p></div>
            {rep.risky.length === 0 ? <p className="text-xs text-success">Nothing stands out.</p> : (
              <>
                <ul className="space-y-1">{rep.risky.slice(0, 50).map((r) => (
                  <li key={r.domain} className="text-xs"><label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={picked.has(r.domain)} onChange={(e) => setPicked((p) => { const x = new Set(p); if (e.target.checked) x.add(r.domain); else x.delete(r.domain); return x; })} /><span><span className="text-fg font-medium break-all">{r.domain}</span> <span className="text-fg-muted">({n(r.links)} link{r.links === 1 ? '' : 's'}, risk {r.risk}): {r.reasons.join('; ')}</span></span></label></li>
                ))}</ul>
                <button type="button" className={secondary} disabled={picked.size === 0} onClick={() => saveText('disavow.txt', disavowFile([...picked]))}><Download className="w-4 h-4" /> Download disavow file ({picked.size})</button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export function BacklinkGap({ goOutreach }: { goOutreach: () => void }) {
  const [mine, setMine] = useState('');
  const [rivals, setRivals] = useState([{ name: 'Competitor 1', text: '' }, { name: 'Competitor 2', text: '' }]);
  const [ran, setRan] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const own = useMemo(() => new Set(parseLinks(mine).entries.map((e) => e.domain)), [mine]);
  const rows = useMemo(() => (ran ? linkGap(own, rivals.map((r) => ({ name: r.name.trim() || 'Competitor', domains: new Set(parseLinks(r.text).entries.map((e) => e.domain)) })).filter((r) => r.domains.size > 0), rivals.map((r) => domainOf(r.name) ?? '').filter(Boolean)) : []), [ran, own, rivals]);
  const addAll = async (list: string[]) => {
    setBusy(true); setMsg(null);
    try { const r = await apiClient.linkAddProspects(list); setMsg(`Added ${r.added} site${r.added === 1 ? '' : 's'} to your link building list${r.skipped ? ` (${r.skipped} skipped: already there, your own, or not valid)` : ''}.`); } catch (e) { setMsg(errMessage(e)); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Find sites that link to your competitors but not to you. Paste or upload each list of linking sites (from Search Console for you; from whichever backlink tool you already use for competitors). Name each competitor by its website if you want it left out of the results.</p>
      <FileOrPaste label="Sites that link to you" value={mine} onChange={setMine} />
      {rivals.map((r, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-3 space-y-2">
          <input aria-label={`Competitor ${i + 1} name`} className={`${field} w-full sm:w-64`} value={r.name} placeholder="competitor.com" onChange={(e) => setRivals(rivals.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
          <FileOrPaste label={`Sites that link to ${r.name || `competitor ${i + 1}`}`} value={r.text} onChange={(v) => setRivals(rivals.map((x, k) => (k === i ? { ...x, text: v } : x)))} />
        </div>
      ))}
      <div className="flex gap-2"><button type="button" className={secondary} disabled={rivals.length >= 5} onClick={() => setRivals([...rivals, { name: `Competitor ${rivals.length + 1}`, text: '' }])}>Add a competitor</button><button type="button" className={primary} disabled={rivals.every((r) => r.text.trim().length < 3)} onClick={() => setRan(true)}>Find link gaps</button></div>
      {ran && (rows.length === 0 ? <p className="text-sm text-fg-muted">No gaps found: every site that links to the competitors already links to you, or the lists could not be read.</p> : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-fg">{n(rows.length)} sites link to a competitor and not to you.</span><span className="flex-1" />
            <button type="button" className={secondary} disabled={busy} onClick={() => void addAll(rows.filter((r) => r.linksToCompetitors >= 2).map((r) => r.domain))}>Add sites linking to 2 or more</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => void addAll(rows.slice(0, 100).map((r) => r.domain))}>Add top 100</button></div>
          {msg && <p role="status" className="text-xs text-fg-muted">{msg} <button type="button" onClick={goOutreach} className="underline text-accent-text">Open the link building list</button></p>}
          <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-xs"><thead className="bg-fill-2 text-fg-muted"><tr><th className="text-left p-2">Site</th><th className="text-right p-2">Competitors it links to</th><th className="text-left p-2">Which</th></tr></thead>
            <tbody>{rows.slice(0, 200).map((r) => <tr key={r.domain} className="border-t border-line"><td className="p-2 text-fg break-all">{r.domain}</td><td className="p-2 text-right tabular-nums">{r.linksToCompetitors}</td><td className="p-2 text-fg-muted">{r.competitors.join(', ')}</td></tr>)}</tbody></table></div>
        </div>
      ))}
    </div>
  );
}

const STATUSES: { key: LinkProspectInfo['status']; label: string }[] = [{ key: 'new', label: 'To contact' }, { key: 'contacted', label: 'Contacted' }, { key: 'replied', label: 'Replied' }, { key: 'won', label: 'Link won' }, { key: 'lost', label: 'Not interested' }];
const TEMPLATES = [
  { name: 'Resource page', subject: 'A resource for your {topic} page', body: 'Hi {name},\n\nI was reading {page} and found it useful. We published a guide on {topic} at {url} that your readers may find helpful as well. If it fits, it would be great to see it linked there.\n\nEither way, thanks for putting together such a helpful page.\n\n{me}' },
  { name: 'Broken link', subject: 'A broken link on {page}', body: 'Hi {name},\n\nWhile reading {page} I noticed a link that no longer works. I thought you would want to know. We have a page on the same subject at {url} that could replace it, if useful.\n\nBest,\n{me}' },
  { name: 'Mention, no link', subject: 'Thank you for mentioning us', body: 'Hi {name},\n\nThank you for mentioning us on {page}. Would you consider linking the mention to {url}? It would help readers find us.\n\nThanks again,\n{me}' },
];

export function LinkBuilding() {
  const [state, setState] = useState<Awaited<ReturnType<typeof apiClient.linkProspects>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | LinkProspectInfo['status']>('all');
  const [tpl, setTpl] = useState(0);
  const load = React.useCallback(async () => { try { setState(await apiClient.linkProspects()); setError(null); } catch (e) { setError(errMessage(e)); } }, []);
  React.useEffect(() => { void load(); }, [load]);
  const patch = async (id: string, p: Parameters<typeof apiClient.linkUpdateProspect>[1]) => {
    try { const r = await apiClient.linkUpdateProspect(id, p); setState((s) => s && { ...s, prospects: s.prospects.map((x) => (x.id === id ? r.prospect : x)) }); } catch (e) { setError(errMessage(e)); }
  };
  const check = async (id: string) => { setBusy(id); setError(null); try { const r = await apiClient.linkCheckProspect(id); setState((s) => s && { ...s, prospects: s.prospects.map((x) => (x.id === id ? r.prospect : x)) }); } catch (e) { setError(errMessage(e)); } setBusy(null); };
  const remove = async (id: string) => { try { await apiClient.linkDeleteProspect(id); setState((s) => s && { ...s, prospects: s.prospects.filter((x) => x.id !== id) }); } catch (e) { setError(errMessage(e)); } };
  const addNow = async () => { setBusy('add'); setError(null); try { await apiClient.linkAddProspects(add.split(/[\n,\s]+/).filter(Boolean)); setAdd(''); await load(); } catch (e) { setError(errMessage(e)); } setBusy(null); };
  if (!state) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <div aria-busy="true" className="h-24 rounded-xl bg-fill-2 animate-pulse" />;
  const shown = state.prospects.filter((p) => filter === 'all' || p.status === filter);
  const count = (k: LinkProspectInfo['status']) => state.prospects.filter((p) => p.status === k).length;
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Keep track of sites you want a link from. Move each one along as you reach out, and use "Check link" to see whether your link is now on the page. {state.prospects.length} of {state.limit} used.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {state.canEdit && <div className="flex flex-wrap gap-2"><textarea aria-label="Sites to add" className={`${field} flex-1 min-w-[220px] min-h-[64px]`} placeholder="Add sites, one per line (for example blog.example.org)" value={add} onChange={(e) => setAdd(e.target.value)} /><button type="button" className={primary} disabled={busy === 'add' || add.trim().length < 3} onClick={() => void addNow()}>Add sites</button></div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} className={`text-xs rounded-full border px-3 py-1 ${filter === 'all' ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted'}`}>All ({state.prospects.length})</button>
        {STATUSES.map((s) => <button key={s.key} type="button" aria-pressed={filter === s.key} onClick={() => setFilter(s.key)} className={`text-xs rounded-full border px-3 py-1 ${filter === s.key ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-muted'}`}>{s.label} ({count(s.key)})</button>)}
      </div>
      {shown.length === 0 ? <p className="text-sm text-fg-muted">Nothing here yet. Add sites above, or use Backlinks → Link gap to find some.</p> : (
        <ul className="space-y-2">{shown.map((p) => (
          <li key={p.id} className="rounded-xl border border-line bg-surface p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-fg break-all">{p.domain}</span>
              {p.linkLive === true && <span className="text-[11px] rounded-full px-2 py-0.5 bg-success-soft text-success">Link is live</span>}
              {p.linkLive === false && <span className="text-[11px] rounded-full px-2 py-0.5 bg-warning-soft text-warning">Link not found</span>}
              <span className="flex-1" />
              <select aria-label={`Status for ${p.domain}`} disabled={!state.canEdit} className={field} value={p.status} onChange={(e) => void patch(p.id, { status: e.target.value as LinkProspectInfo['status'] })}>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label={`Page where your link should appear on ${p.domain}`} disabled={!state.canEdit} className={field} placeholder="Page where your link should be" defaultValue={p.pageUrl} onBlur={(e) => { if (e.target.value !== p.pageUrl) void patch(p.id, { pageUrl: e.target.value }); }} />
              <input aria-label={`Contact email for ${p.domain}`} disabled={!state.canEdit} className={field} placeholder="Contact email" defaultValue={p.contactEmail} onBlur={(e) => { if (e.target.value !== p.contactEmail) void patch(p.id, { contactEmail: e.target.value }); }} />
            </div>
            <textarea aria-label={`Notes for ${p.domain}`} disabled={!state.canEdit} className={`${field} w-full min-h-[48px]`} placeholder="Notes" defaultValue={p.notes} onBlur={(e) => { if (e.target.value !== p.notes) void patch(p.id, { notes: e.target.value }); }} />
            {state.canEdit && <div className="flex flex-wrap gap-2 items-center"><button type="button" className={secondary} disabled={busy === p.id || !p.pageUrl} onClick={() => void check(p.id)}>{busy === p.id ? 'Checking…' : 'Check link'}</button>{p.checkedAt && <span className="text-[11px] text-fg-subtle">Checked {new Date(p.checkedAt).toLocaleString()}</span>}<span className="flex-1" /><button type="button" className={secondary} onClick={() => { if (window.confirm(`Remove ${p.domain}?`)) void remove(p.id); }}>Remove</button></div>}
          </li>
        ))}</ul>
      )}
      <section className="rounded-xl border border-line bg-surface p-3 space-y-2"><h3 className="text-sm font-semibold text-fg">Email starters</h3>
        <select aria-label="Template" className={field} value={tpl} onChange={(e) => setTpl(Number(e.target.value))}>{TEMPLATES.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}</select>
        <p className="text-xs text-fg-muted">Subject: {TEMPLATES[tpl]!.subject}</p>
        <pre className="text-xs text-fg whitespace-pre-wrap font-sans rounded-lg bg-fill-2 p-3">{TEMPLATES[tpl]!.body}</pre>
        <button type="button" className={secondary} onClick={() => { void navigator.clipboard?.writeText(`Subject: ${TEMPLATES[tpl]!.subject}\n\n${TEMPLATES[tpl]!.body}`); }}>Copy</button>
        <p className="text-[11px] text-fg-subtle">Replace the words in {'{braces}'} before sending. Write to a real person and keep it short and honest.</p>
      </section>
    </div>
  );
}
