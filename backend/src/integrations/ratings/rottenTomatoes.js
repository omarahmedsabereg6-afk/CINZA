import config from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import { caches } from '../../utils/cache.js';
import {
  RatingProvider,
  buildTitleMatchInput,
  normaliseRottenTomatoesResponse,
  unavailableRating,
} from './schema.js';

const log = createLogger('ratings:rotten_tomatoes');

export function isRottenTomatoesConfigured(rtConfig = config.ratings.rottenTomatoes) {
  return Boolean(rtConfig?.enabled && rtConfig.apiKey && rtConfig.baseUrl);
}

export async function findRottenTomatoesTitle(input, { fetchImpl = fetch, rtConfig = config.ratings.rottenTomatoes } = {}) {
  if (!isRottenTomatoesConfigured(rtConfig)) return null;

  // This is intentionally only an official-provider placeholder. The exact
  // endpoint and request shape must be adapted after Rotten Tomatoes supplies
  // licensed API/Data Feed documentation. Do not replace this with scraping or
  // undocumented endpoints.
  const url = new URL('/titles/match', rtConfig.baseUrl);
  if (input.title) url.searchParams.set('title', input.title);
  if (input.originalTitle) url.searchParams.set('originalTitle', input.originalTitle);
  if (input.year) url.searchParams.set('year', String(input.year));
  if (input.mediaType) url.searchParams.set('mediaType', input.mediaType);

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${rtConfig.apiKey}`,
    },
    signal: AbortSignal.timeout(rtConfig.timeoutMs),
  });

  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.id ?? payload?.rottenTomatoesId ?? payload?.result?.id ?? null;
}

export async function fetchRottenTomatoesRating(input, { fetchImpl = fetch, rtConfig = config.ratings.rottenTomatoes } = {}) {
  if (!isRottenTomatoesConfigured(rtConfig)) return unavailableRating(RatingProvider.ROTTEN_TOMATOES, 'disabled_or_unconfigured');

  const match = buildTitleMatchInput(input);
  if (!match?.title) return unavailableRating(RatingProvider.ROTTEN_TOMATOES, 'insufficient_title_data');

  const cacheKey = `rt:${match.mediaType}:${match.sourceId}:${match.title}:${match.year ?? ''}`;
  return caches.ratings.wrap(cacheKey, rtConfig.cacheTtlMs, async () => {
    try {
      const rtId = await findRottenTomatoesTitle(match, { fetchImpl, rtConfig });
      if (!rtId) return unavailableRating(RatingProvider.ROTTEN_TOMATOES, 'no_match');

      // Official-provider placeholder only. Endpoint will be finalized after
      // authorization and documentation are available.
      const url = new URL(`/titles/${encodeURIComponent(rtId)}/ratings`, rtConfig.baseUrl);
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${rtConfig.apiKey}`,
        },
        signal: AbortSignal.timeout(rtConfig.timeoutMs),
      });

      if (!response.ok) return unavailableRating(RatingProvider.ROTTEN_TOMATOES, 'request_failed');
      const payload = await response.json();
      const normalised = normaliseRottenTomatoesResponse(payload);
      return normalised.available ? normalised : unavailableRating(RatingProvider.ROTTEN_TOMATOES, 'no_rating_data');
    } catch (error) {
      log.warn('Rotten Tomatoes rating unavailable', { reason: error?.name ?? 'error' });
      return unavailableRating(RatingProvider.ROTTEN_TOMATOES, 'provider_error');
    }
  });
}

export default { fetchRottenTomatoesRating, findRottenTomatoesTitle, isRottenTomatoesConfigured };
