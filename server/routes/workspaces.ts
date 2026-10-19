import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getPlanLimits } from '../config/plans.js';
import {
  getFirestoreStore,
  type ProjectDoc,
  type WorkspaceDoc,
  type WorkspaceRole,
} from '../lib/firestore.js';
import { normalizeDomain } from '../lib/sourceMatcher.js';
import { requireUser } from '../middleware/requireUser.js';
import { validateAsset } from '../../src/utils/imageAssets.js';

export const meRouter = Router();
export const workspacesRouter = Router();

const SUPPORTED_IANA_TIMEZONES = new Set<string>(
  typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function'
    ? ['UTC', ...Intl.supportedValuesOf('timeZone')]
    : ['UTC', 'Asia/Dhaka', 'Asia/Singapore', 'America/New_York', 'Europe/London']
);

export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  return SUPPORTED_IANA_TIMEZONES.has(tz.trim());
}

const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase ISO code (e.g. USD, BDT).');

const timezoneSchema = z
  .string()
  .trim()
  .refine((val) => isValidIanaTimezone(val), {
    message: 'Invalid IANA time zone.',
  });

const domainInputSchema = z
  .string()
  .trim()
  .transform((val, ctx) => {
    if (val === '') return '';
    const norm = normalizeDomain(val);
    if (!norm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid website domain (expected a hostname such as example.com).',
      });
      return z.NEVER;
    }
    return norm;
  });

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'Project name is required.').max(100, 'Project name must be at most 100 characters.'),
    domain: domainInputSchema.optional().default(''),
    timezone: timezoneSchema.optional().default('UTC'),
    currency: currencySchema.optional().default('USD'),
  })
  .strict();

export const patchProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    domain: domainInputSchema.optional(),
    timezone: timezoneSchema.optional(),
    currency: currencySchema.optional(),
    brandTerms: z
      .array(z.string().trim().min(1, 'Brand term cannot be empty.').max(50, 'Brand term must be 1–50 characters.'))
      .max(20, 'At most 20 brand terms are allowed.')
      .optional(),
    hostnameFilters: z
      .array(
        z
          .string()
          .trim()
          .transform((val, ctx) => {
            const norm = normalizeDomain(val);
            if (!norm) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Invalid hostname filter "${val}".`,
              });
              return z.NEVER;
            }
            return norm;
          })
      )
      .max(20, 'At most 20 hostname filters are allowed.')
      .optional(),
    ga4PropertyId: z.string().trim().min(1).max(120).nullable().optional(),
    ga4PropertyName: z.string().trim().min(1).max(200).nullable().optional(),
    searchConsoleSite: z.string().trim().min(1).max(500).nullable().optional(),
    metaAdAccountId: z.string().trim().min(1).max(120).nullable().optional(),
    metaAdAccountName: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict();

const userSettingsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    defaultDateRange: z
      .enum(['Today', 'Last 7 days', 'Last 28 days', 'Last 90 days', 'This month', 'Last month'])
      .optional(),
    compareByDefault: z.boolean().optional(),
    displayCurrency: currencySchema.optional(),
    timezone: timezoneSchema.optional(),
    numberFormat: z.enum(['en-US', 'en-GB', 'en-IN', 'de-DE', 'fr-FR', 'bn-BD']).optional(),
    emailNotifications: z
      .object({
        weeklyReport: z.boolean().optional(),
        alerts: z.boolean().optional(),
        productUpdates: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const patchUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    settings: userSettingsSchema.optional(),
  })
  .strict();

export const patchWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    defaults: z
      .object({
        currency: currencySchema,
        timezone: timezoneSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

function deriveDisplayName(name: string | null | undefined, email: string | null | undefined): string {
  if (name && name.trim().length > 0) {
    return name.trim().slice(0, 100);
  }
  if (email && email.includes('@')) {
    const prefix = email.split('@')[0]?.trim();
    if (prefix) return prefix.slice(0, 100);
  }
  return 'AdLens User';
}

function getMemberRole(ws: WorkspaceDoc, uid: string): WorkspaceRole | null {
  if (!ws.members || typeof ws.members !== 'object') {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(ws.members, uid)) {
    return null;
  }
  return ws.members[uid] ?? null;
}

async function buildMePayload(
  uid: string,
  fallbackEmail: string | null,
  fallbackName: string | null,
  fallbackPhotoURL?: string | null
) {
  const store = getFirestoreStore();
  let userDoc = await store.getUser(uid);
  let workspaces = await store.listWorkspacesForUser(uid);

  if (!userDoc || workspaces.length === 0) {
    const bootstrapped = await store.bootstrapUserAndWorkspace({
      uid,
      email: fallbackEmail,
      displayName: deriveDisplayName(fallbackName, fallbackEmail),
      photoURL: fallbackPhotoURL ?? null,
    });
    userDoc = bootstrapped.user;
    workspaces = await store.listWorkspacesForUser(uid);
  }

  const projectsLists = await Promise.all(workspaces.map((ws) => store.listProjects(ws.id)));
  const projects: ProjectDoc[] = projectsLists.flat();

  return {
    user: {
      uid,
      ...userDoc,
    },
    workspaces: workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      ownerId: ws.ownerId,
      role: getMemberRole(ws, uid) ?? 'member',
      plan: ws.plan,
      limits: getPlanLimits(ws.plan),
      logoURL: ws.logoURL ?? null,
      logoPath: ws.logoPath ?? null,
      hasLogo: Boolean(ws.hasLogo),
      defaults: ws.defaults,
      members: ws.members,
      memberIds: ws.memberIds,
    })),
    projects,
  };
}

meRouter.use(requireUser);
workspacesRouter.use(requireUser);

// POST /api/me/bootstrap (idempotent, in a Firestore transaction)
meRouter.post('/bootstrap', async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email;
    const bodyName =
      typeof req.body?.displayName === 'string' && req.body.displayName.trim()
        ? req.body.displayName.trim()
        : req.user!.name ?? null;
    const displayName = deriveDisplayName(bodyName, email);
    const photoURL = req.user!.picture ?? null;

    const store = getFirestoreStore();
    await store.bootstrapUserAndWorkspace({
      uid,
      email,
      displayName,
      photoURL,
    });

    const payload = await buildMePayload(uid, email, displayName, photoURL);
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'BOOTSTRAP_FAILED',
        message: err instanceof Error ? err.message : 'Failed to bootstrap user workspace.',
      },
    });
  }
});

// GET /api/me -> { user, workspaces: [{ id, name, role, plan, limits, ... }], projects: [...] }
meRouter.get('/', async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const payload = await buildMePayload(
      uid,
      req.user!.email,
      req.user!.name ?? null,
      req.user!.picture ?? null
    );
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'ME_FETCH_FAILED',
        message: err instanceof Error ? err.message : 'Failed to load user profile and workspaces.',
      },
    });
  }
});

// PATCH /api/me -> update user profile & settings in Firestore
meRouter.patch('/', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const parsed = patchUserSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Invalid user settings payload.',
      },
    });
    return;
  }


  try {
    const store = getFirestoreStore();
    const updated = await store.updateUser(uid, parsed.data);
    res.json({ user: { uid, ...updated } });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'USER_UPDATE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to update user settings.',
      },
    });
  }
});

// GET /api/me/avatar/:uid -> fetch custom avatar asset for any verified user
meRouter.get('/avatar/:uid', async (req: Request, res: Response) => {
  const targetUid = String(req.params.uid || '').trim();
  if (!targetUid) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'User ID is required.' },
    });
    return;
  }
  try {
    const store = getFirestoreStore();
    const avatar = await store.getUserAvatar(targetUid);
    res.json({ avatar });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'AVATAR_FETCH_FAILED',
        message: err instanceof Error ? err.message : 'Failed to load avatar.',
      },
    });
  }
});

// PUT /api/me/avatar -> store custom avatar asset in users/{uid}/assets/avatar
meRouter.put('/avatar', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const body = req.body ?? {};
  const asset = {
    dataUrl: typeof body.dataUrl === 'string' ? body.dataUrl : '',
    mimeType: body.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
    width: typeof body.width === 'number' ? body.width : 0,
    height: typeof body.height === 'number' ? body.height : 0,
  };

  const errCode = validateAsset(asset, 'avatar');
  if (errCode) {
    res.status(400).json({
      error: { code: errCode, message: `Invalid avatar image asset (${errCode}).` },
    });
    return;
  }

  try {
    const store = getFirestoreStore();
    const saved = await store.setUserAvatar(uid, asset);
    res.json({ avatar: saved });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'AVATAR_SAVE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to save avatar.',
      },
    });
  }
});

// DELETE /api/me/avatar -> delete custom avatar asset and reset hasCustomAvatar
meRouter.delete('/avatar', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  try {
    const store = getFirestoreStore();
    await store.deleteUserAvatar(uid);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'AVATAR_DELETE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to remove avatar.',
      },
    });
  }
});

// PATCH /api/workspaces/:wsId -> owners/admins update workspace name, logo, defaults
workspacesRouter.patch('/:wsId', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const wsId = String(req.params.wsId || '').trim();
  const store = getFirestoreStore();

  try {
    const ws = await store.getWorkspace(wsId);
    const role = ws ? getMemberRole(ws, uid) : null;
    if (!ws || !role) {
      res.status(404).json({
        error: {
          code: 'WORKSPACE_NOT_FOUND',
          message: 'Workspace not found.',
        },
      });
      return;
    }

    if (role !== 'owner' && role !== 'admin') {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'Only workspace owners and admins can update workspace settings.',
        },
      });
      return;
    }

    const parsed = patchWorkspaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid workspace update payload.',
        },
      });
      return;
    }


    const updated = await store.updateWorkspace(wsId, parsed.data);
    res.json({
      workspace: {
        ...updated,
        role,
        limits: getPlanLimits(updated.plan),
      },
    });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'WORKSPACE_UPDATE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to update workspace.',
      },
    });
  }
});

// GET /api/workspaces/:wsId/logo -> members fetch workspace logo asset
workspacesRouter.get('/:wsId/logo', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const wsId = String(req.params.wsId || '').trim();
  const store = getFirestoreStore();

  try {
    const ws = await store.getWorkspace(wsId);
    const role = ws ? getMemberRole(ws, uid) : null;
    if (!ws || !role) {
      res.status(404).json({
        error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' },
      });
      return;
    }
    const logo = await store.getWorkspaceLogo(wsId);
    res.json({ logo });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'LOGO_FETCH_FAILED',
        message: err instanceof Error ? err.message : 'Failed to load workspace logo.',
      },
    });
  }
});

// PUT /api/workspaces/:wsId/logo -> owners/admins store workspace logo asset
workspacesRouter.put('/:wsId/logo', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const wsId = String(req.params.wsId || '').trim();
  const store = getFirestoreStore();

  try {
    const ws = await store.getWorkspace(wsId);
    const role = ws ? getMemberRole(ws, uid) : null;
    if (!ws || !role) {
      res.status(404).json({
        error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' },
      });
      return;
    }
    if (role !== 'owner' && role !== 'admin') {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'Only workspace owners and admins can update the workspace logo.',
        },
      });
      return;
    }

    const body = req.body ?? {};
    const asset = {
      dataUrl: typeof body.dataUrl === 'string' ? body.dataUrl : '',
      mimeType: body.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
      width: typeof body.width === 'number' ? body.width : 0,
      height: typeof body.height === 'number' ? body.height : 0,
    };

    const errCode = validateAsset(asset, 'logo');
    if (errCode) {
      res.status(400).json({
        error: { code: errCode, message: `Invalid workspace logo asset (${errCode}).` },
      });
      return;
    }

    const saved = await store.setWorkspaceLogo(wsId, asset);
    res.json({ logo: saved });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'LOGO_SAVE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to save workspace logo.',
      },
    });
  }
});

// DELETE /api/workspaces/:wsId/logo -> owners/admins delete workspace logo asset
workspacesRouter.delete('/:wsId/logo', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const wsId = String(req.params.wsId || '').trim();
  const store = getFirestoreStore();

  try {
    const ws = await store.getWorkspace(wsId);
    const role = ws ? getMemberRole(ws, uid) : null;
    if (!ws || !role) {
      res.status(404).json({
        error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' },
      });
      return;
    }
    if (role !== 'owner' && role !== 'admin') {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'Only workspace owners and admins can remove the workspace logo.',
        },
      });
      return;
    }

    await store.deleteWorkspaceLogo(wsId);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'LOGO_DELETE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to remove workspace logo.',
      },
    });
  }
});

// POST /api/workspaces/:wsId/projects
workspacesRouter.post('/:wsId/projects', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const wsId = String(req.params.wsId || '').trim();
  const store = getFirestoreStore();

  try {
    const ws = await store.getWorkspace(wsId);
    const role = ws ? getMemberRole(ws, uid) : null;
    if (!ws || !role) {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'You are not a member of this workspace.',
        },
      });
      return;
    }

    if (req.body && typeof req.body === 'object' && 'isDemo' in req.body) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'isDemo is server-only and cannot be specified by the client.',
        },
      });
      return;
    }

    const parsed = createProjectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid project creation payload.',
        },
      });
      return;
    }

    const limits = getPlanLimits(ws.plan);

    try {
      const project = await store.createProject(
        wsId,
        {
          name: parsed.data.name,
          domain: parsed.data.domain || '',
          timezone: parsed.data.timezone || ws.defaults?.timezone || 'UTC',
          currency: parsed.data.currency || ws.defaults?.currency || 'USD',
          isDemo: false,
          createdBy: uid,
        },
        { maxProjects: limits.maxProjects }
      );

      res.status(201).json({ project });
    } catch (createErr) {
      if (
        (createErr as { code?: string })?.code === 'PLAN_LIMIT_REACHED' ||
        (createErr as Error)?.message === 'PLAN_LIMIT_REACHED'
      ) {
        res.status(403).json({
          error: {
            code: 'PLAN_LIMIT_REACHED',
            message: `Your ${ws.plan} plan allows up to ${limits.maxProjects} projects.`,
          },
        });
        return;
      }
      throw createErr;
    }
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'PROJECT_CREATE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to create project.',
      },
    });
  }
});

// PATCH /api/workspaces/:wsId/projects/:id
workspacesRouter.patch('/:wsId/projects/:id', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const wsId = String(req.params.wsId || '').trim();
  const projectId = String(req.params.id || '').trim();
  const store = getFirestoreStore();

  try {
    const ws = await store.getWorkspace(wsId);
    const role = ws ? getMemberRole(ws, uid) : null;
    if (!ws || !role) {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'You are not a member of this workspace.',
        },
      });
      return;
    }

    if (req.body && typeof req.body === 'object' && 'isDemo' in req.body) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'isDemo is server-only and cannot be specified by the client.',
        },
      });
      return;
    }

    const parsed = patchProjectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid project update payload.',
        },
      });
      return;
    }

    const updated = await store.updateProject(wsId, projectId, parsed.data);
    if (!updated) {
      res.status(404).json({
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found.',
        },
      });
      return;
    }

    res.json({ project: updated });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'PROJECT_UPDATE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to update project.',
      },
    });
  }
});

// DELETE /api/workspaces/:wsId/projects/:id (owner/admin only, else 403 NOT_ALLOWED)
workspacesRouter.delete('/:wsId/projects/:id', async (req: Request, res: Response) => {
  const uid = req.user!.uid;
  const wsId = String(req.params.wsId || '').trim();
  const projectId = String(req.params.id || '').trim();
  const store = getFirestoreStore();

  try {
    const ws = await store.getWorkspace(wsId);
    const role = ws ? getMemberRole(ws, uid) : null;
    if (!ws || !role || (role !== 'owner' && role !== 'admin')) {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'Only workspace owners and admins can delete projects.',
        },
      });
      return;
    }

    const deleted = await store.deleteProject(wsId, projectId);
    if (!deleted) {
      res.status(404).json({
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found.',
        },
      });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'PROJECT_DELETE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to delete project.',
      },
    });
  }
});
