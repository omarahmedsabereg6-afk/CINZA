/**
 * Catalog: search, detail, seasons, availability, discover (sections 15-20).
 *
 * Thin, cached wrappers over the API. The caching is what keeps the app feeling
 * instant when navigating back and forth between a result and its detail page.
 */
import api from './api.js';
import settings from './settings.js';
import { toCountryCode } from '../core/countries.js';
import { store } from '../core/store.js';
import { TtlCache } from '../core/cache.js';

const detailCache = new TtlCache({ max: 60, ttlMs: 10 * 60 * 1000 });
const availabilityCache = new TtlCache({ max: 60, ttlMs: 10 * 60 * 1000 });

if (typeof window !== 'undefined') {
  window.addEventListener('cinza:region-changed', () => {
    availabilityCache.clear();
  });
}

function region() {
  return settings.getRegion();
}

/* ------------------------------- search ------------------------------- */

const LOCAL_SELECTED_KEY = 'cinza_selected_history';
const LOCAL_SEARCH_KEY = 'cinza_search_history';
const MAX_SELECTED_HISTORY = 20;

function readSelectedHistory() {
  try {
    const raw = localStorage.getItem(LOCAL_SELECTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSelectedHistory(items) {
  try {
    localStorage.setItem(LOCAL_SELECTED_KEY, JSON.stringify(items.slice(0, MAX_SELECTED_HISTORY)));
  } catch (err) {
    console.warn('[search] failed to save selected history', err);
  }
}

export function saveSelectedItem(item) {
  if (!item) return;
  const list = readSelectedHistory();
  const targetId = String(item.tmdbId || item.id || item.title || '');
  const targetType = String(item.mediaType || item.type || '');
  const filtered = list.filter((x) => {
    const xId = String(x.tmdbId || x.id || x.title || '');
    const xType = String(x.mediaType || x.type || '');
    return !(xId === targetId && xType === targetType);
  });
  filtered.unshift({
    ...item,
    savedAt: new Date().toISOString(),
  });
  writeSelectedHistory(filtered);
}

export function removeSelectedItem(item) {
  if (!item) return;
  const targetId = String(item.tmdbId || item.id || item.title || '');
  const targetType = String(item.mediaType || item.type || '');
  const list = readSelectedHistory().filter((x) => {
    const xId = String(x.tmdbId || x.id || x.title || '');
    const xType = String(x.mediaType || x.type || '');
    return !(xId === targetId && xType === targetType);
  });
  writeSelectedHistory(list);
}

export function selectedHistory() {
  return readSelectedHistory();
}

export function clearSelectedHistory() {
  try {
    localStorage.removeItem(LOCAL_SELECTED_KEY);
  } catch {}
  return { deleted: true };
}

export const saveRecentSearch = saveSelectedItem;
export const removeRecentSearch = removeSelectedItem;

export async function search({ query, type = 'all', page = 1, signal }) {
  return api.get('/search', { q: query, type, page }, { signal });
}

export async function recentSearches() {
  // Returns selected history items first, as requested by user
  return { items: readSelectedHistory() };
}

export async function clearRecentSearches() {
  clearSelectedHistory();
  try {
    localStorage.removeItem(LOCAL_SEARCH_KEY);
  } catch {}
  try {
    await api.delete('/search/recent');
  } catch {}
  return { deleted: true };
}

export async function person(id) {
  return detailCache.wrap(`person:${id}`, undefined, async () => {
    const payload = await api.get(`/people/${id}`);
    return payload.person;
  });
}

export async function personCredits(id) {
  return detailCache.wrap(`person:${id}:credits`, undefined, async () => {
    const payload = await api.get(`/people/${id}/credits`);
    return payload.credits ?? { id: String(id), cast: [], movies: [], tvShows: [] };
  });
}

export async function movieCredits(mediaType, tmdbId) {
  const key = `${mediaType}:${tmdbId}:credits`;
  return detailCache.wrap(key, undefined, async () => {
    const payload = await api.get(`/${mediaType === 'tv' ? 'tv' : 'movies'}/${tmdbId}/credits`);
    return payload.credits ?? { cast: [], crew: [] };
  });
}

export async function recommendations(mediaType, tmdbId, { kind = 'recommendations' } = {}) {
  const key = `${mediaType}:${tmdbId}:${kind}`;
  return detailCache.wrap(key, undefined, async () => {
    const payload = await api.get(`/${mediaType === 'tv' ? 'tv' : 'movies'}/${tmdbId}/${kind}`);
    return payload.items ?? payload.results ?? [];
  });
}

/* ------------------------------- discover ------------------------------ */

export async function discover({ limit = 12, page = 1, sortBy = 'popularity.desc' } = {}) {
  const params = { limit, page, sortBy };
  return detailCache.wrap(`discover:${limit}:${page}:${sortBy}`, 5 * 60 * 1000, () => api.get('/discover', params));
}

/**
 * Genre-filtered and sorted discovery for the Home browse experience.
 * Uses TMDB genre IDs and sort criteria internally.
 * @param {number} [genreId] - TMDB genre ID (e.g., 28 for Action, 18 for Drama)
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.limit]
 * @param {string} [options.sortBy='popularity.desc']
 */
export async function discoverByGenre(genreId, { page = 1, limit, sortBy = 'popularity.desc' } = {}) {
  if (!genreId && sortBy === 'popularity.desc') return discover({ limit });
  
  const params = { page, sortBy };
  if (genreId) params.genreId = genreId;
  if (limit) params.limit = limit;

  return detailCache.wrap(`discover:genre:${genreId || 0}:${page}:${sortBy}:${limit ?? 'all'}`, 5 * 60 * 1000, () => 
    api.get('/discover/genre', params)
  );
}

/* -------------------------------- detail ------------------------------- */

/**
 * Detail for a movie or series.
 * @param {'movie'|'tv'} mediaType
 */
export async function detail(mediaType, tmdbId, { force = false } = {}) {
  const key = `${mediaType}:${tmdbId}`;
  if (force) detailCache.delete(key);

  return detailCache.wrap(key, undefined, async () => {
    const payload =
      mediaType === 'tv' ? await api.get(`/tv/${tmdbId}`) : await api.get(`/movies/${tmdbId}`);
    return payload.series ?? payload.movie;
  });
}

export async function season(tvId, seasonNumber) {
  const key = `season:${tvId}:${seasonNumber}`;
  return detailCache.wrap(key, undefined, async () => {
    const payload = await api.get(`/tv/${tvId}/seasons/${seasonNumber}`);
    return payload.season;
  });
}

/* ----------------------------- where to watch -------------------------- */

/**
 * Region-aware availability (section 17).
 * An empty result is a real answer: the UI renders "no legal viewing options found".
 */
export async function availability(mediaType, tmdbId, { region: reqRegion, refresh = false } = {}) {
  const activeRegion = toCountryCode(reqRegion || region());
  const key = `${mediaType}:${tmdbId}:${activeRegion}`;
  if (refresh) availabilityCache.delete(key);

  return availabilityCache.wrap(key, undefined, async () => {
    const payload = await api.get(`/${mediaType}/${tmdbId}/availability`, { region: activeRegion, refresh });
    return payload.availability;
  });
}

/** Reference stills for the Matched Scene block. Labelled, never claimed as a match. */
export async function stills(mediaType, tmdbId) {
  const key = `stills:${mediaType}:${tmdbId}`;
  return detailCache.wrap(key, undefined, async () => api.get(`/${mediaType}/${tmdbId}/stills`));
}

export function invalidateAll() {
  detailCache.clear();
  availabilityCache.clear();
}

export default {
  search,
  recentSearches,
  saveRecentSearch,
  removeRecentSearch,
  saveSelectedItem,
  removeSelectedItem,
  selectedHistory,
  clearSelectedHistory,
  clearRecentSearches,
  person,
  discover,
  detail,
  season,
  availability,
  stills,
  invalidateAll,
};
