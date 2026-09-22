/**
 * API route index.
 *
 * Everything is mounted under /api so the app has a single predictable prefix, and
 * GET /api returns a machine-readable route list — which makes it obvious that a
 * requested endpoint does not exist (and why) instead of surfacing a bare 404.
 */
import { Router } from 'express';
import metaRoutes from './meta.routes.js';
import authRoutes from './auth.routes.js';
import recognitionRoutes from './recognitions.routes.js';
import historyRoutes from './history.routes.js';
import watchlistRoutes from './watchlist.routes.js';
import catalogRoutes from './catalog.routes.js';
import feedbackRoutes from './feedback.routes.js';

const router = Router();

router.use('/meta', metaRoutes);
router.use('/auth', authRoutes);
router.use('/recognitions', recognitionRoutes);
router.use('/history', historyRoutes);
router.use('/watchlist', watchlistRoutes);
router.use('/feedback', feedbackRoutes);

/**
 * Catalog + search resources are mounted at the API root so the paths match the
 * documented contract exactly: /api/search, /api/discover, /api/movies/:id,
 * /api/tv/:id, /api/people/:id.
 */
router.use('/', catalogRoutes);

/** Route index. */
router.get('/', (_req, res) => {
  res.json({
    name: 'CINZA API',
    version: '1.0.0',
    documentation: 'See README.md > API reference',
    routes: {
      meta: ['GET /api', 'GET /api/meta/config', 'GET /api/meta/health', 'GET /api/meta/metrics'],
      auth: [
        'POST /api/auth/register',
        'POST /api/auth/login',
        'POST /api/auth/refresh',
        'POST /api/auth/logout',
        'POST /api/auth/logout-all',
        'POST /api/auth/forgot-password',
        'POST /api/auth/reset-password',
        'GET /api/auth/me',
        'GET /api/auth/settings',
        'PATCH /api/auth/profile',
        'DELETE /api/auth/account',
      ],
      recognition: [
        'POST /api/recognitions (multipart: image|images[]|frame[]|video|meta)',
        'GET /api/recognitions',
        'GET /api/recognitions/:id',
        'DELETE /api/recognitions/:id',
      ],
      history: ['GET /api/history', 'GET /api/history/stats', 'DELETE /api/history'],
      watchlist: [
        'GET /api/watchlist',
        'POST /api/watchlist',
        'GET /api/watchlist/check',
        'DELETE /api/watchlist/:id',
        'DELETE /api/watchlist',
      ],
      search: [
        'GET /api/search?q=&type=all|movie|tv|person',
        'GET /api/search/recent',
        'DELETE /api/search/recent',
        'GET /api/discover',
        'GET /api/people/:id',
      ],
      catalog: [
        'GET /api/movies/:id',
        'GET /api/tv/:id',
        'GET /api/tv/:id/seasons/:seasonNumber',
        'GET /api/movie|tv/:id/stills',
        'GET /api/movie|tv/:id/availability?region=US',
      ],
      feedback: ['POST /api/feedback', 'GET /api/feedback/stats'],
    },
  });
});

export default router;
