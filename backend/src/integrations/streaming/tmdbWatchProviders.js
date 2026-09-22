/**
 * Streaming availability provider built on TMDB's /watch/providers endpoint.
 *
 * Legal-only guarantee (section 17): we surface exactly what the upstream returns
 * for the requested region. We never infer, compute or invent availability, and an
 * empty result is reported as "no legal viewing options found for your region"
 * rather than filled in with guesses.
 */
import config from '../../config/env.js';
import { imageUrl } from '../tmdb/normalise.js';
import { getTmdb } from '../tmdb/index.js';
import { StreamingCategory, countryName, toCountryCode } from '../../database/constants.js';

const CATEGORY_MAP = [
  [StreamingCategory.STREAM, 'flatrate'],
  [StreamingCategory.RENT, 'rent'],
  [StreamingCategory.BUY, 'buy'],
];

function toProvider(rawEntry, category) {
  return {
    key: String(rawEntry.provider_id),
    name: rawEntry.provider_name,
    logoPath: rawEntry.logo_path ?? null,
    logoUrl: imageUrl(rawEntry.logo_path, 'w92'),
    category,
    deepLink: null, // filled from the region `link` below — TMDB provides one link per region, not per provider
    priceText: rawEntry.price ?? null,
    quality: null,
    priority: rawEntry.display_priority ?? 999,
  };
}

export const tmdbWatchProviders = {
  name: 'tmdb',
  isMock: false,

  async availability({ mediaType, tmdbId, region = config.streaming.defaultRegion }) {
    const regionCode = toCountryCode(region, config.streaming.defaultRegion);
    const payload = await getTmdb().watchProviders(mediaType, tmdbId, regionCode);
    const bucket = payload?.results?.[regionCode] ?? null;

    const groups = CATEGORY_MAP.map(([category, key]) => {
      const entries = Array.isArray(bucket?.[key]) ? bucket[key] : [];
      return {
        category,
        providers: entries
          .map((e) => toProvider(e, category))
          .map((p) => ({ ...p, deepLink: bucket?.link ?? null }))
          .sort((a, b) => a.priority - b.priority),
      };
    }).filter((g) => g.providers.length > 0);

    return {
      region: regionCode,
      regionName: countryName(regionCode),
      link: bucket?.link ?? null,
      groups,
      hasAny: groups.length > 0,
      isMock: false,
      source: 'tmdb',
    };
  },
};

export default tmdbWatchProviders;
