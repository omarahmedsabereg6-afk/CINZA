/**
 * App-level error type.
 *
 * Every failure the user can see goes through here so that:
 *   - the message is always actionable ("check your connection", not "TypeError")
 *   - the machine-readable `code` from the API survives to the UI
 *   - offline / timeout / server / validation failures are distinguishable without
 *     string matching at call sites
 */
export const Failure = {
  OFFLINE: 'OFFLINE',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  NETWORK: 'NETWORK',
  SERVER_DOWN: 'SERVER_DOWN',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  VALIDATION: 'VALIDATION',
  NO_MATCH: 'NO_MATCH',
  UPSTREAM: 'UPSTREAM',
  UNKNOWN: 'UNKNOWN',
};

const COPY = {
  [Failure.OFFLINE]: {
    title: 'No internet connection',
    text: 'Please check your connection and try again.',
  },
  [Failure.TIMEOUT]: {
    title: 'That took too long',
    text: 'The recognition service did not respond in time. Please try again.',
  },
  [Failure.CANCELLED]: {
    title: 'Cancelled',
    text: 'You cancelled the recognition.',
  },
  [Failure.NETWORK]: {
    title: 'Connection problem',
    text: 'We could not reach the server. Please check your connection and try again.',
  },
  [Failure.SERVER_DOWN]: {
    title: 'Service unavailable',
    text: 'The CINZA service is not reachable right now. Please try again in a moment.',
  },
  [Failure.RATE_LIMITED]: {
    title: 'Too many requests',
    text: 'You have made a lot of recognitions recently. Please wait a moment and try again.',
  },
  [Failure.UNAUTHENTICATED]: {
    title: 'Please sign in',
    text: 'Your session has expired. Sign in again to continue.',
  },
  [Failure.VALIDATION]: {
    title: 'That did not work',
    text: 'Please check what you entered and try again.',
  },
  [Failure.NO_MATCH]: {
    title: 'We could not identify this scene',
    text: 'Try a clearer, well-lit screenshot, or describe the scene in words.',
  },
  [Failure.UPSTREAM]: {
    title: 'A service is unavailable',
    text: 'One of the services CINZA depends on is not responding. Please try again shortly.',
  },
  [Failure.UNKNOWN]: {
    title: 'Something went wrong',
    text: 'Please try again.',
  },
};

/** Maps an HTTP status + API error code onto a Failure kind. */
export function classify({ status, code } = {}) {
  if (code === 'NO_MATCH_FOUND' || code === 'NO_INPUT') return Failure.NO_MATCH;
  if (code === 'RATE_LIMITED') return Failure.RATE_LIMITED;
  if (code === 'UNAUTHENTICATED' || code === 'TOKEN_EXPIRED') return Failure.UNAUTHENTICATED;
  if (code === 'DATABASE_UNAVAILABLE') return Failure.SERVER_DOWN;
  if (code === 'AI_UNAVAILABLE' || code === 'TMDB_UNAVAILABLE' || code === 'STREAMING_UNAVAILABLE') return Failure.UPSTREAM;
  if (typeof code === 'string' && code.startsWith('IMAGE_')) return Failure.VALIDATION;
  if (typeof code === 'string' && code.startsWith('VIDEO_')) return Failure.VALIDATION;
  if (code === 'VALIDATION_FAILED') return Failure.VALIDATION;

  if (status === 401 || status === 403) return Failure.UNAUTHENTICATED;
  if (status === 429) return Failure.RATE_LIMITED;
  if (status === 400 || status === 422) return Failure.VALIDATION;
  if (status === 502 || status === 503 || status === 504) return Failure.UPSTREAM;
  if (status >= 500) return Failure.SERVER_DOWN;
  return Failure.UNKNOWN;
}

export class AppError extends Error {
  /**
   * @param {string} kind     one of Failure
   * @param {object} [options]
   * @param {string} [options.message] server copy, when it is user-safe
   * @param {string} [options.code]    API error code
   * @param {number} [options.status]  HTTP status
   * @param {*}      [options.details]
   * @param {Error}  [options.cause]
   */
  constructor(kind, { message, code, status, details, cause } = {}) {
    super(message || COPY[kind]?.title || 'Something went wrong');
    this.name = 'AppError';
    this.kind = kind ?? Failure.UNKNOWN;
    this.code = code ?? null;
    this.status = status ?? null;
    this.details = details ?? null;
    this.cause = cause ?? null;
    this.retryable = [
      Failure.OFFLINE,
      Failure.NETWORK,
      Failure.TIMEOUT,
      Failure.SERVER_DOWN,
      Failure.UPSTREAM,
    ].includes(this.kind);
  }

  /** Never empty, always safe to render. */
  get title() {
    return COPY[this.kind]?.title ?? COPY[Failure.UNKNOWN].title;
  }

  get text() {
    return this.message || COPY[this.kind]?.text || COPY[Failure.UNKNOWN].text;
  }

  toString() {
    return `[${this.kind}${this.code ? `/${this.code}` : ''}] ${this.message}`;
  }
}

export function isAbort(error) {
  return error?.name === 'AbortError' || error?.kind === Failure.CANCELLED;
}

export function toAppError(error, fallbackKind = Failure.UNKNOWN) {
  if (error instanceof AppError) return error;
  if (isAbort(error)) return new AppError(Failure.CANCELLED, { cause: error });
  if (error instanceof TypeError) return new AppError(Failure.NETWORK, { cause: error });
  return new AppError(fallbackKind, { message: error?.message, cause: error });
}

export default { AppError, Failure, classify, toAppError, isAbort };
