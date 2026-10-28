/**
 * Checks every alert rule and sends what is due (Sprint 33). Runs inside the daily job (POST /api/ops/run-digests).
 * Safe to call more than once a day: a rule is checked at most once per UTC day, and a rule that stays tripped is announced once
 * (then again after 7 days if it is still tripped). Dates are UTC and end yesterday, so a day is complete when it is judged.
 */
import { alertSentence, evaluate, RENOTIFY_MS, type AlertStore, type Evaluation, type StoredAlertRule } from './alertRules.js';
import { escapeHtml } from './digest.js';
import { previousPeriod } from './dateMath.js';
import type { MailMessage, MailResult } from './mailer.js';

const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface RuleContext { projectName: string; emailAllowed: boolean; metricLabel: string }

export interface RunAlertsDeps {
  store: AlertStore;
  /** Null when the project or the person who made the rule is gone: the rule is then removed. */
  context(rule: StoredAlertRule): Promise<RuleContext | null>;
  /** The rule's number for the dates. Null when there is no data. May throw. */
  measure(rule: StoredAlertRule, range: { startDate: string; endDate: string }): Promise<number | null>;
  /** The rule's webhook address, or null when none is set. */
  webhookUrl(rule: StoredAlertRule): string | null;
  sendMail(msg: MailMessage): Promise<MailResult>;
  postWebhook(url: string, payload: Record<string, unknown>): Promise<boolean>;
  appUrl: string;
  now?: Date;
  /** Check even if the rule was already checked today. */
  force?: boolean;
}

export interface RunAlertsSummary { checked: number; triggered: number; notified: number; skipped: number; errors: number; removed: number }

export interface Checked { current: number | null; previous: number | null; evaluation: Evaluation; sentence: string | null }

/** Measures and judges one rule. Does not send or save anything. */
export async function checkRule(rule: StoredAlertRule, ctx: RuleContext, deps: Pick<RunAlertsDeps, 'measure'>, now: Date): Promise<Checked> {
  const end = iso(new Date(now.getTime() - DAY));
  const start = iso(new Date(now.getTime() - rule.windowDays * DAY));
  const current = await deps.measure(rule, { startDate: start, endDate: end });
  const pct = rule.condition === 'rises_pct' || rule.condition === 'falls_pct';
  const previous = pct && current !== null ? await deps.measure(rule, previousPeriod(start, end)) : null;
  const evaluation = evaluate(rule.condition, rule.threshold, current, previous);
  const sentence = current === null ? null : alertSentence(rule, ctx.metricLabel, current, evaluation, previous);
  return { current, previous, evaluation, sentence };
}

export function buildAlertEmail(rule: StoredAlertRule, projectName: string, sentence: string, appUrl: string, test = false): MailMessage & { to: string } {
  const subject = `${test ? 'Test: ' : 'Alert: '}${rule.name} (${projectName})`;
  const text = [test ? `This is a test of your alert “${rule.name}”.` : `Your alert “${rule.name}” was triggered.`, sentence, `Project: ${projectName}`, `Open AdLens: ${appUrl}`, 'You can change or switch off this alert under Alerts in AdLens.'].join('\n\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17181b"><h2 style="margin:0 0 4px">${escapeHtml(test ? `Test: ${rule.name}` : rule.name)}</h2><p style="margin:0 0 16px;color:#666">${escapeHtml(projectName)}</p><p>${escapeHtml(sentence)}</p><p><a href="${escapeHtml(appUrl)}">Open AdLens</a></p><p style="color:#888;font-size:12px">You can change or switch off this alert under Alerts in AdLens.</p></div>`;
  return { to: '', subject, text, html };
}

export function webhookPayload(rule: StoredAlertRule, projectName: string, sentence: string, c: Checked, appUrl: string, test = false): Record<string, unknown> {
  const text = `${test ? 'Test of alert' : 'Alert'} “${rule.name}” (${projectName}): ${sentence}`;
  // "text" is read by Slack and many tools, "content" by Discord; "alert" carries the details for anything custom.
  return {
    text, content: text,
    alert: { name: rule.name, project: projectName, metric: rule.metric, source: rule.source, value: c.current, previousValue: c.previous, changePercent: c.evaluation.changePercent, condition: rule.condition, threshold: rule.threshold, windowDays: rule.windowDays, test, url: appUrl },
  };
}

/** Sends a message to every channel the rule has. Returns how many channels accepted it. */
export async function deliver(rule: StoredAlertRule, ctx: RuleContext, checked: Checked, deps: RunAlertsDeps, sentence: string, test = false): Promise<number> {
  let ok = 0;
  if (rule.emails.length > 0 && ctx.emailAllowed) {
    const built = buildAlertEmail(rule, ctx.projectName, sentence, deps.appUrl, test);
    for (const to of rule.emails) {
      const r = await deps.sendMail({ ...built, to });
      if (r.ok) ok += 1;
    }
  }
  const url = deps.webhookUrl(rule);
  if (url && (await deps.postWebhook(url, webhookPayload(rule, ctx.projectName, sentence, checked, deps.appUrl, test)))) ok += 1;
  return ok;
}

export async function runAlertRules(deps: RunAlertsDeps): Promise<RunAlertsSummary> {
  const now = deps.now ?? new Date();
  const today = iso(now);
  const summary: RunAlertsSummary = { checked: 0, triggered: 0, notified: 0, skipped: 0, errors: 0, removed: 0 };
  for (const rule of await deps.store.listAll()) {
    try {
      if (!rule.enabled) { summary.skipped++; continue; }
      if (!deps.force && rule.lastCheckedAt && rule.lastCheckedAt.slice(0, 10) === today) { summary.skipped++; continue; }
      const ctx = await deps.context(rule);
      if (!ctx) { await deps.store.delete(rule.id); summary.removed++; continue; }
      summary.checked++;
      const next: StoredAlertRule = { ...rule, lastCheckedAt: now.toISOString() };
      let checked: Checked;
      try {
        checked = await checkRule(rule, ctx, deps, now);
      } catch {
        // Keep the reason short and free of anything from the other service.
        next.status = 'error';
        next.lastError = 'Could not read the data for this alert. Check the connection.';
        await deps.store.put(next);
        summary.errors++;
        continue;
      }
      delete next.lastError;
      next.lastValue = checked.current;
      if (checked.current === null) {
        next.status = 'nodata';
        next.lastMessage = 'No data for the last period.';
      } else if (!checked.evaluation.triggered) {
        next.status = 'ok';
        next.lastMessage = checked.sentence ?? undefined;
      } else {
        summary.triggered++;
        next.status = 'triggered';
        next.lastMessage = checked.sentence ?? undefined;
        next.lastTriggeredAt = now.toISOString();
        const due = rule.status !== 'triggered' || !rule.lastNotifiedAt || now.getTime() - Date.parse(rule.lastNotifiedAt) >= RENOTIFY_MS;
        if (due && checked.sentence && (await deliver(rule, ctx, checked, deps, checked.sentence)) > 0) {
          next.lastNotifiedAt = now.toISOString();
          summary.notified++;
        }
      }
      await deps.store.put(next);
    } catch {
      summary.errors++;
    }
  }
  return summary;
}
