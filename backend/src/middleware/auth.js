/**
 * Authentication middleware (section 22).
 *
 * Two levels:
 *   optionalAuth  — attaches req.user when a valid token is present, never rejects.
 *                   Used by endpoints that work anonymously (history, search) but
 *                   behave better when signed in (server-synced history).
 *   requireAuth   — rejects with UNAUTHENTICATED when no valid token is present.
 *
 * Tokens are bearer JWTs. We deliberately do NOT use cookies, so there is no CSRF
 * surface, and the app can store the token in native secure storage.
 */
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { prisma } from '../database/prisma.js';

function extractToken(req) {
  const header = req.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function resolveUser(req) {
  const token = extractToken(req);
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret, { algorithms: ['HS256'] });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new HttpError(401, ErrorCode.TOKEN_EXPIRED, 'Access token expired.');
    }
    throw new HttpError(401, ErrorCode.UNAUTHENTICATED, 'Access token is invalid.');
  }

  if (payload.typ !== 'access') {
    throw new HttpError(401, ErrorCode.UNAUTHENTICATED, 'Wrong token type.');
  }

  const user = await prisma.user.findFirst({
    where: { id: payload.sub, deletedAt: null },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      region: true,
      language: true,
      theme: true,
      notificationsEnabled: true,
      createdAt: true,
    },
  });

  if (!user) throw new HttpError(401, ErrorCode.UNAUTHENTICATED, 'Account no longer exists.');
  return user;
}

export async function optionalAuth(req, _res, next) {
  try {
    req.user = await resolveUser(req);
    next();
  } catch (error) {
    // A malformed/expired token on an optional route should behave like "anonymous"
    // rather than blocking the request — the app refreshes and retries.
    if (error.status === 401) {
      req.user = null;
      req.authError = error.code;
      return next();
    }
    next(error);
  }
}

export async function requireAuth(req, _res, next) {
  try {
    const user = await resolveUser(req);
    if (!user) throw new HttpError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required.');
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export default { optionalAuth, requireAuth };
