import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.js';
import { connectionsRouter, googleApiRouter } from './routes/connections.js';
import { ga4Router } from './routes/ga4.js';
import { healthRouter } from './routes/health.js';
import { metaRouter } from './routes/meta.js';
import { reportsRouter } from './routes/reports.js';
import { searchConsoleRouter } from './routes/searchConsole.js';

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
app.use('/api/auth', authRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/google', googleApiRouter);
app.use('/api/ga4', ga4Router);
app.use('/api/search-console', searchConsoleRouter);
app.use('/api/meta', metaRouter);
app.use('/api/reports', reportsRouter);

// Serve static frontend build in production when running npm start (not needed on Vercel, which serves /dist directly)
const isProduction = process.env.NODE_ENV === 'production' || !process.env.API_PORT;
const isVercel = Boolean(process.env.VERCEL);
const distPath = path.resolve(__dirname, '../dist');

if (isProduction && !isVercel) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

export default app;
