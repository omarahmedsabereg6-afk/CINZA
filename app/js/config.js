/**
 * Runtime configuration for the app.
 *
 * THE API BASE URL
 * ----------------
 * Resolution order (first match wins):
 *
 *   1. `?api=https://...` query parameter    — fastest way to point a device at a
 *                                              dev machine without a rebuild
 *   2. Saved override in device storage      — set from Profile > Developer
 *   3. Same-origin, when the app was served  — this is the dev default, because the
 *      by the API (http/https)                 backend serves app/www when SERVE_APP=true
 *   4. The packaged default below            — used by the native builds
 *
 * Nothing here is a secret. The API base is a public address; every credential stays
 * on the server (section 28).
 */
import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'cinza.apiBase';

/** Where the packaged Android/iOS app looks for the API. Change this for production. */
const PACKAGED_DEFAULT = 'http://192.168.0.213:8787';

/** Convenience defaults so a device on the same network as a dev machine just works. */
const DEV_DEFAULTS = {
  android: 'http://192.168.0.213:8787', // Android emulator's alias for the host
  ios: 'http://localhost:8787', // iOS simulator shares the host network
};

const BUILD = typeof __CINZA_BUILD__ === 'string' ? __CINZA_BUILD__ : 'development';

function isNativePlatform() {
  try {
    return Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function platform() {
  try {
    return Capacitor?.getPlatform?.() ?? 'web';
  } catch {
    return 'web';
  }
}

function fromQuery() {
  if (typeof location === 'undefined') return null;
  const value = new URLSearchParams(location.search).get('api');
  return value ? value.replace(/\/+$/, '') : null;
}

function fromStorage() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function sameOriginIfServed() {
  if (typeof location === 'undefined') return null;
  const { protocol, origin } = location;
  // Capacitor serves the bundle from https://localhost (Android) or
  // capacitor://localhost (iOS). Those are NOT the API.
  if (protocol === 'capacitor:' || protocol === 'file:') return null;
  if (!/^https?:$/.test(protocol)) return null;
  // A localhost/127.0.0.1 origin in the webview is the bundle host, not the API,
  // unless we were loaded from the API itself (the dev fallback below).
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return null;
  }
  return origin;
}

function resolveApiBase() {
  const queryOverride = fromQuery();
  if (queryOverride) {
    saveApiBase(queryOverride);
    return queryOverride;
  }

  const stored = fromStorage();
  if (stored) return stored.replace(/\/+$/, '');

  const native = isNativePlatform();
  if (native) {
    const dev = DEV_DEFAULTS[platform()];
    // In a debug build, a dev API is far more useful than a placeholder host.
    return BUILD === 'production' ? PACKAGED_DEFAULT : dev ?? PACKAGED_DEFAULT;
  }

  const origin = sameOriginIfServed();
  if (origin) return origin;

  // Running from the standalone dev server (app/build.mjs --serve) on :5173.
  return `${location.protocol}//${location.hostname}:8787`;
}

export function saveApiBase(base) {
  try {
    localStorage.setItem(STORAGE_KEY, String(base).replace(/\/+$/, ''));
  } catch {
    /* storage may be unavailable; the query override still works for this session */
  }
}

export function clearApiBase() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export const config = {
  build: BUILD,
  isProduction: BUILD === 'production',
  isNative: isNativePlatform(),
  platform: platform(),
  apiBase: resolveApiBase(),
  apiPrefix: '/api',
  requestTimeoutMs: 30_000,
  /** Recognition routinely takes longer than a normal request. */
  uploadTimeoutMs: 90_000,
  appName: 'CINZA',
  storagePrefix: 'cinza.',
  hapticsEnabled: true,
};

export default config;
