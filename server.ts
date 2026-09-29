import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { healthPayload, runProcessEstimate, runGenerateWorkOrders } from './serverRoutines.js';

// Env files/keys live in env/ (see env/README.md); root paths kept as legacy fallback.
dotenv.config({ path: ['env/.env.local', 'env/.env', '.env.local', '.env'] });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '60mb' }));
  app.use(express.urlencoded({ extended: true, limit: '60mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json(healthPayload());
  });

  // Process Xactimate Estimate
  app.post('/api/process-estimate', async (req, res) => {
    const result = await runProcessEstimate(req.body || {});
    res.status(result.status).json(result.body);
  });

  // Generate subcontractor field work orders (zero financial visibility)
  app.post('/api/generate-work-orders', async (req, res) => {
    const result = await runGenerateWorkOrders(req.body || {});
    res.status(result.status).json(result.body);
  });

  // Client side or static serving
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Operational Workspace server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
