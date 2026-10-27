import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { DASHBOARD_TEMPLATES, templateToInput } from '../config/dashboardTemplates.js';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import type { Dashboard } from '../types/dashboard.js';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

export const DashboardsPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Dashboard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await apiClient.listDashboards());
    } catch (e) {
      setError(errMessage(e));
      setItems([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (key: string, input: Parameters<typeof apiClient.createDashboard>[0]) => {
    setBusy(key);
    setError(null);
    try {
      const d = await apiClient.createDashboard(input);
      navigate(`/dashboards/${d.id}`);
    } catch (e) {
      setError(errMessage(e));
      setBusy(null);
    }
  };

  const remove = async (d: Dashboard) => {
    if (!window.confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    try {
      await apiClient.deleteDashboard(d.id);
      await load();
    } catch (e) {
      setError(errMessage(e));
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Dashboards</h1>
        <p className="text-xs sm:text-sm text-fg-muted">Put the numbers you care about on one screen. Start from a template or build your own.</p>
      </div>

      {error && <ErrorState title="Dashboards" message={error} onRetry={() => void load()} />}

      <section aria-labelledby="your-dashboards" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="your-dashboards" className="text-base font-semibold text-fg">Your dashboards</h2>
          <button type="button" disabled={busy !== null} onClick={() => void create('blank', { name: 'Untitled dashboard', description: '', widgets: [] })} className="inline-flex items-center gap-1.5 rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Blank dashboard
          </button>
        </div>
        {items === null ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState title="No dashboards yet" description="Pick a template below to get a ready-made dashboard in one click." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((d) => (
              <li key={d.id} className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-2">
                <button type="button" onClick={() => navigate(`/dashboards/${d.id}`)} className="text-left">
                  <span className="block text-sm font-semibold text-fg">{d.name}</span>
                  <span className="block text-xs text-fg-muted">{d.widgets.length} widget{d.widgets.length === 1 ? '' : 's'} · updated {new Date(d.updatedAt).toLocaleDateString()}</span>
                </button>
                <div className="flex justify-end">
                  <button type="button" aria-label={`Delete ${d.name}`} onClick={() => void remove(d)} className="p-2 text-fg-muted hover:text-danger"><Trash2 className="w-4 h-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="templates" className="space-y-3">
        <h2 id="templates" className="text-base font-semibold text-fg">Templates</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {DASHBOARD_TEMPLATES.map((t) => (
            <li key={t.id} className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent-soft text-accent-text flex items-center justify-center shrink-0"><LayoutGrid className="w-4 h-4" /></div>
                <div>
                  <h3 className="text-sm font-semibold text-fg">{t.name}</h3>
                  <p className="text-xs text-fg-muted">{t.description}</p>
                  <p className="text-[11px] text-fg-subtle mt-1">Needs: {t.needs.map((n) => (n === 'ga4' ? 'Google Analytics' : 'Search Console')).join(' + ')}</p>
                </div>
              </div>
              <button type="button" disabled={busy !== null} onClick={() => void create(t.id, templateToInput(t))} className="self-start rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">
                {busy === t.id ? 'Creating…' : 'Use this template'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
