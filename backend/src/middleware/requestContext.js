/**
 * Request context: correlation id, timing, and a minimal structured access log.
 * Every response carries `X-Request-Id` so a user-reported failure can be traced to
 * exact server logs.
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('http');

export function requestContext(req, res, next) {
  req.id = req.get('x-request-id') || randomUUID();
  req.startedAt = process.hrtime.bigint();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export function accessLog(req, res, next) {
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    // Health checks and static assets would otherwise drown the log.
    if (req.path === '/api/health') return;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(0)}ms`, {
      requestId: req.id,
      userId: req.user?.id ?? null,
      ip: req.ip,
    });
  });
  next();
}

export default { requestContext, accessLog };
