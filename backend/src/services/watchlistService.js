/**
 * Watchlist (section 19).
 *
 * Supports saving movies, series AND individual episodes. An episode is stored as
 * the series identity plus an `episodeRef` such as "S02E05", which keeps one row per
 * saved thing while allowing the app to render episode cards.
 *
 * Items are validated against TMDB before being written, so a client cannot fill the
 * watchlist with arbitrary text — it can only save titles that actually exist.
 */
import { prisma } from '../database/prisma.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { createLogger } from '../utils/logger.js';
import { MediaType, isMediaType } from '../database/constants.js';
import { getTmdb } from '../integrations/tmdb/index.js';
import { toMovieDetail, toTvDetail, imageUrl } from '../integrations/tmdb/normalise.js';

const log = createLogger('watchlist');

export const formatEpisodeRef = (season, episode) =>
  season && episode ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : '';

export function toWatchlistItem(row) {
  return {
    id: row.id,
    mediaType: row.mediaType,
    tmdbId: row.tmdbId,
    title: row.title,
    posterPath: row.posterPath,
    posterUrl: imageUrl(row.posterPath, 'w342'),
    year: row.year,
    episodeRef: row.episodeRef || null,
    note: row.note ?? null,
    createdAt: row.createdAt,
  };
}

export async function listWatchlist({ userId, mediaType, limit = 50, cursor }) {
  const where = { userId };
  if (mediaType) where.mediaType = mediaType;

  const rows = await prisma.watchlistItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100) + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map(toWatchlistItem),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total: await prisma.watchlistItem.count({ where }),
    hasMore,
  };
}

/** Verifies the title exists upstream and returns canonical display metadata. */
async function resolveTitle(mediaType, tmdbId) {
  const tmdb = getTmdb();
  const raw = mediaType === MediaType.TV ? await tmdb.tvDetail(tmdbId) : await tmdb.movieDetail(tmdbId);
  if (!raw) {
    throw HttpError.notFound(ErrorCode.NOT_FOUND, `No ${mediaType} with id ${tmdbId} exists.`);
  }
  return mediaType === MediaType.TV
    ? toTvDetail(raw, raw.credits, Boolean(raw.__mock))
    : toMovieDetail(raw, raw.credits, Boolean(raw.__mock));
}

export async function addToWatchlist({ userId, mediaType, tmdbId, seasonNumber, episodeNumber, note }) {
  if (!isMediaType(mediaType)) {
    throw HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'mediaType must be "movie" or "tv".');
  }

  const detail = await resolveTitle(mediaType, tmdbId);
  const episodeRef = mediaType === MediaType.TV ? formatEpisodeRef(seasonNumber, episodeNumber) : '';

  const item = await prisma.watchlistItem.upsert({
    where: {
      userId_mediaType_tmdbId_episodeRef: { userId, mediaType, tmdbId: String(tmdbId), episodeRef },
    },
    update: { note: note ?? null, posterPath: detail.posterPath ?? null, title: detail.title },
    create: {
      userId,
      mediaType,
      tmdbId: String(tmdbId),
      title: detail.title,
      posterPath: detail.posterPath ?? null,
      year: detail.year ?? null,
      episodeRef,
      note: note ?? null,
    },
  });

  log.debug(`watchlist add: ${mediaType}/${tmdbId}${episodeRef ? ` ${episodeRef}` : ''} for user ${userId}`);
  return { item: toWatchlistItem(item), created: true };
}

export async function removeFromWatchlist({ userId, id, mediaType, tmdbId }) {
  if (id) {
    const row = await prisma.watchlistItem.findUnique({ where: { id } });
    if (!row || row.userId !== userId) {
      throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That watchlist item does not exist.');
    }
    await prisma.watchlistItem.delete({ where: { id } });
    return { deleted: true, id };
  }

  if (!tmdbId || !isMediaType(mediaType)) {
    throw HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'Provide either `id`, or `mediaType` + `tmdbId`.');
  }

  const result = await prisma.watchlistItem.deleteMany({ where: { userId, mediaType, tmdbId: String(tmdbId) } });
  if (result.count === 0) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That watchlist item does not exist.');
  return { deleted: true, count: result.count };
}

export async function isInWatchlist({ userId, mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const episodeRef = mediaType === MediaType.TV ? formatEpisodeRef(seasonNumber, episodeNumber) : '';
  const row = await prisma.watchlistItem.findUnique({
    where: { userId_mediaType_tmdbId_episodeRef: { userId, mediaType, tmdbId: String(tmdbId), episodeRef } },
    select: { id: true },
  });
  return { saved: Boolean(row), id: row?.id ?? null };
}

export async function clearWatchlist({ userId }) {
  const result = await prisma.watchlistItem.deleteMany({ where: { userId } });
  return { deleted: result.count };
}

export default { listWatchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, clearWatchlist, toWatchlistItem };
