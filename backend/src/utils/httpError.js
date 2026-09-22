/**
 * Typed HTTP errors.
 *
 * Every error the API returns has (a) a machine-readable `code` the app switches on
 * and (b) a human message that is safe to show a user. Unexpected errors are
 * converted to a generic 500 so internals never leak (section 28).
 */

export const ErrorCode = {
  // 400
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  IMAGE_TOO_SMALL: 'IMAGE_TOO_SMALL',
  IMAGE_TYPE_UNSUPPORTED: 'IMAGE_TYPE_UNSUPPORTED',
  IMAGE_CORRUPT: 'IMAGE_CORRUPT',
  VIDEO_TOO_LARGE: 'VIDEO_TOO_LARGE',
  VIDEO_TOO_LONG: 'VIDEO_TOO_LONG',
  VIDEO_TYPE_UNSUPPORTED: 'VIDEO_TYPE_UNSUPPORTED',
  NO_INPUT: 'NO_INPUT',
  // 401 / 403
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  // 404
  NOT_FOUND: 'NOT_FOUND',
  RECOGNITION_NOT_FOUND: 'RECOGNITION_NOT_FOUND',
  // 429
  RATE_LIMITED: 'RATE_LIMITED',
  // 502 / 503 — upstream integration problems
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  TMDB_UNAVAILABLE: 'TMDB_UNAVAILABLE',
  STREAMING_UNAVAILABLE: 'STREAMING_UNAVAILABLE',
  // 500
  RECOGNITION_FAILED: 'RECOGNITION_FAILED',
  NO_MATCH_FOUND: 'NO_MATCH_FOUND',
  INTERNAL: 'INTERNAL',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
};

/** Friendly, user-safe copy per code. The app falls back to `message` if absent. */
const USER_MESSAGES = {
  VALIDATION_FAILED: 'Some of the details you sent were not valid.',
  IMAGE_TOO_LARGE: 'That image is too large. Try a smaller screenshot.',
  IMAGE_TOO_SMALL: 'That image is too small to analyse. Use at least 120×120 pixels.',
  IMAGE_TYPE_UNSUPPORTED: 'Only JPG, PNG and WEBP images can be recognised.',
  IMAGE_CORRUPT: 'We could not read that image. It may be damaged.',
  VIDEO_TOO_LARGE: 'That video is too large. Trim it or pick a shorter clip.',
  VIDEO_TOO_LONG: 'That video is too long. Clips must be under the configured limit.',
  VIDEO_TYPE_UNSUPPORTED: 'That video format is not supported.',
  NO_INPUT: 'Add an image, a video, or describe the scene to continue.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  INVALID_CREDENTIALS: 'That email and password combination does not match an account.',
  TOKEN_EXPIRED: 'Your session expired. Please sign in again.',
  FORBIDDEN: 'You do not have access to that.',
  EMAIL_TAKEN: 'An account with that email already exists.',
  NOT_FOUND: 'We could not find that.',
  RECOGNITION_NOT_FOUND: 'That recognition is no longer available.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  AI_UNAVAILABLE: 'The recognition service is busy or unreachable. Please try again.',
  AI_INVALID_RESPONSE: 'The recognition service returned something we could not read.',
  TMDB_UNAVAILABLE: 'The movie database is unreachable right now.',
  STREAMING_UNAVAILABLE: 'Viewing options are unavailable right now.',
  RECOGNITION_FAILED: 'Recognition failed. Please try again.',
  NO_MATCH_FOUND: 'We could not identify this scene. Try a clearer, well-lit screenshot.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
  DATABASE_UNAVAILABLE: 'We cannot reach our database right now. Please try again shortly.',
};

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || USER_MESSAGES[code] || 'Request failed');
    this.name = 'HttpError';
    this.status = status;
    this.code = code || ErrorCode.INTERNAL;
    this.details = details;
    this.expose = true;
  }

  /** Copy that is safe to render in the app. */
  get userMessage() {
    return USER_MESSAGES[this.code] || this.message;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }

  static badRequest(code = ErrorCode.VALIDATION_FAILED, message, details) {
    return new HttpError(400, code, message, details);
  }
  static unauthorized(code = ErrorCode.UNAUTHENTICATED, message) {
    return new HttpError(401, code, message);
  }
  static forbidden(code = ErrorCode.FORBIDDEN, message) {
    return new HttpError(403, code, message);
  }
  static notFound(code = ErrorCode.NOT_FOUND, message) {
    return new HttpError(404, code, message);
  }
  static conflict(code = ErrorCode.EMAIL_TAKEN, message) {
    return new HttpError(409, code, message);
  }
  static tooMany(code = ErrorCode.RATE_LIMITED, message) {
    return new HttpError(429, code, message);
  }
  static upstream(code = ErrorCode.INTERNAL, message) {
    return new HttpError(502, code, message);
  }
  static internal(message, details) {
    return new HttpError(500, ErrorCode.INTERNAL, message, details);
  }
  static unavailable(code = ErrorCode.INTERNAL, message) {
    return new HttpError(503, code, message);
  }
}

export default HttpError;
