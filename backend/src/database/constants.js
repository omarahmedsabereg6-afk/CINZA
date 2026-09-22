/**
 * Allowed values for the string columns that stand in for database enums.
 *
 * The Prisma schema avoids native enums so it can target both SQLite and
 * PostgreSQL. Validation therefore happens here + at the edge with zod.
 */

export const MediaType = {
  MOVIE: 'movie',
  TV: 'tv',
  PERSON: 'person',
};

export const RecognitionMode = {
  IMAGE: 'image',
  VIDEO: 'video',
  DESCRIBE: 'describe',
};

export const RecognitionStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  /**
   * The attempt SUCCEEDED but no candidate cleared the confidence bar. This is a
   * distinct outcome from `failed` (which means something went wrong on our side),
   * so it gets its own status: History can show it as "not identified" and we do not
   * pollute error dashboards with ordinary misses.
   */
  NO_MATCH: 'no_match',
  FAILED: 'failed',
};

export const RecognitionSource = {
  CAMERA: 'camera',
  GALLERY: 'gallery',
  VIDEO: 'video',
  TEXT: 'text',
};

export const ImageKind = {
  PRIMARY: 'primary',
  FRAME: 'frame',
  REFERENCE: 'reference',
};

export const StreamingCategory = {
  STREAM: 'stream',
  RENT: 'rent',
  BUY: 'buy',
};

export const CandidateSource = {
  AI_HINT: 'ai_hint',
  TMDB_SEARCH: 'tmdb_search',
  FINGERPRINT: 'fingerprint',
  TEXT: 'text',
};

export const isMediaType = (v) => v === MediaType.MOVIE || v === MediaType.TV;
export const isStreamingCategory = (v) =>
  v === StreamingCategory.STREAM || v === StreamingCategory.RENT || v === StreamingCategory.BUY;

/** Curated region list for "Where to Watch". Kept small and explicit on purpose. */
export const REGIONS = [
  { code: 'US', name: 'United States', language: 'en-US' },
  { code: 'GB', name: 'United Kingdom', language: 'en-GB' },
  { code: 'CA', name: 'Canada', language: 'en-CA' },
  { code: 'AU', name: 'Australia', language: 'en-AU' },
  { code: 'DE', name: 'Germany', language: 'de-DE' },
  { code: 'FR', name: 'France', language: 'fr-FR' },
  { code: 'ES', name: 'Spain', language: 'es-ES' },
  { code: 'IT', name: 'Italy', language: 'it-IT' },
  { code: 'PT', name: 'Portugal', language: 'pt-PT' },
  { code: 'BR', name: 'Brazil', language: 'pt-BR' },
  { code: 'MX', name: 'Mexico', language: 'es-MX' },
  { code: 'AR', name: 'Argentina', language: 'es-AR' },
  { code: 'NL', name: 'Netherlands', language: 'nl-NL' },
  { code: 'SE', name: 'Sweden', language: 'sv-SE' },
  { code: 'PL', name: 'Poland', language: 'pl-PL' },
  { code: 'TR', name: 'Türkiye', language: 'tr-TR' },
  { code: 'SA', name: 'Saudi Arabia', language: 'ar-SA' },
  { code: 'AE', name: 'United Arab Emirates', language: 'ar-AE' },
  { code: 'EG', name: 'Egypt', language: 'ar-EG' },
  { code: 'IN', name: 'India', language: 'hi-IN' },
  { code: 'JP', name: 'Japan', language: 'ja-JP' },
  { code: 'KR', name: 'South Korea', language: 'ko-KR' },
  { code: 'ZA', name: 'South Africa', language: 'en-ZA' },
];

const COUNTRY_MAP = new Map();
for (const r of REGIONS) {
  COUNTRY_MAP.set(r.name.toLowerCase(), r.code);
  COUNTRY_MAP.set(r.code.toLowerCase(), r.code);
}

const COMMON_ALIASES = {
  usa: 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  uae: 'AE',
  emirates: 'AE',
  ksa: 'SA',
  turkey: 'TR',
  korea: 'KR',
  'republic of korea': 'KR',
};

for (const [alias, code] of Object.entries(COMMON_ALIASES)) {
  COUNTRY_MAP.set(alias.toLowerCase(), code);
}

let regionNamesEn = null;
try {
  regionNamesEn = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  // fallback if Intl.DisplayNames is not supported
}

export function toCountryCode(input, fallback = null) {
  if (!input) return fallback;
  const raw = String(input).trim();
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (REGIONS.some((r) => r.code === upper)) {
    return upper;
  }
  const clean = raw.toLowerCase();
  if (COUNTRY_MAP.has(clean)) {
    return COUNTRY_MAP.get(clean);
  }
  for (const [name, code] of COUNTRY_MAP.entries()) {
    if (name === clean) return code;
  }
  for (const [name, code] of COUNTRY_MAP.entries()) {
    if (clean.startsWith(name) || name.startsWith(clean)) return code;
  }
  return fallback;
}

export const countryName = (code) => {
  if (!code) return 'Unknown country';
  const upper = String(code).trim().toUpperCase();
  const known = REGIONS.find((r) => r.code === upper);
  if (known) return known.name;
  if (regionNamesEn) {
    try {
      const display = regionNamesEn.of(upper);
      if (display && display !== upper) return display;
    } catch {
      // ignore
    }
  }
  return upper;
};

export const regionName = countryName;

export const languageForRegion = (code) =>
  REGIONS.find((r) => r.code === String(code || '').toUpperCase())?.language || 'en-US';

export default {
  MediaType,
  RecognitionMode,
  RecognitionStatus,
  RecognitionSource,
  ImageKind,
  StreamingCategory,
  CandidateSource,
  REGIONS,
  isMediaType,
  isStreamingCategory,
  toCountryCode,
  countryName,
  regionName,
  languageForRegion,
};
