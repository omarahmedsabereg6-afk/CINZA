/**
 * Profile + settings + account deletion (sections 21, 40).
 */
import config from '../config/env.js';
import { prisma } from '../database/prisma.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { createLogger } from '../utils/logger.js';
import { sha256Hex } from '../utils/ids.js';
import { PUBLIC_USER_FIELDS, toPublicUser } from './authService.js';

const log = createLogger('user');

export async function updateProfile(userId, { displayName, region, language, theme, notificationsEnabled, privateEnabled }) {
  const data = {};
  if (displayName !== undefined) data.displayName = displayName.trim().slice(0, 60) || null;
  if (region !== undefined) data.region = region.toUpperCase();
  if (language !== undefined) data.language = language;
  if (theme !== undefined) data.theme = theme;
  if (notificationsEnabled !== undefined) data.notificationsEnabled = notificationsEnabled;
  if (privateEnabled !== undefined) data.privateEnabled = privateEnabled;

  if (Object.keys(data).length === 0) {
    throw HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'No profile fields were supplied.');
  }

  const user = await prisma.user.update({ where: { id: userId }, data, select: PUBLIC_USER_FIELDS });
  return toPublicUser(user);
}

export async function getSettings(userId) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: PUBLIC_USER_FIELDS });
  if (!user) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'Account not found.');

  const [historyCount, watchlistCount] = await Promise.all([
    prisma.recognition.count({ where: { userId } }),
    prisma.watchlistItem.count({ where: { userId } }),
  ]);

  return {
    profile: toPublicUser(user),
    region: user.region,
    defaultRegion: config.streaming.defaultRegion,
    language: user.language,
    theme: user.theme,
    notifications: user.notificationsEnabled,
    privateHistory: user.privateEnabled,
    counts: { history: historyCount, watchlist: watchlistCount },
    sync: {
      // The app mirrors these to decide what to keep locally vs. on the server.
      historySynced: true,
      watchlistSynced: true,
    },
  };
}

/**
 * Deletes an account and everything attached to it (section 40).
 *
 * Order matters: personal content first, then the credentials, then an anonymised
 * tombstone. The email is rewritten so the address can be reused for a new account.
 * ApiCallMetric rows are operational telemetry and carry no personal data, so they
 * are deliberately retained.
 */
export async function deleteAccount(userId, { confirm } = {}) {
  if (confirm !== true) {
    throw HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'Account deletion must be explicitly confirmed.');
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'Account not found.');

  const recognitions = await prisma.recognition.findMany({ where: { userId }, select: { id: true } });
  const recognitionIds = recognitions.map((r) => r.id);

  await prisma.$transaction([
    prisma.recognitionFeedback.deleteMany({ where: { OR: [{ userId }, { recognitionId: { in: recognitionIds } }] } }),
    prisma.recognitionImage.deleteMany({ where: { recognitionId: { in: recognitionIds } } }),
    prisma.recognitionCandidate.deleteMany({ where: { recognitionId: { in: recognitionIds } } }),
    prisma.recognition.deleteMany({ where: { id: { in: recognitionIds } } }),
    prisma.watchlistItem.deleteMany({ where: { userId } }),
    prisma.searchHistory.deleteMany({ where: { userId } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted+${userId}@cinza.invalid`,
        passwordHash: sha256Hex(`deleted-${userId}-${Date.now()}`),
        displayName: null,
        deletedAt: new Date(),
        notificationsEnabled: false,
      },
    }),
  ]);

  log.info(`account deleted: ${userId} (${recognitionIds.length} recognition(s) removed)`);
  return {
    deleted: true,
    message: 'Your account and all associated history have been deleted.',
    removed: { recognitions: recognitionIds.length },
  };
}

export default { updateProfile, getSettings, deleteAccount };
