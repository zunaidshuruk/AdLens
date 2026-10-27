import type { NextFunction, Request, Response } from 'express';
import { getFlags, refreshAdminSettings, type FeatureFlags } from '../lib/adminSettings.js';

/** URL start -> the switch that controls it. */
const FEATURE_BY_PREFIX: [string, keyof FeatureFlags][] = [
  ['/api/explore', 'explore'], ['/api/dashboards', 'dashboards'], ['/api/agents', 'agents'],
  ['/api/mcp', 'mcp'], ['/mcp', 'mcp'], ['/api/ai', 'aiAnalyst'], ['/api/team', 'team'],
];

/** These keep working in maintenance mode: uptime checks, the sign-in screens' settings, and the admin panel itself. */
const ALWAYS_OPEN = ['/api/health', '/api/ops/ready', '/api/public-config', '/api/admin', '/api/billing/admin', '/api/billing/whoami', '/api/platform', '/api/auth'];

/** Applies the admin panel's feature switches and maintenance mode. Mounted in front of /api and /mcp. */
export async function featureGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  await refreshAdminSettings();
  const flags = getFlags();
  const path = req.originalUrl.split('?')[0];
  const starts = (p: string) => path === p || path.startsWith(`${p}/`);
  if (flags.maintenanceMode && !ALWAYS_OPEN.some(starts)) {
    res.status(503).json({ error: { code: 'MAINTENANCE', message: flags.maintenanceMessage || 'AdLens is being updated. Please try again in a little while.' } });
    return;
  }
  const hit = FEATURE_BY_PREFIX.find(([p]) => starts(p));
  if (hit && flags[hit[1]] === false) {
    res.status(503).json({ error: { code: 'FEATURE_OFF', message: 'This part of AdLens is switched off for now. Please try again later.' } });
    return;
  }
  next();
}
