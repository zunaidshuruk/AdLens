import { securityRouter, ssoRouter } from './routes/sso.js';
import { billingRouter } from './routes/billing.js';
import { teamRouter } from './routes/team.js';
import { twoStepRouter } from './routes/twoStep.js';
import { adminRouter } from './routes/admin.js';
import { featureGate } from './middleware/featureGate.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { ipProtection, loadProtection } from './middleware/protect.js';
import { digestRouter } from './routes/digest.js';
import { unsubscribeRouter } from './routes/unsubscribe.js';
import { reportError } from './lib/errorReporter.js';
import { opsRouter } from './routes/ops.js';
import { getServerConfig } from './config.js';
import { registerAuthProxy, upstreamHostFor } from './lib/authProxy.js';
import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import {
  connectionsRouter,
  googleApiRouter,
  metaConnectionRouter,
} from './routes/connections.js';
import { agentsRouter } from './routes/agents.js';
import { dashboardsRouter } from './routes/dashboards.js';
import { exploreRouter } from './routes/explore.js';
import { datasetsRouter } from './routes/datasets.js';
import { alertsRouter } from './routes/alerts.js';
import { emailSchedulesRouter } from './routes/emailSchedules.js';
import { sharesRouter } from './routes/shares.js';
import { sharedRouter } from './routes/shared.js';
import { ga4Router } from './routes/ga4.js';
import { healthRouter } from './routes/health.js';
import { mcpAccountRouter, mcpRouter, oauthRouter } from './routes/mcp.js';
import { metaRouter } from './routes/meta.js';
import { metaCallbacksRouter } from './routes/metaCallbacks.js';
import { publicConfigRouter } from './routes/publicConfig.js';
import { reportsRouter } from './routes/reports.js';
import { searchConsoleRouter } from './routes/searchConsole.js';
import { sessionRouter } from './routes/session.js';
import { meRouter, workspacesRouter } from './routes/workspaces.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// Enable Secure cookies behind reverse proxy / Cloud Run / Vercel
// How many proxies sit in front (Cloud Run, a load balancer, Cloudflare...). 1 = one. Set TRUST_PROXY=0 when the server is reached directly,
// otherwise a visitor could fake their address and dodge the per-address limits.
app.set('trust proxy', Number.isFinite(Number(process.env.TRUST_PROXY)) && process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== '' ? Number(process.env.TRUST_PROXY) : 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(ipProtection);
app.use(loadProtection);

// Sign-in helper served from our own address (only when AUTH_PROXY=on). Checked on every request so the switch needs no restart.
let authProxyApp: express.Express | null = null;
app.use((req, res, next) => {
  if (!req.path.startsWith('/__/')) return next();
  const cfg = getServerConfig();
  if (!cfg.authProxyEnabled || !cfg.firebaseProjectId) return next();
  if (!authProxyApp) {
    authProxyApp = express();
    registerAuthProxy(authProxyApp, { upstreamHost: upstreamHostFor(cfg.firebaseProjectId) });
  }
  return authProxyApp(req, res, next);
});

// 256 KB: a workspace logo is a data URL of up to 200,000 characters (the default 100 KB limit refused logos between 100 and 200 KB).
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Normalize Vercel rewrite { "source": "/api/(.*)", "destination": "/api" } so Express always sees /api/<subpath>
app.use((req, _res, next) => {
  if (req.url === '/api' || req.url.startsWith('/api?')) {
    const matchHeader = req.headers['x-now-route-matches'];
    if (typeof matchHeader === 'string') {
      const params = new URLSearchParams(matchHeader);
      const captured = params.get('1');
      if (captured) {
        const qIndex = req.url.indexOf('?');
        const query = qIndex >= 0 ? req.url.slice(qIndex) : '';
        req.url = `/api/${decodeURIComponent(captured).replace(/^\/+/, '')}${query}`;
      }
    }
  } else if (!req.url.startsWith('/api') && Boolean(process.env.VERCEL)) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  next();
});

// MCP endpoint and its OAuth documents live at the site root (clients look for /mcp and /.well-known/*)
app.use(['/mcp', '/api'], featureGate);
app.use('/mcp', mcpRouter);
app.use(oauthRouter);

// Mount API routes
app.use('/api/health', healthRouter);
app.use('/api/public-config', publicConfigRouter);
app.use('/api/auth', authRouter);
app.use('/api/session', sessionRouter);
app.use('/api/me', meRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/connections/meta', metaConnectionRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/google', googleApiRouter);
app.use('/api/explore', exploreRouter);
app.use('/api/datasets', datasetsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/email-schedules', emailSchedulesRouter);
app.use('/api/shared', sharedRouter);
app.use('/api/dashboards', dashboardsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/mcp', mcpAccountRouter);
app.use('/api/ga4', ga4Router);
app.use('/api/search-console', searchConsoleRouter);
app.use('/api/platform', metaCallbacksRouter);
app.use('/api/meta', metaRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/ops', opsRouter);
app.use('/api/digest', digestRouter);
app.use('/api/unsubscribe', unsubscribeRouter);
app.use('/api/billing', billingRouter);
app.use('/api/team', teamRouter);
app.use('/api/2fa', twoStepRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sso', ssoRouter);
app.use('/api/security', securityRouter);

// Last resort for anything a route did not catch. Reports it (without request data) and answers with a plain message.
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const status = (err as { status?: number; statusCode?: number } | null)?.status ?? (err as { statusCode?: number } | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read.' } });
    return;
  }
  console.error('[unhandled]', err instanceof Error ? err.name : 'Error');
  void reportError(err, { method: req.method, path: req.path });
  res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
});

const NO_CACHE_FILES = new Set([
  'sw.js',
  'version.json',
  'manifest.webmanifest',
  'offline.html',
  'index.html',
]);

export function configureStatic(targetApp: express.Express, staticDistPath: string): void {
  const resolvedDist = path.resolve(staticDistPath);

  targetApp.use(
    express.static(resolvedDist, {
      setHeaders(res, filePath) {
        const rel = path.relative(resolvedDist, filePath).split(path.sep).join('/');
        if (rel.startsWith('assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (rel.startsWith('icons/')) {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        } else if (NO_CACHE_FILES.has(rel)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  targetApp.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (req.path === '/assets' || req.path.startsWith('/assets/')) {
      res.status(404).end();
      return;
    }
    const ext = path.posix.extname(req.path).toLowerCase();
    if (ext !== '' && ext !== '.html') {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(resolvedDist, 'index.html'));
  });
}

// Serve static frontend build in production when running npm start (not needed on Vercel, which serves /dist directly)
const isProduction = process.env.NODE_ENV === 'production';
const isVercel = Boolean(process.env.VERCEL);
const distPath = path.resolve(__dirname, '../dist');

if (isProduction && !isVercel) {
  configureStatic(app, distPath);
}

export default app;
