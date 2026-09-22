/**
 * Matching engine entry point (section 13).
 *
 * Pipeline:
 *
 *   candidates (cheap search results, many)
 *        |
 *        v  pre-rank on summary-only signals        <- scoreTitle/scoreYear/scoreContentType
 *   top K  (default 8)
 *        |
 *        v  fetch details + credits                 <- the ONLY expensive step, bounded
 *   scoreable candidates (cast, characters, genres, runtime)
 *        |
 *        v  scoreCandidate()                        <- 8 weighted scorers, full breakdown
 *        |
 *        v  verifyCandidate() on the leader         <- adversarial contradiction checks
 *        |
 *        v  calibrateConfidence()                   <- evidence + self-report + margin
 *   verdict + explainable breakdown
 *
 * Why two passes: a recognition can generate 20+ candidates, and fetching detail +
 * credits for all of them would multiply the API cost for no accuracy benefit. The
 * cheap pass is a good enough filter, and it keeps the expensive pass constant.
 */
import { createLogger } from '../../utils/logger.js';
import { getTmdb } from '../../integrations/tmdb/index.js';
import { toMovieDetail, toTvDetail, toMediaSummary } from '../../integrations/tmdb/normalise.js';
import { MediaType } from '../../database/constants.js';
import { generateCandidates } from '../candidateGenerator.js';
import { scoreCandidate, preRank } from './scorers.js';
import { verifyCandidate, calibrateConfidence, VERDICT, THRESHOLDS, verdictLabel } from './confidence.js';
import { fallbackRecognizer } from '../../integrations/ai/fallbackRecognition.js';
import config from '../../config/env.js';

const log = createLogger('recognition:match');

/** How many candidates get a detail+credits fetch. Cost control (section 41). */
export const MAX_DETAIL_FETCHES = 8;

/** Turns a normalised TMDB detail into the flat shape the scorers consume. */
function toScoreable(detail) {
  const cast = detail.cast ?? [];
  return {
    tmdbId: detail.tmdbId,
    mediaType: detail.mediaType,
    title: detail.title,
    originalTitle: detail.originalTitle,
    overview: detail.overview,
    year: detail.year,
    genres: detail.genres ?? [],
    cast,
    characters: cast.map((c) => c.character).filter(Boolean),
    keywords: [],
    runtime: detail.runtime ?? null,
    posterUrl: detail.posterUrl,
    backdropUrl: detail.backdropUrl,
    popularity: detail.popularity ?? null,
    voteAverage: detail.voteAverage ?? null,
  };
}

async function addFallbackEntries({ tmdb, enriched, fallback }) {
  if (!fallback || !Array.isArray(fallback.candidates) || fallback.candidates.length === 0) return enriched;
  const seen = new Set(enriched.map((entry) => `${entry.candidate.mediaType}:${entry.candidate.tmdbId}`));
  const appended = [];

  for (const suggestion of fallback.candidates.slice(0, 3)) {
    const title = suggestion?.title;
    if (!title) continue;
    try {
      const response = await tmdb.searchMulti(title, { limit: 4 });
      const results = response?.results ?? [];
      for (const raw of results) {
        if (raw?.media_type === 'person') continue;
        const summary = toMediaSummary(raw);
        if (!summary || !summary.tmdbId || !summary.mediaType) continue;
        const key = `${summary.mediaType}:${summary.tmdbId}`;
        if (seen.has(key)) continue;
        appended.push({
          candidate: summary,
          detail: null,
          summary,
          preScore: 0,
          score: 0.18 + (Number(suggestion.confidence ?? 0.35) * 0.45),
          breakdown: {
            fallback: {
              score: Number(suggestion.confidence ?? 0.35),
              weight: 1,
              detail: suggestion.reason ?? `Fallback clue match: ${title}`,
            },
          },
          sources: ['fallback'],
          matchedQueries: [title],
          seedScore: Number(suggestion.confidence ?? 0.35),
          fingerprint: null,
          detailLoaded: false,
        });
        seen.add(key);
      }
    } catch (error) {
      log.warn(`fallback candidate search failed for "${title}": ${error.message}`);
    }
  }

  return [...enriched, ...appended];
}

/**
 * @param {object} input
 * @param {object} input.analysis
 * @param {Array}  [input.fingerprintHits]
 * @param {number} [input.maxDetails]
 */
export async function matchCandidates({ analysis, fingerprintHits = [], maxDetails = MAX_DETAIL_FETCHES }) {
  const tmdb = getTmdb();
  const started = Date.now();

  const { candidates, stats } = await generateCandidates({ analysis, fingerprintHits });

  if (candidates.length === 0) {
    const fallback = await fallbackRecognizer.analyze({ images: [], analysis, describe: '', hint: '', region: 'US', language: 'en-US' });
    log.info('no candidates were generated; fallback recognizer produced structured evidence', { candidateCount: fallback.candidates.length, confidence: fallback.confidence });
    return {
      best: null,
      ranked: [],
      verification: null,
      confidence: null,
      verdict: VERDICT.NONE,
      verdictLabel: verdictLabel(VERDICT.NONE),
      stats: { ...stats, detailCalls: 0, elapsedMs: Date.now() - started, fallback },
      reason: 'The vision analysis produced no searchable titles.',
    };
  }

  const rankedPre = preRank(analysis, candidates);
  const shortlist = rankedPre.slice(0, maxDetails);

  let detailCalls = 0;
  const enriched = [];

  for (const { candidate, preScore } of shortlist) {
    let detail = null;
    try {
      const raw =
        candidate.mediaType === MediaType.TV ? await tmdb.tvDetail(candidate.tmdbId) : await tmdb.movieDetail(candidate.tmdbId);
      detailCalls += 1;
      if (raw) {
        detail =
          candidate.mediaType === MediaType.TV
            ? toTvDetail(raw, raw.credits, Boolean(raw.__mock))
            : toMovieDetail(raw, raw.credits, Boolean(raw.__mock));
      }
    } catch (error) {
      log.warn(`detail fetch failed for ${candidate.mediaType}/${candidate.tmdbId}: ${error.message}`);
    }

    // Score against the richest data we have; fall back to the search summary so a
    // failed detail call does not silently remove a candidate.
    const scoreable = detail ? toScoreable(detail) : toScoreable({ ...candidate, cast: [] });
    const { score, breakdown } = scoreCandidate(analysis, scoreable);

    enriched.push({
      candidate: scoreable,
      detail,
      summary: candidate,
      preScore,
      score,
      breakdown,
      sources: candidate.sources,
      matchedQueries: candidate.matchedQueries,
      seedScore: candidate.seedScore,
      fingerprint: candidate.fingerprint ?? null,
      detailLoaded: Boolean(detail),
    });
  }

  enriched.sort((a, b) => b.score - a.score);

  const best = enriched[0];
  const runnerUp = enriched[1] ?? null;
  const margin = runnerUp && best.score > 0 ? Math.max(0, (best.score - runnerUp.score) / best.score) : null;

  const verification = verifyCandidate({ analysis, candidate: best.candidate });
  const { confidence, verdict, components } = calibrateConfidence({
    weightedScore: best.score,
    analysis,
    margin,
    verificationAdjustments: verification.adjustments,
    isMock: Boolean(best.summary.isMock || stats.isMock),
    frameAgreement: analysis.frameAgreement ?? null,
  });

  const fallbackThreshold = Number.parseFloat(String(config.ai.fallbackThreshold ?? 0.7));
  let fallbackCandidate = null;
  let finalEnriched = enriched;

  if (confidence < Math.round(fallbackThreshold * 100)) {
    fallbackCandidate = await fallbackRecognizer.analyze({
      images: [],
      analysis,
      describe: '',
      hint: '',
      region: 'US',
      language: 'en-US',
    });

    if (fallbackCandidate?.candidates?.length) {
      finalEnriched = await addFallbackEntries({ tmdb, enriched: finalEnriched, fallback: fallbackCandidate });
      finalEnriched.sort((a, b) => b.score - a.score);
      const fallbackBest = finalEnriched[0];
      if (fallbackBest && fallbackBest.score > best.score) {
        finalEnriched = finalEnriched.slice(0, Math.min(finalEnriched.length, 8));
      }
    }
  }

  log.debug(
    `match: "${best.candidate.title}" score=${best.score.toFixed(3)} confidence=${confidence} verdict=${verdict} ` +
      `(margin=${margin === null ? 'n/a' : margin.toFixed(3)}, ${detailCalls} detail call(s), fallback=${fallbackCandidate ? 'used' : 'not-needed'})`
  );

  return {
    best: {
      ...best,
      confidence,
      verdict,
      verdictLabel: verdictLabel(verdict),
      margin,
      components,
    },
    ranked: finalEnriched,
    verification,
    confidence,
    verdict,
    verdictLabel: verdictLabel(verdict),
    components,
    /** true when the best candidate did not clear the "worth showing" bar (section 14) */
    rejected: verdict === VERDICT.NONE || confidence === 0,
    stats: {
      ...stats,
      detailCalls,
      shortlistSize: shortlist.length,
      elapsedMs: Date.now() - started,
      thresholds: THRESHOLDS,
      fallback: fallbackCandidate,
    },
  };
}

export { scoreCandidate, preRank, verifyCandidate, calibrateConfidence, VERDICT, verdictLabel };
export default { matchCandidates, MAX_DETAIL_FETCHES };
