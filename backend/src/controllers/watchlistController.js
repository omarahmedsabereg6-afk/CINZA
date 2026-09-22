import { asyncHandler } from '../utils/asyncHandler.js';
import * as watchlistService from '../services/watchlistService.js';

export const list = asyncHandler(async (req, res) => {
  const { limit, cursor, mediaType } = req.query;
  const result = await watchlistService.listWatchlist({ userId: req.user.id, limit, cursor, mediaType });
  res.json(result);
});

export const add = asyncHandler(async (req, res) => {
  const result = await watchlistService.addToWatchlist({ userId: req.user.id, ...req.body });
  res.status(201).json(result);
});

export const remove = asyncHandler(async (req, res) => {
  const result = await watchlistService.removeFromWatchlist({
    userId: req.user.id,
    id: req.params.id,
    ...(req.body ?? {}),
  });
  res.json(result);
});

export const check = asyncHandler(async (req, res) => {
  const result = await watchlistService.isInWatchlist({ userId: req.user.id, ...req.query });
  res.json(result);
});

export const clear = asyncHandler(async (req, res) => {
  const result = await watchlistService.clearWatchlist({ userId: req.user.id });
  res.json(result);
});

export default { list, add, remove, check, clear };
