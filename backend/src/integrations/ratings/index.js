import { RatingProvider, tmdbRating, unavailableRating } from './schema.js';
import { fetchRottenTomatoesRating } from './rottenTomatoes.js';

export async function getExternalRatings(detail, options = {}) {
  const tmdb = tmdbRating({ voteAverage: detail?.voteAverage, voteCount: detail?.voteCount });
  const rottenTomatoes = await fetchRottenTomatoesRating(detail, options);

  return {
    tmdb,
    rottenTomatoes: rottenTomatoes ?? unavailableRating(RatingProvider.ROTTEN_TOMATOES, 'unavailable'),
  };
}

export { RatingProvider, tmdbRating, unavailableRating } from './schema.js';
export { fetchRottenTomatoesRating, findRottenTomatoesTitle, isRottenTomatoesConfigured } from './rottenTomatoes.js';
