import type { GA4Overview, GA4TrafficPoint } from '../../src/types/index.js';
import '../reports/ga4Reports.js';
import { reportRegistry } from '../reports/registry.js';
import { getPlanFeatures } from '../config/plans.js';
import { getServerConfig } from '../config.js';
import { previousPeriod } from './dateMath.js';
import type { RunDigestsDeps } from './digestRunner.js';
import { getFirestoreStore } from './firestore.js';
import { sendMail } from './mailer.js';
import { buildReportContext } from './reportContext.js';
import { getDigestStore, type DigestSubscription } from './digestStore.js';

/** True while the person is still a member of the workspace and the project still exists. */
async function stillValid(sub: DigestSubscription) {
  const store = getFirestoreStore();
  const ws = await store.getWorkspace(sub.workspaceId);
  if (!ws || !ws.members || !Object.prototype.hasOwnProperty.call(ws.members, sub.uid)) return null;
  const project = await store.getProject(sub.workspaceId, sub.projectId);
  return project ?? null;
}

export function productionDigestDeps(now?: Date): RunDigestsDeps {
  return {
    store: getDigestStore(),
    appUrl: getServerConfig().appBaseUrl,
    now,
    send: (m) => sendMail(m),
    // A workspace whose plan no longer includes summaries is skipped, not unsubscribed: upgrading brings them back.
    async allowed(sub) {
      const ws = await getFirestoreStore().getWorkspace(sub.workspaceId);
      return !ws || getPlanFeatures(ws.plan).emailSummaries;
    },
    async projectInfo(sub) {
      const p = await stillValid(sub);
      return p ? { name: p.name, domain: p.domain } : null;
    },
    async loadData(sub, range) {
      const project = await stillValid(sub);
      if (!project || !project.ga4PropertyId) return null;
      const ctx = buildReportContext(sub.uid, project);
      const prev = previousPeriod(range.start7, range.end);
      const overviewDef = reportRegistry.get('ga4.overview');
      const seriesDef = reportRegistry.get('ga4.trafficOverTime');
      if (!overviewDef || !seriesDef) return null;
      const [overview, series] = await Promise.all([
        overviewDef.run(ctx, overviewDef.input.parse({ startDate: range.start7, endDate: range.end, compareStartDate: prev.startDate, compareEndDate: prev.endDate })) as Promise<GA4Overview>,
        seriesDef.run(ctx, seriesDef.input.parse({ startDate: range.start29, endDate: range.end })) as Promise<GA4TrafficPoint[]>,
      ]);
      return { overview, series };
    },
  };
}
