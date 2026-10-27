import { getServerConfig, normalizeMetaAdAccountId } from '../config.js';
import type { ReportContext } from '../reports/types.js';
import type { ProjectDoc } from './firestore.js';
import { getVault } from './vault.js';

/** The report context for one person and one project: their own Google connection and the project's chosen property, site and ad account. */
export function buildReportContext(uid: string, project: ProjectDoc | undefined): ReportContext {
  return {
    getAccessToken: () => getVault().getAccessToken(uid, 'google'),
    ga4PropertyId: project?.ga4PropertyId ?? undefined,
    ga4PropertyName: project?.ga4PropertyName ?? project?.ga4PropertyId ?? undefined,
    searchConsoleSite: project?.searchConsoleSite ?? undefined,
    ...(project ? { project } : {}),
    getMeta: async () => {
      const cfg = getServerConfig();
      const accountId = normalizeMetaAdAccountId(project?.metaAdAccountId ?? undefined);
      if (!cfg.vaultReady || !accountId) return null;
      try {
        const accessToken = await getVault().getAccessToken(uid, 'meta');
        return { accessToken, appSecret: cfg.metaAppSecret, accountId };
      } catch {
        return null;
      }
    },
  };
}
