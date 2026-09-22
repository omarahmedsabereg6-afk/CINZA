/**
 * The recognition pipeline (sections 10, 11, 12, 13, 14, 15, 31, 40, 41).
 *
 *   validated input
 *      -> result cache lookup (identical bytes cost nothing)
 *      -> vision analysis (AI)                       [masked in mock mode]
 *      -> fingerprint lookup (SceneMatcher)
 *      -> candidate generation (TMDB search)
 *      -> candidate scoring + verification + confidence
 *      -> scene resolution (season/episode, reference frame)
 *      -> persistence + fingerprint indexing
 *      -> API payload
 *
 * Guarantees this module enforces:
 *  - Uploaded image bytes are never persisted. Only a small client-generated
 *    preview, non-reversible perceptual hashes and dimensions are stored, and they
 *    are deleted with the recognition (section 40).
 *  - A timestamp is NEVER invented. Where one cannot be established the payload says
 *    so explicitly, and the app renders the honest copy (section 15).
 *  - A simulated (mock) analysis is flagged on the result and capped in confidence,
 *    so it can never be mistaken for a real identification (section 32).
 *  - Every upstream call is bounded and counted (section 41).
 */
import config from '../config/env.js';
import { prisma } from '../database/prisma.js';
import { createLogger } from '../utils/logger.js';
import { stringifyJson, parseJson } from '../utils/json.js';
import { sha256Hex } from '../utils/ids.js';
import {
  MediaType,
  RecognitionMode,
  RecognitionSource,
  RecognitionStatus,
  ImageKind,
} from '../database/constants.js';
import { analyseScene, getVisionProvider } from '../integrations/ai/index.js';
import { getTmdb } from '../integrations/tmdb/index.js';
import { toSeason } from '../integrations/tmdb/normalise.js';
import { getSceneMatcher } from '../recognition/sceneMatcher/index.js';
import { matchCandidates } from '../recognition/matching/index.js';
import { fuseFrameAnalyses } from '../recognition/videoFrames.js';
import { bump, recordApiCall } from '../services/metricsService.js';

const log = createLogger('recognition');

const RESULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Human copy for the scene block when a timestamp genuinely cannot be established. */
export const TIMESTAMP_UNAVAILABLE = 'Scene identified — exact timestamp unavailable.';

/**
 * Cache key. Includes the normalisation version, mode, region and any user text, so a
 * cached answer can never be served for a materially different request.
 */
function buildCacheKey({ inputHashValue, mode, describe, region, analysisVersion = 'v1' }) {
  return sha256Hex([analysisVersion, mode, region, inputHashValue, describe ?? '', getVisionProvider().name].join('|'));
}

/**
 * Resolves the season/episode for a TV result.
 *
 * Order of trust:
 *   1. An explicit fingerprint match that already carries S/E (highest trust)
 *   2. The vision model's own hint, but ONLY if that season/episode exists upstream
 *   3. Nothing — we report that it could not be determined
 *
 * We never guess an episode number from a single frame.
 */
async function resolveEpisode({ analysis, bestCandidate, fingerprintHit }) {
  const tmdb = getTmdb();

  const fromFingerprint =
    fingerprintHit && fingerprintHit.seasonNumber && fingerprintHit.episodeNumber
      ? { seasonNumber: fingerprintHit.seasonNumber, episodeNumber: fingerprintHit.episodeNumber, basis: 'fingerprint' }
      : null;

  const hint =
    analysis.seasonHint !== null && analysis.episodeHint !== null
      ? { seasonNumber: analysis.seasonHint, episodeNumber: analysis.episodeHint, basis: 'model_hint' }
      : null;

  const candidate = fromFingerprint ?? hint;
  if (!candidate) {
    return { seasonNumber: null, episodeNumber: null, episodeTitle: null, episodeStill: null, basis: 'undetermined' };
  }

  // Verify the claimed episode actually exists before showing it to a user.
  try {
    const raw = await tmdb.season(bestCandidate.candidate.tmdbId, candidate.seasonNumber);
    if (raw) {
      const season = toSeason(raw, Boolean(raw.__mock));
      const episode = season.episodes.find((e) => e.episodeNumber === candidate.episodeNumber);
      if (episode) {
        return {
          seasonNumber: candidate.seasonNumber,
          episodeNumber: candidate.episodeNumber,
          episodeTitle: episode.name,
          episodeOverview: episode.overview,
          episodeStill: episode.stillUrl,
          episodeAirDate: episode.airDate,
          seasonName: season.name,
          basis: candidate.basis,
        };
      }
    }
  } catch (error) {
    log.warn(`could not verify episode ${candidate.seasonNumber}x${candidate.episodeNumber}: ${error.message}`);
  }

  return {
    seasonNumber: candidate.seasonNumber,
    episodeNumber: candidate.episodeNumber,
    episodeTitle: null,
    episodeStill: null,
    basis: `${candidate.basis}_unverified`,
    notice: 'The episode number could not be verified against the series data.',
  };
}

/**
 * Builds the "Matched Scene" block (section 15).
 *
 * The reference image is included ONLY when it comes from a real fingerprint match.
 * We never pair the user's screenshot with an unrelated still and claim it matches.
 */
function buildScene({ analysis, images, fingerprintHit, episode, confidence }) {
  const primary = images[0] ?? null;

  return {
    userThumb: primary?.thumbDataUrl ?? null,
    userImage: primary
      ? { width: primary.width, height: primary.height, mimeType: primary.mimeType, sizeBytes: primary.sizeBytes }
      : null,
    frameCount: images.filter((i) => i.kind === ImageKind.FRAME).length || 1,

    referenceImage: fingerprintHit?.thumbDataUrl ?? null,
    referenceLabel: fingerprintHit
      ? `Previously confirmed frame (${fingerprintHit.distanceLabel ?? 'similar'}, ${(fingerprintHit.similarity * 100).toFixed(0)}% hash similarity)`
      : null,

    description: analysis.sceneDescription || null,
    visibleText: analysis.visibleText || null,
    quotes: analysis.possibleQuotes ?? [],
    clues: analysis.visualClues ?? [],
    settings: analysis.settings ?? [],

    sceneTitle: episode?.episodeTitle ?? null,
    seasonNumber: episode?.seasonNumber ?? null,
    episodeNumber: episode?.episodeNumber ?? null,

    // A film timestamp is NEVER inferred from a screenshot. Only an exact-frame
    // index could supply one, and no such index exists yet (section 31).
    timestamp: null,
    timestampLabel: TIMESTAMP_UNAVAILABLE,
    timestampSource: 'none',
    timestampBasis: 'No frame-level index is available. Timestamps require sequence alignment against a known print.',

    matchBasis: fingerprintHit
      ? `Exact scene match at ${(fingerprintHit.similarity * 100).toFixed(0)}% perceptual-hash similarity.`
      : confidence >= 76
        ? 'Identified from visual evidence and verified metadata.'
        : 'Identified from visual evidence; confirmation recommended.',

    frameEvidence: analysis.frameEvidence ?? null,
    episodeBasis: episode?.basis ?? null,
    episodeNotice: episode?.notice ?? null,
  };
}

function buildAlternatives(ranked) {
  return ranked.slice(1, 4).map((entry) => ({
    tmdbId: entry.candidate.tmdbId,
    mediaType: entry.candidate.mediaType,
    title: entry.candidate.title,
    year: entry.candidate.year,
    posterUrl: entry.candidate.posterUrl,
    score: Number((entry.score * 100).toFixed(1)),
    reasons: Object.entries(entry.breakdown ?? {})
      .filter(([, v]) => v.score >= 0.7)
      .slice(0, 3)
      .map(([key]) => key),
  }));
}

/* ------------------------------------------------------------------ *
 * Persistence helpers
 * ------------------------------------------------------------------ */

async function persistImages(recognitionId, images) {
  if (images.length === 0) return;
  await prisma.recognitionImage.createMany({
    data: images.map((image) => ({
      recognitionId,
      kind: image.kind ?? ImageKind.PRIMARY,
      sortOrder: image.sortOrder ?? 0,
      mimeType: image.mimeType,
      width: image.width ?? null,
      height: image.height ?? null,
      sizeBytes: image.sizeBytes ?? null,
      // Only the small preview and non-reversible hashes are stored (section 40).
      thumbDataUrl: image.thumbDataUrl ?? null,
      pHash: image.pHash ?? null,
      dHash: image.dHash ?? null,
      aHash: image.aHash ?? null,
      frameTimeMs: image.frameTimeMs ?? null,
    })),
  });
}

async function persistCandidates(recognitionId, ranked) {
  const top = ranked.slice(0, 5);
  if (top.length === 0) return;

  const rows = top.map((entry, index) => ({
    recognitionId,
    tmdbId: entry.candidate.tmdbId,
    mediaType: entry.candidate.mediaType,
    title: entry.candidate.title,
    year: entry.candidate.year ?? null,
    score: entry.score,
    rank: index,
    source: entry.sources?.[0] ?? 'tmdb_search',
    breakdownJson: stringifyJson({
      breakdown: entry.breakdown,
      sources: entry.sources,
      matchedQueries: entry.matchedQueries,
      seedScore: entry.seedScore,
    }),
  }));

  // `skipDuplicates` is a PostgreSQL-only option. SQLite (the local dev database)
  // rejects it, so the flag is only added when the target is Postgres. Rows are
  // already unique by construction: candidates are deduped by mediaType+tmdbId in
  // candidateGenerator before they ever reach here.
  await prisma.recognitionCandidate.createMany({
    data: rows,
    ...(config.database.provider === 'postgresql' ? { skipDuplicates: true } : {}),
  });
}

/** Shapes the API response. `internal` details are stripped unless debug is on. */
export function toApiPayload({ recognition, result, images, aiMeta, stats, cacheHit, debug }) {
  const best = result?.best ?? null;

  return {
    id: recognition.id,
    status: recognition.status,
    createdAt: recognition.createdAt,
    processingMs: recognition.processingMs,

    // Honesty flags the app MUST render (§32). The banner already has the title
    // "Simulated result", so this copy deliberately does not repeat it.
    isMock: Boolean(recognition.isMock),
    isCached: Boolean(cacheHit),
    mockNotice: recognition.isMock
      ? 'No AI provider key is configured, so this identification was produced by the mock adapter. It is not a real recognition.'
      : null,
    providers: { ai: aiMeta?.provider ?? null, tmdb: stats?.isMock ? 'mock' : 'tmdb' },
    mode: recognition.mode,
    source: recognition.source,

    match: best
      ? {
          tmdbId: best.candidate.tmdbId,
          mediaType: best.candidate.mediaType,
          title: best.candidate.title,
          originalTitle: best.candidate.originalTitle,
          year: best.candidate.year,
          runtime: best.candidate.runtime,
          genres: best.candidate.genres,
          overview: best.candidate.overview,
          posterUrl: best.candidate.posterUrl,
          backdropUrl: best.candidate.backdropUrl,
          voteAverage: best.candidate.voteAverage,
          directors: best.detail?.directors ?? [],
          writers: best.detail?.writers ?? [],
          cast: (best.detail?.cast ?? []).slice(0, 12),
          confidence: result.confidence,
          verdict: result.verdict,
          verdictLabel: result.verdictLabel,
          margin: result.best.margin,
          confidenceComponents: result.best.components,
          alternativeCount: Math.max(0, (result.ranked?.length ?? 1) - 1),
          alternatives: buildAlternatives(result.ranked ?? []),
          whyThisMatch: Object.entries(best.breakdown ?? {}).map(([key, v]) => ({
            signal: key,
            score: Math.round(v.score * 100),
            weight: v.weight,
            detail: v.detail,
          })),
          verification: result.verification
            ? { adjustments: result.verification.adjustments, notes: result.verification.notes }
            : null,
        }
      : null,

    scene: result?.scene ?? null,

    images: images.map((image) => ({
      id: image.id ?? null,
      kind: image.kind,
      sortOrder: image.sortOrder,
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes,
      mimeType: image.mimeType,
      thumbDataUrl: image.thumbDataUrl,
      frameTimeMs: image.frameTimeMs,
      hashes: { pHash: image.pHash, dHash: image.dHash, aHash: image.aHash },
    })),

    noMatchReason: best ? null : result?.reason ?? 'The scene could not be matched to a title.',

    ...(debug ? { debug: { stats, aiMeta, candidates: (result?.ranked ?? []).map((r) => ({ title: r.candidate.title, score: r.score, sources: r.sources })) } } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Main entry point
 * ------------------------------------------------------------------ */

/**
 * @param {object} input
 * @param {Array}  input.images           validated upload records (buffers are consumed here)
 * @param {string} input.mode             image | video | describe
 * @param {string} [input.describe]       user description
 * @param {string} [input.hint]           extra app context
 * @param {string} input.region
 * @param {string} input.language
 * @param {string} input.source
 * @param {string|null} input.userId
 * @param {string} input.inputHashValue
 * @param {boolean} [input.debug]
 */
export async function runRecognition({
  images = [],
  mode = RecognitionMode.IMAGE,
  describe = '',
  hint = '',
  region = config.streaming.defaultRegion,
  language = 'en-US',
  source = RecognitionSource.GALLERY,
  userId = null,
  inputHashValue,
  debug = false,
}) {
  log.info('[TRACE recognition] pipeline started');
  const startedAt = Date.now();
  bump('recognitions');
  bump('imagesUploaded', images.length);

  const cacheKey = buildCacheKey({ inputHashValue, mode, describe, region });
  const aiMeta = { provider: getVisionProvider().name, isMock: getVisionProvider().isMock, calls: 0 };
  log.info('[TRACE recognition] AI provider resolved', { provider: aiMeta.provider, isMock: aiMeta.isMock });

  let recognition = await prisma.recognition.create({
    data: {
      userId,
      mode,
      source,
      region,
      language,
      inputHash: inputHashValue,
      status: RecognitionStatus.PROCESSING,
      aiProvider: aiMeta.provider,
      tmdbProvider: getTmdb().name,
    },
  });

  try {
    /* ---------- 1. result cache (cost control, section 41) ---------- */
    const cached = await prisma.recognitionCache
      .findUnique({ where: { inputHash: cacheKey } })
      .catch(() => null);

    let vision;
    let stats;
    let result;
    let cacheHit = false;
    let fingerprintHit = null;

    if (cached && cached.expiresAt > new Date()) {
      const payload = parseJson(cached.payload, null);
      if (payload) {
        log.info(`recognition cache hit (${cacheKey.slice(0, 12)}) — skipping AI and TMDB`);
        bump('recognitionsCached');
        cacheHit = true;
        vision = payload.vision;
        stats = { ...payload.stats, isMock: payload.stats?.isMock ?? false, searchCalls: 0, detailCalls: 0, fromCache: true };
        result = payload.result;
        await prisma.recognitionCache
          .update({ where: { inputHash: cacheKey }, data: { hits: { increment: 1 } } })
          .catch(() => null);
      }
    }

    if (!cacheHit) {
      /* ---------- 2. vision analysis ---------- */
      if (mode === RecognitionMode.VIDEO && images.length > 1) {
        log.info('[TRACE recognition] video multi-frame path');
        // Analyse each frame, then fuse. Bounded by AI_MAX_CALLS_PER_RECOGNITION.
        const perFrame = [];
        const frameBudget = Math.min(images.length, config.ai.maxCallsPerRecognition + 1);
        for (let i = 0; i < frameBudget; i += 1) {
          const single = await analyseScene({
            images: [images[i]],
            mode: RecognitionMode.IMAGE,
            describe,
            region,
            language,
            callIndex: i,
          });
          aiMeta.calls += single.meta.cached ? 0 : 1;
          perFrame.push({ analysis: single.analysis, frameIndex: i, frameTimeMs: images[i].frameTimeMs });
        }
        const fused = fuseFrameAnalyses(perFrame);
        vision = {
          analysis: { ...fused.analysis, frameAgreement: fused.agreement },
          meta: {
            provider: aiMeta.provider,
            isMock: aiMeta.isMock,
            cached: false,
            framesAnalysed: fused.frameCount,
            agreement: fused.agreement,
            supportingFrames: fused.supportingFrames,
          },
        };
        bump('videoFramesProcessed', fused.frameCount);
      } else {
        log.info('[TRACE recognition] analyseScene call entering');
        const analysis = await analyseScene({
          images: mode === RecognitionMode.DESCRIBE ? [] : images,
          mode,
          describe,
          hint,
          region,
          language,
          callIndex: 0,
        });
        log.info('[TRACE recognition] analyseScene returned');
        aiMeta.calls += analysis.meta.cached ? 0 : 1;
        vision = analysis;
      }

      /* ---------- 3. fingerprint lookup (section 31) ---------- */
      const sceneMatcher = getSceneMatcher();
      const primary = images[0];
      const fingerprintHits = primary
        ? await sceneMatcher.search({ pHash: primary.pHash, dHash: primary.dHash, aHash: primary.aHash })
        : [];
      fingerprintHit = fingerprintHits[0] ?? null;
      if (fingerprintHit) {
        log.info(`exact scene match: ${fingerprintHit.mediaType}/${fingerprintHit.tmdbId} @ ${fingerprintHit.similarity}`);
      }

      /* ---------- 4-6. candidates, scoring, verification, confidence ---------- */
      result = await matchCandidates({ analysis: vision.analysis, fingerprintHits });
      stats = result.stats;

      // Store the cached answer for identical future requests.
      if (result.best && !vision.meta.isMock) {
        await prisma.recognitionCache
          .create({
            data: {
              inputHash: cacheKey,
              payload: stringifyJson({ vision, result, stats }),
              isMock: false,
              expiresAt: new Date(Date.now() + RESULT_CACHE_TTL_MS),
            },
          })
          .catch((error) => log.debug(`cache persist skipped: ${error.message}`));
      }
    }

    /* ---------- 7. scene resolution ---------- */
    const episode =
      result?.best && result.best.candidate.mediaType === MediaType.TV
        ? await resolveEpisode({ analysis: vision.analysis, bestCandidate: result.best, fingerprintHit })
        : null;

    result.episode = episode;
    result.scene = buildScene({
      analysis: vision.analysis,
      images,
      fingerprintHit,
      episode,
      confidence: result.confidence ?? 0,
    });

    /* ---------- 8. persist ---------- */
    const noMatch = !result.best;
    await persistImages(recognition.id, images);
    await persistCandidates(recognition.id, result.ranked ?? []);

    recognition = await prisma.recognition.update({
      where: { id: recognition.id },
      data: {
        status: noMatch ? RecognitionStatus.NO_MATCH : RecognitionStatus.COMPLETED,
        tmdbId: result.best?.candidate.tmdbId ?? null,
        mediaType: result.best?.candidate.mediaType ?? null,
        title: result.best?.candidate.title ?? null,
        originalTitle: result.best?.candidate.originalTitle ?? null,
        year: result.best?.candidate.year ?? null,
        posterPath: result.best?.candidate.posterPath ?? null,
        backdropPath: result.best?.candidate.backdropPath ?? null,
        confidence: result.confidence ?? null,
        seasonNumber: episode?.seasonNumber ?? null,
        episodeNumber: episode?.episodeNumber ?? null,
        episodeTitle: episode?.episodeTitle ?? null,
        isMock: Boolean(aiMeta.isMock || stats?.isMock),
        isCached: cacheHit,
        aiCalls: aiMeta.calls,
        tmdbCalls: (stats?.searchCalls ?? 0) + (stats?.detailCalls ?? 0),
        processingMs: Date.now() - startedAt,
        errorCode: noMatch ? 'NO_MATCH_FOUND' : null,
        errorMessage: noMatch ? result.reason ?? null : null,
        resultJson: stringifyJson({ match: result.best?.candidate ? { ...result.best.candidate, confidence: result.confidence, verdict: result.verdict } : null }),
        sceneJson: stringifyJson(result.scene),
        aiJson: stringifyJson(vision.analysis),
        completedAt: new Date(),
      },
    });

    /* ---------- 9. index confirmed frames for exact scene matching ---------- */
    if (result.best && !noMatch) {
      await getSceneMatcher().index(
        {
          tmdbId: result.best.candidate.tmdbId,
          mediaType: result.best.candidate.mediaType,
          title: result.best.candidate.title,
          seasonNumber: episode?.seasonNumber ?? null,
          episodeNumber: episode?.episodeNumber ?? null,
        },
        images
      );
    }

    if (noMatch) bump('recognitionsFailed');
    else bump('recognitionsSucceeded');
    bump('totalProcessingMs', Date.now() - startedAt);

    if (stats?.searchCalls) recordApiCall({ kind: 'tmdb', provider: getTmdb().name, operation: 'recognition_search', ok: true });

    const imagesForPayload = await prisma.recognitionImage
      .findMany({ where: { recognitionId: recognition.id }, orderBy: { sortOrder: 'asc' } })
      .catch(() => images.map((i) => ({ ...i, id: null })));

    log.info('[TRACE recognition] pipeline completed');
    return toApiPayload({
      recognition,
      result,
      images: imagesForPayload.length ? imagesForPayload : images,
      aiMeta,
      stats,
      cacheHit,
      debug,
    });
  } catch (error) {
    bump('errors');
    log.error('[TRACE recognition] pipeline error', { code: error.code, message: error.message });

    await prisma.recognition
      .update({
        where: { id: recognition.id },
        data: {
          status: RecognitionStatus.FAILED,
          errorCode: error.code ?? 'RECOGNITION_FAILED',
          errorMessage: error.message,
          processingMs: Date.now() - startedAt,
          completedAt: new Date(),
        },
      })
      .catch(() => null);

    throw error;
  }
}

export default { runRecognition, toApiPayload, TIMESTAMP_UNAVAILABLE };
