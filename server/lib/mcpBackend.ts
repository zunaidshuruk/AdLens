import { z } from 'zod';
import { compactReport } from '../../src/utils/aiReportCompactor.js';
import { withDateDefaults } from '../../src/utils/aiTools.js';
import { GoogleApiError } from './google.js';
import { MetaApiError } from './meta.js';
import { getFirestoreStore, type ProjectDoc } from './firestore.js';
import { McpToolError, type McpBackend, type ProjectSummary, type ReportSummary, type RunReportArgs } from './mcpProtocol.js';
import type { McpPrincipal } from './mcpCredentials.js';
import { buildReportContext } from './reportContext.js';
import { mapVaultError } from './vault.js';
import '../reports/ga4Reports.js';
import '../reports/exploreReports.js';
import '../reports/intelligenceReports.js';
import { reportRegistry } from '../reports/registry.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Loads a project only if the credential lists it AND its owner is still a member of that workspace right now. */
async function loadAllowedProject(p: McpPrincipal, key: { workspaceId: string; projectId: string }): Promise<ProjectDoc | null> {
  if (!p.projects.some((a) => a.workspaceId === key.workspaceId && a.projectId === key.projectId)) return null;
  const store = getFirestoreStore();
  const ws = await store.getWorkspace(key.workspaceId);
  if (!ws?.members || !Object.prototype.hasOwnProperty.call(ws.members, p.uid)) return null;
  return store.getProject(key.workspaceId, key.projectId);
}

const idOf = (pr: { workspaceId: string; projectId: string }) => `${pr.workspaceId}/${pr.projectId}`;

export const mcpBackend: McpBackend = {
  async listProjects(p): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    for (const a of p.projects) {
      const project = await loadAllowedProject(p, a);
      if (!project) continue;
      out.push({
        project_id: idOf(a),
        name: project.name,
        domain: project.domain,
        google_analytics: Boolean(project.ga4PropertyId),
        search_console: Boolean(project.searchConsoleSite),
        meta_ads: Boolean(project.metaAdAccountId),
      });
    }
    return out;
  },

  async listReports(_p, source): Promise<ReportSummary[]> {
    return reportRegistry
      .list()
      .filter((r) => !source || r.source === source)
      .map((r) => ({ report_id: r.id, title: r.title, description: r.description, source: r.source, arguments: r.input }));
  },

  async runReport(p, a: RunReportArgs): Promise<string> {
    if (!ISO.test(a.start_date) || !ISO.test(a.end_date) || a.start_date > a.end_date) throw new McpToolError('start_date and end_date must be YYYY-MM-DD dates, with start_date on or before end_date.');
    if ((a.compare_start_date || a.compare_end_date) && !(a.compare_start_date && a.compare_end_date && ISO.test(a.compare_start_date) && ISO.test(a.compare_end_date) && a.compare_start_date <= a.compare_end_date)) {
      throw new McpToolError('compare_start_date and compare_end_date must both be valid YYYY-MM-DD dates.');
    }
    const def = reportRegistry.get(a.report_id);
    if (!def) throw new McpToolError(`Unknown report_id. Use list_reports to see what is available.`);

    let access = p.projects[0];
    if (a.project_id) {
      const [workspaceId, projectId, ...rest] = a.project_id.split('/');
      const found = rest.length === 0 && p.projects.find((x) => x.workspaceId === workspaceId && x.projectId === projectId);
      if (!found) throw new McpToolError('That project_id is not available to this connection. Use list_projects.');
      access = found;
    } else if (p.projects.length !== 1) {
      throw new McpToolError('Several projects are available. Pass project_id (see list_projects).');
    }
    const project = access ? await loadAllowedProject(p, access) : null;
    if (!project) throw new McpToolError('That project is no longer available to this connection.');

    const parsed = (def.input as z.ZodType).safeParse(
      withDateDefaults(a.args, { startDate: a.start_date, endDate: a.end_date, ...(a.compare_start_date && a.compare_end_date ? { compareStartDate: a.compare_start_date, compareEndDate: a.compare_end_date } : {}) }),
    );
    if (!parsed.success) throw new McpToolError(`Invalid arguments: ${parsed.error.issues[0]?.message ?? 'check list_reports for the arguments this report accepts.'}`);

    try {
      const result = await def.run(buildReportContext(p.uid, project), parsed.data);
      const c = compactReport(result as never, { maxTokens: 6000, maxRows: 100, maxStringLength: 120 });
      return `${def.title} — ${a.start_date} to ${a.end_date}${c.truncated ? ' (shortened to fit)' : ''}\n\n${c.text}`;
    } catch (e) {
      const vault = mapVaultError(e);
      if (vault) throw new McpToolError(vault.code === 'VAULT_NOT_CONNECTED' ? 'The owner has not connected Google in AdLens.' : vault.message);
      if (e instanceof GoogleApiError || e instanceof MetaApiError) throw new McpToolError(e.message);
      throw e;
    }
  },
};
