/**
 * Live TMDB client.
 *
 * This module is the ONLY place the TMDB credentials are touched, and it never
 * leaves the server (section 12 + 28). The app talks to our API instead.
 *
 * Cost control (section 41):
 *   - every read goes through a TTL cache, so repeat searches/details are free
 *   - `append_to_response` fetches credits+videos in the same request as the detail
 *   - failures are retried at most once, only for transient statuses
 *   - each outbound call is recorded as a metric
 */
import config from '../../config/env.js';
import HttpError, { ErrorCode } from '../../utils/httpError.js';
import { caches } from '../../utils/cache.js';
import { createLogger } from '../../utils/logger.js';
import { recordApiCall } from '../../services/metricsService.js';

const log = createLogger('tmdb');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function request(path, { params = {}, ttlMs = config.tmdb.cacheTtlMs, cache = caches.tmdbDetail, label = path } = {}) {
  const search = new URLSearchParams({
    language: config.tmdb.language,
    ...params,
  });
  // A v4 bearer token is preferred; fall back to the v3 api_key query parameter.
  if (!config.tmdb.accessToken && config.tmdb.apiKey) search.set('api_key', config.tmdb.apiKey);

  const url = `${config.tmdb.baseUrl}${path}?${search.toString()}`;
  const cacheKey = url;

  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    recordApiCall({ kind: 'tmdb', provider: 'tmdb', operation: label, ok: true, cacheHit: true, durationMs: 0 });
    return cached;
  }

  const headers = { Accept: 'application/json' };
  if (config.tmdb.accessToken) headers.Authorization = `Bearer ${config.tmdb.accessToken}`;

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      const durationMs = Date.now() - started;
      clearTimeout(timer);

      if (response.status === 404) {
        recordApiCall({ kind: 'tmdb', provider: 'tmdb', operation: label, status: 404, ok: true, durationMs });
        return null;
      }
      if (!response.ok) {
        recordApiCall({ kind: 'tmdb', provider: 'tmdb', operation: label, status: response.status, ok: false, durationMs });
        if (RETRYABLE_STATUS.has(response.status) && attempt === 0) {
          lastError = new Error(`TMDB responded ${response.status}`);
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw new HttpError(
          502,
          ErrorCode.TMDB_UNAVAILABLE,
          `TMDB ${path} failed with status ${response.status}`
        );
      }

      const payload = await response.json();
      recordApiCall({ kind: 'tmdb', provider: 'tmdb', operation: label, status: response.status, ok: true, durationMs });
      cache.set(cacheKey, payload, ttlMs);
      return payload;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof HttpError) throw error;
      recordApiCall({ kind: 'tmdb', provider: 'tmdb', operation: label, ok: false, durationMs: Date.now() - started });
      lastError = error;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
    }
  }

  log.warn(`TMDB request failed: ${path}`, { message: lastError?.message });
  throw new HttpError(502, ErrorCode.TMDB_UNAVAILABLE, `TMDB request failed: ${lastError?.message ?? 'unknown error'}`);
}

export const tmdbClient = {
  name: 'tmdb',
  isMock: false,

  searchMulti(query, { page = 1 } = {}) {
    return request('/search/multi', {
      params: { query, page: String(page), include_adult: 'false' },
      cache: caches.tmdbSearch,
      label: 'search/multi',
    });
  },

  searchMovie(query, { page = 1, year } = {}) {
    return request('/search/movie', {
      params: { query, page: String(page), ...(year ? { year: String(year) } : {}) },
      cache: caches.tmdbSearch,
      label: 'search/movie',
    });
  },

  searchTv(query, { page = 1, firstAirDateYear } = {}) {
    return request('/search/tv', {
      params: { query, page: String(page), ...(firstAirDateYear ? { first_air_date_year: String(firstAirDateYear) } : {}) },
      cache: caches.tmdbSearch,
      label: 'search/tv',
    });
  },

  async movieDetail(id) {
    return request(`/movie/${encodeURIComponent(id)}`, {
      params: { append_to_response: 'credits,videos' },
      label: 'movie/detail',
    });
  },

  async tvDetail(id) {
    return request(`/tv/${encodeURIComponent(id)}`, {
      params: { append_to_response: 'credits,videos' },
      label: 'tv/detail',
    });
  },

  season(tvId, seasonNumber) {
    return request(`/tv/${encodeURIComponent(tvId)}/season/${encodeURIComponent(seasonNumber)}`, { label: 'tv/season' });
  },

  images(mediaType, id) {
    return request(`/${mediaType === 'tv' ? 'tv' : 'movie'}/${encodeURIComponent(id)}/images`, {
      params: { include_image_language: `${config.tmdb.language.slice(0, 2)},en,null` },
      cache: caches.tmdbImages,
      label: `${mediaType}/images`,
    });
  },

  trending({ mediaType = 'all', window = 'week' } = {}) {
    return request(`/trending/${mediaType}/${window}`, { params: { page: '1' }, cache: caches.tmdbSearch, label: 'trending' });
  },

  popular(mediaType = 'movie') {
    const endpoint = mediaType === 'tv' ? 'tv' : mediaType === 'person' ? 'person' : 'movie';
    return request(`/${endpoint}/popular`, { params: { page: '1' }, cache: caches.tmdbSearch, label: `popular/${endpoint}` });
  },

  searchPerson(query, { page = 1 } = {}) {
    return request('/search/person', { params: { query, page: String(page) }, cache: caches.tmdbSearch, label: 'search/person' });
  },

  person(id) {
    return request(`/person/${encodeURIComponent(id)}`, {
      params: { append_to_response: 'combined_credits' },
      label: 'person/detail',
    });
  },

  personCredits(id) {
    return request(`/person/${encodeURIComponent(id)}/combined_credits`, { label: 'person/credits' });
  },

  movieCredits(id) {
    return request(`/movie/${encodeURIComponent(id)}/credits`, { label: 'movie/credits' });
  },

  tvCredits(id) {
    return request(`/tv/${encodeURIComponent(id)}/credits`, { label: 'tv/credits' });
  },

  movieRecommendations(id) {
    return request(`/movie/${encodeURIComponent(id)}/recommendations`, { params: { page: '1' }, cache: caches.tmdbSearch, label: 'movie/recommendations' });
  },

  movieSimilar(id) {
    return request(`/movie/${encodeURIComponent(id)}/similar`, { params: { page: '1' }, cache: caches.tmdbSearch, label: 'movie/similar' });
  },

  tvRecommendations(id) {
    return request(`/tv/${encodeURIComponent(id)}/recommendations`, { params: { page: '1' }, cache: caches.tmdbSearch, label: 'tv/recommendations' });
  },

  tvSimilar(id) {
    return request(`/tv/${encodeURIComponent(id)}/similar`, { params: { page: '1' }, cache: caches.tmdbSearch, label: 'tv/similar' });
  },

  watchProviders(mediaType, id, region = 'US') {
    const regionCode = String(region || 'US').trim().toUpperCase();
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    return request(`/${endpoint}/${encodeURIComponent(id)}/watch/providers`, {
      params: { watch_region: regionCode },
      cache: caches.providers,
      ttlMs: 6 * 60 * 60 * 1000,
      label: `watch/providers/${endpoint}/${id}/${regionCode}`,
    });
  },

  async discoverByGenre(mediaType = 'all', genreId, { page = 1, sortBy = 'popularity.desc' } = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const movieParams = { page: String(page) };
    const tvParams = { page: String(page) };

    if (sortBy === 'vote_average.desc') {
      movieParams.sort_by = 'vote_average.desc';
      movieParams['vote_count.gte'] = '100';
      tvParams.sort_by = 'vote_average.desc';
      tvParams['vote_count.gte'] = '50';
    } else if (sortBy === 'release_date.desc') {
      movieParams.sort_by = 'primary_release_date.desc';
      movieParams['primary_release_date.lte'] = today;
      tvParams.sort_by = 'first_air_date.desc';
      tvParams['first_air_date.lte'] = today;
    } else if (sortBy === 'vote_count.desc') {
      movieParams.sort_by = 'vote_count.desc';
      tvParams.sort_by = 'vote_count.desc';
    } else {
      movieParams.sort_by = 'popularity.desc';
      tvParams.sort_by = 'popularity.desc';
    }

    const numId = Number(genreId);
    if (numId > 0) {
      movieParams.with_genres = String(numId);
      let tvGenreId = String(numId);
      if (numId === 28 || numId === 12) tvGenreId = '10759'; // Action & Adventure
      else if (numId === 878 || numId === 14) tvGenreId = '10765'; // Sci-Fi & Fantasy
      else if (numId === 10752) tvGenreId = '10768'; // War & Politics
      tvParams.with_genres = tvGenreId;
    }

    function sortCombined(a, b) {
      if (sortBy === 'vote_average.desc') {
        const diff = (b.vote_average ?? 0) - (a.vote_average ?? 0);
        if (diff !== 0) return diff;
        return (b.vote_count ?? 0) - (a.vote_count ?? 0);
      }
      if (sortBy === 'release_date.desc') {
        const dateA = new Date(a.release_date || a.first_air_date || 0).getTime();
        const dateB = new Date(b.release_date || b.first_air_date || 0).getTime();
        return dateB - dateA;
      }
      if (sortBy === 'vote_count.desc') {
        return (b.vote_count ?? 0) - (a.vote_count ?? 0);
      }
      return (b.popularity ?? 0) - (a.popularity ?? 0);
    }

    if (mediaType === 'tv') {
      const res = await request('/discover/tv', {
        params: tvParams,
        cache: caches.tmdbSearch,
        label: `discover/genre/tv/${genreId || 'all'}/${sortBy}/${page}`,
      });
      const results = (res?.results ?? []).map((t) => ({ ...t, media_type: 'tv' })).sort(sortCombined);
      return {
        ...res,
        results,
      };
    }

    if (mediaType === 'movie') {
      const res = await request('/discover/movie', {
        params: movieParams,
        cache: caches.tmdbSearch,
        label: `discover/genre/movie/${genreId || 'all'}/${sortBy}/${page}`,
      });
      const results = (res?.results ?? []).map((m) => ({ ...m, media_type: 'movie' })).sort(sortCombined);
      return {
        ...res,
        results,
      };
    }

    // mediaType is 'all': TMDB does not have /discover/all. Query movie and tv in parallel.
    const [moviesRes, tvRes] = await Promise.all([
      request('/discover/movie', {
        params: movieParams,
        cache: caches.tmdbSearch,
        label: `discover/genre/movie/${genreId || 'all'}/${sortBy}/${page}`,
      }).catch(() => ({ results: [] })),
      request('/discover/tv', {
        params: tvParams,
        cache: caches.tmdbSearch,
        label: `discover/genre/tv/${genreId || 'all'}/${sortBy}/${page}`,
      }).catch(() => ({ results: [] })),
    ]);

    const movies = (moviesRes?.results ?? []).map((m) => ({ ...m, media_type: 'movie' }));
    const tvs = (tvRes?.results ?? []).map((t) => ({ ...t, media_type: 'tv' }));
    const combined = [...movies, ...tvs].sort(sortCombined);

    return {
      page: Number(page) || 1,
      results: combined,
      total_results: (moviesRes?.total_results ?? 0) + (tvRes?.total_results ?? 0),
      total_pages: Math.max(moviesRes?.total_pages ?? 1, tvRes?.total_pages ?? 1),
    };
  },
};

export default tmdbClient;
