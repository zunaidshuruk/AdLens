import type { NextFunction, Request, Response } from 'express';
import { getFirestoreStore, type ProjectDoc } from '../lib/firestore.js';

declare global {
  namespace Express {
    interface Request {
      project?: ProjectDoc;
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

    req.project = project;
    next();
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: err instanceof Error ? err.message : 'Failed to load project.',
      },
    });
  }
}
