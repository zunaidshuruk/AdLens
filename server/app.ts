import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.js';
import { connectionsRouter, googleApiRouter } from './routes/connections.js';
import { ga4Router } from './routes/ga4.js';
import { healthRouter } from './routes/health.js';
import { metaRouter } from './routes/meta.js';
import { publicConfigRouter } from './routes/publicConfig.js';
import { reportsRouter } from './routes/reports.js';
import { searchConsoleRouter } from './routes/searchConsole.js';
import { sessionRouter } from './routes/session.js';
import { meRouter, workspacesRouter } from './routes/workspaces.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// Enable Secure cookies behind reverse proxy / Cloud Run / Vercel
app.set('trust proxy', 1);

app.use(express.json());
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

// Mount API routes
app.use('/api/health', healthRouter);
app.use('/api/public-config', publicConfigRouter);
app.use('/api/auth', authRouter);
app.use('/api/session', sessionRouter);
app.use('/api/me', meRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/google', googleApiRouter);
app.use('/api/ga4', ga4Router);
app.use('/api/search-console', searchConsoleRouter);
app.use('/api/meta', metaRouter);
app.use('/api/reports', reportsRouter);

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
