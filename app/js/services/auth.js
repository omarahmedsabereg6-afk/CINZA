/**
 * Authentication (section 22).
 *
 * Responsibilities:
 *   - hold the session (access + refresh tokens, user)
 *   - persist tokens through secureStore, never in plain browser storage on native
 *   - refresh the access token exactly once per failure, with a shared in-flight
 *     promise so a burst of 401s cannot trigger a refresh storm
 *   - keep `store.session` in sync so the UI can react (header, Profile, History)
 *
 * Anonymous use is a first-class mode: `status: 'anonymous'` is a valid, working
 * state in which recognition, history (on-device) and search all function.
 */
import api, { configureApi } from './api.js';
import { secureStore } from './secureStore.js';
import { store, actions } from '../core/store.js';
import { AppError, Failure } from '../core/errors.js';

let inFlightRefresh = null;

function isAuthenticated() {
  return store.getState().session.status === 'authenticated';
}

/** Called by api.js when a 401 could not be recovered. */
function handleUnauthorized() {
  if (!isAuthenticated()) return;
  clearSession({ reason: 'expired' });
}

configureApi({
  getToken: () => currentAccessToken,
  onRefresh: () => refreshSession(),
  onUnauthorized: handleUnauthorized,
});

let currentAccessToken = null;

/* ------------------------------------------------------------------ *
 * Session lifecycle
 * ------------------------------------------------------------------ */

function applySession(session) {
  currentAccessToken = session.accessToken ?? null;
  actions.setSession({
    status: 'authenticated',
    user: session.user ?? store.getState().session.user,
    expiresIn: session.expiresIn ?? null,
  });
}

function clearSession({ reason } = {}) {
  currentAccessToken = null;
  actions.setSession({ status: 'anonymous', user: null });
  secureStore.clear().catch(() => null);
  if (reason === 'expired') {
    store.set({ session: { ...store.getState().session, expired: true } });
  }
}

/** Restores a session at boot without blocking the first paint. */
export async function restoreSession() {
  const [accessToken, refreshToken, user] = await Promise.all([
    secureStore.getAccessToken(),
    secureStore.getRefreshToken(),
    secureStore.getUser(),
  ]);

  if (!accessToken && !refreshToken) {
    actions.setSession({ status: 'anonymous', user: null });
    return { status: 'anonymous' };
  }

  currentAccessToken = accessToken;

  if (accessToken) {
    // Optimistically show the cached user, then confirm with the API.
    if (user) actions.setSession({ status: 'authenticated', user });
    try {
      const payload = await api.get('/auth/me');
      applySession({ accessToken, user: payload.user });
      await secureStore.setUser(payload.user);
      return { status: 'authenticated', user: payload.user };
    } catch (error) {
      if (error?.kind === Failure.OFFLINE || error?.kind === Failure.NETWORK) {
        // Offline: keep the cached identity so the app stays usable.
        actions.setSession({ status: 'authenticated', user: user ?? null });
        return { status: 'authenticated', offline: true };
      }
      // Fall through to a refresh attempt.
    }
  }

  if (refreshToken) {
    const refreshed = await refreshSession();
    if (refreshed) return { status: 'authenticated', user: store.getState().session.user };
  }

  clearSession({ reason: 'expired' });
  return { status: 'anonymous' };
}

export async function register({ email, password, displayName, region }) {
  const payload = await api.post('/auth/register', { email, password, displayName, region });
  const session = payload.session;
  await secureStore.setTokens(session);
  await secureStore.setUser(session.user);
  applySession(session);
  return session.user;
}

export async function login({ email, password }) {
  const payload = await api.post('/auth/login', { email, password });
  const session = payload.session;
  await secureStore.setTokens(session);
  await secureStore.setUser(session.user);
  applySession(session);
  return session.user;
}

export async function refreshSession() {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const refreshToken = await secureStore.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const payload = await api.post('/auth/refresh', { refreshToken });
      const session = payload.session;
      await secureStore.setTokens(session);
      if (session.user) await secureStore.setUser(session.user);
      applySession(session);
      return true;
    } catch {
      // Only a definitive rejection should end the session; a network blip should not.
      clearSession({ reason: 'expired' });
      return false;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

export async function logout({ everywhere = false } = {}) {
  const refreshToken = await secureStore.getRefreshToken();
  try {
    if (everywhere && isAuthenticated()) await api.post('/auth/logout-all');
    else if (refreshToken) await api.post('/auth/logout', { refreshToken });
  } catch {
    // Local sign-out must succeed even if the server call fails.
  }
  clearSession();
}

export async function forgotPassword(email) {
  return api.post('/auth/forgot-password', { email });
}

export async function resetPassword({ token, password }) {
  return api.post('/auth/reset-password', { token, password });
}

export async function updateProfile(patch) {
  const payload = await api.patch('/auth/profile', patch);
  applySession({ accessToken: currentAccessToken, user: payload.user });
  await secureStore.setUser(payload.user);
  return payload.user;
}

export async function getSettings() {
  return api.get('/auth/settings');
}

export async function deleteAccount() {
  const result = await api.delete('/auth/account', { confirm: true });
  clearSession();
  return result;
}

export const auth = {
  restoreSession,
  register,
  login,
  logout,
  refreshSession,
  forgotPassword,
  resetPassword,
  updateProfile,
  getSettings,
  deleteAccount,
  isAuthenticated,
  get user() {
    return store.getState().session.user;
  },
  get status() {
    return store.getState().session.status;
  },
  get region() {
    return store.getState().session.user?.region ?? null;
  },
};

/** Throws a friendly AppError when an action needs an account. */
export function requireAccount(action = 'do that') {
  if (isAuthenticated()) return;
  throw new AppError(Failure.UNAUTHENTICATED, {
    message: `Sign in to ${action}. Your history and watchlist will then sync across devices.`,
  });
}

export default auth;
