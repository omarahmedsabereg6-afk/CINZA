import { Router } from 'express';
import * as metaController from '../controllers/metaController.js';

const router = Router();

/**
 * GET /api/meta/config
 *
 * The app fetches this once at boot. It drives capability gating (which buttons
 * exist), upload limits, the region list, and the mock-mode banners. It contains no
 * credentials of any kind (section 28).
 */
router.get('/config', metaController.getConfig);

/** Liveness + dependency status. Returns 503 when the database is unreachable. */
router.get('/health', metaController.getHealth);

/** Usage/cost telemetry for the developer screen (section 41). */
router.get('/metrics', metaController.getMetrics);

export default router;
