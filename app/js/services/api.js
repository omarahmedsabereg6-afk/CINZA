/**
 * API client.
 *
 * Single place that:
 *   - builds URLs against the resolved API base (see config.js)
 *   - attaches the bearer token
 *   - enforces timeouts with AbortController (uploads get a longer one)
 *   - converts every failure into an AppError so screens only handle one error type
 *   - transparently refreshes an expired access token ONCE and replays the request
 *
 * Auth hooks are injected to avoid a circular import between api.js and auth.js.
 */
import config from '../config.js';
import { AppError, Failure, classify, isAbort } from '../core/errors.js';

let tokenProvider = () => null;
let refreshHandler = null;
let unauthorizedHandler = null;

export function configureApi({ getToken, onRefresh, onUnauthorized }) {
  if (getToken) tokenProvider = getToken;
  if (onRefresh) refreshHandler = onRefresh;
  if (onUnauthorized) unauthorizedHandler = onUnauthorized;
}

function buildUrl(path, query) {
  const base = `${config.apiBase}${config.apiPrefix}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return base;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { __text: text.slice(0, 500) };
  }
}

function errorFromResponse(status, payload) {
  const apiError = payload?.error ?? {};
  const kind = classify({ status, code: apiError.code });
  return new AppError(kind, {
    message: apiError.message,
    code: apiError.code,
    status,
    details: apiError.details ?? null,
  });
}

async function rawRequest(path, { method = 'GET', body, form, query, token, timeoutMs, signal, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? config.requestTimeoutMs);

  // Link a caller-supplied signal (used to cancel an in-flight recognition).
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const finalHeaders = { Accept: 'application/json', ...headers };
  const authToken = token ?? tokenProvider();
  if (authToken) finalHeaders.Authorization = `Bearer ${authToken}`;
  if (body !== undefined && !form) finalHeaders['Content-Type'] = 'application/json';
  finalHeaders['X-Client-Platform'] = config.platform;
  finalHeaders['X-Client-Version'] = '1.0.0';

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers: finalHeaders,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal,
      cache: 'no-store',
    });

    const payload = await parseBody(response);

    if (response.ok) {
      return { ok: true, status: response.status, data: payload, headers: response.headers };
    }
    return { ok: false, status: response.status, data: payload, error: errorFromResponse(response.status, payload) };
  } catch (error) {
    if (isAbort(error)) {
      throw new AppError(Failure.CANCELLED, { cause: error });
    }
    // navigator.onLine is unreliable, but combined with a fetch failure it is a
    // good enough signal to show the offline copy rather than a generic error.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new AppError(offline ? Failure.OFFLINE : Failure.NETWORK, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Public request helper with one automatic token refresh + retry.
 *
 * @returns {Promise<any>} the parsed payload
 * @throws {AppError}
 */
export async function request(path, options = {}) {
  let result = await rawRequest(path, options);

  if (!result.ok && result.status === 401 && refreshHandler && !options.__retried) {
    const refreshed = await refreshHandler().catch(() => false);
    if (refreshed) {
      result = await rawRequest(path, { ...options, __retried: true });
    } else {
      unauthorizedHandler?.();
    }
  }

  if (result.ok) return result.data;

  // A 401 that could not be refreshed means the session is gone.
  if (result.status === 401 && result.error?.kind === Failure.UNAUTHENTICATED) {
    unauthorizedHandler?.();
  }

  throw result.error;
}

/**
 * Verb helpers.
 *
 * The second argument is the QUERY for GET, and the BODY for POST/PATCH/DELETE.
 * That is the conventional shape and it is what every call site in this app
 * expects. (Getting this wrong is a silent failure: the request still succeeds, the
 * filters are just ignored, so it is worth stating explicitly.)
 *
 * The third argument is always request options: { token, timeoutMs, signal, headers }.
 */
export const api = {
  get: (path, query, options) => request(path, { ...options, method: 'GET', query }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, body, options) => request(path, { ...options, method: 'DELETE', body }),
  upload: (path, form, options) =>
    request(path, { ...options, method: 'POST', form, timeoutMs: options?.timeoutMs ?? config.uploadTimeoutMs }),
};

/** Lightweight reachability probe used by the offline banner. */
export async function ping(timeoutMs = 6000) {
  try {
    await request('/meta/health', { timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export default api;
