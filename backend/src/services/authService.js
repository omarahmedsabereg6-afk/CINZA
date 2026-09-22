/**
 * Authentication service (section 22).
 *
 * Token model
 * -----------
 *   access token   short-lived JWT (JWT_ACCESS_TTL, default 15m), signed HS256,
 *                  carries { sub, typ: 'access', role }. Never stored server-side.
 *   refresh token  opaque 48-byte random string. Only its SHA-256 HASH is stored,
 *                  so a database disclosure cannot be replayed. Rotated on every
 *                  use: the old row is revoked and a new one issued (single-use).
 *
 * Deliberate choices
 * ------------------
 * - Passwords: bcrypt, cost 12. `bcryptjs` is used rather than the native `bcrypt`
 *   so the API has no build toolchain requirement.
 * - No user enumeration: register reports EMAIL_TAKEN (unavoidable and expected),
 *   but login and password-reset return the SAME response whether or not the account
 *   exists, and login runs a dummy hash comparison on unknown emails so response
 *   timing does not leak existence either.
 * - No cookie sessions: bearer tokens only, which removes the CSRF surface entirely
 *   and lets the app keep tokens in native Keychain/Keystore.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import { prisma } from '../database/prisma.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { createLogger } from '../utils/logger.js';
import { randomToken, sha256Hex } from '../utils/ids.js';

const log = createLogger('auth');

const BCRYPT_COST = 12;
/** A real hash of a random value, used to equalise timing for unknown emails. */
const DUMMY_HASH = bcrypt.hashSync('cinza-dummy-password-for-timing-equalisation', BCRYPT_COST);
const RESET_TTL_MS = 30 * 60 * 1000;

export const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  region: true,
  language: true,
  theme: true,
  notificationsEnabled: true,
  privateEnabled: true,
  avatarColor: true,
  createdAt: true,
  lastLoginAt: true,
};

export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email.split('@')[0],
    role: user.role,
    region: user.region,
    language: user.language,
    theme: user.theme,
    notificationsEnabled: user.notificationsEnabled,
    privateEnabled: user.privateEnabled ?? true,
    avatarColor: user.avatarColor ?? '#C8342B',
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, typ: 'access', role: user.role },
    config.auth.jwtSecret,
    { expiresIn: config.auth.accessTtl, algorithm: 'HS256', issuer: 'cinza' }
  );
}

async function issueRefreshToken(userId, userAgent) {
  const token = randomToken(48);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + config.auth.refreshTtlMs),
      userAgent: userAgent ? String(userAgent).slice(0, 250) : null,
    },
  });
  return token;
}

async function buildSession(user, userAgent) {
  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id, userAgent);
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: config.auth.accessTtl,
    user: toPublicUser(user),
  };
}

/** Opportunistic cleanup so the table cannot grow without bound. */
async function pruneExpiredTokens() {
  try {
    await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    log.debug(`token prune skipped: ${error.message}`);
  }
}

export async function register({ email, password, displayName, region, language }, { userAgent, ip } = {}) {
  const normalisedEmail = String(email).trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalisedEmail }, select: { id: true } });
  if (existing) {
    throw HttpError.conflict(ErrorCode.EMAIL_TAKEN, 'An account with that email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await prisma.user.create({
    data: {
      email: normalisedEmail,
      passwordHash,
      displayName: displayName?.trim() || normalisedEmail.split('@')[0],
      region: (region || config.streaming.defaultRegion).toUpperCase(),
      language: language || 'en-US',
      lastLoginAt: new Date(),
    },
  });

  log.info(`registered user ${user.id}`);
  pruneExpiredTokens().catch(() => null);
  return buildSession(user, userAgent);
}

export async function login({ email, password }, { userAgent } = {}) {
  const normalisedEmail = String(email).trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: normalisedEmail, deletedAt: null },
    select: { ...PUBLIC_USER_FIELDS, passwordHash: true },
  });

  // Always run a comparison so a missing account and a wrong password take the same time.
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    log.warn(`failed login for ${normalisedEmail}`);
    throw HttpError.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password.');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  log.info(`login ok for ${user.id}`);
  pruneExpiredTokens().catch(() => null);
  return buildSession(user, userAgent);
}

/** Rotates a refresh token. Reuse of an already-revoked token is treated as theft. */
export async function refresh({ refreshToken }, { userAgent } = {}) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw HttpError.unauthorized(ErrorCode.UNAUTHENTICATED, 'A refresh token is required.');
  }

  const tokenHash = sha256Hex(refreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: PUBLIC_USER_FIELDS } },
  });

  if (!stored) {
    throw HttpError.unauthorized(ErrorCode.UNAUTHENTICATED, 'Refresh token is not recognised.');
  }

  if (stored.revokedAt) {
    // Someone is replaying a token we already rotated. Revoke the whole family.
    log.warn(`refresh token reuse detected for user ${stored.userId} — revoking all sessions`);
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw HttpError.unauthorized(ErrorCode.UNAUTHENTICATED, 'This session was already used. Please sign in again.');
  }

  if (stored.expiresAt < new Date()) {
    throw HttpError.unauthorized(ErrorCode.TOKEN_EXPIRED, 'Session expired. Please sign in again.');
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return buildSession(stored.user, userAgent);
}

export async function logout({ refreshToken }) {
  if (!refreshToken) return { revoked: 0 };
  const result = await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256Hex(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { revoked: result.count };
}

export async function logoutAll(userId) {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { revoked: result.count };
}

export async function me(userId) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: PUBLIC_USER_FIELDS });
  if (!user) throw HttpError.notFound(ErrorCode.NOT_FOUND, 'Account not found.');
  return toPublicUser(user);
}

/**
 * Starts a password reset.
 *
 * Always returns the same shape (no user enumeration). When no transactional email
 * provider is configured we cannot send the link, so in development the token is
 * returned in the response and logged, clearly marked, instead of silently doing
 * nothing. In production the response never contains the token.
 */
export async function requestPasswordReset({ email }, { ip } = {}) {
  const normalisedEmail = String(email).trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { email: normalisedEmail, deletedAt: null }, select: { id: true, email: true } });

  const response = {
    accepted: true,
    message: 'If an account exists for that address, a reset link has been sent.',
    delivery: 'email',
  };

  if (!user) {
    log.info(`password reset requested for unknown address ${normalisedEmail}`);
    return response;
  }

  const token = randomToken(32);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
      requestIp: ip ? String(ip).slice(0, 60) : null,
    },
  });

  const link = `${config.apiUrl}/reset?token=${token}`;
  if (config.isProduction) {
    // TODO: wire a transactional email provider here (Resend/SES/Postmark).
    log.info(`password reset link generated for user ${user.id} (email delivery not configured)`);
  } else {
    log.warn(`DEVELOPMENT password reset link (no email provider configured): ${link}`);
    response.devResetToken = token;
    response.devResetUrl = link;
    response.delivery = 'development-console';
    response.notice =
      'No email provider is configured, so this link was returned directly and printed to the server log. In production it is emailed and omitted from the response.';
  }

  return response;
}

export async function resetPassword({ token, password }) {
  const tokenHash = sha256Hex(String(token));
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'That reset link is invalid or has expired.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  await prisma.$transaction([
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    // A password change invalidates every existing session.
    prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  log.info(`password reset completed for user ${stored.userId}`);
  return { reset: true, message: 'Your password has been changed. Please sign in again.' };
}

export default {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  requestPasswordReset,
  resetPassword,
  toPublicUser,
  PUBLIC_USER_FIELDS,
};
