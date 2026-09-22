import { asyncHandler } from '../utils/asyncHandler.js';
import { submitFeedback, feedbackStats } from '../services/recognitionService.js';
import * as metaService from '../services/metaService.js';
import * as userService from '../services/userService.js';

export const createFeedback = asyncHandler(async (req, res) => {
  const result = await submitFeedback({ ...req.body, userId: req.user?.id ?? null });
  res.status(201).json(result);
});

export const getFeedbackStats = asyncHandler(async (_req, res) => {
  res.json({ stats: await feedbackStats() });
});

/* ------------------------------ meta ------------------------------- */

export const getConfig = asyncHandler(async (_req, res) => {
  res.json({ config: metaService.publicConfig() });
});

export const getHealth = asyncHandler(async (_req, res) => {
  const health = await metaService.health();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

export const getMetrics = asyncHandler(async (_req, res) => {
  res.json(await metaService.metrics());
});

/* ------------------------------ user ------------------------------- */

export const getSettings = asyncHandler(async (req, res) => {
  res.json(await userService.getSettings(req.user.id));
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await userService.updateProfile(req.user.id, req.body);
  res.json({ user });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  const result = await userService.deleteAccount(req.user.id, req.body);
  res.json(result);
});

export default {
  createFeedback,
  getFeedbackStats,
  getConfig,
  getHealth,
  getMetrics,
  getSettings,
  updateProfile,
  deleteAccount,
};
