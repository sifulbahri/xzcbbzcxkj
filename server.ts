import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDb, initDatabase, resolveDbPath } from './server/database.ts';
import {
  apiRateLimiter,
  configureHelmet,
  requireAuthIfPublic,
  sanitizeLogError,
} from './server/middleware/security.ts';
import applicationsRouter from './server/routes/applications.ts';
import cvRouter from './server/routes/cv.ts';
import dashboardRouter from './server/routes/dashboard.ts';
import jobsRouter from './server/routes/jobs.ts';
import settingsRouter from './server/routes/settings.ts';
import { getAiReadiness } from './server/services/aiProvider.ts';

async function startServer() {
  initDatabase();

  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST?.trim() || '0.0.0.0';

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(configureHelmet());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use('/api', apiRateLimiter);
  app.use('/api', requireAuthIfPublic);

  app.get('/api/health', (_req, res) => {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      const ai = getAiReadiness();
      res.json({
        status: 'ok',
        service: 'glints-ai-job-assistant',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          path: path.basename(resolveDbPath()),
        },
        ai: {
          configured: ai.configured,
          activeProvider: ai.activeProvider,
          activeModel: ai.activeModel,
        },
      });
    } catch (err) {
      console.error('[GET /api/health]', sanitizeLogError(err));
      res.status(500).json({ status: 'error', error: 'Database health check failed.' });
    }
  });

  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api/cv', cvRouter);
  app.use('/api/settings', settingsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('[Express Error]', sanitizeLogError(err));
      res.status(500).json({ error: 'Internal server error.' });
    }
  );

  app.listen(port, host, () => {
    console.log(`Glints AI Job Assistant listening on http://${host}:${port} (${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', sanitizeLogError(err));
  process.exit(1);
});
