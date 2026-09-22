import { Router } from 'express';
import { validateQuery } from '../middleware/validate.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import * as catalogController from '../controllers/catalogController.js';
import {
  searchQuerySchema,
  catalogQuerySchema,
  seasonParamsSchema,
  availabilityQuerySchema,
  discoverQuerySchema,
  genreQuerySchema,
} from '../validation/schemas.js';

const router = Router();

/**
 * GET /api/search?q=dune&type=all|movie|tv|person
 * Movies, series, actors and directors — all resolved server-side against TMDB
 * (section 20). Signed-in searches are added to SearchHistory.
 */
router.get('/search', optionalAuth, validateQuery(searchQuerySchema), catalogController.search);
router.get('/search/recent', optionalAuth, catalogController.recentSearches);
router.delete('/search/recent', requireAuth, catalogController.clearRecentSearches);

/** Home rails: trending, popular movies, popular series. */
router.get('/discover', optionalAuth, validateQuery(discoverQuerySchema), catalogController.discover);

router.get('/movies/:id', validateQuery(catalogQuerySchema), catalogController.getMovie);
router.get('/movies/:id/credits', catalogController.getMovieCredits);
router.get('/movies/:id/recommendations', catalogController.getRelatedTitles);
router.get('/movies/:id/similar', catalogController.getRelatedTitles);
router.get('/tv/:id', validateQuery(catalogQuerySchema), catalogController.getSeries);
router.get('/tv/:id/credits', catalogController.getSeriesCredits);
router.get('/tv/:id/recommendations', catalogController.getRelatedTitles);
router.get('/tv/:id/similar', catalogController.getRelatedTitles);
router.get('/tv/:id/seasons/:seasonNumber', catalogController.getSeason);

/** Reference stills for the Matched Scene block. */
router.get('/:mediaType(movies?|tv)/:id/stills', catalogController.getStills);

/** Where to Watch — region aware, legal providers only (section 17). */
router.get('/:mediaType(movies?|tv)/:id/availability', optionalAuth, validateQuery(availabilityQuerySchema), catalogController.getAvailability);

router.get('/people/:id', catalogController.getPerson);
router.get('/people/:id/credits', catalogController.getPersonCredits);

/* ----------------------------- genre filter --------------------------- */

router.get('/discover/genre', optionalAuth, validateQuery(genreQuerySchema), catalogController.discoverByGenre);

export { catalogQuerySchema, seasonParamsSchema, genreQuerySchema };
export default router;
