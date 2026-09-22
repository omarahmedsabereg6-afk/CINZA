import { asyncHandler } from '../utils/asyncHandler.js';
import * as recognitionService from '../services/recognitionService.js';

export const listHistory = asyncHandler(async (req, res) => {
  const { limit, cursor, mediaType, status } = req.query;
  const result = await recognitionService.listHistory({
    userId: req.user?.id ?? null,
    limit,
    cursor,
    mediaType,
    status,
  });
  res.json(result);
});

export const getRecognition = asyncHandler(async (req, res) => {
  const result = await recognitionService.getRecognition({ id: req.params.id, userId: req.user?.id ?? null });
  res.json({ recognition: result });
});

export const deleteRecognition = asyncHandler(async (req, res) => {
  const result = await recognitionService.deleteRecognition({ id: req.params.id, userId: req.user.id });
  res.json(result);
});

export const clearHistory = asyncHandler(async (req, res) => {
  const result = await recognitionService.clearHistory({ userId: req.user.id });
  res.json(result);
});

export const historyStats = asyncHandler(async (req, res) => {
  const stats = await recognitionService.historyStats({ userId: req.user.id });
  res.json({ stats });
});

export default { listHistory, getRecognition, deleteRecognition, clearHistory, historyStats };
