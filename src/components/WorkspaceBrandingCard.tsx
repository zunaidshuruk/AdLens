import React, { useEffect, useState } from 'react';
import { apiClient, type BrandingInfo } from '../api/client';
import { useApp } from '../context/AppContext';

const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';

/** Settings → Workspace: put your own name, logo line and colour on shared report pages, PDFs and scheduled emails. */
export const WorkspaceBrandingCard: React.FC = () => {
  const { activeWorkspace } = useApp();
  const wsId = activeWorkspace?.id;
  const [state, setState] = useState<{ branding: BrandingInfo; allowed: boolean; canEdit: boolean; hasLogo: boolean } | null>(null);
  const [form, setForm] = useState<BrandingInfo>({ enabled: false, name: '', footer: '', accent: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!wsId) return;
    let live = true;
    apiClient.getBranding(wsId).then((s) => { if (live) { setState(s); setForm(s.branding); } }).catch(() => { /* card stays hidden */ });
    return () => { live = false; };
  }, [wsId]);
  if (!wsId || !state) return null;
  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try { const r = await apiClient.saveBranding(wsId, { ...form, accent: form.accent || null }); setForm(r.branding); setSaved(true); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  const locked = !state.allowed || !state.canEdit;
  return (
    <section data-testid="workspace-branding-card" className="rounded-2xl border border-line bg-surface p-4 sm:p-5 space-y-3">
      <div><h2 className="text-base font-semibold text-fg">White label</h2>
        <p className="text-xs text-fg-muted">Show your own name, logo and colour on share links, PDFs and scheduled emails, so clients see your brand. Upload the logo under the workspace settings above.</p></div>
      {!state.allowed && <p role="status" className="text-xs text-warning">White label is not part of your plan. Upgrade to use it.</p>}
      {state.allowed && !state.canEdit && <p className="text-xs text-fg-muted">Only owners and admins can change this.</p>}
      <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" disabled={locked} checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Use my brand on reports I share</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-fg block">Name to show<input className={`${field} block w-full mt-1`} disabled={locked} maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={activeWorkspace?.name ?? 'Your agency'} /></label>
        <label className="text-xs font-medium text-fg block">Accent colour<span className="flex items-center gap-2 mt-1"><input type="color" aria-label="Accent colour" disabled={locked} value={form.accent ?? '#1a73e8'} onChange={(e) => setForm({ ...form, accent: e.target.value })} className="h-10 w-14 rounded border border-line bg-surface" /><button type="button" className="text-xs underline text-fg-muted" disabled={locked || !form.accent} onClick={() => setForm({ ...form, accent: null })}>Use default</button></span></label>
      </div>
      <label className="text-xs font-medium text-fg block">Footer line (optional)<input className={`${field} block w-full mt-1`} disabled={locked} maxLength={160} value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} placeholder="Prepared by Acme Marketing · hello@acme.com" /></label>
      <p className="text-xs text-fg-muted">{state.hasLogo ? 'Your workspace logo is used on share pages.' : 'No workspace logo yet, so share pages show only your name.'} PDFs and emails show your name, footer line and colour but not the logo image.</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {saved && <p role="status" className="text-xs text-success">Saved.</p>}
      <button type="button" disabled={locked || busy} onClick={() => void save()} className="rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2 min-h-[40px] disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
    </section>
  );
};
