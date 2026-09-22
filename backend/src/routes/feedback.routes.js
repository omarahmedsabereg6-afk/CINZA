import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { optionalAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import * as metaController from '../controllers/metaController.js';
import { feedbackSchema } from '../validation/schemas.js';

const router = Router();

/**
 * POST /api/feedback  (section 34)
 *
 * "Yes, that's right" / "No, it is actually ..." on a result. Anonymous callers may
 * submit feedback, because a signed-out user's correction is just as useful — it is
 * simply not attributed to an account.
 *
 * A correction also re-labels the stored recognition, so History stops showing an
 * answer the user has already told us is wrong.
 */
router.post('/', writeLimiter, optionalAuth, validateBody(feedbackSchema), metaController.createFeedback);

/** Aggregate accuracy — how often users confirm a result. */
router.get('/stats', metaController.getFeedbackStats);

export default router;
