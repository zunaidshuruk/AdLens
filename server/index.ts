import http from 'http';
import { app } from './app.js';

export { app };

let activeServer: http.Server | null = null;

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
      activeServer?.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 100);
      return;
    }
    res.status(403).end();
  });
}

const isTestEnv = Boolean(process.env.NODE_TEST_CONTEXT);

if (!isTestEnv) {
  const port = Number(process.env.API_PORT || process.env.PORT || 3000);

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
