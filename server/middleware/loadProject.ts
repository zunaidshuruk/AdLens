import type { NextFunction, Request, Response } from 'express';
import { historyViolation } from '../config/plans.js';
import { getFirestoreStore, type ProjectDoc } from '../lib/firestore.js';
import { permissionsOf, type Permission } from '../lib/permissions.js';
import { SETUP_REQUIRED, mustSetUpTwoStep } from '../lib/twoStepPolicy.js';

declare global {
  namespace Express {
    interface Request {
      project?: ProjectDoc;
      /** The plan whose limits apply to the workspace of `project`. */
      workspacePlan?: string;
      /** What the signed-in person may do in the workspace of `project`. */
      memberPermissions?: Set<Permission>;
    }
  }
}

export const PROJECT_HEADER_NAME = 'x-adlens-project';

export function parseProjectHeader(rawHeader: string | string[] | undefined): {
  wsId: string;
  projectId: string;
} | null {
  if (!rawHeader) return null;
  const val = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader).trim();
  if (!val) return null;
  const parts = val.split('/');
  if (parts.length !== 2) return null;
  const [wsId, projectId] = parts.map((p) => p.trim());
  if (!wsId || !projectId) return null;
  return { wsId, projectId };
}

/**
 * Loads the project specified in the `X-AdLens-Project: "<wsId>/<projectId>"` header.
 * If the header is present, verifies the workspace exists, the authenticated caller is a member,
 * and the project exists in that workspace. Otherwise responds with 404 PROJECT_NOT_FOUND.
 * If the header is omitted, leaves `req.project` undefined so routes can fall back to the session selection.
 */
export async function loadProject(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawHeader = req.headers[PROJECT_HEADER_NAME];
  if (rawHeader === undefined || (typeof rawHeader === 'string' && rawHeader.trim() === '')) {
    next();
    return;
  }

  const parsed = parseProjectHeader(rawHeader);
  if (!parsed) {
    res.status(404).json({
      error: {
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found or invalid X-AdLens-Project header.',
      },
    });
    return;
  }

  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
      },
    });
    return;
  }

  try {
    const store = getFirestoreStore();
    const workspace = await store.getWorkspace(parsed.wsId);
    if (
      !workspace ||
      !workspace.members ||
      !Object.prototype.hasOwnProperty.call(workspace.members, uid)
    ) {
      res.status(404).json({
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found or you do not have access to this workspace.',
        },
      });
      return;
    }

    const permissions = permissionsOf(workspace, uid);
    if (!permissions.has('reports.view')) {
      res.status(403).json({ error: { code: 'NOT_ALLOWED', message: 'Your role in this workspace does not allow viewing its data.' } });
      return;
    }

    if (await mustSetUpTwoStep(workspace, uid)) {
      res.status(403).json({ error: { ...SETUP_REQUIRED } });
      return;
    }

    const project = await store.getProject(parsed.wsId, parsed.projectId);
    if (!project) {
      res.status(404).json({
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found in workspace.',
        },
      });
      return;
    }

    // Plan limit: how far back the main date range may start (query string or JSON body).
    const bodyStart = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).startDate : undefined;
    const refused = historyViolation(workspace.plan, req.query?.startDate ?? bodyStart);
    if (refused) {
      res.status(403).json({ error: { code: 'PLAN_HISTORY_LIMIT', message: refused } });
      return;
    }

    req.project = project;
    req.workspacePlan = workspace.plan;
    req.memberPermissions = permissions;
    next();
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to load project.',
      },
    });
  }
}
