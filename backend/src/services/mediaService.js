/**
 * Media detail service (sections 12, 15, 16, 17, 19, 26).
 *
 * Responsibilities:
 *  - serve movie / TV / season / person detail through the TMDB adapter
 *  - mirror that metadata into our own Movie / TVSeries / TVSeason / TVEpisode tables
 *    so a cold TMDB is not a total outage, and so repeat views cost nothing
 *  - resolve "Where to Watch" through the streaming abstraction, persisting rows in
 *    StreamingAvailability with a short TTL
 *  - supply reference stills for the Matched Scene block, without ever implying that
 *    an unrelated still is the exact frame the user captured
 */
import { prisma } from '../database/prisma.js';
import { createLogger } from '../utils/logger.js';
import { stringifyJson } from '../utils/json.js';
import { getTmdb } from '../integrations/tmdb/index.js';
import { toMovieDetail, toTvDetail, toSeason, toImages, toMediaSummary, toPerson, imageUrl, rowToMovie, rowToSeries } from '../integrations/tmdb/normalise.js';
import { getAvailability } from '../integrations/streaming/index.js';
import { MediaType, StreamingCategory, toCountryCode, countryName } from '../database/constants.js';

const log = createLogger('media');

/* ------------------------------------------------------------------ *
 * Catalog mirroring
 * ------------------------------------------------------------------ */

async function mirrorMovie(detail) {
  if (!detail) return;
  await prisma.movie
    .upsert({
      where: { tmdbId: String(detail.tmdbId) },
      update: {
        title: detail.title,
        overview: detail.overview,
        posterPath: detail.posterPath,
        backdropPath: detail.backdropPath,
        year: detail.year,
        runtime: detail.runtime,
        voteAverage: detail.voteAverage,
        genresJson: stringifyJson(detail.genres),
        castJson: stringifyJson(detail.cast),
        crewJson: stringifyJson(detail.crew),
        videosJson: stringifyJson(detail.videos),
        fetchedAt: new Date(),
      },
      create: {
        tmdbId: String(detail.tmdbId),
        title: detail.title,
        originalTitle: detail.originalTitle,
        overview: detail.overview,
        posterPath: detail.posterPath,
        backdropPath: detail.backdropPath,
        releaseDate: detail.releaseDate,
        year: detail.year,
        runtime: detail.runtime,
        voteAverage: detail.voteAverage,
        popularity: detail.popularity,
        genresJson: stringifyJson(detail.genres),
        castJson: stringifyJson(detail.cast),
        crewJson: stringifyJson(detail.crew),
        videosJson: stringifyJson(detail.videos),
      },
    })
    .catch((error) => log.debug(`movie mirror skipped: ${error.message}`));
}

async function mirrorSeries(detail) {
  if (!detail) return;
  const persisted = await prisma.tVSeries
    .upsert({
      where: { tmdbId: String(detail.tmdbId) },
      update: {
        name: detail.title,
        overview: detail.overview,
        posterPath: detail.posterPath,
        backdropPath: detail.backdropPath,
        yearStart: detail.year,
        yearEnd: detail.yearEnd,
        numberOfSeasons: detail.seasonsCount,
        numberOfEpisodes: detail.episodesCount,
        voteAverage: detail.voteAverage,
        status: detail.status,
        genresJson: stringifyJson(detail.genres),
        castJson: stringifyJson(detail.cast),
        crewJson: stringifyJson(detail.crew),
        seasonsJson: stringifyJson(detail.seasons),
        fetchedAt: new Date(),
      },
      create: {
        tmdbId: String(detail.tmdbId),
        name: detail.title,
        originalName: detail.originalTitle,
        overview: detail.overview,
        posterPath: detail.posterPath,
        backdropPath: detail.backdropPath,
        firstAirDate: detail.firstAirDate,
        lastAirDate: detail.lastAirDate,
        yearStart: detail.year,
        yearEnd: detail.yearEnd,
        numberOfSeasons: detail.seasonsCount,
        numberOfEpisodes: detail.episodesCount,
        voteAverage: detail.voteAverage,
        popularity: detail.popularity,
        status: detail.status,
        genresJson: stringifyJson(detail.genres),
        castJson: stringifyJson(detail.cast),
        crewJson: stringifyJson(detail.crew),
        seasonsJson: stringifyJson(detail.seasons),
      },
    })
    .catch((error) => {
      log.debug(`series mirror skipped: ${error.message}`);
      return null;
    });

  // Mirror the season shells so the app can render a season picker offline.
  if (persisted) {
    for (const season of detail.seasons ?? []) {
      await prisma.tVSeason
        .upsert({
          where: { seriesId_seasonNumber: { seriesId: persisted.id, seasonNumber: season.seasonNumber } },
          update: { name: season.name, posterPath: season.posterPath, airDate: season.airDate, episodeCount: season.episodeCount },
          create: {
            seriesId: persisted.id,
            tmdbId: season.tmdbId,
            seasonNumber: season.seasonNumber,
            name: season.name,
            overview: season.overview,
            posterPath: season.posterPath,
            airDate: season.airDate,
            episodeCount: season.episodeCount,
          },
        })
        .catch(() => null);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export async function getMovie({ tmdbId, mirror = true }) {
  const tmdb = getTmdb();
  try {
    const raw = await tmdb.movieDetail(tmdbId);
    if (!raw) return null;
    const detail = toMovieDetail(raw, raw.credits, Boolean(raw.__mock));
    if (mirror && !detail.isMock) mirrorMovie(detail).catch(() => null);
    return detail;
  } catch (error) {
    // TMDB down: serve the mirrored copy if we have one.
    const row = await prisma.movie.findUnique({ where: { tmdbId: String(tmdbId) } }).catch(() => null);
    if (row) {
      log.warn(`TMDB unavailable for movie/${tmdbId}; serving mirrored copy`);
      return { ...rowToMovie(row), stale: true };
    }
    throw error;
  }
}

export async function getSeries({ tmdbId, mirror = true }) {
  const tmdb = getTmdb();
  try {
    const raw = await tmdb.tvDetail(tmdbId);
    if (!raw) return null;
    const detail = toTvDetail(raw, raw.credits, Boolean(raw.__mock));

    // Prefer locally cached episode data for seasons we already know, so the season
    // picker works without a TMDB round trip per season.
    const localSeasons = await prisma.tVSeason
      .findMany({ where: { series: { tmdbId: String(tmdbId) } }, include: { episodes: true } })
      .catch(() => []);

    const enrichedSeasons = detail.seasons.map((season) => {
      const local = localSeasons.find((s) => s.seasonNumber === season.seasonNumber);
      return {
        ...season,
        episodes: (local?.episodes ?? []).map((e) => ({
          tmdbId: e.tmdbId,
          episodeNumber: e.episodeNumber,
          seasonNumber: local.seasonNumber,
          name: e.name,
          overview: e.overview,
          stillPath: e.stillPath,
          stillUrl: null,
          airDate: e.airDate,
          runtime: e.runtime,
          voteAverage: e.voteAverage,
        })),
        episodesCached: Boolean(local?.episodes?.length),
      };
    });

    if (mirror && !detail.isMock) mirrorSeries({ ...detail, seasons: enrichedSeasons }).catch(() => null);
    return { ...detail, seasons: enrichedSeasons };
  } catch (error) {
    const row = await prisma.tVSeries.findUnique({ where: { tmdbId: String(tmdbId) } }).catch(() => null);
    if (row) {
      log.warn(`TMDB unavailable for tv/${tmdbId}; serving mirrored copy`);
      return { ...rowToSeries(row), stale: true };
    }
    throw error;
  }
}

export async function getSeason({ tvId, seasonNumber }) {
  const tmdb = getTmdb();
  const raw = await tmdb.season(tvId, seasonNumber);
  if (!raw) return null;
  const season = toSeason(raw, Boolean(raw.__mock));

  // Mirror episodes so a previously viewed season is instant and works offline-ish.
  const series = await prisma.tVSeries.findUnique({ where: { tmdbId: String(tvId) } }).catch(() => null);
  if (series) {
    const persisted = await prisma.tVSeason
      .upsert({
        where: { seriesId_seasonNumber: { seriesId: series.id, seasonNumber: Number(seasonNumber) } },
        update: { name: season.name, overview: season.overview, posterPath: season.posterPath, airDate: season.airDate, episodeCount: season.episodes.length },
        create: {
          seriesId: series.id,
          tmdbId: season.tmdbId,
          seasonNumber: Number(seasonNumber),
          name: season.name,
          overview: season.overview,
          posterPath: season.posterPath,
          airDate: season.airDate,
          episodeCount: season.episodes.length,
        },
      })
      .catch(() => null);

    if (persisted) {
      for (const episode of season.episodes) {
        await prisma.tVEpisode
          .upsert({
            where: { seasonId_episodeNumber: { seasonId: persisted.id, episodeNumber: episode.episodeNumber } },
            update: { name: episode.name, overview: episode.overview, stillPath: episode.stillPath, airDate: episode.airDate, runtime: episode.runtime },
            create: {
              seasonId: persisted.id,
              tmdbId: episode.tmdbId,
              episodeNumber: episode.episodeNumber,
              name: episode.name,
              overview: episode.overview,
              stillPath: episode.stillPath,
              airDate: episode.airDate,
              runtime: episode.runtime,
              voteAverage: episode.voteAverage,
            },
          })
          .catch(() => null);
      }
    }
  }

  return season;
}

export async function getPerson({ id }) {
  const tmdb = getTmdb();
  const raw = await tmdb.person(id);
  if (!raw) return null;
  return toPerson(raw, Boolean(raw.__mock));
}

export async function getPersonCredits({ id }) {
  const tmdb = getTmdb();
  const raw = await tmdb.personCredits(id);
  if (!raw) return null;

  const cast = (raw.cast ?? []).map((credit) => {
    const mediaType = credit.media_type === 'tv' ? 'tv' : 'movie';
    const title = credit.title ?? credit.name ?? 'Untitled';
    const year = credit.release_date
      ? Number.parseInt(String(credit.release_date).slice(0, 4), 10)
      : credit.first_air_date
        ? Number.parseInt(String(credit.first_air_date).slice(0, 4), 10)
        : null;

    return {
      tmdbId: String(credit.id ?? credit.tmdbId ?? credit.media_id ?? ''),
      mediaType,
      title,
      year,
      posterPath: credit.poster_path ?? null,
      posterUrl: imageUrl(credit.poster_path, 'w342'),
      character: credit.character ?? null,
      voteAverage: credit.vote_average ?? null,
      overview: credit.overview ?? null,
    };
  }).filter((credit) => credit.tmdbId && credit.tmdbId !== '');

  return {
    id: String(id),
    cast,
    movies: cast.filter((credit) => credit.mediaType === 'movie'),
    tvShows: cast.filter((credit) => credit.mediaType === 'tv'),
  };
}

export async function getMovieCredits({ tmdbId }) {
  const tmdb = getTmdb();
  const raw = await tmdb.movieCredits(tmdbId);
  if (!raw) return null;
  const cast = (raw.cast ?? []).map((person) => ({
    id: String(person.id),
    name: person.name ?? '',
    character: person.character ?? null,
    profilePath: person.profile_path ?? null,
    profileUrl: imageUrl(person.profile_path, 'w185'),
    order: person.order ?? 999,
  }));
  const crew = (raw.crew ?? []).map((person) => ({
    id: String(person.id),
    name: person.name ?? '',
    job: person.job ?? null,
    department: person.department ?? null,
  }));
  return {
    id: String(tmdbId),
    cast,
    crew,
    directors: crew.filter((person) => person.job === 'Director').map((person) => person.name),
    writers: crew.filter((person) => ['Writer', 'Screenplay', 'Story', 'Author'].includes(person.job ?? '')).map((person) => person.name),
  };
}

export async function getSeriesCredits({ tmdbId }) {
  const tmdb = getTmdb();
  const raw = await tmdb.tvCredits(tmdbId);
  if (!raw) return null;
  const cast = (raw.cast ?? []).map((person) => ({
    id: String(person.id),
    name: person.name ?? '',
    character: person.character ?? null,
    profilePath: person.profile_path ?? null,
    profileUrl: imageUrl(person.profile_path, 'w185'),
    order: person.order ?? 999,
  }));
  const crew = (raw.crew ?? []).map((person) => ({
    id: String(person.id),
    name: person.name ?? '',
    job: person.job ?? null,
    department: person.department ?? null,
  }));
  return {
    id: String(tmdbId),
    cast,
    crew,
    directors: crew.filter((person) => person.job === 'Director').map((person) => person.name),
    writers: crew.filter((person) => ['Writer', 'Screenplay', 'Story', 'Author'].includes(person.job ?? '')).map((person) => person.name),
  };
}

export async function getRelatedTitles({ mediaType, tmdbId, kind = 'recommendations' }) {
  const tmdb = getTmdb();
  let raw = null;

  if (mediaType === 'tv') {
    raw = kind === 'similar' ? await tmdb.tvSimilar(tmdbId) : await tmdb.tvRecommendations(tmdbId);
  } else {
    raw = kind === 'similar' ? await tmdb.movieSimilar(tmdbId) : await tmdb.movieRecommendations(tmdbId);
  }

  const results = (raw?.results ?? []).map((item) => ({
    ...toMediaSummary({
      ...item,
      media_type: item.media_type ?? mediaType,
    }),
    isMock: Boolean(raw?.__mock || item.__mock),
  })).filter(Boolean);

  return {
    mediaType,
    kind,
    items: results,
    total: results.length,
  };
}

/* ------------------------------------------------------------------ *
 * Reference stills for the Matched Scene block
 * ------------------------------------------------------------------ */
/**
 * Returns candidate reference imagery for a title.
 *
 * IMPORTANT: these are stills FROM THE TITLE, not the frame the user captured. They
 * are labelled as such in the payload and rendered with that label, because pairing a
 * user's screenshot with an unrelated still and calling it a match would be a lie
 * (section 15). A true matched-frame reference only comes from the SceneMatcher.
 */
export async function getReferenceStills({ mediaType, tmdbId, limit = 12 }) {
  const tmdb = getTmdb();
  try {
    const raw = await tmdb.images(mediaType, tmdbId);
    const { stills } = toImages(raw, Boolean(raw.__mock));
    return {
      stills: stills.slice(0, limit),
      label: 'Reference stills from this title — not a frame-level match',
      isMock: Boolean(raw?.__mock),
      available: stills.length > 0,
    };
  } catch (error) {
    log.debug(`reference stills unavailable for ${mediaType}/${tmdbId}: ${error.message}`);
    return { stills: [], label: null, isMock: false, available: false };
  }
}

/* ------------------------------------------------------------------ *
 * Where to Watch (section 17)
 * ------------------------------------------------------------------ */

/**
 * Region-aware availability. Reads fresh rows from StreamingAvailability when
 * present, otherwise asks the streaming provider and persists the result.
 *
 * Availability is NEVER fabricated: an empty provider list is returned as an empty
 * list and the app renders "No legal viewing options found for your region."
 */
export async function getWatchOptions({ mediaType, tmdbId, region, refresh = false }) {
  const regionCode = toCountryCode(region);

  if (!refresh) {
    const cached = await prisma.streamingAvailability
      .findMany({
        where: { tmdbId: String(tmdbId), mediaType, region: regionCode, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { displayPriority: 'asc' },
      })
      .catch(() => []);

    if (cached.length > 0) {
      return { ...groupStoredProviders(cached, regionCode), cached: true };
    }
  }

  const availability = await getAvailability({ mediaType, tmdbId, region: regionCode });

  // Persist whatever the provider returned, including an empty result, so we do not
  // hammer the licensing API for a title that genuinely has no options.
  const rows = [];
  for (const group of availability.groups ?? []) {
    for (const provider of group.providers) {
      rows.push({
        tmdbId: String(tmdbId),
        mediaType,
        region: regionCode,
        providerKey: provider.key,
        providerName: provider.name,
        providerLogoPath: provider.logoPath,
        category: provider.category,
        deepLink: provider.deepLink,
        priceText: provider.priceText,
        quality: provider.quality,
        displayPriority: provider.priority,
        source: availability.source ?? 'unknown',
        isMock: Boolean(availability.isMock),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      });
    }
  }

  if (rows.length > 0) {
    for (const row of rows) {
      await prisma.streamingAvailability
        .upsert({
          where: {
            tmdbId_mediaType_region_providerKey_category: {
              tmdbId: row.tmdbId,
              mediaType: row.mediaType,
              region: row.region,
              providerKey: row.providerKey,
              category: row.category,
            },
          },
          update: { ...row },
          create: row,
        })
        .catch((error) => log.debug(`availability persist skipped: ${error.message}`));
    }
  }

  return { ...availability, cached: false };
}

function groupStoredProviders(rows, region) {
  const groups = [
    { category: StreamingCategory.STREAM, providers: [] },
    { category: StreamingCategory.RENT, providers: [] },
    { category: StreamingCategory.BUY, providers: [] },
  ];

  for (const row of rows) {
    const group = groups.find((g) => g.category === row.category);
    if (!group) continue;
    group.providers.push({
      key: row.providerKey,
      name: row.providerName,
      logoPath: row.providerLogoPath,
      logoUrl: imageUrl(row.providerLogoPath, 'w92'),
      category: row.category,
      deepLink: row.deepLink,
      priceText: row.priceText,
      quality: row.quality,
      priority: row.displayPriority ?? 999,
    });
  }

  const populated = groups.filter((g) => g.providers.length > 0);
  return {
    region,
    regionName: countryName(region),
    link: rows[0]?.deepLink ?? null,
    groups: populated,
    hasAny: populated.length > 0,
    isMock: rows.some((r) => r.isMock),
    source: rows[0]?.source ?? 'cache',
  };
}

/* ------------------------------------------------------------------ *
 * Home rails (section 26 — avoid loading huge lists eagerly)
 * ------------------------------------------------------------------ */

export async function getDiscover({ region = null, limit = 12, genreId, page = 1, sortBy = 'popularity.desc' } = {}) {
  const tmdb = getTmdb();

  if (genreId || (sortBy && sortBy !== 'popularity.desc')) {
    const pageNum = Number(page) || 1;
    const response = await tmdb.discoverByGenre('all', genreId, { page: pageNum, sortBy });
    const rawItems = (response?.results ?? [])
      .map((raw) => toMediaSummary(raw))
      .filter((item) => item?.tmdbId && item.title);
    const items = limit !== undefined && limit !== null ? rawItems.slice(0, Number(limit)) : rawItems;
    const totalResults = response?.total_results ?? items.length;
    const totalPages = response?.total_pages ?? 1;

    return {
      items,
      total: totalResults,
      page: pageNum,
      totalPages,
      hasMore: pageNum < totalPages,
      sortBy,
      isMock: tmdb.isMock,
      region,
    };
  }

  const [trending, popularMovies, popularSeries, popularPeople] = await Promise.all([
    tmdb.trending({ mediaType: 'all' }).catch(() => ({ results: [] })),
    tmdb.popular('movie').catch(() => ({ results: [] })),
    tmdb.popular('tv').catch(() => ({ results: [] })),
    tmdb.popular('person').catch(() => ({ results: [] })),
  ]);

  const clean = (response) =>
    (response?.results ?? [])
      .map((raw) => toMediaSummary(raw))
      .filter((item) => item?.tmdbId && item.title)
      .slice(0, limit);

  const cleanPeople = (response) =>
    (response?.results ?? [])
      .slice(0, 10)
      .map((raw) => ({
        id: String(raw.id),
        name: raw.name ?? '',
        department: raw.known_for_department ?? 'Acting',
        profilePath: raw.profile_path ?? null,
        profileUrl: imageUrl(raw.profile_path, 'w185'),
        popularity: raw.popularity ?? null,
        knownFor: (raw.known_for ?? [])
          .filter((k) => k.media_type === 'movie' || k.media_type === 'tv')
          .map((k) => toMediaSummary(k))
          .slice(0, 2),
      }))
      .filter((p) => p.name);

  return {
    rails: [
      { key: 'trending', title: 'Trending this week', items: clean(trending) },
      { key: 'movies', title: 'Popular movies', items: clean(popularMovies) },
      { key: 'series', title: 'Popular series', items: clean(popularSeries) },
    ].filter((rail) => rail.items.length > 0),
    people: cleanPeople(popularPeople),
    sortBy,
    isMock: tmdb.isMock,
    region,
  };
}

export { MediaType };
export default { getMovie, getSeries, getSeason, getPerson, getReferenceStills, getWatchOptions, getDiscover };
