/**
 * Streaming availability abstraction (section 19).
 *
 * The whole point of this file is that NOTHING outside `integrations/streaming/`
 * knows which service answers. Today there are two implementations:
 *
 *   tmdb   — TMDB /watch/providers  (JustWatch-sourced, legal, region aware)
 *   mock   — fixture catalog        (offline development)
 *
 * To integrate a licensing API later (JustWatch's own API, Watchmode, a studio
 * feed), add `myProvider.js` exporting the same interface and register it in
 * REGISTRY. No service, controller or app code changes:
 *
 *   availability({ mediaType, tmdbId, region })
 *     -> { region, regionName, link, groups: [{category, providers:[...]}], hasAny, isMock, source }
 *
 * Response caching lives here so every implementation benefits, since licensing
 * data changes slowly and these calls are the most rate-limited of all.
 */
import config from '../../config/env.js';
import { caches } from '../../utils/cache.js';
import { createLogger } from '../../utils/logger.js';
import { recordApiCall } from '../../services/metricsService.js';
import tmdbWatchProviders from './tmdbWatchProviders.js';
import mockStreaming from './mockStreaming.js';
import { toCountryCode, countryName } from '../../database/constants.js';

const log = createLogger('streaming');

const REGISTRY = {
  tmdb: tmdbWatchProviders,
  mock: mockStreaming,
};

let announced = false;

export function getStreamingProvider() {
  const provider = config.streaming.enabled ? REGISTRY[config.streaming.provider] ?? mockStreaming : mockStreaming;
  if (!announced) {
    announced = true;
    if (provider.isMock) {
      log.warn('Streaming availability is running in MOCK mode — provider lists are simulated fixtures.');
    } else {
      log.info(`Streaming availability live: ${provider.name}`);
    }
  }
  return provider;
}

export async function getAvailability({ mediaType, tmdbId, region = config.streaming.defaultRegion }) {
  const provider = getStreamingProvider();
  const regionCode = toCountryCode(region, config.streaming.defaultRegion);
  const key = `${provider.name}:${mediaType}:${tmdbId}:${regionCode}`;

  const cached = caches.providers.get(key);
  if (cached) {
    recordApiCall({ kind: 'streaming', provider: provider.name, operation: 'availability', ok: true, cacheHit: true, durationMs: 0 });
    return { ...cached, cached: true };
  }

  const started = Date.now();
  try {
    const result = await provider.availability({ mediaType, tmdbId, region: regionCode });
    recordApiCall({
      kind: 'streaming',
      provider: provider.name,
      operation: 'availability',
      ok: true,
      durationMs: Date.now() - started,
    });
    caches.providers.set(key, result);
    return { ...result, cached: false };
  } catch (error) {
    recordApiCall({
      kind: 'streaming',
      provider: provider.name,
      operation: 'availability',
      ok: false,
      durationMs: Date.now() - started,
    });
    // Availability is supplementary: never fail a whole screen because a licensing
    // lookup is down. Return an explicit, non-fabricated empty result.
    log.warn(`availability lookup failed for ${mediaType}/${tmdbId}: ${error.message}`);
    return {
      region: regionCode,
      regionName: countryName(regionCode),
      link: null,
      groups: [],
      hasAny: false,
      isMock: provider.isMock,
      source: provider.name,
      error: true,
      notice: 'Viewing options could not be loaded right now. Please try again.',
    };
  }
}

export default { getStreamingProvider, getAvailability };
