import { Router, type Request, type Response } from 'express';
import { getServerConfig } from '../config.js';
import { chooseAuthDomain } from '../lib/authProxy.js';
import { getFlags, refreshAdminSettings } from '../lib/adminSettings.js';

export const publicConfigRouter = Router();

// GET /api/public-config (no auth) -> { firebase: { apiKey, authDomain, projectId, appId }, providers: string[], legal: { entity, supportEmail, address } }
// With AUTH_PROXY=on, authDomain is the address the page was loaded from (only if allow-listed), so sign-in also works
// inside the installed app. Otherwise it is the configured Firebase address, exactly as before.
publicConfigRouter.get('/', async (req: Request, res: Response) => {
  await refreshAdminSettings();
  const flags = getFlags();
  const cfg = getServerConfig();
  res.json({
    firebase: {
      apiKey: cfg.firebaseApiKey,
      authDomain: chooseAuthDomain({
        proxyEnabled: cfg.authProxyEnabled,
        requestHost: req.hostname,
        configuredAuthDomain: cfg.firebaseAuthDomain,
        allowedHosts: cfg.authAllowedHosts,
      }),
      projectId: cfg.firebaseProjectId,
      appId: cfg.firebaseAppId,
    },
    providers: cfg.authProviders,
    status: { signupsOpen: flags.signupsOpen, maintenance: flags.maintenanceMode, maintenanceMessage: flags.maintenanceMessage },
    legal: { entity: cfg.legalEntity, supportEmail: cfg.supportEmail, address: cfg.legalAddress },
  });
});
