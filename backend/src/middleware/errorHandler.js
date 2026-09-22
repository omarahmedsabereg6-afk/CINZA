/**
 * Terminal middleware: 404 and the single error funnel.
 *
 * Contract every error response follows:
 *   { error: { code, message, details? } }
 * where `code` is machine-readable (the app switches on it) and `message` is safe,
 * user-facing copy. Internal details are logged, never returned (section 28).
 */
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { createLogger } from '../utils/logger.js';
import { friendlyDatabaseError } from '../database/prisma.js';

const log = createLogger('error');

export function notFound(req, _res, next) {
  next(
    new HttpError(
      404,
      ErrorCode.NOT_FOUND,
      `No API route matches ${req.method} ${req.path}. See GET /api for the route index.`
    )
  );
}

/** Maps known driver/library errors onto our error contract before the 500 fallback. */
function translateError(error) {
  if (error instanceof HttpError) return error;

  // Prisma
  if (error?.code === 'P2002') {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : 'field';
    return HttpError.conflict(ErrorCode.EMAIL_TAKEN, `That ${target} is already taken.`);
  }
  if (error?.code === 'P2025') {
    return HttpError.notFound(ErrorCode.NOT_FOUND, 'That record does not exist.');
  }
  if (error?.code === 'P2003') {
    return HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'A referenced record does not exist.');
  }
  if (typeof error?.code === 'string' && error.code.startsWith('P1')) {
    return new HttpError(
      503,
      ErrorCode.DATABASE_UNAVAILABLE,
      friendlyDatabaseError(error),
      { provider: 'prisma' }
    );
  }

  // Body parser
  if (error?.type === 'entity.parse.failed') {
    return HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'The request body was not valid JSON.');
  }
  if (error?.type === 'entity.too.large') {
    return HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'The request body was too large.');
  }

  // CORS rejection (see middleware/security.js)
  if (typeof error?.message === 'string' && error.message.includes('not allowed by CORS')) {
    return HttpError.forbidden(ErrorCode.FORBIDDEN, error.message);
  }

  // AbortError from our own timeouts
  if (error?.name === 'AbortError') {
    return HttpError.upstream(ErrorCode.INTERNAL, 'The request to an upstream service timed out.');
  }

  return null;
}

export function errorHandler(error, req, res, _next) {
  const translated = translateError(error);

  if (translated) {
    if (translated.status >= 500) {
      log.error(`${translated.code}: ${translated.message}`, { requestId: req.id, path: req.originalUrl });
    } else if (translated.status >= 400) {
      log.warn(`${translated.code}: ${translated.message}`, { requestId: req.id, path: req.originalUrl });
    }
    return res.status(translated.status).json(translated.toJSON());
  }

  // Unknown error: log everything, return nothing revealing.
  log.error(`Unhandled: ${error?.message}`, {
    requestId: req.id,
    path: req.originalUrl,
    stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
  });

  return res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL,
      message: 'Something went wrong on our side. Please try again.',
      details: { requestId: req.id },
    },
  });
}

/** Wraps an async middleware so synchronous throws and rejections both reach errorHandler. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default { notFound, errorHandler, wrap };
