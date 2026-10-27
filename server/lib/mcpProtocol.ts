/**
 * Model Context Protocol server over Streamable HTTP, read-only (Sprint 17).
 * This is the JSON-RPC part: it knows nothing about Express or Firestore, only about a `McpBackend`, so it can be tested directly.
 * AdLens answers every request with a single JSON response (no streaming, no server-initiated messages).
 */
import type { McpPrincipal } from './mcpCredentials.js';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SERVER_INFO = { name: 'adlens', title: 'AdLens', version: '1.0.0' };

export class McpToolError extends Error {}

export interface ProjectSummary {
  project_id: string;
  name: string;
  domain: string;
  google_analytics: boolean;
  search_console: boolean;
  meta_ads: boolean;
}
export interface ReportSummary {
  report_id: string;
  title: string;
  description: string;
  source: string;
  arguments: Record<string, unknown>;
}
export interface RunReportArgs {
  project_id?: string;
  report_id: string;
  start_date: string;
  end_date: string;
  compare_start_date?: string;
  compare_end_date?: string;
  args?: Record<string, unknown>;
}

export interface McpBackend {
  listProjects(p: McpPrincipal): Promise<ProjectSummary[]>;
  listReports(p: McpPrincipal, source?: string): Promise<ReportSummary[]>;
  /** Returns the report result as text for the model. Throws McpToolError with a message safe to show. */
  runReport(p: McpPrincipal, a: RunReportArgs): Promise<string>;
}

export const TOOLS = [
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'Lists the AdLens projects this connection may read, with which data sources (Google Analytics 4, Search Console, Meta Ads) each has. Call this first to get a project_id.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_reports',
    title: 'List reports',
    description: 'Lists the reports that can be run, with what each one answers and the extra arguments it accepts. Optionally filter by source: ga4, search_console, meta or combined.',
    inputSchema: { type: 'object', properties: { source: { type: 'string', enum: ['ga4', 'search_console', 'meta', 'combined'] } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'run_report',
    title: 'Run a report',
    description: 'Runs one report for a date range and returns the numbers. Read-only. Use list_reports to find report_id values. Dates are YYYY-MM-DD. Optional compare dates add a comparison period.',
    inputSchema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'For example ga4.overview or searchConsole.opportunities.' },
        project_id: { type: 'string', description: 'From list_projects. Optional when only one project is available.' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
        compare_start_date: { type: 'string' },
        compare_end_date: { type: 'string' },
        args: { type: 'object', description: 'Extra arguments for this report (see list_reports).' },
      },
      required: ['report_id', 'start_date', 'end_date'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
] as const;

type Id = string | number | null;
export interface RpcResponse {
  jsonrpc: '2.0';
  id: Id;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });
const err = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = (text: string, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });

const INSTRUCTIONS =
  'AdLens gives read-only access to a person\'s own website analytics (Google Analytics 4), search results (Search Console) and Meta ad performance. ' +
  'Call list_projects, then list_reports, then run_report. Report data comes straight from those services for the dates you ask for; say which dates a figure covers.';

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

async function callTool(name: unknown, args: unknown, principal: McpPrincipal, backend: McpBackend): Promise<unknown> {
  const a = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'list_projects':
        return textResult(JSON.stringify({ projects: await backend.listProjects(principal) }, null, 2));
      case 'list_reports': {
        const source = asString(a.source);
        if (source !== undefined && !['ga4', 'search_console', 'meta', 'combined'].includes(source)) return textResult('source must be one of ga4, search_console, meta, combined.', true);
        return textResult(JSON.stringify({ reports: await backend.listReports(principal, source) }, null, 2));
      }
      case 'run_report': {
        const report_id = asString(a.report_id);
        const start_date = asString(a.start_date);
        const end_date = asString(a.end_date);
        if (!report_id || !start_date || !end_date) return textResult('report_id, start_date and end_date are required.', true);
        const extra = a.args && typeof a.args === 'object' && !Array.isArray(a.args) ? (a.args as Record<string, unknown>) : undefined;
        return textResult(
          await backend.runReport(principal, {
            report_id,
            start_date,
            end_date,
            ...(asString(a.project_id) ? { project_id: asString(a.project_id) } : {}),
            ...(asString(a.compare_start_date) ? { compare_start_date: asString(a.compare_start_date) } : {}),
            ...(asString(a.compare_end_date) ? { compare_end_date: asString(a.compare_end_date) } : {}),
            ...(extra ? { args: extra } : {}),
          }),
        );
      }
      default:
        return null;
    }
  } catch (e) {
    if (e instanceof McpToolError) return textResult(e.message, true);
    return textResult('That could not be completed right now. Please try again.', true);
  }
}

/** Handles one JSON-RPC message. Returns null for notifications (the HTTP layer answers 202). */
export async function handleRpcMessage(message: unknown, principal: McpPrincipal, backend: McpBackend): Promise<RpcResponse | null> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return err(null, -32600, 'Invalid request.');
  const m = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const hasId = m.id !== undefined;
  const id: Id = typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return hasId ? err(id, -32600, 'Invalid request.') : null;
  const params = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>;

  if (!hasId) return null; // notifications (initialized, cancelled, ...) need no reply

  switch (m.method) {
    case 'initialize': {
      const asked = asString(params.protocolVersion);
      const version = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked ?? '') ? (asked as string) : SUPPORTED_PROTOCOL_VERSIONS[0];
      return ok(id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const result = await callTool(params.name, params.arguments, principal, backend);
      return result === null ? err(id, -32602, `Unknown tool: ${String(params.name).slice(0, 60)}`) : ok(id, result);
    }
    default:
      return err(id, -32601, `Method not found: ${m.method.slice(0, 60)}`);
  }
}

/** Handles a request body: one message or a batch. Returns what to send, or null for 202 with no body. */
export async function handleRpcBody(body: unknown, principal: McpPrincipal, backend: McpBackend): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return err(null, -32600, 'Invalid request.');
    if (body.length > 20) return err(null, -32600, 'Too many messages in one request.');
    const out = (await Promise.all(body.map((b) => handleRpcMessage(b, principal, backend)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? out : null;
  }
  return handleRpcMessage(body, principal, backend);
}
