/**
 * TMDB shape -> internal shape.
 *
 * Both the live client and the mock adapter deliberately return RAW TMDB-shaped
 * payloads, so exactly one normaliser exists and swapping providers cannot change
 * application behaviour. If a field is missing, it normalises to null rather than
 * undefined so the JSON we return to the app has a stable shape.
 */
import config from '../../config/env.js';
import { parseJsonArray } from '../../utils/json.js';

const orNull = (v) => (v === undefined || v === '' ? null : v);

export const imageUrl = (path, size = 'w500') => (path ? `${config.tmdb.imageBaseUrl}/${size}${path}` : null);

const yearOf = (dateString) => {
  if (!dateString) return null;
  const year = Number.parseInt(String(dateString).slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
};

/** TMDB search/list item -> MediaSummary */
export function toMediaSummary(raw) {
  if (!raw) return null;
  const mediaType = raw.media_type === 'tv' || raw.first_air_date !== undefined ? 'tv' : 'movie';
  const title = mediaType === 'tv' ? raw.name ?? raw.title : raw.title ?? raw.name;
  const originalTitle = mediaType === 'tv' ? raw.original_name : raw.original_title;
  const date = mediaType === 'tv' ? raw.first_air_date : raw.release_date;

  return {
    tmdbId: String(raw.id),
    mediaType,
    title: title ?? '',
    originalTitle: orNull(originalTitle),
    overview: orNull(raw.overview),
    posterPath: orNull(raw.poster_path),
    backdropPath: orNull(raw.backdrop_path),
    posterUrl: imageUrl(raw.poster_path, 'w342'),
    backdropUrl: imageUrl(raw.backdrop_path, 'w780'),
    year: yearOf(date),
    releaseDate: orNull(date),
    voteAverage: raw.vote_average ?? null,
    popularity: raw.popularity ?? null,
    genreIds: raw.genre_ids ?? [],
    genres: [],
    isMock: Boolean(raw.__mock),
  };
}

/** Credits payload -> { cast, crew, directors, writers } */
export function toCredits(raw) {
  const cast = (raw?.cast ?? []).slice(0, 30).map((c) => ({
    id: String(c.id ?? ''),
    name: c.name ?? '',
    character: orNull(c.character),
    order: c.order ?? 999,
    profilePath: orNull(c.profile_path),
    profileUrl: imageUrl(c.profile_path, 'w185'),
  }));

  const crew = (raw?.crew ?? []).slice(0, 60).map((c) => ({
    id: String(c.id ?? ''),
    name: c.name ?? '',
    job: orNull(c.job),
    department: orNull(c.department),
  }));

  return {
    cast,
    crew,
    directors: crew.filter((c) => c.job === 'Director').map((c) => c.name),
    writers: crew
      .filter((c) => ['Writer', 'Screenplay', 'Story', 'Author'].includes(c.job ?? ''))
      .map((c) => c.name),
  };
}

function collectVideos(raw) {
  const results = raw?.videos?.results ?? [];
  return results
    .filter((v) => v?.site === 'YouTube' && v?.key)
    .slice(0, 6)
    .map((v) => ({ key: v.key, name: v.name ?? '', type: v.type ?? 'Clip', url: `https://www.youtube.com/watch?v=${v.key}` }));
}

/** TMDB movie detail -> MediaDetail (mediaType='movie') */
export function toMovieDetail(raw, creditsRaw, mock = false) {
  const summary = toMediaSummary({ ...raw, media_type: 'movie' });
  const credits = toCredits(creditsRaw);
  return {
    ...summary,
    mediaType: 'movie',
    runtime: raw?.runtime ?? null,
    genres: (raw?.genres ?? []).map((g) => g.name).filter(Boolean),
    tagline: orNull(raw?.tagline),
    status: orNull(raw?.status),
    voteCount: raw?.vote_count ?? null,
    ...credits,
    videos: collectVideos(raw),
    isMock: mock || Boolean(raw?.__mock),
  };
}

/** TMDB tv detail -> MediaDetail (mediaType='tv') */
export function toTvDetail(raw, creditsRaw, mock = false) {
  const summary = toMediaSummary({ ...raw, media_type: 'tv' });
  const credits = toCredits(creditsRaw);
  const seasons = (raw?.seasons ?? [])
    .filter((s) => (s?.season_number ?? -1) >= 0)
    .map((s) => ({
      tmdbId: s.id ? String(s.id) : null,
      seasonNumber: s.season_number,
      name: s.name ?? `Season ${s.season_number}`,
      overview: orNull(s.overview),
      posterPath: orNull(s.poster_path),
      posterUrl: imageUrl(s.poster_path, 'w342'),
      airDate: orNull(s.air_date),
      year: yearOf(s.air_date),
      episodeCount: s.episode_count ?? 0,
    }));

  return {
    ...summary,
    mediaType: 'tv',
    yearEnd: yearOf(raw?.last_air_date),
    firstAirDate: orNull(raw?.first_air_date),
    lastAirDate: orNull(raw?.last_air_date),
    seasonsCount: raw?.number_of_seasons ?? seasons.length,
    episodesCount: raw?.number_of_episodes ?? null,
    seasonCount: raw?.number_of_seasons ?? seasons.length,
    episodeCount: raw?.number_of_episodes ?? null,
    status: orNull(raw?.status),
    voteCount: raw?.vote_count ?? null,
    genres: (raw?.genres ?? []).map((g) => g.name).filter(Boolean),
    seasons,
    ...credits,
    videos: collectVideos(raw),
    isMock: mock || Boolean(raw?.__mock),
  };
}

/** TMDB season payload -> our episode list */
export function toSeason(raw, mock = false) {
  return {
    tmdbId: raw?.id ? String(raw.id) : null,
    seasonNumber: raw?.season_number ?? 0,
    name: raw?.name ?? `Season ${raw?.season_number ?? 0}`,
    overview: orNull(raw?.overview),
    posterPath: orNull(raw?.poster_path),
    posterUrl: imageUrl(raw?.poster_path, 'w342'),
    airDate: orNull(raw?.air_date),
    episodes: (raw?.episodes ?? []).map((e) => ({
      tmdbId: e.id ? String(e.id) : null,
      episodeNumber: e.episode_number,
      seasonNumber: raw?.season_number ?? 0,
      name: e.name ?? `Episode ${e.episode_number}`,
      overview: orNull(e.overview),
      stillPath: orNull(e.still_path),
      stillUrl: imageUrl(e.still_path, 'w300'),
      airDate: orNull(e.air_date),
      runtime: e.runtime ?? null,
      voteAverage: e.vote_average ?? null,
    })),
    isMock: mock || Boolean(raw?.__mock),
  };
}

/** TMDB images payload -> reference stills usable for "Matched Scene" */
export function toImages(raw, mock = false) {
  const stills = (raw?.stills ?? []).slice(0, 24).map((s) => ({
    filePath: s.file_path,
    url: imageUrl(s.file_path, 'w780'),
    thumbUrl: imageUrl(s.file_path, 'w300'),
    width: s.width ?? null,
    height: s.height ?? null,
    language: orNull(s.iso_639_1),
    aspectRatio: s.aspect_ratio ?? null,
  }));
  const backdrops = (raw?.backdrops ?? []).slice(0, 24).map((s) => ({
    filePath: s.file_path,
    url: imageUrl(s.file_path, 'w1280'),
    thumbUrl: imageUrl(s.file_path, 'w780'),
    width: s.width ?? null,
    height: s.height ?? null,
    language: orNull(s.iso_639_1),
  }));
  return { stills, backdrops, isMock: mock || Boolean(raw?.__mock) };
}

export function toPerson(raw, mock = false) {
  if (!raw) return null;
  const credits = raw.combined_credits?.cast ?? [];
  const seen = new Set();
  const knownFor = [];
  for (const c of credits.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))) {
    const key = `${c.media_type}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    knownFor.push(toMediaSummary({ ...c, media_type: c.media_type }));
    if (knownFor.length >= 12) break;
  }
  return {
    id: String(raw.id),
    name: raw.name ?? '',
    biography: orNull(raw.biography),
    department: orNull(raw.known_for_department),
    profilePath: orNull(raw.profile_path),
    profileUrl: imageUrl(raw.profile_path, 'w342'),
    birthday: orNull(raw.birthday),
    placeOfBirth: orNull(raw.place_of_birth),
    knownFor,
    isMock: mock || Boolean(raw?.__mock),
  };
}

/** Cached catalog row -> MediaDetail (used when serving from our own DB mirror) */
export function rowToMovie(row) {
  if (!row) return null;
  return {
    tmdbId: row.tmdbId,
    mediaType: 'movie',
    title: row.title,
    originalTitle: row.originalTitle,
    overview: row.overview,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    posterUrl: imageUrl(row.posterPath, 'w342'),
    backdropUrl: imageUrl(row.backdropPath, 'w780'),
    year: row.year,
    releaseDate: row.releaseDate,
    runtime: row.runtime,
    voteAverage: row.voteAverage,
    popularity: row.popularity,
    genres: parseJsonArray(row.genresJson),
    cast: parseJsonArray(row.castJson),
    crew: parseJsonArray(row.crewJson),
    directors: parseJsonArray(row.crewJson).filter((c) => c.job === 'Director').map((c) => c.name),
    writers: parseJsonArray(row.crewJson).filter((c) => ['Writer', 'Screenplay'].includes(c.job)).map((c) => c.name),
    videos: parseJsonArray(row.videosJson),
    isMock: false,
    fromCache: true,
  };
}

export function rowToSeries(row) {
  if (!row) return null;
  return {
    tmdbId: row.tmdbId,
    mediaType: 'tv',
    title: row.name,
    originalTitle: row.originalName,
    overview: row.overview,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    posterUrl: imageUrl(row.posterPath, 'w342'),
    backdropUrl: imageUrl(row.backdropPath, 'w780'),
    year: row.yearStart,
    yearEnd: row.yearEnd,
    firstAirDate: row.firstAirDate,
    lastAirDate: row.lastAirDate,
    seasonsCount: row.numberOfSeasons,
    episodesCount: row.numberOfEpisodes,
    status: row.status,
    voteAverage: row.voteAverage,
    popularity: row.popularity,
    genres: parseJsonArray(row.genresJson),
    cast: parseJsonArray(row.castJson),
    crew: parseJsonArray(row.crewJson),
    directors: parseJsonArray(row.crewJson).filter((c) => c.job === 'Director').map((c) => c.name),
    writers: parseJsonArray(row.crewJson).filter((c) => ['Writer', 'Screenplay'].includes(c.job)).map((c) => c.name),
    seasons: parseJsonArray(row.seasonsJson),
    isMock: false,
    fromCache: true,
  };
}

export default {
  toMediaSummary,
  toCredits,
  toMovieDetail,
  toTvDetail,
  toSeason,
  toImages,
  toPerson,
  rowToMovie,
  rowToSeries,
  imageUrl,
};
