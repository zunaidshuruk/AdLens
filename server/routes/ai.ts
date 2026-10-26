import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getServerConfig,
  isEmailAllowedForMetaSystemUser,
  normalizeMetaAdAccountId,
} from '../config.js';
import { getPlanLimits } from '../config/plans.js';
import type { AgentSource } from '../lib/agentConfig.js';
import { createAgentProvider } from '../lib/agentProviders.js';
import { ToolInputError } from '../lib/agentRunner.js';
import { ANALYST_FORMAT_INSTRUCTIONS } from '../lib/analystFormat.js';
import { askAnalyst, MAX_QUESTION_CHARS, type AnalystDeps } from '../lib/analystService.js';
import { getFirestoreStore, getUtcMonthPeriod, type ProjectDoc } from '../lib/firestore.js';
import { guardedRequest, type RequestFn } from '../lib/ssrfGuard.js';
import { getVault } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';
import '../reports/ga4Reports.js';
import { reportRegistry } from '../reports/registry.js';
import { dateRangeBaseObject, dateRangeSchema } from '../reports/schemas.js';
import type { ReportContext } from '../reports/types.js';

export const aiRouter = Router();

// Rate limiter: 20 requests per minute per user
const AI_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AI_RATE_LIMIT_MAX_REQUESTS = 20;
const userAiRequestCounters = new Map<string, { count: number; resetAt: number }>();

export function clearAiRateLimit(): void {
  userAiRequestCounters.clear();
}

export function aiRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.user?.uid || req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = userAiRequestCounters.get(key);

  if (!entry || now >= entry.resetAt) {
    userAiRequestCounters.set(key, { count: 1, resetAt: now + AI_RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= AI_RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded (max 20 AI questions per minute). Please wait and try again.',
      },
    });
    return;
  }

  entry.count += 1;
  next();
}

let testAiRequestOverride: RequestFn | null = null;

export function setTestAiRequest(fn: RequestFn | null): void {
  testAiRequestOverride = fn;
}

export const askBodySchema = dateRangeBaseObject
  .extend({
    question: z
      .string()
      .trim()
      .min(1, 'Question must be between 1 and 2000 characters.')
      .max(MAX_QUESTION_CHARS, `Question must be at most ${MAX_QUESTION_CHARS} characters.`),
    history: z
      .array(z.unknown())
      .max(20, 'History may contain at most 20 messages.')
      .optional()
      .default([]),
    agentId: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    const dateCheck = dateRangeSchema.safeParse({
      startDate: val.startDate,
      endDate: val.endDate,
      ...(val.compareStartDate !== undefined ? { compareStartDate: val.compareStartDate } : {}),
      ...(val.compareEndDate !== undefined ? { compareEndDate: val.compareEndDate } : {}),
    });
    if (!dateCheck.success) {
      for (const issue of dateCheck.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
      }
    }
  });

export function buildAiReportContext(uid: string, project?: ProjectDoc): ReportContext {
  const propertyId = project?.ga4PropertyId ?? undefined;
  const propertyName = (project?.ga4PropertyName || propertyId) ?? undefined;
  const searchConsoleSite = project?.searchConsoleSite ?? undefined;

  return {
    getAccessToken: async () => getVault().getAccessToken(uid, 'google'),
    ...(propertyId ? { ga4PropertyId: propertyId } : {}),
    ...(propertyName ? { ga4PropertyName: propertyName } : {}),
    ...(searchConsoleSite ? { searchConsoleSite } : {}),
    ...(project ? { project } : {}),
  };
}

export async function executeRegisteredReportTool(
  id: string,
  args: Record<string, unknown>,
  ctx: ReportContext
): Promise<unknown> {
  const report = reportRegistry.get(id);
  if (!report) {
    throw new ToolInputError(`Report "${id}" is not registered.`);
  }
  const parsed = report.input.safeParse(args ?? {});
  if (!parsed.success) {
    const firstMsg = parsed.error.issues[0]?.message || 'Invalid tool arguments.';
    throw new ToolInputError(firstMsg);
  }
  return report.run(ctx, parsed.data);
}

export async function resolveConnectedSourcesForProject(
  uid: string,
  email: string | null | undefined,
  project?: ProjectDoc
): Promise<AgentSource[]> {
  const cfg = getServerConfig();
  let summary = null;
  if (cfg.vaultReady) {
    try {
      summary = await getVault().getSummary(uid, 'google');
    } catch {
      summary = null;
    }
  }
  const isGoogleConnected = Boolean(cfg.googleConfigured && summary?.connected);
  const metaAllowed = isEmailAllowedForMetaSystemUser(email);
  const effectiveMetaAccountId =
    cfg.metaConfigured && metaAllowed
      ? normalizeMetaAdAccountId(project?.metaAdAccountId || cfg.metaAdAccountId)
      : '';

  const connectedSources: AgentSource[] = [];
  if (isGoogleConnected && project?.ga4PropertyId) {
    connectedSources.push('ga4');
  }
  if (isGoogleConnected && project?.searchConsoleSite) {
    connectedSources.push('search_console');
  }
  if (effectiveMetaAccountId) {
    connectedSources.push('meta');
  }
  return connectedSources;
}

aiRouter.use(requireUser);
aiRouter.use(aiRateLimitMiddleware);
aiRouter.use(verifyGoogleSessionOwnership);
aiRouter.use(loadProject);

// GET /api/ai/usage
aiRouter.get('/usage', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const store = getFirestoreStore();
  let project = req.project;
  let workspaceId = project?.workspaceId ?? '';

  if (!workspaceId) {
    const workspaces = await store.listWorkspacesForUser(uid);
    if (workspaces.length > 0) {
      workspaceId = workspaces[0].id;
      if (!project) {
        const projects = await store.listProjects(workspaceId);
        project = projects[0];
      }
    } else {
      workspaceId = `ws_${uid}`;
    }
  }

  const period = getUtcMonthPeriod();
  const [workspace, usage] = await Promise.all([
    store.getWorkspace(workspaceId),
    store.getUsage(workspaceId, period),
  ]);
  const limit = getPlanLimits(workspace?.plan).aiQuestionsPerMonth;
  const rawUsed = usage?.aiQuestions ?? 0;
  const used =
    typeof rawUsed === 'number' && Number.isFinite(rawUsed) && rawUsed >= 0
      ? Math.floor(rawUsed)
      : 0;
  const cfg = getServerConfig();

  res.status(200).json({
    used,
    limit,
    period,
    aiConfigured: cfg.aiConfigured,
  });
});

// POST /api/ai/ask
aiRouter.post('/ask', async (req: Request, res: Response) => {
  const parsed = askBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const firstField = String(firstIssue?.path?.[0] ?? '');
    const isDateIssue = ['startDate', 'endDate', 'compareStartDate', 'compareEndDate'].includes(
      firstField
    );
    res.status(400).json({
      error: {
        code: isDateIssue ? 'INVALID_DATE_RANGE' : 'VALIDATION_ERROR',
        message: firstIssue?.message || 'Invalid request body.',
      },
    });
    return;
  }

  if (parsed.data.agentId !== undefined && parsed.data.agentId !== null && parsed.data.agentId !== '') {
    res.status(400).json({
      error: {
        code: 'AGENTS_NOT_ENABLED',
        message: 'Custom agents are not enabled yet.',
      },
    });
    return;
  }

  const uid = req.user!.uid;
  const store = getFirestoreStore();
  let project = req.project;
  let workspaceId = project?.workspaceId ?? '';

  if (!workspaceId) {
    const workspaces = await store.listWorkspacesForUser(uid);
    if (workspaces.length > 0) {
      workspaceId = workspaces[0].id;
      if (!project) {
        const projects = await store.listProjects(workspaceId);
        project = projects[0];
      }
    } else {
      workspaceId = `ws_${uid}`;
    }
  }

  const cfg = getServerConfig();
  const connectedSources = await resolveConnectedSourcesForProject(uid, req.user?.email, project);
  const reportCtx = buildAiReportContext(uid, project);

  const tools = reportRegistry.list().map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    source: r.source,
    input: r.input,
  }));

  const primaryApiKey = cfg.geminiApiKey || cfg.geminiApiKey2 || undefined;
  const fallbackApiKey = cfg.geminiApiKey && cfg.geminiApiKey2 ? cfg.geminiApiKey2 : undefined;

  const askInput = {
    question: parsed.data.question,
    history: parsed.data.history,
    workspaceId,
    project: {
      name: project?.name || 'AdLens Project',
      domain: project?.domain || null,
      currency: project?.currency || 'USD',
      timezone: project?.timezone || 'UTC',
    },
    dates: {
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      ...(parsed.data.compareStartDate ? { compareStartDate: parsed.data.compareStartDate } : {}),
      ...(parsed.data.compareEndDate ? { compareEndDate: parsed.data.compareEndDate } : {}),
    },
    connectedSources,
  };

  const makeDeps = (apiKey: string | undefined): AnalystDeps => ({
    tools,
    executeTool: (id, args) => executeRegisteredReportTool(id, args, reportCtx),
    makeProvider: (providerCfg) =>
      createAgentProvider(providerCfg, {
        request: testAiRequestOverride ?? guardedRequest,
      }),
    cloudInstructions: ANALYST_FORMAT_INSTRUCTIONS,
    cloud: {
      apiKey,
      model: cfg.geminiModel || undefined,
    },
    consumeQuota: (wsId) => store.consumeAiQuota(wsId),
    refundQuota: (wsId) => store.refundAiQuota(wsId),
  });

  let result = await askAnalyst(askInput, makeDeps(primaryApiKey));

  if (
    fallbackApiKey &&
    result.error?.code &&
    (result.error.code === 'PROVIDER_AUTH' ||
      result.error.code === 'PROVIDER_RATE_LIMITED' ||
      result.error.code === 'PROVIDER_UNAVAILABLE')
  ) {
    result = await askAnalyst(askInput, makeDeps(fallbackApiKey));
  }

  if (result.error?.code === 'QUOTA_EXCEEDED') {
    res.status(429).json(result);
    return;
  }

  res.status(200).json(result);
});
