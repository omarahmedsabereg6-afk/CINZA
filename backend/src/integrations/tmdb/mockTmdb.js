/**
 * Mock TMDB adapter.
 *
 * Contract: returns the SAME payload shapes as the live TMDB API (including
 * `credits`/`videos` merged in, which the live client gets via
 * `append_to_response`). That is what lets one normaliser serve both providers.
 *
 * Every payload is tagged `__mock: true`, and that flag is carried through to the
 * app so a simulated result can never be mistaken for a real identification.
 */
import { CATALOG, TRENDING, findById } from './fixtures/catalog.js';
import { normaliseTitle, titleSimilarity } from '../../utils/similarity.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tmdb:mock');

const GENRE_IDS = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  'Science Fiction': 878,
  Thriller: 53,
  War: 10752,
  Western: 37,
};

const genreId = (name) => GENRE_IDS[name] ?? 0;
const genreObj = (name) => ({ id: genreId(name), name });

/** Deterministic fake ids for crew members so person pages are stable. */
const nameId = (name) =>
  String(
    Math.abs(
      [...name].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 9_999_991, 7)
    )
  );

function toSearchItem(entry) {
  const serial = entry.tmdbId.replace('mock-', '');
  const base = {
    id: Number(serial),
    __mock: true,
    overview: entry.overview,
    // No artwork ships with the mock catalog. The UI renders its own generated
    // placeholder instead of us pretending to have a poster.
    poster_path: null,
    backdrop_path: null,
    popularity: entry.popularity,
    vote_average: entry.voteAverage,
    genre_ids: entry.genres.map(genreId),
  };
  return entry.mediaType === 'tv'
    ? { ...base, media_type: 'tv', media_type_label: 'tv', name: entry.title, original_name: entry.originalTitle, first_air_date: `${entry.year}-01-01` }
    : { ...base, media_type: 'movie', title: entry.title, original_title: entry.originalTitle, release_date: `${entry.year}-01-01` };
}

function toCredits(entry) {
  return {
    id: Number(entry.tmdbId.replace('mock-', '')),
    cast: entry.cast.map((name, i) => ({
      id: Number(nameId(name)),
      name,
      character: entry.characters[i] ?? null,
      order: i,
      profile_path: null,
    })),
    crew: [
      ...entry.director.map((name) => ({ id: Number(nameId(name)), name, job: 'Director', department: 'Directing' })),
      ...entry.writers.map((name) => ({ id: Number(nameId(name)), name, job: 'Screenplay', department: 'Writing' })),
    ],
  };
}

function toMovieDetailRaw(entry) {
  return {
    ...toSearchItem(entry),
    runtime: entry.runtime,
    tagline: null,
    status: 'Released',
    vote_count: Math.round(entry.popularity * 137),
    genres: entry.genres.map(genreObj),
    credits: toCredits(entry),
    videos: { results: [] },
  };
}

function toTvDetailRaw(entry) {
  return {
    ...toSearchItem(entry),
    last_air_date: entry.endYear ? `${entry.endYear}-06-01` : null,
    number_of_seasons: entry.seasons.length,
    number_of_episodes: entry.seasons.reduce((sum, s) => sum + (s.episodeCount ?? s.episodes.length), 0),
    status: entry.endYear ? 'Ended' : 'Returning Series',
    vote_count: Math.round(entry.popularity * 211),
    genres: entry.genres.map(genreObj),
    seasons: entry.seasons.map((s) => ({
      id: Number(`${entry.tmdbId.replace('mock-', '')}${s.number}`),
      season_number: s.number,
      name: s.name,
      overview: null,
      poster_path: null,
      air_date: s.airDate,
      episode_count: s.episodeCount ?? s.episodes.length,
    })),
    credits: toCredits(entry),
    videos: { results: [] },
  };
}

/** Relevance score for mock search: title, keywords, cast, crew, overview. */
function scoreEntry(entry, query) {
  const q = normaliseTitle(query);
  if (!q) return 0;
  let score = titleSimilarity(query, entry.title) * 1.0;
  if (entry.originalTitle) score = Math.max(score, titleSimilarity(query, entry.originalTitle) * 0.9);

  const haystack = [
    ...entry.keywords,
    ...entry.cast,
    ...entry.director,
    ...entry.characters,
    ...entry.genres,
    entry.overview,
  ].join(' ').toLowerCase();

  const words = q.split(' ').filter((w) => w.length > 2);
  if (words.length) {
    const hits = words.filter((w) => haystack.includes(w)).length;
    score += (hits / words.length) * 0.75;
  }
  if (entry.cast.some((n) => normaliseTitle(n).includes(q))) score += 0.6;
  if (entry.keywords.some((k) => k.includes(q))) score += 0.5;
  return score;
}

function searchCatalog(query, { mediaType = 'multi', limit = 20 } = {}) {
  const pool = mediaType === 'multi' ? CATALOG : CATALOG.filter((c) => c.mediaType === mediaType);
  if (!query) {
    return pool
      .slice()
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, limit)
      .map(toSearchItem);
  }
  return pool
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((r) => r.score >= 0.32)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => toSearchItem(r.entry));
}

export const mockTmdb = {
  name: 'mock',
  isMock: true,

  async searchMulti(query, opts = {}) {
    const results = searchCatalog(query, { mediaType: 'multi', limit: opts.limit });
    log.debug(`searchMulti("${query}") -> ${results.length} result(s)`);
    return { page: 1, results, total_results: results.length, total_pages: 1 };
  },

  async searchMovie(query, opts = {}) {
    const results = searchCatalog(query, { mediaType: 'movie', limit: opts.limit });
    return { page: 1, results, total_results: results.length, total_pages: 1 };
  },

  async searchTv(query, opts = {}) {
    const results = searchCatalog(query, { mediaType: 'tv', limit: opts.limit });
    return { page: 1, results, total_results: results.length, total_pages: 1 };
  },

  async movieDetail(id) {
    const entry = findById(id);
    if (!entry || entry.mediaType !== 'movie') return null;
    return toMovieDetailRaw(entry);
  },

  async tvDetail(id) {
    const entry = findById(id);
    if (!entry || entry.mediaType !== 'tv') return null;
    return toTvDetailRaw(entry);
  },

  async season(tvId, seasonNumber) {
    const entry = findById(tvId);
    if (!entry || entry.mediaType !== 'tv') return null;
    const season = entry.seasons.find((s) => s.number === Number(seasonNumber));
    if (!season) return null;
    return {
      __mock: true,
      id: Number(`${entry.tmdbId.replace('mock-', '')}${season.number}`),
      season_number: season.number,
      name: season.name,
      overview: null,
      poster_path: null,
      air_date: season.airDate,
      episodes: season.episodes.map((e, i) => ({
        id: Number(`${entry.tmdbId.replace('mock-', '')}${season.number}${String(e.number).padStart(2, '0')}`),
        episode_number: e.number,
        name: e.name,
        overview: e.overview,
        still_path: null,
        air_date: e.airDate,
        runtime: e.runtime,
        vote_average: Math.max(6, Math.min(10, entry.voteAverage - i * 0.05)),
      })),
    };
  },

  /** The mock ships no stills — returning an empty list is the honest answer. */
  async images() {
    return { __mock: true, id: null, stills: [], backdrops: [] };
  },

  async trending({ mediaType = 'all', limit = 12 } = {}) {
    const pool = mediaType === 'all' ? CATALOG : CATALOG.filter((c) => c.mediaType === mediaType);
    const ordered = TRENDING.map((id) => pool.find((c) => c.tmdbId === id)).filter(Boolean);
    return {
      page: 1,
      results: ordered.slice(0, limit).map(toSearchItem),
      total_results: ordered.length,
      total_pages: 1,
      __mock: true,
    };
  },

  async popular(mediaType = 'movie', limit = 12) {
    if (mediaType === 'person') {
      const seen = new Map();
      for (const entry of CATALOG) {
        for (const actor of entry.cast ?? []) {
          if (!seen.has(actor)) {
            seen.set(actor, {
              id: Number(nameId(actor)),
              name: actor,
              known_for_department: 'Acting',
              profile_path: null,
              popularity: entry.popularity,
              known_for: [toSearchItem(entry)],
              __mock: true,
            });
          }
        }
      }
      const results = [...seen.values()].sort((a, b) => b.popularity - a.popularity).slice(0, limit);
      return { page: 1, results, total_results: results.length, total_pages: 1, __mock: true };
    }
    const pool = CATALOG.filter((c) => c.mediaType === mediaType).sort((a, b) => b.popularity - a.popularity);
    return { page: 1, results: pool.slice(0, limit).map(toSearchItem), total_results: pool.length, total_pages: 1, __mock: true };
  },

  async discoverByGenre(mediaType = 'all', targetGenreId, { page = 1, sortBy = 'popularity.desc' } = {}) {
    const pool = mediaType === 'all' || !mediaType
      ? CATALOG
      : CATALOG.filter((c) => c.mediaType === mediaType);

    const targetId = Number(targetGenreId);
    let filtered = pool;

    if (targetId > 0) {
      const genreNames = Object.entries(GENRE_IDS)
        .filter(([, id]) => id === targetId)
        .map(([name]) => name.toLowerCase());

      if (targetId === 10765) {
        genreNames.push('science fiction', 'fantasy');
      } else if (targetId === 10759) {
        genreNames.push('action', 'adventure');
      } else if (targetId === 878) {
        genreNames.push('science fiction', 'sci-fi');
      }

      filtered = pool.filter((entry) => {
        const itemGenres = (entry.genres ?? []).map((g) => g.toLowerCase());
        return genreNames.some((gName) => itemGenres.includes(gName));
      });
    }

    filtered.sort((a, b) => {
      if (sortBy === 'vote_average.desc') {
        return (b.voteAverage ?? 0) - (a.voteAverage ?? 0);
      }
      if (sortBy === 'release_date.desc') {
        return (b.year ?? 0) - (a.year ?? 0);
      }
      if (sortBy === 'vote_count.desc') {
        return (b.popularity ?? 0) - (a.popularity ?? 0);
      }
      return (b.popularity ?? 0) - (a.popularity ?? 0);
    });

    return {
      page: Number(page) || 1,
      results: filtered.map(toSearchItem),
      total_results: filtered.length,
      total_pages: 1,
      __mock: true,
    };
  },

  async searchPerson(query) {
    const needle = normaliseTitle(query);
    if (!needle) return { page: 1, results: [], total_results: 0, total_pages: 1, __mock: true };
    const seen = new Map();
    for (const entry of CATALOG) {
      for (const person of [...entry.cast, ...entry.director, ...entry.writers]) {
        if (!normaliseTitle(person).includes(needle) || seen.has(person)) continue;
        seen.set(person, {
          id: Number(nameId(person)),
          name: person,
          known_for_department: entry.cast.includes(person) ? 'Acting' : 'Directing',
          profile_path: null,
          popularity: entry.popularity,
          __mock: true,
          known_for: [toSearchItem(entry)],
        });
      }
    }
    const results = [...seen.values()].sort((a, b) => b.popularity - a.popularity);
    return { page: 1, results, total_results: results.length, total_pages: 1, __mock: true };
  },

  async person(id) {
    const target = String(id);
    for (const entry of CATALOG) {
      for (const person of [...entry.cast, ...entry.director, ...entry.writers]) {
        if (nameId(person) !== target) continue;
        const credits = CATALOG.filter((c) =>
          [...c.cast, ...c.director, ...c.writers].includes(person)
        ).map((c) => toSearchItem(c));
        return {
          __mock: true,
          id: Number(target),
          name: person,
          biography: null,
          known_for_department: entry.cast.includes(person) ? 'Acting' : 'Directing',
          profile_path: null,
          birthday: null,
          place_of_birth: null,
          combined_credits: { cast: credits },
        };
      }
    }
    return null;
  },

  /**
   * Watch providers. The mock deliberately returns a SMALL, clearly-labelled
   * fixture set for a couple of regions so the Where to Watch UI has something to
   * render. `isMock` is propagated so the app can label it.
   */
  async watchProviders(mediaType, id, region = 'US') {
    const entry = findById(id);
    if (!entry) return { __mock: true, id: null, results: {} };

    const catalogue = {
      netflix: { provider_id: 8, provider_name: 'Netflix', display_priority: 1 },
      prime: { provider_id: 9, provider_name: 'Prime Video', display_priority: 2 },
      apple: { provider_id: 2, provider_name: 'Apple TV', display_priority: 3 },
      max: { provider_id: 1899, provider_name: 'Max', display_priority: 4 },
      paramount: { provider_id: 531, provider_name: 'Paramount+', display_priority: 5 },
    };

    const flatrate = entry.providerKeys
      .filter((k) => k !== 'apple')
      .map((k) => catalogue[k])
      .filter(Boolean);
    const rent = ['apple', 'prime']
      .filter((k) => entry.providerKeys.includes(k) || k === 'apple')
      .map((k) => ({ ...catalogue[k], price: '3.99 USD' }));
    const buy = ['apple', 'prime'].map((k) => ({ ...catalogue[k], price: '12.99 USD' }));

    return {
      __mock: true,
      id: Number(String(id).replace('mock-', '')),
      results: {
        [String(region).toUpperCase()]: {
          link: null,
          flatrate: flatrate.length ? flatrate : undefined,
          rent: rent.length ? rent : undefined,
          buy: buy.length ? buy : undefined,
        },
      },
    };
  },
};

export default mockTmdb;
