import http from 'http';
import { app } from './app.js';

export { app };

let activeServer: http.Server | null = null;
let secondaryServer: http.Server | null = null;

// Register /api/_dev_reload ONLY when NODE_ENV !== 'production'
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/_dev_reload', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      res.status(404).end();
      return;
    }
    const ip = req.ip || req.socket.remoteAddress || '';
    if (ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost')) {
      res.json({ ok: true });
      secondaryServer?.close();
      activeServer?.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 50);
      return;
    }
    res.status(403).end();
  });
}

const isTestEnv = Boolean(process.env.NODE_TEST_CONTEXT);

async function startServer(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  const port = Number(process.env.API_PORT || process.env.PORT || 3000);

  if (!isProduction && !process.env.API_PORT) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  let retries = 0;

  const startListening = () => {
    const server = app.listen(port, '0.0.0.0', () => {
      activeServer = server;
      console.log(`Server listening on http://0.0.0.0:${port}`);

      // Also listen on 3001 in dev mode if primary port is 3000 so any direct 3001 proxy calls succeed
      if (!isProduction && port !== 3001) {
        const sec = app.listen(3001, '0.0.0.0', () => {
          secondaryServer = sec;
        });
        sec.on('error', () => {
          // Ignore if 3001 is already occupied
        });
      }
    });

    server.on('error', async (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && !isProduction && retries < 5) {
        retries += 1;
        try {
          await fetch(`http://127.0.0.1:${port}/api/_dev_reload`, { method: 'POST' });
        } catch {
          // ignore
        }
        setTimeout(startListening, 200);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });
  };

  startListening();
}

if (!isTestEnv) {
  void startServer();
}
