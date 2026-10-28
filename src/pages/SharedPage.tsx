import { Download } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient, type SharedSnapshot } from '../api/client';
import { AdLensLogo } from '../components/AdLensLogo';
import { WidgetCard } from '../components/DashboardWidgetView';
import { APP_NAME } from '../config/app';
import { formatShortDate } from '../utils/dateUtils';

const ROW_PX = 56;

/** The read-only page behind a share link. Shows a saved snapshot only; nothing here is live. */
export const SharedPage: React.FC = () => {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<'loading' | 'password' | 'ready' | 'gone'>('loading');
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [usedPassword, setUsedPassword] = useState<string | undefined>(undefined);
  const [data, setData] = useState<{ snapshot: SharedSnapshot; expiresAt: string | null } | null>(null);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const open = async (pw?: string) => {
    setBusy(true); setError(null);
    try { setData(await apiClient.sharedOpen(token, pw)); setUsedPassword(pw); setPhase('ready'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open this page.'); }
    setBusy(false);
  };

  useEffect(() => {
    apiClient.sharedMeta(token).then((m) => {
      setTitle(m.title);
      if (m.needsPassword) setPhase('password'); else void open();
    }).catch(() => setPhase('gone'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  return (
    <div className="min-h-screen bg-page text-fg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-2 font-semibold"><AdLensLogo className="w-6 h-6" /><span>{APP_NAME}</span><span className="text-xs font-normal text-fg-muted">· shared, read-only</span></div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        {phase === 'loading' && <div aria-busy="true" className="h-24 rounded-xl bg-fill-2 animate-pulse" />}
        {phase === 'gone' && (
          <div className="rounded-xl border border-line bg-surface p-6 text-center space-y-1">
            <h1 className="text-lg font-semibold">This link is not available</h1>
            <p className="text-sm text-fg-muted">It may have expired or been turned off. Ask the person who sent it for a new one.</p>
          </div>
        )}
        {phase === 'password' && (
          <form onSubmit={(e) => { e.preventDefault(); void open(password); }} className="mx-auto max-w-sm rounded-xl border border-line bg-surface p-6 space-y-3">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-sm text-fg-muted">This page needs a password.</p>
            <input type="password" autoFocus autoComplete="off" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]" />
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
            <button type="submit" disabled={busy || !password} className="w-full rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-3 py-2 min-h-[40px] disabled:opacity-50">{busy ? 'Opening…' : 'Open'}</button>
          </form>
        )}
        {phase === 'ready' && data && (
          <>
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{data.snapshot.title}</h1>
                <button type="button" disabled={pdfBusy} onClick={() => { setPdfBusy(true); setError(null); apiClient.sharedPdf(token, usedPassword).catch((e) => setError(e instanceof Error ? e.message : 'Could not make the PDF.')).finally(() => setPdfBusy(false)); }} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> {pdfBusy ? 'Making PDF…' : 'Download PDF'}</button>
              </div>
              {error && <p role="alert" className="text-xs text-danger">{error}</p>}
              {data.snapshot.description && <p className="text-sm text-fg-muted">{data.snapshot.description}</p>}
              <p className="text-xs text-fg-subtle">
                Numbers for {formatShortDate(data.snapshot.range.startDate)} to {formatShortDate(data.snapshot.range.endDate)} · saved {new Date(data.snapshot.generatedAt).toLocaleString()}
                {data.expiresAt ? ` · link works until ${new Date(data.expiresAt).toLocaleDateString()}` : ''}
              </p>
            </div>
            <div className={wide ? 'grid gap-3' : 'flex flex-col gap-3'} style={wide ? { gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridAutoRows: `${ROW_PX}px` } : undefined}>
              {[...data.snapshot.widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x).map((w) => (
                <div key={w.id} style={wide ? { gridColumn: `${w.layout.x + 1} / span ${w.layout.w}`, gridRow: `${w.layout.y + 1} / span ${w.layout.h}` } : { minHeight: Math.max(1, w.layout.h) * ROW_PX }}>
                  <WidgetCard
                    widget={(w.kind === 'text'
                      ? { id: w.id, title: w.title, layout: w.layout, kind: 'text', text: w.text ?? '' }
                      : { id: w.id, title: w.title, layout: w.layout, kind: w.kind, days: w.days, target: w.target, source: w.result?.source ?? 'ga4', spec: { dimensions: [], metrics: [], filters: [], limit: 1 } }) as never}
                    state={{ loading: false, error: w.error ?? null, result: w.result ?? null }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
};
