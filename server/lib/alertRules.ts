/**
 * Alert rules (Sprint 33): "tell me when this number crosses a line".
 * A rule watches one number (a metric from GA4, Search Console, Meta Ads or an uploaded table, optionally narrowed by one filter)
 * over the last 1, 7 or 28 complete days, and sends an email and/or a webhook (Slack, Discord, anything that accepts JSON) when it trips.
 * This file: types, validation, the plain-language wording and the stored form. Pure apart from the store.
 */
import { z } from 'zod';
import { dataExploreInputSchema } from './datasets.js';
import { META_METRICS, SC_METRICS, GA4_METRICS, ga4ExploreInputSchema, metaExploreInputSchema, scExploreInputSchema, fieldLabel } from './exploreSpec.js';
import { getAdminFirestore } from './firestore.js';
import { validateOutboundUrl } from './ssrfGuard.js';

export const ALERT_SOURCES = ['ga4', 'search_console', 'meta', 'data'] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];
export const CONDITIONS = ['above', 'below', 'rises_pct', 'falls_pct'] as const;
export type AlertCondition = (typeof CONDITIONS)[number];
export const WINDOWS = [1, 7, 28] as const;
export const MAX_EMAILS = 3;
export const RENOTIFY_MS = 7 * 24 * 60 * 60 * 1000;

const filterSchema = z.object({
  field: z.string().min(1).max(60),
  op: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'startsWith']),
  value: z.string().trim().min(1).max(200),
});

export const alertInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the alert a name').max(80),
  source: z.enum(ALERT_SOURCES),
  metric: z.string().min(1).max(40),
  filter: filterSchema.optional(),
  /** Uploaded tables only. */
  datasetId: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
  aggregate: z.enum(['sum', 'avg', 'min', 'max', 'count']).optional(),
  condition: z.enum(CONDITIONS),
  threshold: z.number().finite().min(-1e12).max(1e12),
  windowDays: z.union([z.literal(1), z.literal(7), z.literal(28)]),
  emails: z.array(z.string().trim().toLowerCase().email().max(120)).max(MAX_EMAILS).default([]),
  /** Where to POST a JSON message (Slack incoming webhook, Discord webhook, Zapier…). https only. */
  webhookUrl: z.string().trim().max(600).optional(),
  enabled: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if ((v.condition === 'rises_pct' || v.condition === 'falls_pct') && v.threshold <= 0) {
    ctx.addIssue({ code: 'custom', path: ['threshold'], message: 'For a percent change, enter a number above 0 (for example 20 for 20%).' });
  }
  if (v.source === 'data' && !v.datasetId) ctx.addIssue({ code: 'custom', path: ['datasetId'], message: 'Choose an uploaded table.' });
  if (v.source !== 'data' && v.datasetId) ctx.addIssue({ code: 'custom', path: ['datasetId'], message: 'Only uploaded tables use a table.' });
  if (v.emails.length === 0 && !v.webhookUrl) ctx.addIssue({ code: 'custom', path: ['emails'], message: 'Choose where to send it: an email address or a webhook address.' });
  if (v.webhookUrl) {
    try {
      const u = validateOutboundUrl(v.webhookUrl, { allowedPorts: [443] });
      if (u.protocol !== 'https:') throw new Error('https');
    } catch {
      ctx.addIssue({ code: 'custom', path: ['webhookUrl'], message: 'The webhook address must start with https:// and be reachable on the public internet.' });
    }
  }
  // The number and the filter must be ones this source offers. Checked by building the real query with placeholder dates.
  const problem = queryProblem(v);
  if (problem) ctx.addIssue({ code: 'custom', path: ['metric'], message: problem });
});
export type AlertInput = z.infer<typeof alertInputSchema>;

const PLACEHOLDER = { startDate: '2026-01-01', endDate: '2026-01-07' };

/** The query a rule runs: one number, no breakdown, over the given dates. */
export function queryFor(rule: Pick<AlertInput, 'source' | 'metric' | 'filter' | 'datasetId' | 'aggregate'>, range: { startDate: string; endDate: string }): Record<string, unknown> {
  const base = { ...range, dimensions: [], metrics: [rule.metric], filters: rule.filter ? [rule.filter] : [], limit: 1 };
  return rule.source === 'data' ? { ...base, datasetId: rule.datasetId, aggregate: rule.aggregate ?? 'sum' } : base;
}

function queryProblem(rule: Pick<AlertInput, 'source' | 'metric' | 'filter' | 'datasetId' | 'aggregate'>): string | null {
  const schema = rule.source === 'ga4' ? ga4ExploreInputSchema : rule.source === 'meta' ? metaExploreInputSchema : rule.source === 'data' ? dataExploreInputSchema : scExploreInputSchema;
  const r = schema.safeParse(queryFor(rule, PLACEHOLDER));
  return r.success ? null : r.error.issues[0]?.message || 'That number is not available.';
}

export const metricLabel = (rule: Pick<StoredAlertRule, 'source' | 'metric'>, datasetColumnLabel?: string): string =>
  rule.source === 'data' ? datasetColumnLabel ?? (rule.metric === '__rows' ? 'Number of rows' : 'Column') : fieldLabel(rule.source, rule.metric);

export const METRIC_TYPES: Record<Exclude<AlertSource, 'data'>, Map<string, string>> = {
  ga4: new Map(GA4_METRICS.map((m) => [m.key, m.type])),
  search_console: new Map(SC_METRICS.map((m) => [m.key, m.type])),
  meta: new Map(META_METRICS.map((m) => [m.key, m.type])),
};

// ---------------------------------------------------------------------------
// Checking one rule
// ---------------------------------------------------------------------------

export interface Evaluation {
  triggered: boolean;
  /** Percent change, for the two percent conditions (null when it cannot be worked out). */
  changePercent: number | null;
}

export function evaluate(condition: AlertCondition, threshold: number, current: number | null, previous: number | null): Evaluation {
  if (current === null || !Number.isFinite(current)) return { triggered: false, changePercent: null };
  if (condition === 'above') return { triggered: current > threshold, changePercent: null };
  if (condition === 'below') return { triggered: current < threshold, changePercent: null };
  if (previous === null || !Number.isFinite(previous) || previous === 0) return { triggered: false, changePercent: null };
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return { triggered: condition === 'rises_pct' ? pct >= threshold : pct <= -threshold, changePercent: Number(pct.toFixed(1)) };
}

const nf = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : Number(n.toFixed(2)).toLocaleString('en-US'));
const windowText = (d: number) => (d === 1 ? 'yesterday' : `the last ${d} days`);

export function conditionText(condition: AlertCondition, threshold: number): string {
  switch (condition) {
    case 'above': return `goes above ${nf(threshold)}`;
    case 'below': return `drops below ${nf(threshold)}`;
    case 'rises_pct': return `rises by ${nf(threshold)}% or more compared with the period before`;
    default: return `falls by ${nf(threshold)}% or more compared with the period before`;
  }
}

/** One plain sentence for the email, Slack message and the screen. */
export function alertSentence(rule: Pick<StoredAlertRule, 'name' | 'condition' | 'threshold' | 'windowDays'>, label: string, current: number, ev: Evaluation, previous: number | null): string {
  const base = `${label} was ${nf(current)} over ${windowText(rule.windowDays)}`;
  if (rule.condition === 'above') return `${base}, above your limit of ${nf(rule.threshold)}.`;
  if (rule.condition === 'below') return `${base}, below your limit of ${nf(rule.threshold)}.`;
  const dir = rule.condition === 'rises_pct' ? 'up' : 'down';
  return `${base}, ${dir} ${nf(Math.abs(ev.changePercent ?? 0))}% from ${previous === null ? 'the period before' : nf(previous)}.`;
}

// ---------------------------------------------------------------------------
// Stored form
// ---------------------------------------------------------------------------

export type RuleStatus = 'new' | 'ok' | 'triggered' | 'nodata' | 'error';

export interface StoredAlertRule extends Omit<AlertInput, 'webhookUrl' | 'emails'> {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  emails: string[];
  /** The webhook address, sealed with the server key. Never sent to the browser. */
  sealedWebhook?: string;
  /** Only the host, so people can tell which webhook is set (for example hooks.slack.com). */
  webhookHost?: string;
  status: RuleStatus;
  lastCheckedAt?: string;
  lastValue?: number | null;
  lastMessage?: string;
  lastTriggeredAt?: string;
  lastNotifiedAt?: string;
  lastError?: string;
}

export type PublicAlertRule = Omit<StoredAlertRule, 'sealedWebhook'>;
export const publicRule = (r: StoredAlertRule): PublicAlertRule => { const { sealedWebhook: _s, ...rest } = r; return rest; };

export interface AlertStore {
  listAll(): Promise<StoredAlertRule[]>;
  listForProject(workspaceId: string, projectId: string): Promise<StoredAlertRule[]>;
  get(id: string): Promise<StoredAlertRule | null>;
  put(rule: StoredAlertRule): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export function createInMemoryAlertStore(): AlertStore {
  const map = new Map<string, StoredAlertRule>();
  return {
    async listAll() { return [...map.values()].map((r) => structuredClone(r)); },
    async listForProject(ws, p) { return [...map.values()].filter((r) => r.workspaceId === ws && r.projectId === p).map((r) => structuredClone(r)); },
    async get(id) { const r = map.get(id); return r ? structuredClone(r) : null; },
    async put(r) { map.set(r.id, structuredClone(r)); },
    async delete(id) { return map.delete(id); },
  };
}

const col = () => getAdminFirestore().collection('alertRules');
const firestoreAlertStore: AlertStore = {
  async listAll() { return (await col().get()).docs.map((d) => d.data() as StoredAlertRule); },
  async listForProject(ws, p) { return (await col().where('workspaceId', '==', ws).where('projectId', '==', p).get()).docs.map((d) => d.data() as StoredAlertRule); },
  async get(id) { const s = await col().doc(id).get(); return s.exists ? (s.data() as StoredAlertRule) : null; },
  async put(r) { await col().doc(r.id).set(r); },
  async delete(id) { const ref = col().doc(id); const s = await ref.get(); if (!s.exists) return false; await ref.delete(); return true; },
};

let override: AlertStore | null = null;
export function setTestAlertStore(s: AlertStore | null): void { override = s; }
export function getAlertStore(): AlertStore { return override ?? firestoreAlertStore; }
