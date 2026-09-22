/**
 * Watchlist (section 19).
 *
 * Movies, series and individual episodes. Signed-in users get the server copy;
 * anonymous users get a device-local list that is clearly labelled as such, so
 * "saved" is never over-promised.
 */
import api from './api.js';
import { store, actions } from '../core/store.js';
import config from '../config.js';

const LOCAL_KEY = `${config.storagePrefix}watchlist`;

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(items) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn('[watchlist] local storage unavailable', error?.message ?? error);
  }
}

const keyOf = ({ mediaType, tmdbId, episodeRef }) => `${mediaType}:${tmdbId}:${episodeRef ?? ''}`;

export const isAuthenticated = () => store.getState().session.status === 'authenticated';

/**
 * Saves a title.
 * Rejects impossible entries rather than writing them, so the list cannot fill with
 * garbage. On the server the title is additionally verified against TMDB.
 */
export async function add({ mediaType, tmdbId, title, posterUrl, posterPath, year, seasonNumber, episodeNumber, note }) {
  if (!mediaType || !tmdbId) throw new Error('A title needs a mediaType and tmdbId.');

  const episodeRef =
    mediaType === 'tv' && seasonNumber && episodeNumber
      ? `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
      : '';

  if (isAuthenticated()) {
    const payload = await api.post('/watchlist', {
      mediaType,
      tmdbId,
      ...(seasonNumber ? { seasonNumber } : {}),
      ...(episodeNumber ? { episodeNumber } : {}),
      ...(note ? { note } : {}),
    });
    actions.touchWatchlist();
    return payload.item;
  }

  const item = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mediaType,
    tmdbId: String(tmdbId),
    title: title ?? 'Untitled',
    posterUrl: posterUrl ?? null,
    posterPath: posterPath ?? null,
    year: year ?? null,
    episodeRef: episodeRef || null,
    note: note ?? null,
    createdAt: new Date().toISOString(),
    local: true,
  };

  const items = readLocal().filter((entry) => keyOf(entry) !== keyOf(item));
  writeLocal([item, ...items]);
  actions.touchWatchlist();
  return item;
}

export async function list({ mediaType, limit = 60 } = {}) {
  if (!isAuthenticated()) {
    const items = readLocal().filter((item) => !mediaType || item.mediaType === mediaType);
    return {
      items,
      total: items.length,
      storage: 'device',
      notice: items.length
        ? 'Saved on this device only. Sign in to keep your watchlist across devices.'
        : null,
    };
  }

  const payload = await api.get('/watchlist', { limit, ...(mediaType ? { mediaType } : {}) });
  return {
    items: payload.items.map((item) => ({ ...item, local: false })),
    total: payload.total,
    storage: 'server',
    notice: null,
    hasMore: payload.hasMore,
    nextCursor: payload.nextCursor,
  };
}

export async function remove({ id, mediaType, tmdbId }) {
  if (isAuthenticated() && id && !String(id).startsWith('local_')) {
    await api.delete(`/watchlist/${id}`);
    actions.touchWatchlist();
    return { deleted: true, id };
  }
  if (isAuthenticated() && mediaType && tmdbId) {
    await api.delete('/watchlist', { mediaType, tmdbId });
    actions.touchWatchlist();
    return { deleted: true };
  }

  const before = readLocal();
  const after = before.filter((item) => item.id !== id && keyOf(item) !== keyOf({ mediaType, tmdbId, episodeRef: '' }));
  writeLocal(after);
  actions.touchWatchlist();
  return { deleted: before.length !== after.length, id };
}

export async function clear() {
  if (isAuthenticated()) {
    const result = await api.delete('/watchlist/all');
    writeLocal([]);
    actions.touchWatchlist();
    return result;
  }
  const count = readLocal().length;
  writeLocal([]);
  actions.touchWatchlist();
  return { deleted: count };
}

/** Used to render the correct Save/Remove state without downloading the list. */
export async function has({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  if (!mediaType || !tmdbId) return { saved: false, id: null };

  if (isAuthenticated()) {
    try {
      const payload = await api.get('/watchlist/check', {
        mediaType,
        tmdbId,
        ...(seasonNumber ? { seasonNumber } : {}),
        ...(episodeNumber ? { episodeNumber } : {}),
      });
      return { saved: Boolean(payload.saved), id: payload.id ?? null };
    } catch {
      return { saved: false, id: null };
    }
  }

  const episodeRef =
    mediaType === 'tv' && seasonNumber && episodeNumber
      ? `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
      : '';
  const match = readLocal().find((item) => keyOf(item) === keyOf({ mediaType, tmdbId, episodeRef }));
  return { saved: Boolean(match), id: match?.id ?? null };
}

export async function count() {
  if (isAuthenticated()) {
    const payload = await api.get('/watchlist/count');
    return payload.count;
  }
  return readLocal().length;
}

export default { add, list, remove, clear, has, count, isAuthenticated };
