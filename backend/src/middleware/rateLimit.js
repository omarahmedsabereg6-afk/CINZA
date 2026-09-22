/**
 * Rate limiting (section 28).
 *
 * Three tiers, because the cost profile of each route class is completely different:
 *   - global:  broad protection against casual abuse of any endpoint
 *   - auth:    tight, to blunt credential stuffing and password spraying
 *   - recognise: tight, because each call can cost real AI + TMDB money
 *
 * Limits are keyed by authenticated user when we have one (so a shared office NAT
 * does not lock out a whole building) and fall back to IP otherwise.
 */
import rateLimit from 'express-rate-limit';
import config from '../config/env.js';
import { ErrorCode } from '../utils/httpError.js';

/**
 * Rate-limit key.
 *
 * Prefers the authenticated user id so a shared NAT (an office, a campus, a mobile
 * carrier CGNAT) cannot lock out an entire building. Falls back to the client IP.
 *
 * IPv6 addresses are collapsed to their /64 prefix: a single residential IPv6
 * allocation contains ~18 quintillion addresses, so keying on the full address would
 * make IP-based limits trivially bypassable.
 */
function clientKey(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  if (ip.includes(':')) {
    const [head] = ip.split('::');
    const groups = head.split(':').filter(Boolean).slice(0, 4);
    return `ip6:${groups.join(':') || 'unknown'}`;
  }
  return `ip:${ip.replace(/^::ffff:/, '')}`;
}

const handler = (req, res) => {
  res.status(429).json({
    error: {
      code: ErrorCode.RATE_LIMITED,
      message: 'Too many requests. Please wait a moment and try again.',
      details: { requestId: req.id },
    },
  });
};

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientKey,
  handler,
  skip: () => config.isTest,
};

export const globalLimiter = rateLimit({
  ...base,
  windowMs: config.security.rateLimit.windowMs,
  limit: config.security.rateLimit.max,
});

export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  // Successful logins should not count against the budget.
  skipSuccessfulRequests: true,
});

export const recognitionLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: config.security.rateLimit.recognitionMax,
});

export const writeLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 60,
});

export default { globalLimiter, authLimiter, recognitionLimiter, writeLimiter };
