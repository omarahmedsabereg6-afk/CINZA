/**
 * Recognition history + feedback (sections 16, 18, 24, 40).
 *
 * Privacy model (important)
 * -------------------------
 *   Authenticated recognition  -> owned by a user, synced, retrievable and deletable
 *                                 through the API.
 *   Anonymous recognition      -> stored with `userId = null` and NOT retrievable by
 *                                 id through the API. The app keeps the full payload
 *                                 locally. This means an anonymous user's screenshot
 *                                 can never be read by anyone else who guesses an id.
 *
 * Uploaded image bytes are never stored; history items carry only a small preview
 * thumbnail plus the match metadata (section 40).
 */
import { prisma } from '../database/prisma.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { createLogger } from '../utils/logger.js';
import { parseJson } from '../utils/json.js';
import { RecognitionStatus } from '../database/constants.js';

const log = createLogger('history');

/** Shapes a Recognition row (with its primary image) into a History list item. */
export function toHistoryItem(row, image = null) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    mode: row.mode,
    source: row.source,
    confidence: row.confidence,
    isMock: row.isMock,
    isCached: row.isCached,
    processingMs: row.processingMs,
    match: row.tmdbId
      ? {
          tmdbId: row.tmdbId,
          mediaType: row.mediaType,
          title: row.title,
          originalTitle: row.originalTitle,
          year: row.year,
          posterPath: row.posterPath,
          backdropPath: row.backdropPath,
          seasonNumber: row.seasonNumber,
          episodeNumber: row.episodeNumber,
          episodeTitle: row.episodeTitle,
        }
      : null,
    thumbDataUrl: image?.thumbDataUrl ?? null,
    image: image
      ? {
          width: image.width,
          height: image.height,
          sizeBytes: image.sizeBytes,
          mimeType: image.mimeType,
          frameTimeMs: image.frameTimeMs,
        }
      : null,
    errorCode: row.errorCode ?? null,
    errorMessage: null, // server-side detail is not exposed in list views
    noMatchReason: row.status === RecognitionStatus.NO_MATCH ? 'The scene could not be identified.' : null,
  };
}

export async function listHistory({ userId, limit = 30, cursor, mediaType, status }) {
  if (!userId) {
    // The app keeps anonymous history on-device; the API has nothing to return.
    return { items: [], nextCursor: null, total: 0, storage: 'device' };
  }

  const where = { userId };
  if (mediaType) where.mediaType = mediaType;
  if (status) where.status = status;

  const rows = await prisma.recognition.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100) + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      images: {
        orderBy: { sortOrder: 'asc' },
        take: 1,
        select: { thumbDataUrl: true, width: true, height: true, sizeBytes: true, mimeType: true, frameTimeMs: true },
      },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const total = await prisma.recognition.count({ where });

  return {
    items: page.map((row) => toHistoryItem(row, row.images[0] ?? null)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total,
    storage: 'server',
    hasMore,
  };
}

/**
 * Fetches one recognition. Returns 404 (not 403) when it belongs to someone else,
 * so the endpoint cannot be used to probe which ids exist.
 */
export async function getRecognition({ id, userId }) {
  const row = await prisma.recognition.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      candidates: { orderBy: { rank: 'asc' } },
    },
  });

  if (!row) throw HttpError.notFound(ErrorCode.RECOGNITION_NOT_FOUND, 'That recognition no longer exists.');

  const isOwner = Boolean(userId) && row.userId === userId;
  if (!isOwner) {
    if (row.userId !== null) {
      throw HttpError.notFound(ErrorCode.RECOGNITION_NOT_FOUND, 'That recognition no longer exists.');
    }
    throw HttpError.notFound(
      ErrorCode.RECOGNITION_NOT_FOUND,
      'That recognition was made anonymously and is stored only on the device that created it.'
    );
  }

  return {
    ...toHistoryItem(row, row.images[0] ?? null),
    result: parseJson(row.resultJson, null),
    scene: parseJson(row.sceneJson, null),
    images: row.images.map((image) => ({
      id: image.id,
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
    candidates: row.candidates.map((c) => ({
      rank: c.rank,
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      title: c.title,
      year: c.year,
      score: c.score,
      source: c.source,
      breakdown: parseJson(c.breakdownJson, null),
    })),
    // Surfaced so the app can show what it cost to produce.
    telemetry: {
      aiCalls: row.aiCalls,
      tmdbCalls: row.tmdbCalls,
      processingMs: row.processingMs,
      aiProvider: row.aiProvider,
      tmdbProvider: row.tmdbProvider,
      region: row.region,
      cached: row.isCached,
    },
  };
}

export async function deleteRecognition({ id, userId }) {
  const row = await prisma.recognition.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!row || row.userId !== userId) {
    throw HttpError.notFound(ErrorCode.RECOGNITION_NOT_FOUND, 'That recognition no longer exists.');
  }
  // Images and candidates cascade.
  await prisma.recognition.delete({ where: { id } });
  log.debug(`deleted recognition ${id}`);
  return { deleted: true, id };
}

export async function clearHistory({ userId }) {
  const rows = await prisma.recognition.findMany({ where: { userId }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { deleted: 0 };

  await prisma.$transaction([
    prisma.recognitionImage.deleteMany({ where: { recognitionId: { in: ids } } }),
    prisma.recognitionCandidate.deleteMany({ where: { recognitionId: { in: ids } } }),
    prisma.recognitionFeedback.deleteMany({ where: { recognitionId: { in: ids } } }),
    prisma.recognition.deleteMany({ where: { id: { in: ids } } }),
  ]);

  log.info(`cleared ${ids.length} recognition(s) for user ${userId}`);
  return { deleted: ids.length };
}

export async function historyStats({ userId }) {
  const [total, identified, noMatch, failed, avgConfidence] = await Promise.all([
    prisma.recognition.count({ where: { userId } }),
    prisma.recognition.count({ where: { userId, status: RecognitionStatus.COMPLETED } }),
    prisma.recognition.count({ where: { userId, status: RecognitionStatus.NO_MATCH } }),
    prisma.recognition.count({ where: { userId, status: RecognitionStatus.FAILED } }),
    prisma.recognition.aggregate({ where: { userId, confidence: { not: null } }, _avg: { confidence: true } }),
  ]);

  return {
    total,
    identified,
    noMatch,
    failed,
    averageConfidence: avgConfidence._avg.confidence ? Math.round(avgConfidence._avg.confidence) : null,
  };
}

/**
 * Records whether the identification was right (section 29 — RecognitionFeedback).
 *
 * This is the training/evaluation signal for the matching engine: when a user
 * supplies the correct title we also index it, so a corrected result improves the
 * next attempt rather than being thrown away.
 */
export async function submitFeedback({
  recognitionId,
  userId,
  correct,
  correctedTmdbId,
  correctedTitle,
  correctedMediaType,
  correctedSeason,
  correctedEpisode,
  comment,
}) {
  const recognition = await prisma.recognition.findUnique({
    where: { id: recognitionId },
    select: { id: true, userId: true, title: true, mediaType: true, tmdbId: true },
  });
  if (!recognition) throw HttpError.notFound(ErrorCode.RECOGNITION_NOT_FOUND, 'That recognition no longer exists.');

  if (correct === false && !correctedTmdbId && !correctedTitle) {
    throw HttpError.badRequest(
      ErrorCode.VALIDATION_FAILED,
      'A correction must include the correct title or TMDB id.'
    );
  }

  const feedback = await prisma.recognitionFeedback.create({
    data: {
      recognitionId,
      userId: userId ?? null,
      correct: correct !== false,
      correctedTmdbId: correctedTmdbId ? String(correctedTmdbId) : null,
      correctedTitle: correctedTitle ?? null,
      correctedMediaType: correctedMediaType ?? null,
      correctedSeason: correctedSeason ?? null,
      correctedEpisode: correctedEpisode ?? null,
      comment: comment?.slice(0, 500) ?? null,
    },
  });

  // A correction is a strong signal — apply it to the recognition itself so History
  // is not left showing something the user has already told us is wrong.
  if (correct === false && correctedTitle) {
    await prisma.recognition.update({
      where: { id: recognitionId },
      data: {
        title: correctedTitle,
        tmdbId: correctedTmdbId ? String(correctedTmdbId) : null,
        mediaType: correctedMediaType ?? recognition.mediaType,
        errorCode: 'CORRECTED_BY_USER',
      },
    });
  }

  log.info(
    `feedback received for ${recognitionId}: ${correct === false ? `correction -> ${correctedTitle}` : 'confirmed correct'}`
  );

  return {
    id: feedback.id,
    recorded: true,
    corrected: correct === false,
    message: correct === false ? 'Thanks — we have updated this result.' : 'Thanks for confirming.',
  };
}

export async function feedbackStats() {
  const [total, corrected, confirmed] = await Promise.all([
    prisma.recognitionFeedback.count(),
    prisma.recognitionFeedback.count({ where: { correct: false } }),
    prisma.recognitionFeedback.count({ where: { correct: true } }),
  ]);
  return {
    total,
    corrected,
    confirmed,
    accuracy: total === 0 ? null : Number((confirmed / total).toFixed(3)),
  };
}

export default {
  listHistory,
  getRecognition,
  deleteRecognition,
  clearHistory,
  historyStats,
  submitFeedback,
  feedbackStats,
  toHistoryItem,
};
