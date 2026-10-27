/**
 * Sends the weekly summaries and traffic spike/drop alerts that are due (Sprint 18).
 * Called once a day by a scheduler through POST /api/ops/run-digests. Safe to call more often: nothing is sent twice
 * (a weekly summary needs 7 days since the last one; an alert is sent once per unusual day).
 *
 * Dates are UTC and end yesterday, so a day is complete when it is reported.
 */
import type { GA4Overview, GA4TrafficPoint } from '../../src/types/index.js';
import { detectLatestAnomaly } from './anomaly.js';
import { buildAnomalyAlert, buildWeeklyDigest, type DigestMetric } from './digest.js';
import type { DigestStore, DigestSubscription } from './digestStore.js';
import type { MailMessage, MailResult } from './mailer.js';

const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface DigestData { overview: GA4Overview | null; series: GA4TrafficPoint[] }

export interface RunDigestsDeps {
  store: DigestStore;
  /** Returns null when the subscription is no longer valid (project deleted, person removed). */
  loadData(sub: DigestSubscription, range: { start7: string; end: string; start29: string }): Promise<DigestData | null>;
  /** False when the workspace's plan does not include summaries. The subscription is kept, just not served. */
  allowed?(sub: DigestSubscription): Promise<boolean>;
  projectInfo(sub: DigestSubscription): Promise<{ name: string; domain: string } | null>;
  send(msg: MailMessage): Promise<MailResult>;
  appUrl: string;
  now?: Date;
}

export interface RunDigestsSummary { checked: number; weeklySent: number; alertsSent: number; skipped: number; failed: number; removed: number }

function metricsFrom(o: GA4Overview): DigestMetric[] {
  const m = (label: string, x: GA4Overview['sessions'], unit?: DigestMetric['unit']): DigestMetric => ({ label, value: x.value, previousValue: x.previousValue, changePercent: Number.isFinite(x.changePercent) ? x.changePercent : null, unit });
  return [m('Sessions', o.sessions), m('Users', o.users), m('Engagement rate', o.engagementRate, 'percent'), m('Key events', o.conversions)];
}

export async function runDigests(deps: RunDigestsDeps): Promise<RunDigestsSummary> {
  const now = deps.now ?? new Date();
  const end = iso(new Date(now.getTime() - DAY));
  const range = { end, start7: iso(new Date(now.getTime() - 7 * DAY)), start29: iso(new Date(now.getTime() - 29 * DAY)) };
  const summary: RunDigestsSummary = { checked: 0, weeklySent: 0, alertsSent: 0, skipped: 0, failed: 0, removed: 0 };

  for (const sub of await deps.store.listAll()) {
    summary.checked++;
    try {
      const weeklyDue = sub.weekly && (!sub.lastWeeklyAt || now.getTime() - Date.parse(sub.lastWeeklyAt) >= 7 * DAY - 60 * 60 * 1000);
      if (!weeklyDue && !sub.alerts) { summary.skipped++; continue; }
      if (deps.allowed && !(await deps.allowed(sub))) { summary.skipped++; continue; }
      const info = await deps.projectInfo(sub);
      if (!info) { await deps.store.delete(sub.id); summary.removed++; continue; }
      const data = await deps.loadData(sub, range);
      if (!data) { await deps.store.delete(sub.id); summary.removed++; continue; }

      const anomaly = sub.alerts ? detectLatestAnomaly(data.series.map((p) => ({ date: p.date, value: p.sessions }))) : null;
      const fresh = anomaly && anomaly.date !== sub.lastAlertDate ? anomaly : null;
      const next = { ...sub };
      let did = false;

      if (weeklyDue && data.overview) {
        const mail = buildWeeklyDigest({ projectName: info.name, domain: info.domain, startDate: range.start7, endDate: range.end, metrics: metricsFrom(data.overview), anomaly: fresh, appUrl: deps.appUrl });
        const r = await deps.send({ to: sub.email, ...mail });
        if (r.ok) { next.lastWeeklyAt = now.toISOString(); summary.weeklySent++; did = true; if (fresh) next.lastAlertDate = fresh.date; } else summary.failed++;
      }
      if (fresh && next.lastAlertDate !== fresh.date) {
        const mail = buildAnomalyAlert({ projectName: info.name, domain: info.domain, appUrl: deps.appUrl, anomaly: fresh });
        const r = await deps.send({ to: sub.email, ...mail });
        if (r.ok) { next.lastAlertDate = fresh.date; summary.alertsSent++; did = true; } else summary.failed++;
      }
      if (did) await deps.store.put(next); else summary.skipped++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}
