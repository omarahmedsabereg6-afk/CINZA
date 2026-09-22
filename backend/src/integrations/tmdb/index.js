/**
 * TMDB provider selection.
 *
 * Every consumer imports `getTmdb()` and never a concrete client, so switching
 * between the live API and the fixture catalog is a single env change
 * (TMDB_PROVIDER=tmdb + a credential, or TMDB_PROVIDER=mock).
 *
 * Both adapters satisfy this interface:
 *
 *   searchMulti(query, opts)          -> { results: TmdbItem[] }
 *   searchMovie(query, opts)          -> { results }
 *   searchTv(query, opts)             -> { results }
 *   searchPerson(query, opts)         -> { results }
 *   person(id)                        -> raw person or null
 *   movieDetail(id)                   -> raw movie (incl. credits, videos) or null
 *   tvDetail(id)                      -> raw tv (incl. credits, seasons) or null
 *   season(tvId, seasonNumber)        -> raw season or null
 *   images(mediaType, id)             -> { stills, backdrops }
 *   trending({ mediaType, window })   -> { results }
 *   popular(mediaType)                -> { results }
 *   watchProviders(mediaType, id, region) -> { results: { [REGION]: {...} } }
 *
 * `isMock` is exposed so the pipeline can stamp results as simulated.
 */
import config from '../../config/env.js';
import tmdbClient from './tmdbClient.js';
import mockTmdb from './mockTmdb.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tmdb');

let announced = false;

export function getTmdb() {
  const provider = config.tmdb.enabled ? tmdbClient : mockTmdb;
  if (!announced) {
    announced = true;
    if (provider.isMock) {
      log.warn('TMDB is running in MOCK mode — results are simulated fixtures, not real metadata.');
      log.warn('Enable live data with: TMDB_PROVIDER=tmdb and TMDB_ACCESS_TOKEN=<v4 token>');
    } else {
      log.info('TMDB live mode enabled.');
    }
  }
  return provider;
}

export const isMockTmdb = () => getTmdb().isMock;

export * as normalise from './normalise.js';
export default getTmdb;
