/**
 * Mock streaming adapter.
 *
 * Returns the same shape as the live adapter, built from the same fixture catalog
 * that backs the mock TMDB adapter. Every payload is tagged `isMock: true`, which
 * the app renders as a "simulated availability" note — so a demo is never mistaken
 * for real licensing data.
 *
 * For regions the fixture does not cover we return an EMPTY result, which is the
 * correct, honest behaviour and lets the "no legal viewing options found for your
 * region" state be tested.
 */
import { getTmdb } from '../tmdb/index.js';
import { imageUrl } from '../tmdb/normalise.js';
import { StreamingCategory, regionName } from '../../database/constants.js';

/** Regions the fixture pretends to have licensing data for. */
const FIXTURE_REGIONS = new Set(['US', 'GB', 'CA', 'DE', 'FR', 'ES', 'BR', 'MX', 'AU', 'PT']);

const CATEGORY_MAP = [
  [StreamingCategory.STREAM, 'flatrate'],
  [StreamingCategory.RENT, 'rent'],
  [StreamingCategory.BUY, 'buy'],
];

export const mockStreaming = {
  name: 'mock',
  isMock: true,

  async availability({ mediaType, tmdbId, region = 'US' }) {
    const regionCode = String(region).toUpperCase();

    if (!FIXTURE_REGIONS.has(regionCode)) {
      return {
        region: regionCode,
        regionName: regionName(regionCode),
        link: null,
        groups: [],
        hasAny: false,
        isMock: true,
        source: 'mock',
        notice: `Simulated availability has no fixture data for ${regionCode}. The live TMDB provider would be queried here.`,
      };
    }

    const payload = await getTmdb().watchProviders(mediaType, tmdbId, regionCode);
    const bucket = payload?.results?.[regionCode] ?? null;

    const groups = CATEGORY_MAP.map(([category, key]) => {
      const entries = Array.isArray(bucket?.[key]) ? bucket[key] : [];
      return {
        category,
        providers: entries
          .map((e) => ({
            key: String(e.provider_id),
            name: e.provider_name,
            logoPath: null,
            logoUrl: imageUrl(null, 'w92'),
            category,
            deepLink: null,
            priceText: e.price ?? null,
            quality: null,
            priority: e.display_priority ?? 999,
          }))
          .sort((a, b) => a.priority - b.priority),
      };
    }).filter((g) => g.providers.length > 0);

    return {
      region: regionCode,
      regionName: regionName(regionCode),
      link: null,
      groups,
      hasAny: groups.length > 0,
      isMock: true,
      source: 'mock',
      notice: 'Simulated availability from the mock fixture catalog. Set STREAMING_PROVIDER=tmdb for real licensing data.',
    };
  },
};

export default mockStreaming;
