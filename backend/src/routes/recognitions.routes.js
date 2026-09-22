import { Router } from 'express';
import { recognitionUpload, uploadErrorHandler } from '../middleware/upload.js';
import { validateUploadMeta, validateQuery } from '../middleware/validate.js';
import { optionalAuth } from '../middleware/auth.js';
import { recognitionLimiter } from '../middleware/rateLimit.js';
import * as recognitionController from '../controllers/recognitionController.js';
import * as historyController from '../controllers/historyController.js';
import { recognitionMetaSchema, recognitionQuerySchema } from '../validation/schemas.js';

const router = Router();

/**
 * POST /api/recognitions
 *
 * multipart/form-data:
 *   image   | images[] | frame[]   one or more stills (video frames are sent as images)
 *   video                         optional raw video (server-side extraction)
 *   meta                          JSON: { mode, source, describe, region, language, files[] }
 *
 * Allowed anonymously: an anonymous recognition is stored without an owner and is
 * readable only from the device that created it.
 */
router.post(
  '/',
  recognitionLimiter,
  optionalAuth,
  recognitionUpload,
  uploadErrorHandler,
  validateUploadMeta(recognitionMetaSchema),
  validateQuery(recognitionQuerySchema),
  recognitionController.createRecognition
);

/** Capability probe: tells the app what upload modes will actually work. */
router.get('/', recognitionLimiter, recognitionController.recognitionCapabilities);

/** History lives under /api/recognitions for the CRUD-by-id half of the resource. */
router.get('/:id', optionalAuth, historyController.getRecognition);
router.delete('/:id', optionalAuth, historyController.deleteRecognition);

export default router;
