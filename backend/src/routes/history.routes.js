import { Router } from 'express';
import { validateQuery } from '../middleware/validate.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import * as historyController from '../controllers/historyController.js';
import { historyQuerySchema } from '../validation/schemas.js';

const router = Router();

/**
 * GET /api/history
 *
 * Anonymous callers receive an empty list with `storage: "device"`. Anonymous
 * recognitions are never readable through the API — the app keeps them on-device,
 * which is what makes "your screenshots stay on your phone" true (section 40).
 */
router.get('/', optionalAuth, validateQuery(historyQuerySchema), historyController.listHistory);

/** Aggregate counts for the Profile screen. */
router.get('/stats', requireAuth, historyController.historyStats);

/** "Clear History" action. */
router.delete('/', requireAuth, historyController.clearHistory);

export default router;
