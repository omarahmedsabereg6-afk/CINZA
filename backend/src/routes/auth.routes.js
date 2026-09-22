import { Router } from 'express';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import * as authController from '../controllers/authController.js';
import * as metaController from '../controllers/metaController.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  deleteAccountSchema,
} from '../validation/schemas.js';

const router = Router();

/* --------------------------- public --------------------------- */

router.post('/register', authLimiter, validateBody(registerSchema), authController.register);
router.post('/login', authLimiter, validateBody(loginSchema), authController.login);
router.post('/refresh', validateBody(refreshSchema), authController.refresh);
router.post('/logout', validateBody(refreshSchema), authController.logout);
router.post('/forgot-password', authLimiter, validateBody(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', authLimiter, validateBody(resetPasswordSchema), authController.resetPassword);

/* ------------------------ authenticated ----------------------- */

router.get('/me', requireAuth, authController.me);
router.post('/logout-all', requireAuth, authController.logoutAll);

/** Combined settings payload used by the Profile screen (section 21). */
router.get('/settings', requireAuth, metaController.getSettings);
router.patch('/profile', requireAuth, validateBody(updateProfileSchema), metaController.updateProfile);
router.delete('/account', requireAuth, validateBody(deleteAccountSchema), metaController.deleteAccount);

export { optionalAuth };
export default router;
