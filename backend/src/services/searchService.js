/**
 * Search (section 20) — movies, TV series, actors and directors, all through TMDB
 * on the server so no credential ever reaches the app.
 *
 * `type=all` returns titles and people in separate buckets rather than one mixed
 * list, because the app renders them differently (poster cards vs. person rows).
 * Searches by a signed-in user are recorded in SearchHistory, which powers recent
 * searches on the Search screen.
 */
import { prisma } from '../database/prisma.js';
import { createLogger } from '../utils/logger.js';
import { getTmdb } from '../integrations/tmdb/index.js';
import { toMediaSummary, toPerson, imageUrl } from '../integrations/tmdb/normalise.js';
import { MediaType } from '../database/constants.js';

const log = createLogger('search');

const MAX_RESULTS = 20;

function dedupeTitles(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.tmdbId) continue;
    const key = `${item.mediaType}:${item.tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normPerson(raw) {
  return {
    id: String(raw.id),
    name: raw.name ?? '',
    department: raw.known_for_department ?? null,
    profilePath: raw.profile_path ?? null,
    profileUrl: imageUrl(raw.profile_path, 'w185'),
    popularity: raw.popularity ?? null,
    knownFor: (raw.known_for ?? [])
      .filter((k) => k.media_type === 'movie' || k.media_type === 'tv')
      .map((k) => toMediaSummary(k))
      .slice(0, 4),
    isMock: Boolean(raw.__mock),
  };
}

/**
 * @param {object} input
 * @param {string} input.query
 * @param {'all'|'movie'|'tv'|'person'} input.type
 * @param {string|null} input.userId
 */
export async function search({ query, type = 'all', userId = null, region = null, page = 1 }) {
  const tmdb = getTmdb();
  const trimmed = String(query ?? '').trim();

  if (trimmed.length === 0) {
    return { query: '', type, titles: [], people: [], total: 0, isMock: tmdb.isMock };
  }

  let titles = [];
  let people = [];

  if (type === 'movie' || type === 'tv') {
    const response = type === 'tv' ? await tmdb.searchTv(trimmed, { page }) : await tmdb.searchMovie(trimmed, { page });
    titles = (response?.results ?? []).map((raw) => toMediaSummary({ ...raw, media_type: type }));
    people = [];
  } else if (type === 'person') {
    const response = await tmdb.searchPerson(trimmed, { page });
    people = (response?.results ?? []).map(normPerson);
    titles = [];
  } else {
    // A single /search/multi call covers titles and people, which halves the cost.
    const response = await tmdb.searchMulti(trimmed, { page });
    const results = response?.results ?? [];

    const titleResults = results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
    const personResults = results.filter((r) => r.media_type === 'person');

    titles = titleResults.map((raw) => toMediaSummary(raw));
    people = personResults.map(normPerson);

    // If the mixed search found nobody (common for obscure titles) fall back to the
    // dedicated person endpoint so actor search actually works.
    if (people.length === 0 && titleResults.length < 4) {
      try {
        const personResponse = await tmdb.searchPerson(trimmed, { page });
        people = (personResponse?.results ?? []).slice(0, 8).map(normPerson);
      } catch (error) {
        log.warn(`person fallback search failed: ${error.message}`);
      }
    }
  }

  titles = dedupeTitles(titles).slice(0, MAX_RESULTS);
  people = people.slice(0, MAX_RESULTS);

  if (userId) {
    try {
      await prisma.searchHistory.create({
        data: { userId, query: trimmed.slice(0, 200), resultCount: titles.length + people.length, region },
      });
    } catch (error) {
      log.debug(`search history write skipped: ${error.message}`);
    }
  }

  log.debug(`search "${trimmed}" type=${type} -> ${titles.length} title(s), ${people.length} person(s)`);

  return {
    query: trimmed,
    type,
    titles,
    people,
    total: titles.length + people.length,
    isMock: tmdb.isMock,
  };
}

export async function recentSearches({ userId, limit = 10 }) {
  if (!userId) return { items: [] };
  const rows = await prisma.searchHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit * 3, 60),
    select: { id: true, query: true, resultCount: true, createdAt: true },
  });

  // Collapse repeats so a user who searched the same thing five times sees it once.
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    const key = row.query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(row);
    if (items.length >= limit) break;
  }
  return { items };
}

export async function clearRecentSearches({ userId }) {
  const result = await prisma.searchHistory.deleteMany({ where: { userId } });
  return { deleted: result.count };
}

export async function getPerson({ id }) {
  const tmdb = getTmdb();
  const raw = await tmdb.person(id);
  if (!raw) return null;
  return toPerson(raw, Boolean(raw.__mock));
}

export default { search, recentSearches, clearRecentSearches, getPerson };
