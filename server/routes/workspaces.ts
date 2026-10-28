import { acceptPendingInvites } from './team.js';
import { getFlags } from '../lib/adminSettings.js';
import { can, permissionsOf, roleDef, roleIdOf } from '../lib/permissions.js';
import { getInviteStore } from '../lib/inviteStore.js';
import { explainDatabaseError, isOperator } from './ops.js';
import { reportError } from '../lib/errorReporter.js';
import { getBillingStore } from '../lib/billingStore.js';
import { getDigestStore } from '../lib/digestStore.js';
import { recordAccountDeletion, recordAudit } from '../lib/auditLog.js';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getPlanFeatures, getPlanLimits } from '../config/plans.js';
import { deleteAuthUser } from '../lib/firebaseAdmin.js';
import { twoStepStore } from '../lib/twoStep.js';
import { guardWorkspaceParam, hasTwoStepOn } from '../lib/twoStepPolicy.js';
import {
  getFirestoreStore,
  type ProjectDoc,
  type WorkspaceDoc,
  type WorkspaceRole,
} from '../lib/firestore.js';
import { clearOAuthState, clearSession } from '../lib/session.js';
import { normalizeDomain } from '../lib/sourceMatcher.js';
import { getMetaDeletionStore } from '../lib/metaDeletion.js';
import { getVault } from '../lib/vault.js';
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

export const appearanceSettingsSchema = z
  .object({
    preset: z.enum([
      'adlens-light',
      'adlens-dark',
      'midnight',
      'ocean',
      'forest',
      'sunset',
      'high-contrast',
      'system',
      'custom',
    ]),
    custom: z
      .object({
        mode: z.enum(['light', 'dark']),
        accent: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i, 'Accent colour must be a 6-digit hex colour (#rrggbb).')
          .transform((val) => val.toLowerCase()),
        tint: z.enum(['none', 'cool', 'warm', 'accent']),
      })
      .strict(),
    radius: z.enum(['sharp', 'default', 'round']),
    density: z.enum(['comfortable', 'compact']),
    fontScale: z.enum(['small', 'default', 'large', 'xlarge']),
    fontFamily: z.enum(['plus-jakarta', 'mada', 'poppins', 'noto-sans', 'inter', 'roboto', 'system']).optional(),
    chartPalette: z.enum(['default', 'colorblind', 'monochrome', 'brand']),
  })
  .strict();

export const userSettingsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    appearance: appearanceSettingsSchema.optional(),
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
    requireTwoStep: z.boolean().optional(),
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

/** When sign-ups are closed in the admin panel, only people who already have an account, invited people and operators get in. */
async function signupAllowed(uid: string, email: string | null): Promise<boolean> {
  if (getFlags().signupsOpen) return true;
  if (await getFirestoreStore().getUser(uid)) return true;
  if (isOperator(email)) return true;
  return email ? (await getInviteStore().listForEmail(email)).length > 0 : false;
}

const SIGNUPS_CLOSED = { error: { code: 'SIGNUPS_CLOSED', message: 'New sign-ups are paused right now. If you were invited, sign in with the email that received the invitation.' } };

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
      role: roleIdOf(ws, uid) ?? 'member',
      roleName: roleDef(ws, roleIdOf(ws, uid))?.name ?? 'Member',
      permissions: [...permissionsOf(ws, uid)],
      plan: ws.plan,
      limits: getPlanLimits(ws.plan),
      historyDays: getPlanFeatures(ws.plan).historyDays,
      logoURL: ws.logoURL ?? null,
      logoPath: ws.logoPath ?? null,
      hasLogo: Boolean(ws.hasLogo),
      defaults: ws.defaults,
      requireTwoStep: ws.requireTwoStep === true,
      members: ws.members,
      memberIds: ws.memberIds,
    })),
    projects,
  };
}

meRouter.use(requireUser);
workspacesRouter.use(requireUser);
workspacesRouter.param('wsId', guardWorkspaceParam);

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

    if (!(await signupAllowed(uid, email))) { res.status(403).json(SIGNUPS_CLOSED); return; }
    const store = getFirestoreStore();
    await store.bootstrapUserAndWorkspace({
      uid,
      email,
      displayName,
      photoURL,
    });

    if (req.user!.emailVerified) await acceptPendingInvites(uid, email);
    const payload = await buildMePayload(uid, email, displayName, photoURL);
    res.json(payload);
  } catch (err) {
    const why = explainDatabaseError(err);
    console.error('[bootstrap] could not create the workspace; database error code', why.code); // the cause is in the server log, never sent to the browser
    void reportError(err, { method: 'POST', path: '/api/me/bootstrap' });
    res.status(500).json({
      error: {
        code: 'BOOTSTRAP_FAILED',
        message: 'Failed to bootstrap user workspace.',
      },
    });
  }
});

// GET /api/me -> { user, workspaces: [{ id, name, role, plan, limits, ... }], projects: [...] }
meRouter.get('/', async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    if (!(await signupAllowed(uid, req.user!.email))) { res.status(403).json(SIGNUPS_CLOSED); return; }
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
        message: 'Failed to load user profile and workspaces.',
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
        message: 'Failed to update user settings.',
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
        message: 'Failed to load avatar.',
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
        message: 'Failed to save avatar.',
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
        message: 'Failed to remove avatar.',
      },
    });
  }
});

const RECENT_SIGN_IN_MAX_AGE_MS = 5 * 60 * 1000;

// POST /api/me/delete -> permanently delete user account, owned solo workspaces, vault tokens, and auth user
meRouter.post('/delete', async (req: Request, res: Response) => {
  const uid = req.user!.uid;

  if (!req.body || typeof req.body !== 'object' || req.body.confirm !== 'DELETE') {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Confirmation text "DELETE" is required to delete your account.',
      },
    });
    return;
  }

  const rawAuthTime = req.user?.authTime;
  const authTimeMs =
    typeof rawAuthTime === 'number' && Number.isFinite(rawAuthTime) && rawAuthTime > 0
      ? rawAuthTime > 1e11
        ? rawAuthTime
        : rawAuthTime * 1000
      : 0;

  if (!authTimeMs || Date.now() - authTimeMs > RECENT_SIGN_IN_MAX_AGE_MS) {
    res.status(401).json({
      error: {
        code: 'REAUTH_REQUIRED',
        message: 'Please sign in again to delete your account',
      },
    });
    return;
  }

  try {
    // Pre-flight check: if the user owns any workspace that has other members, block before any destructive step
    const store = getFirestoreStore();
    const workspaces = await store.listWorkspacesForUser(uid);

    for (const ws of workspaces) {
      const role = getMemberRole(ws, uid);
      const isOwner = ws.ownerId === uid || role === 'owner';
      const allMemberUids = new Set<string>([
        ...Object.keys(ws.members ?? {}),
        ...(ws.memberIds ?? []),
      ]);
      const otherMembers = Array.from(allMemberUids).filter((mUid) => mUid && mUid !== uid);

      if (isOwner && otherMembers.length > 0) {
        console.info('[delete-account]', { uid, step: 'transfer_ownership_required' });
        res.status(409).json({
          error: {
            code: 'TRANSFER_OWNERSHIP_REQUIRED',
            message:
              'You own a workspace with other members. Please transfer ownership or remove other members before deleting your account.',
          },
        });
        return;
      }
    }

    // Step 2a: Revoke Google refresh token (ignore failures), then delete vault connections for google and meta
    console.info('[delete-account]', { uid, step: 'revoke_and_delete_connections' });
    const vault = getVault();
    let refreshToken: string | undefined;
    try {
      refreshToken = await vault.getRefreshToken(uid, 'google');
    } catch {
      // Ignore VAULT_NOT_CONNECTED or decrypt failure
    }

    if (refreshToken) {
      try {
        const body = new URLSearchParams({ token: refreshToken });
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });
      } catch {
        // Ignore network/revoke errors
      }
    }

    await vault.deleteConnection(uid, 'google');
    await vault.deleteConnection(uid, 'meta');
    try {
      await getMetaDeletionStore().unlinkUid(uid);
    } catch {
      // best effort
    }

    // Step 2b: Clean up workspaces where user is a member
    console.info('[delete-account]', { uid, step: 'cleanup_workspaces' });
    for (const ws of workspaces) {
      const role = getMemberRole(ws, uid);
      const isOwner = ws.ownerId === uid || role === 'owner';
      if (isOwner) {
        await store.deleteWorkspaceRecursive(ws.id);
      } else {
        await store.removeWorkspaceMember(ws.id, uid);
      }
    }

    // Step 2c: Recursive delete users/{uid} (includes assets/avatar)
    console.info('[delete-account]', { uid, step: 'delete_user_doc' });
    await store.deleteUserRecursive(uid);

    // Step 2d: Delete Firebase Auth user (ignores auth/user-not-found)
    console.info('[delete-account]', { uid, step: 'delete_auth_user' });
    await deleteAuthUser(uid);

    // Step 3: Clear oauth-state cookie and session cookie
    console.info('[delete-account]', { uid, step: 'clear_cookies_and_complete' });
    try { await getDigestStore().deleteForUid(uid); } catch { /* best effort */ }
    try { await twoStepStore().delete(uid); } catch { /* best effort */ }
    try { await getBillingStore().deleteRequestsForUid(uid); } catch { /* best effort */ }
    await recordAccountDeletion(uid);
    clearOAuthState(res);
    clearSession(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('[delete-account]', { uid, step: 'failed' });
    res.status(500).json({
      error: {
        code: 'ACCOUNT_DELETE_FAILED',
        message: 'Failed to delete account.',
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

    if (!can(ws, uid, 'workspace.settings')) {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'Your role does not allow changing workspace settings.',
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


    if (parsed.data.requireTwoStep === true && !(await hasTwoStepOn(uid))) {
      res.status(409).json({ error: { code: 'TWO_STEP_SETUP_FIRST', message: 'Turn on two-step verification for your own account first (Settings, Security), so you are not locked out.' } });
      return;
    }

    const updated = await store.updateWorkspace(wsId, parsed.data);
    if (parsed.data.requireTwoStep !== undefined && parsed.data.requireTwoStep !== (ws.requireTwoStep === true)) {
      void recordAudit({ uid, action: 'workspace.two_step_policy', workspaceId: wsId, detail: parsed.data.requireTwoStep ? 'required for owners and admins' : 'no longer required' });
    }
    res.json({
      workspace: {
        ...updated,
        role,
        roleName: roleDef(updated, roleIdOf(updated, uid))?.name ?? 'Member',
        permissions: [...permissionsOf(updated, uid)],
        requireTwoStep: updated.requireTwoStep === true,
        limits: getPlanLimits(updated.plan),
        historyDays: getPlanFeatures(updated.plan).historyDays,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'WORKSPACE_UPDATE_FAILED',
        message: 'Failed to update workspace.',
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
        message: 'Failed to load workspace logo.',
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
    if (!can(ws, uid, 'workspace.settings')) {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'Your role does not allow changing the workspace logo.',
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
        message: 'Failed to save workspace logo.',
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
    if (!can(ws, uid, 'workspace.settings')) {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'Your role does not allow changing the workspace logo.',
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
        message: 'Failed to remove workspace logo.',
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
    if (!can(ws, uid, 'projects.edit')) {
      res.status(403).json({ error: { code: 'NOT_ALLOWED', message: 'Your role does not allow creating projects.' } });
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
        message: 'Failed to create project.',
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
        message: 'Failed to update project.',
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
    if (!ws || !role || !can(ws, uid, 'projects.delete')) {
      res.status(403).json({
        error: {
          code: 'NOT_ALLOWED',
          message: 'Your role does not allow deleting projects.',
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

    void recordAudit({ uid, workspaceId: wsId, action: 'project.deleted', detail: `project ${projectId}` });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'PROJECT_DELETE_FAILED',
        message: 'Failed to delete project.',
      },
    });
  }
});
