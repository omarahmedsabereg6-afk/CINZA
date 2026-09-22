export const RatingProvider = Object.freeze({
  TMDB: 'tmdb',
  ROTTEN_TOMATOES: 'rotten_tomatoes',
});

export function unavailableRating(provider, reason = null) {
  return {
    provider,
    available: false,
    tomatometer: null,
    popcornmeter: null,
    criticReviews: null,
    audienceRatings: null,
    certification: null,
    url: null,
    attribution: null,
    reason,
  };
}

export function tmdbRating({ voteAverage = null, voteCount = null } = {}) {
  const rating = Number(voteAverage);
  const count = Number(voteCount);
  return {
    provider: RatingProvider.TMDB,
    available: Number.isFinite(rating) && rating > 0,
    voteAverage: Number.isFinite(rating) && rating > 0 ? rating : null,
    voteCount: Number.isFinite(count) && count > 0 ? count : null,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value) {
  return value === undefined || value === '' ? null : String(value);
}

export function normaliseRottenTomatoesResponse(raw = {}) {
  const tomatometer = numberOrNull(
    raw.tomatometer ?? raw.tomatoMeter ?? raw.criticScore ?? raw.criticsScore ?? raw.scores?.tomatometer
  );
  const popcornmeter = numberOrNull(
    raw.popcornmeter ?? raw.popcornMeter ?? raw.audienceScore ?? raw.audience_rating ?? raw.scores?.popcornmeter
  );
  const criticReviews = numberOrNull(
    raw.criticReviews ?? raw.criticReviewCount ?? raw.critics_count ?? raw.reviewCounts?.critics
  );
  const audienceRatings = numberOrNull(
    raw.audienceRatings ?? raw.audienceRatingCount ?? raw.audience_count ?? raw.reviewCounts?.audience
  );
  const url = stringOrNull(raw.url ?? raw.rottenTomatoesUrl ?? raw.links?.rottenTomatoes ?? raw.links?.self);

  return {
    provider: RatingProvider.ROTTEN_TOMATOES,
    available: tomatometer !== null || popcornmeter !== null || url !== null,
    tomatometer,
    popcornmeter,
    criticReviews,
    audienceRatings,
    certification: stringOrNull(raw.certification ?? raw.status ?? raw.ratingStatus),
    url,
    attribution: url ? 'Rotten Tomatoes' : null,
  };
}

export function buildTitleMatchInput(detail) {
  if (!detail) return null;
  return {
    source: 'tmdb',
    sourceId: detail.tmdbId ? String(detail.tmdbId) : null,
    mediaType: detail.mediaType ?? null,
    title: detail.title ?? null,
    originalTitle: detail.originalTitle ?? null,
    year: detail.year ?? null,
    releaseDate: detail.releaseDate ?? detail.firstAirDate ?? null,
  };
}
