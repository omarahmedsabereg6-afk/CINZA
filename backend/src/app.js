/**
 * Express application assembly.
 *
 * Middleware order is deliberate:
 *   requestId/timing -> security headers -> CORS -> body parsers -> routes
 *   -> 404 -> error funnel
 *
 * In development the API can also serve the app bundle (`SERVE_APP=true`), which
 * gives one origin for the whole product and removes CORS from the picture entirely
 * while testing.
 */
import express from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import config from './config/env.js';
import { createLogger } from './utils/logger.js';
import { requestContext, accessLog } from './middleware/requestContext.js';
import { securityHeaders, corsMiddleware } from './middleware/security.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

const log = createLogger('app');

export function createApp() {
  const app = express();

  // Behind a proxy we must trust it to get real client IPs for rate limiting.
  app.set('trust proxy', config.security.trustProxy);
  app.disable('x-powered-by');
  app.set('etag', 'strong');

  app.use(requestContext);
  app.use(securityHeaders());
  app.use(corsMiddleware());
  app.use(accessLog);

  // 8mb accommodates a thumbnail data URL plus metadata; images travel as multipart.
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use('/api', globalLimiter, apiRoutes);

  /* ---------------- optional static hosting of the app ---------------- */
  let appServed = false;
  if (config.serveApp) {
    const webDir = resolve(config.paths.appDir, 'www');
    const sourceDir = config.paths.appDir;
    const dir = existsSync(join(webDir, 'index.html')) ? webDir : sourceDir;

    if (existsSync(join(dir, 'index.html'))) {
      appServed = true;
      log.info(`serving app bundle from ${dir}`);
      app.use(
        express.static(dir, {
          etag: true,
          maxAge: config.isProduction ? '1h' : 0,
          setHeaders(res, filePath) {
            if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
          },
        })
      );

      // Unknown non-API GETs render the shell so the client router handles deep links.
      app.get(/^\/(?!api\/).*/, (req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(join(dir, 'index.html'));
      });
    } else {
      log.warn(
        `SERVE_APP is on but no index.html was found in ${webDir} or ${sourceDir}. ` +
          'Run `npm run build` inside app/ (or `npm run dev` at the root) to produce the bundle.'
      );
    }
  }

  /**
   * Root convenience endpoint. Only registered when this process is NOT also
   * serving the app, because otherwise it would shadow the app's index.html —
   * which is exactly the kind of ordering bug that makes a deployed build look
   * like a blank page.
   */
  if (!appServed) {
    app.get('/', (_req, res) => {
      res.json({
        name: 'CINZA API',
        status: 'running',
        environment: config.env,
        routes: '/api',
        health: '/api/meta/health',
        config: '/api/meta/config',
        note: 'The app bundle is not served by this process (SERVE_APP=false or no build present).',
      });
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
