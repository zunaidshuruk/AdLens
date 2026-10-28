import '../reports/exploreReports.js';
import { getServerConfig } from '../config.js';
import { getPlanFeatures } from '../config/plans.js';
import { metaExploreReport, ga4ExploreReport, searchConsoleExploreReport } from '../reports/exploreReports.js';
import type { RunAlertsDeps } from './alertRunner.js';
import { getAlertStore, metricLabel, queryFor, type StoredAlertRule } from './alertRules.js';
import { dataExploreInputSchema, getDataset, runDataQuery } from './datasets.js';
import { ga4ExploreInputSchema, metaExploreInputSchema, scExploreInputSchema, type ExploreResult } from './exploreSpec.js';
import { getFirestoreStore } from './firestore.js';
import { sendMail } from './mailer.js';
import { getProjectDocsStore } from './projectDocs.js';
import { buildReportContext } from './reportContext.js';
import { guardedRequest } from './ssrfGuard.js';
import { openAgentSecret } from './tokenVault.js';
import { getAgentKeyring } from './vault.js';

function numberFrom(result: ExploreResult, metric: string): number | null {
  const v = result.totals?.[metric] ?? result.rows[0]?.[metric];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Runs the rule's query with the person's own connections. Never touches anything but read-only reports. */
export async function measureRule(rule: StoredAlertRule, range: { startDate: string; endDate: string }): Promise<number | null> {
  const store = getFirestoreStore();
  const project = await store.getProject(rule.workspaceId, rule.projectId);
  if (!project) throw new Error('project gone');
  const query = queryFor(rule, range);
  if (rule.source === 'data') {
    const ds = await getDataset(getProjectDocsStore(), rule.workspaceId, rule.projectId, rule.datasetId ?? '');
    return numberFrom(runDataQuery(ds, dataExploreInputSchema.parse(query)), rule.metric);
  }
  const ctx = buildReportContext(rule.createdBy, project);
  const result = rule.source === 'ga4' ? await ga4ExploreReport.run(ctx, ga4ExploreInputSchema.parse(query))
    : rule.source === 'meta' ? await metaExploreReport.run(ctx, metaExploreInputSchema.parse(query))
    : await searchConsoleExploreReport.run(ctx, scExploreInputSchema.parse(query));
  return numberFrom(result, rule.metric);
}

export async function postJson(url: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await guardedRequest(new URL(url), { method: 'POST', body: JSON.stringify(payload), timeoutMs: 10_000, maxResponseBytes: 50_000 });
    return res.status >= 200 && res.status < 300;
  } catch { return false; }
}

export async function labelFor(rule: StoredAlertRule): Promise<string> {
  if (rule.source !== 'data') return metricLabel(rule);
  try {
    const ds = await getDataset(getProjectDocsStore(), rule.workspaceId, rule.projectId, rule.datasetId ?? '');
    const col = ds.columns.find((c) => c.key === rule.metric);
    const base = rule.metric === '__rows' ? 'Number of rows' : col?.label ?? 'Value';
    const agg = rule.aggregate && rule.aggregate !== 'sum' && rule.metric !== '__rows' ? `${rule.aggregate} of ` : '';
    return `${agg}${base}`;
  } catch { return 'Value'; }
}

export function productionAlertDeps(now?: Date, force?: boolean): RunAlertsDeps {
  return {
    store: getAlertStore(),
    appUrl: getServerConfig().appBaseUrl,
    now, force,
    sendMail: (m) => sendMail(m),
    postWebhook: postJson,
    measure: measureRule,
    webhookUrl(rule) {
      if (!rule.sealedWebhook) return null;
      try { return openAgentSecret(rule.sealedWebhook, rule.createdBy, rule.id, getAgentKeyring()); } catch { return null; }
    },
    async context(rule) {
      const fs = getFirestoreStore();
      const ws = await fs.getWorkspace(rule.workspaceId);
      if (!ws || !ws.members || !Object.prototype.hasOwnProperty.call(ws.members, rule.createdBy)) return null;
      const project = await fs.getProject(rule.workspaceId, rule.projectId);
      if (!project) return null;
      return { projectName: project.name, emailAllowed: getPlanFeatures(ws.plan).emailSummaries, metricLabel: await labelFor(rule) };
    },
  };
}
