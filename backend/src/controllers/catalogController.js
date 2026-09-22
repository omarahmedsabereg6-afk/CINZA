import { asyncHandler } from '../utils/asyncHandler.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import * as searchService from '../services/searchService.js';
import * as mediaService from '../services/mediaService.js';
import { MediaType, isMediaType } from '../database/constants.js';

export const search = asyncHandler(async (req, res) => {
  const { q, type, page, region } = req.query;
  const result = await searchService.search({
    query: q,
    type,
    page,
    region: region ?? req.user?.region ?? null,
    userId: req.user?.id ?? null,
  });
  res.json(result);
});

export const recentSearches = asyncHandler(async (req, res) => {
  const result = await searchService.recentSearches({ userId: req.user?.id ?? null });
  res.json(result);
});

export const clearRecentSearches = asyncHandler(async (req, res) => {
  const result = await searchService.clearRecentSearches({ userId: req.user.id });
  res.json(result);
});

export const getPerson = asyncHandler(async (req, res) => {
  const person = await mediaService.getPerson({ id: req.params.id });
  if (!person) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That person could not be found.');
  res.json({ person });
});

export const getPersonCredits = asyncHandler(async (req, res) => {
  const credits = await mediaService.getPersonCredits({ id: req.params.id });
  if (!credits) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That person could not be found.');
  res.json({ credits });
});

export const getMovieCredits = asyncHandler(async (req, res) => {
  const credits = await mediaService.getMovieCredits({ tmdbId: req.params.id });
  if (!credits) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That movie could not be found.');
  res.json({ credits });
});

export const getSeriesCredits = asyncHandler(async (req, res) => {
  const credits = await mediaService.getSeriesCredits({ tmdbId: req.params.id });
  if (!credits) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That series could not be found.');
  res.json({ credits });
});

export const getRelatedTitles = asyncHandler(async (req, res) => {
  const inferredMediaType = req.params.mediaType ?? (req.path.includes('/movie') || req.path.startsWith('/movies') ? 'movie' : 'tv');
  const kind = req.params.kind ?? (req.path.endsWith('/similar') ? 'similar' : 'recommendations');
  const { id } = req.params;
  const result = await mediaService.getRelatedTitles({ mediaType: inferredMediaType, tmdbId: id, kind });
  if (!result) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'No related titles were found.');
  res.json(result);
});

export const getMovie = asyncHandler(async (req, res) => {
  const movie = await mediaService.getMovie({ tmdbId: req.params.id });
  if (!movie) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That movie could not be found.');
  res.json({ movie });
});

export const getSeries = asyncHandler(async (req, res) => {
  const series = await mediaService.getSeries({ tmdbId: req.params.id });
  if (!series) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That series could not be found.');
  res.json({ series });
});

export const getSeason = asyncHandler(async (req, res) => {
  const { id, seasonNumber } = req.params;
  const season = await mediaService.getSeason({ tvId: id, seasonNumber });
  if (!season) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'That season could not be found.');
  res.json({ season });
});

/** Reference stills for the Matched Scene block — labelled, never claimed as a match. */
export const getStills = asyncHandler(async (req, res) => {
  const mediaType = req.params.mediaType === 'movies' ? 'movie' : req.params.mediaType;
  if (!isMediaType(mediaType)) {
    throw HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'mediaType must be "movie" or "tv".');
  }
  const result = await mediaService.getReferenceStills({ mediaType, tmdbId: req.params.id });
  res.json(result);
});

/** Where to Watch (section 17). */
export const getAvailability = asyncHandler(async (req, res) => {
  const mediaType = req.params.mediaType === 'movies' ? 'movie' : req.params.mediaType;
  if (!isMediaType(mediaType)) {
    throw HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'mediaType must be "movie" or "tv".');
  }
  const region = req.query.region ?? req.user?.region ?? null;
  const result = await mediaService.getWatchOptions({
    mediaType,
    tmdbId: req.params.id,
    region: region ?? 'US',
    refresh: Boolean(req.query.refresh),
  });
  res.json({ availability: result });
});

/** Home rails. */
export const discover = asyncHandler(async (req, res) => {
  const { region, limit, genreId, page, sortBy } = req.query;
  const result = await mediaService.getDiscover({ region: region ?? req.user?.region ?? null, limit, genreId, page, sortBy });
  res.json(result);
});

/** Genre-filtered discovery. */
export const discoverByGenre = asyncHandler(async (req, res) => {
  const { region, limit, genreId, page, sortBy } = req.query;
  const result = await mediaService.getDiscover({ 
    region: region ?? req.user?.region ?? null, 
    limit, 
    genreId,
    page,
    sortBy,
  });
  res.json(result);
});

export { MediaType };
export default {
  search,
  recentSearches,
  clearRecentSearches,
  getPerson,
  getMovie,
  getSeries,
  getSeason,
  getStills,
  getAvailability,
  discover,
  discoverByGenre,
};
