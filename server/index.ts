import cookieParser from 'cookie-parser';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.ts';
import { connectionsRouter, googleApiRouter } from './routes/connections.ts';
import { healthRouter } from './routes/health.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// Enable Secure cookies behind reverse proxy / Cloud Run
app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());

// Mount API routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/google', googleApiRouter);

// Serve static frontend build in production (or when running npm start)
const isProduction = process.env.NODE_ENV === 'production' || !process.env.API_PORT;
const distPath = path.resolve(__dirname, '../dist');

if (isProduction) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const isTestEnv = Boolean(process.env.NODE_TEST_CONTEXT);

if (!isTestEnv) {
  const port = Number(process.env.API_PORT || process.env.PORT || 3000);
  let activeServer: http.Server | null = null;

  app.post('/api/_dev_reload', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    if (ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost')) {
      res.json({ ok: true });
      activeServer?.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 100);
      return;
    }
    res.status(403).end();
  });

  const startListening = () => {
    activeServer = app.listen(port, '0.0.0.0', () => {
      console.log(`Server listening on http://0.0.0.0:${port}`);
    });

    activeServer.on('error', async (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && process.env.API_PORT) {
        try {
          await fetch(`http://127.0.0.1:${port}/api/_dev_reload`, { method: 'POST' });
        } catch {
          // ignore
        }
        setTimeout(() => {
          const retryServer = app.listen(port, '0.0.0.0', () => {
            console.log(`Server listening on http://0.0.0.0:${port}`);
          });
          retryServer.on('error', () => process.exit(0));
        }, 250);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });
  };

  startListening();
}
