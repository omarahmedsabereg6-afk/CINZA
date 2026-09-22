/**
 * History (sections 18, 40).
 *
 * Two stores behind one interface:
 *
 *   authenticated -> the server, so history follows the account
 *   anonymous     -> this device only, in local storage
 *
 * Local storage holds a small thumbnail data URL and the match metadata — the same
 * fields the server keeps. It never holds original uploads, because there are none:
 * the full-size image only ever existed in memory during the request.
 *
 * `storage` is reported to the UI so the screen can say plainly where the entries
 * live, rather than implying they are backed up when they are not.
 */
import api from './api.js';
import { store, actions } from '../core/store.js';
import config from '../config.js';

const LOCAL_KEY = `${config.storagePrefix}history`;
const LOCAL_LIMIT = 60;

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(items) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items.slice(0, LOCAL_LIMIT)));
  } catch (error) {
    // Quota exceeded: drop the oldest half and retry once.
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(items.slice(0, Math.floor(LOCAL_LIMIT / 2))));
    } catch {
      console.warn('[history] local storage unavailable', error?.message ?? error);
    }
  }
}

export const isAuthenticated = () => store.getState().session.status === 'authenticated';

/** Normalises a server recognition payload into a history item. */
function fromRecognition(recognition) {
  const match = recognition.match ?? null;
  return {
    id: recognition.id,
    status: recognition.status,
    createdAt: recognition.createdAt,
    confidence: recognition.match?.confidence ?? recognition.confidence ?? null,
    isMock: Boolean(recognition.isMock),
    mode: recognition.mode,
    source: recognition.source,
    mediaType: match?.mediaType ?? null,
    match: match
      ? {
          tmdbId: match.tmdbId,
          mediaType: match.mediaType,
          title: match.title,
          year: match.year,
          posterUrl: match.posterUrl,
          posterPath: match.posterPath,
          seasonNumber: match.seasonNumber ?? recognition.scene?.seasonNumber ?? null,
          episodeNumber: match.episodeNumber ?? recognition.scene?.episodeNumber ?? null,
          episodeTitle: match.episodeTitle ?? recognition.scene?.sceneTitle ?? null,
        }
      : null,
    thumbDataUrl: recognition.scene?.userThumb ?? recognition.images?.[0]?.thumbDataUrl ?? null,
    verdict: match?.verdict ?? null,
    local: false,
  };
}

/** Stores the payload of an anonymous recognition on the device. */
function saveLocal(recognition) {
  const item = { ...fromRecognition(recognition), local: true };
  const existing = readLocal().filter((entry) => entry.id !== item.id);
  writeLocal([item, ...existing]);
  return item;
}

export async function list({ limit = 40, cursor } = {}) {
  if (!isAuthenticated()) {
    const items = readLocal();
    return {
      items,
      total: items.length,
      storage: 'device',
      hasMore: false,
      nextCursor: null,
      notice: items.length
        ? 'These recognitions are stored on this device only. Sign in to sync them across your devices.'
        : null,
    };
  }

  const payload = await api.get('/history', { limit, cursor });
  return {
    items: payload.items.map((item) => ({ ...item, local: false })),
    total: payload.total,
    storage: payload.storage ?? 'server',
    hasMore: payload.hasMore ?? false,
    nextCursor: payload.nextCursor ?? null,
    notice: null,
  };
}

/** Records a freshly completed recognition. On the server this is already stored. */
export function record(recognition) {
  if (!recognition) return null;
  if (isAuthenticated()) {
    actions.touchHistory();
    return fromRecognition(recognition);
  }
  const item = saveLocal(recognition);
  actions.touchHistory();
  return item;
}

/**
 * Fetches full detail for one entry.
 * Anonymous entries resolve entirely from local storage.
 */
export async function get(id) {
  if (isAuthenticated()) {
    try {
      const payload = await api.get(`/recognitions/${id}`);
      return payload.recognition;
    } catch (error) {
      // Fall back to the device copy if the server no longer has it.
      const local = readLocal().find((entry) => entry.id === id);
      if (local) return local;
      throw error;
    }
  }
  const local = readLocal().find((entry) => entry.id === id);
  if (!local) return null;
  return local;
}

export async function remove(id) {
  if (isAuthenticated()) {
    try {
      await api.delete(`/recognitions/${id}`);
      actions.touchHistory();
      return { deleted: true, id };
    } catch (error) {
      // Still remove the device copy so the user sees the action take effect.
      const items = readLocal().filter((entry) => entry.id !== id);
      writeLocal(items);
      actions.touchHistory();
      if (error?.status && error.status < 500) throw error;
      return { deleted: true, id, localOnly: true };
    }
  }

  writeLocal(readLocal().filter((entry) => entry.id !== id));
  actions.touchHistory();
  return { deleted: true, id };
}

export async function clear() {
  if (isAuthenticated()) {
    const result = await api.delete('/history');
    // Also drop the device cache so nothing lingers after "Clear History".
    writeLocal([]);
    actions.touchHistory();
    return result;
  }
  const count = readLocal().length;
  writeLocal([]);
  actions.touchHistory();
  return { deleted: count };
}

export async function stats() {
  if (!isAuthenticated()) {
    const items = readLocal();
    const identified = items.filter((i) => i.match).length;
    const confidences = items.map((i) => i.confidence).filter((c) => typeof c === 'number');
    return {
      total: items.length,
      identified,
      noMatch: items.filter((i) => i.status === 'no_match').length,
      failed: items.filter((i) => i.status === 'failed').length,
      averageConfidence: confidences.length
        ? Math.round(confidences.reduce((sum, c) => sum + c, 0) / confidences.length)
        : null,
      storage: 'device',
    };
  }
  const payload = await api.get('/history/stats');
  return { ...payload.stats, storage: 'server' };
}

/** All locally held entries — used by Home's "Recent" strip. */
export function localItems() {
  return readLocal();
}

export default { list, get, record, remove, clear, stats, localItems, isAuthenticated };
