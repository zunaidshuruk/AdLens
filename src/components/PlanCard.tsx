import { Check, CreditCard } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type BillingPlanCard, type BillingView } from '../api/client';
import { useAppContext } from '../context/AppContext';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
const money = (p: BillingPlanCard) => (p.priceUsd === 0 && p.priceBdt === 0 ? 'Free' : `USD ${p.priceUsd} / BDT ${p.priceBdt}`);
const STATUS: Record<string, string> = { none: 'Active', active: 'Active', grace: 'Ended, grace period', expired: 'Ended' };

function features(p: BillingPlanCard): string[] {
  const hist = p.features.historyDays === null ? 'All your data history' : `Last ${p.features.historyDays} days of data`;
  return [
    `${p.limits.maxProjects} project${p.limits.maxProjects === 1 ? '' : 's'}`,
    `${p.limits.aiQuestionsPerMonth} AI questions a month`,
    `${p.features.maxMembers} team member${p.features.maxMembers === 1 ? '' : 's'}`,
    `${p.content.maxDashboards} dashboards, ${p.content.maxSavedReports} saved reports per project`,
    p.content.maxAgents > 0 ? `${p.content.maxAgents} AI agents` : 'No AI agents',
    `${p.features.maxMcpKeys} AI-tool key${p.features.maxMcpKeys === 1 ? '' : 's'}`,
    p.features.emailSummaries ? 'Weekly email summary and alerts' : 'No email summaries',
    hist,
  ];
}

function Bar({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-fg"><span>{label}</span><span>{used} of {max}</span></div>
      <div className="h-2 rounded-full bg-fill-2 overflow-hidden" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
        <div className={`h-full ${pct >= 90 ? 'bg-warning' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Settings → Workspace: the current plan, usage against it, every plan side by side, and a way to ask for an upgrade. */
export const PlanCard: React.FC = () => {
  const { activeWorkspace } = useAppContext();
  const wsId = activeWorkspace?.id;
  const [v, setV] = useState<BillingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!wsId) return;
    try { setV(await apiClient.billingGet(wsId)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load your plan.'); }
  }, [wsId]);
  useEffect(() => { void load(); }, [load]);

  const ask = async (plan: string) => {
    if (!wsId) return;
    setBusy(plan); setError(null); setNotice(null);
    try {
      await apiClient.billingRequestUpgrade({ workspaceId: wsId, plan, message });
      setNotice('Thank you. We received your request and will contact you with payment details.');
      setMessage('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the request.'); } finally { setBusy(null); }
  };

  if (!wsId) return null;
  const cur = v?.current;
  const card = 'rounded-2xl border border-line bg-surface p-5 space-y-4';

  return (
    <section className={card} aria-labelledby="plan-heading">
      <div className="flex items-center gap-3">
        <CreditCard className="w-5 h-5 text-accent-text" />
        <div>
          <h2 id="plan-heading" className="text-base font-semibold text-fg">Plan and billing</h2>
          <p className="text-xs text-fg-muted">Your current plan, what you have used, and the plans you can move to.</p>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      {!v && !error && <p className="text-sm text-fg-muted">Loading…</p>}

      {v && cur && (
        <>
          <div className="rounded-xl border border-accent-line bg-accent-soft p-4 space-y-1">
            <div className="text-xs text-fg-muted">Current plan for {v.workspaceName}</div>
            <div className="text-xl font-semibold text-fg">{cur.label}</div>
            <div className="text-sm text-fg">
              {STATUS[cur.status]}{cur.expiresAt ? ` · paid until ${day(cur.expiresAt)}` : ''}
              {cur.status === 'grace' && cur.graceEndsAt ? ` · full access until ${day(cur.graceEndsAt)}, then Free limits apply` : ''}
              {cur.status === 'expired' ? ' · Free limits apply. Upgrade again to restore everything.' : ''}
            </div>
            {cur.plan === 'beta' && <div className="text-xs text-fg-muted">You are on the early-access plan. Thank you for testing AdLens.</div>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Bar label="Projects" used={v.usage.projects} max={cur.limits.maxProjects} />
            <Bar label="AI questions this month" used={v.usage.aiQuestions} max={cur.limits.aiQuestionsPerMonth} />
            <Bar label="Team members" used={v.usage.members} max={cur.features.maxMembers} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">All plans</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {v.plans.map((p) => {
                const isCurrent = p.id === cur.plan;
                const asked = v.openRequest?.plan === p.id;
                const paid = p.priceUsd > 0 || p.priceBdt > 0;
                return (
                  <div key={p.id} className={`rounded-xl border p-4 space-y-3 flex flex-col ${isCurrent ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-fg">{p.label}</div>
                      {isCurrent && <span className="rounded-full bg-accent text-on-accent text-[11px] font-medium px-2 py-0.5">Your current plan</span>}
                    </div>
                    <div className="text-sm text-fg">{money(p)}{paid ? <span className="text-xs text-fg-muted"> a month</span> : null}</div>
                    <ul className="space-y-1.5 flex-1">
                      {features(p).map((f) => <li key={f} className="flex items-start gap-2 text-xs text-fg"><Check className="w-3.5 h-3.5 mt-0.5 text-success shrink-0" />{f}</li>)}
                    </ul>
                    {isCurrent ? <div className="text-xs text-fg-muted">This is your plan now.</div>
                      : !paid ? <div className="text-xs text-fg-muted">The plan you move to when a paid plan ends.</div>
                      : asked ? <div className="text-xs text-fg">Requested on {day(v.openRequest!.createdAt)}. We will be in touch.</div>
                      : v.canRequestUpgrade ? (
                        <button type="button" disabled={busy !== null} onClick={() => void ask(p.id)} className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">
                          {busy === p.id ? 'Sending…' : `Request ${p.label}`}
                        </button>
                      ) : <div className="text-xs text-fg-muted">Ask a workspace owner or admin to upgrade.</div>}
                  </div>
                );
              })}
            </div>
            {v.canRequestUpgrade && (
              <label className="block space-y-1 pt-1">
                <span className="text-xs text-fg-muted">Message with your request (optional)</span>
                <input value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} placeholder="For example: we need 5 team members" className="w-full rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]" />
              </label>
            )}
            <p className="text-xs text-fg-muted">There is no automatic card payment yet. After you request a plan we send you the invoice and payment details, then switch your plan on. {v.refundPolicy}</p>
          </div>

          {v.invoices.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-fg">Payments recorded</h3>
              <ul className="divide-y divide-line text-sm">
                {v.invoices.map((i) => <li key={i.id} className="py-1.5 flex flex-wrap justify-between gap-2 text-fg"><span>{i.number} · {i.plan}</span><span className="text-fg-muted">{i.currency} {i.amount} · {i.periodStart} to {i.periodEnd}</span></li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};
