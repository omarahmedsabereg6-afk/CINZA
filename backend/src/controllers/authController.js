import { asyncHandler } from '../utils/asyncHandler.js';
import * as authService from '../services/authService.js';

export const register = asyncHandler(async (req, res) => {
  const session = await authService.register(req.body, { userAgent: req.get('user-agent'), ip: req.ip });
  res.status(201).json({ session });
});

export const login = asyncHandler(async (req, res) => {
  const session = await authService.login(req.body, { userAgent: req.get('user-agent') });
  res.json({ session });
});

export const refresh = asyncHandler(async (req, res) => {
  const session = await authService.refresh(req.body, { userAgent: req.get('user-agent') });
  res.json({ session });
});

export const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(req.body ?? {});
  res.json({ loggedOut: true, revokedSessions: result.revoked });
});

export const logoutAll = asyncHandler(async (req, res) => {
  const result = await authService.logoutAll(req.user.id);
  res.json({ loggedOut: true, revokedSessions: result.revoked, scope: 'all-devices' });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user.id);
  res.json({ user });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.requestPasswordReset(req.body, { ip: req.ip });
  // Always 202: the response must not reveal whether the address exists.
  res.status(202).json(result);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body);
  res.json(result);
});

export default { register, login, refresh, logout, logoutAll, me, forgotPassword, resetPassword };
