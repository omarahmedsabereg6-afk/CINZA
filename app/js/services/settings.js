/**
 * User settings (section 21): region, language, theme, notifications,
 * recognition quality, safe search, streaming filters, and storage management.
 *
 * Region matters functionally, not cosmetically: it selects which region's legal
 * streaming availability is shown (section 17). Anonymous users keep settings on the
 * device; signed-in users have them mirrored to the account so a reinstall restores
 * them.
 */
import config from '../config.js';
import { store } from '../core/store.js';
import { auth } from './auth.js';
import { toCountryCode, countryName } from '../core/countries.js';

const KEYS = {
  region: `${config.storagePrefix}region`,
  language: `${config.storagePrefix}language`,
  theme: `${config.storagePrefix}theme`,
  notifications: `${config.storagePrefix}notifications`,
  haptics: `${config.storagePrefix}haptics`,
  reduceMotion: `${config.storagePrefix}reduce_motion`,
  uploadQuality: `${config.storagePrefix}upload_quality`,
  matchingSensitivity: `${config.storagePrefix}matching_sensitivity`,
  safeSearch: `${config.storagePrefix}safe_search`,
  spoilerProtection: `${config.storagePrefix}spoiler_protection`,
  watchlistAlerts: `${config.storagePrefix}watchlist_alerts`,
  streamingFilter: `${config.storagePrefix}streaming_filter`,
};

function read(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */
export const THEMES = ['dark', 'light', 'system'];

export function applyTheme(theme = getTheme()) {
  const resolved =
    theme === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#F7F7F9' : '#08090B');
  return resolved;
}

export function getTheme() {
  return read(KEYS.theme, 'dark');
}

export async function setTheme(theme) {
  if (!THEMES.includes(theme)) return getTheme();
  write(KEYS.theme, theme);
  applyTheme(theme);
  if (store.getState().session.status === 'authenticated') {
    auth.updateProfile({ theme }).catch(() => null);
  }
  return theme;
}

/* ------------------------------------------------------------------ *
 * Region
 * ------------------------------------------------------------------ */
export function getRegion() {
  const session = store.getState().session;
  const raw = session.user?.region ?? read(KEYS.region, 'US');
  return toCountryCode(raw);
}

export async function setRegion(region) {
  const code = toCountryCode(region);
  write(KEYS.region, code);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cinza:region-changed', { detail: { region: code } }));
  }
  if (store.getState().session.status === 'authenticated') {
    try {
      await auth.updateProfile({ region: code });
    } catch {
      /* keep the local value; it still drives availability lookups */
    }
  }
  return code;
}

/* ------------------------------------------------------------------ *
 * Language
 * ------------------------------------------------------------------ */
export function getLanguage() {
  const session = store.getState().session;
  return session.user?.language ?? read(KEYS.language, navigator.language ?? 'en-US');
}

export async function setLanguage(language) {
  write(KEYS.language, language);
  if (store.getState().session.status === 'authenticated') {
    try {
      await auth.updateProfile({ language });
    } catch {
      /* ignore */
    }
  }
  return language;
}

/* ------------------------------------------------------------------ *
 * Notifications & Alerts
 * ------------------------------------------------------------------ */
export function getNotifications() {
  const session = store.getState().session;
  if (session.user) return Boolean(session.user.notificationsEnabled);
  return read(KEYS.notifications, 'true') !== 'false';
}

export async function setNotifications(enabled) {
  write(KEYS.notifications, String(Boolean(enabled)));
  if (store.getState().session.status === 'authenticated') {
    try {
      await auth.updateProfile({ notificationsEnabled: Boolean(enabled) });
    } catch {
      /* ignore */
    }
  }
  return Boolean(enabled);
}

export function getWatchlistAlerts() {
  return read(KEYS.watchlistAlerts, 'true') !== 'false';
}

export function setWatchlistAlerts(enabled) {
  write(KEYS.watchlistAlerts, String(Boolean(enabled)));
  return Boolean(enabled);
}

/* ------------------------------------------------------------------ *
 * Haptic Feedback & Motion
 * ------------------------------------------------------------------ */
export function getHaptics() {
  return read(KEYS.haptics, 'true') !== 'false';
}

export function setHaptics(enabled) {
  const bool = Boolean(enabled);
  write(KEYS.haptics, String(bool));
  config.hapticsEnabled = bool;
  return bool;
}

export function getReduceMotion() {
  return read(KEYS.reduceMotion, 'false') === 'true';
}

export function applyReduceMotion(reduce = getReduceMotion()) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.reduceMotion = String(reduce);
  }
  return reduce;
}

export function setReduceMotion(enabled) {
  const bool = Boolean(enabled);
  write(KEYS.reduceMotion, String(bool));
  applyReduceMotion(bool);
  return bool;
}

/* ------------------------------------------------------------------ *
 * Recognition & AI Quality
 * ------------------------------------------------------------------ */
export const UPLOAD_QUALITIES = ['high', 'balanced', 'saver'];

export function getUploadQuality() {
  return read(KEYS.uploadQuality, 'balanced');
}

export function setUploadQuality(quality) {
  if (!UPLOAD_QUALITIES.includes(quality)) return getUploadQuality();
  write(KEYS.uploadQuality, quality);
  return quality;
}

export const MATCHING_SENSITIVITIES = ['strict', 'balanced', 'relaxed'];

export function getMatchingSensitivity() {
  return read(KEYS.matchingSensitivity, 'balanced');
}

export function setMatchingSensitivity(val) {
  if (!MATCHING_SENSITIVITIES.includes(val)) return getMatchingSensitivity();
  write(KEYS.matchingSensitivity, val);
  return val;
}

/* ------------------------------------------------------------------ *
 * Content & Search Filters
 * ------------------------------------------------------------------ */
export function getSafeSearch() {
  return read(KEYS.safeSearch, 'false') === 'true';
}

export function setSafeSearch(enabled) {
  const bool = Boolean(enabled);
  write(KEYS.safeSearch, String(bool));
  return bool;
}

export function getSpoilerProtection() {
  return read(KEYS.spoilerProtection, 'false') === 'true';
}

export function setSpoilerProtection(enabled) {
  const bool = Boolean(enabled);
  write(KEYS.spoilerProtection, String(bool));
  return bool;
}

export const STREAMING_FILTERS = ['all', 'flatrate', 'free', 'buy_rent'];

export function getStreamingFilter() {
  return read(KEYS.streamingFilter, 'all');
}

export function setStreamingFilter(filter) {
  if (!STREAMING_FILTERS.includes(filter)) return getStreamingFilter();
  write(KEYS.streamingFilter, filter);
  return filter;
}

/* ------------------------------------------------------------------ *
 * Storage & Cache Management
 * ------------------------------------------------------------------ */
export function calculateStorageUsage() {
  let totalBytes = 0;
  let itemCount = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('cinza') || key.startsWith(config.storagePrefix))) {
        const val = localStorage.getItem(key) || '';
        totalBytes += (key.length + val.length) * 2;
        itemCount++;
      }
    }
  } catch {
    /* ignore */
  }
  let formatted = '0 KB';
  if (totalBytes > 1024 * 1024) {
    formatted = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else if (totalBytes > 0) {
    formatted = `${Math.max(1, Math.round(totalBytes / 1024))} KB`;
  }
  return { bytes: totalBytes, formatted, itemCount };
}

export async function clearAppCache() {
  try {
    const catalog = await import('./catalog.js');
    catalog.invalidateAll?.();
  } catch {}

  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('cache') || key.includes('temp'))) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      for (const k of keys) {
        if (k.toLowerCase().includes('cinza')) {
          await caches.delete(k);
        }
      }
    }
  } catch {}

  return true;
}

export async function resetToDefaults() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(config.storagePrefix) || key.startsWith('cinza_'))) {
        if (key !== 'cinza.apiBase') {
          toRemove.push(key);
        }
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}

  setHaptics(true);
  setReduceMotion(false);
  setTheme('dark');
  setUploadQuality('balanced');
  setMatchingSensitivity('balanced');
  setSafeSearch(false);
  setSpoilerProtection(false);
  setStreamingFilter('all');
  setWatchlistAlerts(true);
  await setRegion('US');
  await setLanguage('en-US');

  return true;
}

/**
 * Initializes runtime preferences on boot (called by main.js).
 */
export function initPreferences() {
  applyTheme(getTheme());
  applyReduceMotion(getReduceMotion());
  config.hapticsEnabled = getHaptics();
}

/**
 * Picks up server-side settings after sign-in so the device matches the account.
 */
export async function syncFromSession() {
  const session = store.getState().session;
  if (!session.user) return;
  if (session.user.region) write(KEYS.region, session.user.region);
  if (session.user.language) write(KEYS.language, session.user.language);
  if (session.user.theme) {
    write(KEYS.theme, session.user.theme);
    applyTheme(session.user.theme);
  }
}

export default {
  getRegion,
  setRegion,
  getLanguage,
  setLanguage,
  getTheme,
  setTheme,
  applyTheme,
  getNotifications,
  setNotifications,
  getWatchlistAlerts,
  setWatchlistAlerts,
  getHaptics,
  setHaptics,
  getReduceMotion,
  setReduceMotion,
  applyReduceMotion,
  getUploadQuality,
  setUploadQuality,
  getMatchingSensitivity,
  setMatchingSensitivity,
  getSafeSearch,
  setSafeSearch,
  getSpoilerProtection,
  setSpoilerProtection,
  getStreamingFilter,
  setStreamingFilter,
  calculateStorageUsage,
  clearAppCache,
  resetToDefaults,
  initPreferences,
  syncFromSession,
  THEMES,
  UPLOAD_QUALITIES,
  MATCHING_SENSITIVITIES,
  STREAMING_FILTERS,
};
