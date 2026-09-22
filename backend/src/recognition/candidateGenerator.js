/**
 * Candidate generation (section 13, step 1).
 *
 * "Do not simply use the first TMDB result." This stage turns the vision analysis
 * into a POOL of plausible candidates to be scored later, drawing on independent
 * sources so a weak hint from one cannot dominate:
 *
 *   1. Every title the model proposed (rank-weighted, so hint #1 carries more prior)
 *   2. Every original-language title it proposed (English search misses foreign films)
 *   3. Any distinct quote/line from on-screen text, searched as a phrase — subtitles
 *      sometimes contain the title itself
 *   4. Fingerprint matches from the SceneMatcher, if a confirmed frame has been seen
 *      before (section 31)
 *
 * Searches go through the TMDB adapter, so they are cached and counted. Each query
 * is one call; the number of queries is bounded by MAX_QUERIES.
 */
import { createLogger } from '../utils/logger.js';
import { getTmdb } from '../integrations/tmdb/index.js';
import { toMediaSummary } from '../integrations/tmdb/normalise.js';
import { CandidateSource, MediaType } from '../database/constants.js';

const log = createLogger('recognition:candidates');

/** Upper bound on search calls per recognition. Cost control (section 41). */
export const MAX_QUERIES = 6;
/** Results kept per query before merging. */
const PER_QUERY_RESULTS = 6;

const dedupeKey = (mediaType, tmdbId) => `${mediaType}:${tmdbId}`;

function buildQueries(analysis) {
  const queries = [];
  const seen = new Set();

  const push = (query, source, rank) => {
    const trimmed = String(query ?? '').trim();
    const key = trimmed.toLowerCase();
    if (trimmed.length < 2 || trimmed.length > 90 || seen.has(key)) return;
    seen.add(key);
    queries.push({ query: trimmed, source, rank });
  };

  (analysis.possibleTitles ?? []).forEach((title, index) => push(title, CandidateSource.AI_HINT, index));
  (analysis.alternativeTitles ?? []).forEach((title) => push(title, CandidateSource.AI_HINT, 1));

  // On-screen text only becomes a query when it looks like a short phrase, so we do
  // not waste a call searching an entire subtitle line.
  const visible = String(analysis.visibleText ?? '').trim();
  if (visible.length >= 3 && visible.length <= 60 && visible.split(/\s+/).length <= 7) {
    push(visible, CandidateSource.TEXT, 3);
  }

  return queries.slice(0, MAX_QUERIES);
}

/**
 * @param {object} input
 * @param {object} input.analysis           normalised vision analysis
 * @param {Array}  [input.fingerprintHits]  matches from the SceneMatcher
 * @returns {Promise<{candidates: Array, stats: object}>}
 */
export async function generateCandidates({ analysis, fingerprintHits = [] }) {
  const tmdb = getTmdb();
  const queries = buildQueries(analysis);
  const pool = new Map();
  let searchCalls = 0;
  const queryLog = [];

  for (const { query, source, rank } of queries) {
    let response;
    try {
      response = await tmdb.searchMulti(query, { limit: PER_QUERY_RESULTS });
      searchCalls += 1;
    } catch (error) {
      log.warn(`search failed for "${query}": ${error.message}`);
      queryLog.push({ query, source, error: error.message, results: 0 });
      continue;
    }

    const results = response?.results ?? [];
    queryLog.push({ query, source, results: results.length });

    results.slice(0, PER_QUERY_RESULTS).forEach((raw, position) => {
      // Ignore people returned by /search/multi — we only match titles here.
      if (raw?.media_type === 'person') return;
      const summary = toMediaSummary(raw);
      if (!summary || !summary.tmdbId || !summary.mediaType) return;
      if (summary.mediaType !== MediaType.MOVIE && summary.mediaType !== MediaType.TV) return;

      const rankWeight = 1 / (1 + rank * 0.7);
      const positionWeight = 1 / (1 + position * 0.35);
      const seedScore = rankWeight * positionWeight;
      const key = dedupeKey(summary.mediaType, summary.tmdbId);

      const existing = pool.get(key);
      if (existing) {
        existing.seedScore = Math.max(existing.seedScore, seedScore);
        existing.matchedQueries.push(query);
        if (!existing.sources.includes(source)) existing.sources.push(source);
        return;
      }

      pool.set(key, {
        ...summary,
        seedScore,
        sources: [source],
        matchedQueries: [query],
        cast: [],
        characters: [],
        keywords: [],
        detailLoaded: false,
        origin: 'tmdb_search',
      });
    });
  }

  /* ---- fingerprint candidates from the SceneMatcher ---- */
  for (const hit of fingerprintHits) {
    const key = dedupeKey(hit.mediaType, hit.tmdbId);
    // A near-identical previously-confirmed frame is strong evidence, so its seed
    // score is scaled by hash similarity rather than by search position.
    const prior = 0.9 * (hit.similarity ?? 0.5);
    if (pool.has(key)) {
      const existing = pool.get(key);
      existing.seedScore = Math.max(existing.seedScore, prior);
      existing.sources.push(CandidateSource.FINGERPRINT);
      existing.fingerprint = hit;
    } else {
      pool.set(key, {
        tmdbId: String(hit.tmdbId),
        mediaType: hit.mediaType,
        title: hit.title ?? 'Unknown',
        originalTitle: null,
        overview: null,
        posterPath: null,
        backdropPath: null,
        posterUrl: null,
        backdropUrl: null,
        year: hit.year ?? null,
        releaseDate: null,
        voteAverage: hit.voteAverage ?? null,
        popularity: null,
        genreIds: [],
        genres: [],
        isMock: false,
        seedScore: prior,
        sources: [CandidateSource.FINGERPRINT],
        matchedQueries: [],
        cast: [],
        characters: [],
        keywords: [],
        detailLoaded: false,
        origin: 'fingerprint',
        fingerprint: hit,
      });
    }
  }

  const candidates = [...pool.values()].filter((c) => c.title);
  log.debug(`generated ${candidates.length} candidate(s) from ${searchCalls} search call(s)`);

  return {
    candidates,
    stats: {
      queries: queryLog,
      searchCalls,
      candidateCount: candidates.length,
      isMock: tmdb.isMock,
    },
  };
}

export default { generateCandidates, MAX_QUERIES };
