import { Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type LocalBusinessInfo, type LocalScanBrief, type LocalScanFull } from '../../api/client';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface hover:bg-fill-2 text-fg text-sm px-3 py-2 min-h-[40px] disabled:opacity-50';
const when = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } };
const Tile = ({ k, v, hint }: { k: string; v: string; hint?: string }) => <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-fg-muted">{k}</p><p className="text-2xl font-bold text-fg">{v}</p>{hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}</div>;
const rankClass = (r: number | null) => (r === null ? 'bg-fill-2 text-fg-subtle' : r <= 3 ? 'bg-success-soft text-success' : r <= 10 ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger');

function HeatMap({ scan, keywordIndex }: { scan: LocalScanFull; keywordIndex: number }) {
  const n = scan.gridSize;
  const cells = [...scan.points].sort((a, b) => a.row - b.row || a.col - b.col);
  return (
    <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} role="img" aria-label={`Where you rank on the map for "${scan.keywords[keywordIndex]}". North is at the top.`}>
      {cells.map((p) => { const r = p.ranks[keywordIndex] ?? null; return <div key={`${p.row}-${p.col}`} className={`h-10 w-10 sm:h-12 sm:w-12 rounded-lg flex items-center justify-center text-sm font-semibold ${rankClass(r)}`} title={r === null ? 'Not in the first 20 here' : `Position ${r} here`}>{r === null ? '–' : r}</div>; })}
    </div>
  );
}

function BusinessForm({ initial, onSaved, onCancel }: { initial: LocalBusinessInfo | null; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [matchName, setMatchName] = useState(initial?.matchName ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [coords, setCoords] = useState(initial ? `${initial.lat}, ${initial.lng}` : '');
  const [radius, setRadius] = useState(String(initial?.radiusKm ?? 3));
  const [grid, setGrid] = useState<3 | 5 | 7>(initial?.gridSize ?? 5);
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join('\n'));
  const [placeId, setPlaceId] = useState(initial?.placeId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const find = async () => {
    setBusy(true); setError(null); setNote(null);
    try { const g = await apiClient.localGeocode(address || name); setCoords(`${g.lat}, ${g.lng}`); setNote(`Found: ${g.label}`); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    setError(null);
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(coords);
    if (!m) return setError('Enter the location as two numbers, like 23.7808, 90.4160. Use "Find on map" or right-click the spot in Google Maps and copy the numbers.');
    setBusy(true);
    try {
      await apiClient.localSave({ name, matchName, address, lat: Number(m[1]), lng: Number(m[2]), radiusKm: Number(radius) || 3, gridSize: grid, keywords: keywords.split('\n').map((k) => k.trim()).filter(Boolean), placeId }, initial?.id);
      onSaved();
    } catch (e) { setError(errMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-fg-muted space-y-1 block">Business name<input className={`${field} w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ann's Cafe" /></label>
        <label className="text-xs text-fg-muted space-y-1 block">Name as shown on Google (optional)<input className={`${field} w-full`} value={matchName} onChange={(e) => setMatchName(e.target.value)} placeholder="Used to spot your listing in results" /></label>
        <label className="text-xs text-fg-muted space-y-1 block sm:col-span-2">Address<span className="flex gap-2"><input className={`${field} flex-1`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, road, area, city" /><button type="button" className={secondary} onClick={find} disabled={busy || (address + name).trim().length < 3}>Find on map</button></span></label>
        <label className="text-xs text-fg-muted space-y-1 block">Location (latitude, longitude)<input className={`${field} w-full`} value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="23.7808, 90.4160" /></label>
        <label className="text-xs text-fg-muted space-y-1 block">Google place id (optional, learned from the first scan)<input className={`${field} w-full`} value={placeId} onChange={(e) => setPlaceId(e.target.value)} /></label>
        <label className="text-xs text-fg-muted space-y-1 block">How far to look (km from the business)<input className={`${field} w-full`} inputMode="decimal" value={radius} onChange={(e) => setRadius(e.target.value)} /></label>
        <label className="text-xs text-fg-muted space-y-1 block">Grid size<select className={`${field} w-full`} value={grid} onChange={(e) => setGrid(Number(e.target.value) as 3 | 5 | 7)}><option value={3}>3 by 3 (9 spots)</option><option value={5}>5 by 5 (25 spots)</option><option value={7}>7 by 7 (49 spots)</option></select></label>
      </div>
      <label className="text-xs text-fg-muted space-y-1 block">What customers search for (one per line, up to 10)<textarea className={`${field} w-full min-h-[96px]`} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={'coffee shop\nbest cafe near me'} /></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-xs text-success">{note}</p>}
      <div className="flex gap-2"><button type="button" className={primary} onClick={save} disabled={busy}>{initial ? 'Save changes' : 'Add business'}</button><button type="button" className={secondary} onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

/** Sprint 46a and 46b: where you show on Google Maps around your business, and who else shows up there. */
export function LocalRankTracker() {
  const [data, setData] = useState<Awaited<ReturnType<typeof apiClient.localList>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit: LocalBusinessInfo | null } | null>(null);
  const [scan, setScan] = useState<LocalScanFull | null>(null);
  const [history, setHistory] = useState<LocalScanBrief[]>([]);
  const [kw, setKw] = useState(0);
  const [confirm, setConfirm] = useState<{ lookups: number; cost: number } | null>(null);
  const [review, setReview] = useState<{ url: string; qr: string } | null>(null);

  const load = useCallback(async () => {
    try { const d = await apiClient.localList(); setData(d); setSelected((cur) => cur && d.businesses.some((b) => b.id === cur) ? cur : d.businesses[0]?.id ?? null); setError(null); } catch (e) { setError(errMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const loadScans = useCallback(async (id: string) => {
    try { const r = await apiClient.localScans(id); setScan(r.latest); setHistory(r.history); setKw(0); setReview(null); } catch (e) { setError(errMessage(e)); }
  }, []);
  useEffect(() => { if (selected) void loadScans(selected); else { setScan(null); setHistory([]); } }, [selected, loadScans]);

  if (!data) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-sm text-fg-muted">Loading…</p>;
  const biz = data.businesses.find((b) => b.id === selected) ?? null;
  const act = async (fn: () => Promise<string | void>) => { setBusy(true); setError(null); setNote(null); try { const m = await fn(); if (m) setNote(m); } catch (e) { setError(errMessage(e)); } finally { setBusy(false); } };
  const ask = () => act(async () => { const e = await apiClient.localEstimate(biz!.id); if (e.tooBig) throw new Error(`This setup needs ${e.lookups} lookups, more than the limit of ${e.maxLookups}. Use a smaller grid or fewer phrases.`); setConfirm({ lookups: e.lookups, cost: e.estimatedCostUsd }); });
  const run = () => act(async () => {
    const c = confirm!; setConfirm(null);
    const r = await apiClient.localScan(biz!.id, c.lookups);
    setScan(r.scan); await loadScans(biz!.id); await load();
    return r.note ?? 'Scan finished.';
  });
  const prev = history.length >= 2 ? history[history.length - 2]! : null;
  const delta = (cur: number | null, old: number | null | undefined, lowerBetter: boolean) => {
    if (cur === null || old === null || old === undefined) return undefined;
    const d = Math.round((cur - old) * 10) / 10; if (d === 0) return 'Same as last scan';
    return `${(lowerBetter ? d < 0 : d > 0) ? 'Better' : 'Worse'} by ${Math.abs(d)} since last scan`;
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">When someone searches "coffee shop" on Google Maps, you show up higher near your door and lower farther away. This checks Google Maps from a grid of spots around your business and colours each spot: green for the top 3, orange for 4 to 10, red for lower, and a dash if you are not in the first 20. Scans use your own data provider key and ask you to confirm the cost first.</p>
      {!data.providerConnected && <p className="text-sm rounded-lg border border-warning-line bg-warning-soft text-warning p-3">Connect a data provider that offers Google Maps results first: Settings, then Data provider. DataForSEO works out of the box.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-success">{note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {data.businesses.map((b) => <button key={b.id} type="button" onClick={() => setSelected(b.id)} className={`rounded-full border px-3 py-1.5 text-sm min-h-[36px] ${b.id === selected ? 'border-accent bg-accent-soft text-fg font-medium' : 'border-line bg-surface text-fg-muted hover:bg-fill-2'}`}>{b.name}</button>)}
        {data.canEdit && data.businesses.length < data.limit && <button type="button" className={secondary} onClick={() => setForm({ edit: null })}>Add a business</button>}
        <span className="text-xs text-fg-subtle">{data.businesses.length} of {data.limit}</span>
      </div>
      {form && <BusinessForm initial={form.edit} onCancel={() => setForm(null)} onSaved={() => { setForm(null); void load(); }} />}
      {!biz && !form && <p className="text-sm text-fg-muted">Add your business to start. You will need its location and the phrases customers search for.</p>}
      {biz && !form && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {data.canEdit && <button type="button" className={primary} onClick={ask} disabled={busy || !data.providerConnected}>{busy ? 'Working…' : 'Run a scan'}</button>}
            {data.canEdit && <button type="button" className={secondary} onClick={() => setForm({ edit: biz })}>Edit</button>}
            {data.canEdit && <button type="button" className={secondary} aria-label="Remove business" onClick={() => { if (window.confirm(`Remove ${biz.name} and its scan history?`)) void act(async () => { await apiClient.localDelete(biz.id); setSelected(null); await load(); }); }}><Trash2 className="h-4 w-4" /></button>}
            <span className="text-xs text-fg-subtle">{biz.gridSize}x{biz.gridSize} grid, {biz.radiusKm} km, {biz.keywords.length} phrase{biz.keywords.length === 1 ? '' : 's'}</span>
          </div>
          {confirm && (
            <div role="alertdialog" aria-label="Confirm scan" className="rounded-xl border border-warning-line bg-warning-soft p-3 text-sm text-fg space-y-2">
              <p>This scan makes <strong>{confirm.lookups}</strong> Google Maps lookups on your data provider, roughly <strong>${confirm.cost.toFixed(2)}</strong> at typical prices. Your provider bills you directly.</p>
              <div className="flex gap-2"><button type="button" className={primary} onClick={run}>Start scan</button><button type="button" className={secondary} onClick={() => setConfirm(null)}>Cancel</button></div>
            </div>
          )}
          {scan ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Tile k="Average position" v={scan.summary.avgRank === null ? 'Not found' : String(scan.summary.avgRank)} hint={delta(scan.summary.avgRank, prev?.summary.avgRank, true)} />
                <Tile k="In the top 3" v={`${scan.summary.top3Share}%`} hint={delta(scan.summary.top3Share, prev?.summary.top3Share, false)} />
                <Tile k="Seen on the map" v={`${scan.summary.foundShare}%`} hint="Share of spots where you appear" />
                <Tile k="Last scan" v={when(scan.at)} hint={`${scan.lookups} lookups`} />
              </div>
              <div className="flex flex-wrap items-start gap-6">
                <div className="space-y-2">
                  <label className="text-xs text-fg-muted block">Search phrase<select className={`${field} block mt-1`} value={kw} onChange={(e) => setKw(Number(e.target.value))}>{scan.keywords.map((k, i) => <option key={k} value={i}>{k}</option>)}</select></label>
                  <HeatMap scan={scan} keywordIndex={kw} />
                  <p className="text-[11px] text-fg-subtle">North is at the top. Your business is in the middle.</p>
                  {scan.summary.keywords[kw] && <p className="text-xs text-fg-muted">Average {scan.summary.keywords[kw]!.avgRank ?? 'not found'}, top 3 in {scan.summary.keywords[kw]!.top3Share}% of spots, seen in {scan.summary.keywords[kw]!.foundShare}%.</p>}
                </div>
                <div className="min-w-[240px] flex-1 overflow-x-auto">
                  <h3 className="text-sm font-semibold text-fg mb-2">Every phrase</h3>
                  <table className="w-full text-sm"><thead><tr className="text-left text-xs text-fg-muted"><th className="py-1 pr-3">Phrase</th><th className="pr-3">Avg</th><th className="pr-3">Top 3</th><th>Seen</th></tr></thead><tbody>{scan.summary.keywords.map((k) => <tr key={k.keyword} className="border-t border-line"><td className="py-1.5 pr-3">{k.keyword}</td><td className="pr-3">{k.avgRank ?? '–'}</td><td className="pr-3">{k.top3Share}%</td><td>{k.foundShare}%</td></tr>)}</tbody></table>
                </div>
              </div>
              {history.length > 1 && <div><h3 className="text-sm font-semibold text-fg mb-2">History</h3><div className="flex flex-wrap gap-2">{history.slice().reverse().map((h) => <button key={h.id} type="button" onClick={() => void act(async () => { const r = await apiClient.localScanGet(biz.id, h.id); setScan(r.scan); setKw(0); })} className={`rounded-lg border px-2.5 py-1.5 text-xs ${h.id === scan.id ? 'border-accent bg-accent-soft text-fg' : 'border-line bg-surface text-fg-muted hover:bg-fill-2'}`}>{when(h.at)}: avg {h.summary.avgRank ?? '–'}, top 3 {h.summary.top3Share}%</button>)}</div></div>}
              <div>
                <h3 className="text-sm font-semibold text-fg mb-1">Local competitors</h3>
                <p className="text-xs text-fg-muted mb-2">Businesses that show up in the same Maps results, with rating and review count read from the same lookups (no extra cost).</p>
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-fg-muted"><th className="py-1 pr-3">Business</th><th className="pr-3">Seen in</th><th className="pr-3">Avg position</th><th className="pr-3">Rating</th><th className="pr-3">Reviews</th><th>Type</th></tr></thead><tbody>
                  {scan.own && <tr className="border-t border-line bg-accent-soft"><td className="py-1.5 pr-3 font-medium">{scan.own.name} (you)</td><td className="pr-3">{scan.own.appearances}</td><td className="pr-3">{scan.own.avgRank}</td><td className="pr-3">{scan.own.rating ?? '–'}</td><td className="pr-3">{scan.own.reviews ?? '–'}</td><td>{scan.own.category ?? ''}</td></tr>}
                  {scan.competitors.map((c) => <tr key={c.placeId ?? c.name} className="border-t border-line"><td className="py-1.5 pr-3">{c.name}</td><td className="pr-3">{c.appearances}</td><td className="pr-3">{c.avgRank}</td><td className="pr-3">{c.rating ?? '–'}</td><td className="pr-3">{c.reviews ?? '–'}</td><td>{c.category ?? ''}</td></tr>)}
                </tbody></table></div>
                {history.filter((h) => h.own?.reviews != null).length > 1 && <p className="text-xs text-fg-muted mt-2">Your reviews over time: {history.filter((h) => h.own?.reviews != null).map((h) => `${when(h.at)}: ${h.own!.reviews} reviews${h.own!.rating != null ? ` (${h.own!.rating})` : ''}`).join(' → ')}</p>}
              </div>
            </>
          ) : <p className="text-sm text-fg-muted">No scans yet. Press "Run a scan" to see where you show on the map.</p>}
          <div className="rounded-xl border border-line bg-surface p-3 space-y-2">
            <h3 className="text-sm font-semibold text-fg">Ask customers for a review</h3>
            <p className="text-xs text-fg-muted">More recent reviews help you rank. This makes a link that opens Google's review box directly, and a QR code to print for the counter or receipts. We need your Google place id, which the first scan learns for you.</p>
            {!review && <button type="button" className={secondary} onClick={() => void act(async () => { setReview(await apiClient.localReviewLink(biz.id)); })} disabled={busy}>Get review link and QR</button>}
            {review && <div className="flex flex-wrap items-center gap-4"><img src={review.qr} alt="QR code that opens your Google review box" className="h-32 w-32 rounded-lg border border-line p-1" style={{ background: "#fff" }} /><div className="space-y-2 min-w-0"><input readOnly className={`${field} w-full`} value={review.url} onFocus={(e) => e.currentTarget.select()} aria-label="Review link" /><a className={secondary} href={review.qr} download={`${biz.name}-review-qr.png`}>Download QR</a></div></div>}
          </div>
        </div>
      )}
    </div>
  );
}
