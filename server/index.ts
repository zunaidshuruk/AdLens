import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { healthRouter } from './routes/health';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

app.use(express.json());

// Mount API routes
app.use('/api/health', healthRouter);

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

const port = Number(process.env.API_PORT || process.env.PORT || 3000);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && process.env.API_PORT) {
    console.log(`API server port ${port} already active, reusing existing listener.`);
    process.exit(0);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});
