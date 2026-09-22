import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import * as watchlistController from '../controllers/watchlistController.js';
import { validateQuery } from '../middleware/validate.js';
import { watchlistQuerySchema, watchlistAddSchema, watchlistRemoveSchema, watchlistCheckSchema } from '../validation/schemas.js';

const router = Router();

router.get('/', requireAuth, validateQuery(watchlistQuerySchema), watchlistController.list);
router.post('/', requireAuth, writeLimiter, validateBody(watchlistAddSchema), watchlistController.add);

/**
 * GET /api/watchlist/check?mediaType=movie&tmdbId=27205
 * Lets the app render the correct Save/Remove state without downloading the list.
 */
router.get('/check', requireAuth, validateQuery(watchlistCheckSchema), watchlistController.check);

router.delete('/', requireAuth, validateBody(watchlistRemoveSchema), watchlistController.remove);
router.delete('/:id', requireAuth, watchlistController.remove);
router.delete('/all', requireAuth, watchlistController.clear);

export { optionalAuth };
export default router;
