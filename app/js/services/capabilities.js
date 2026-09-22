/**
 * Server capabilities.
 *
 * Fetched once at boot from /api/meta/config. Because it tells the app which
 * features actually work (and which providers are simulated), the UI can hide or
 * label things honestly instead of shipping buttons that do nothing
 * (section 46).
 *
 * A failure here is NOT fatal: the app falls back to conservative defaults and
 * shows a banner, so a cold server still produces a usable shell.
 */
import api from './api.js';
import { store, actions } from '../core/store.js';

/** Conservative fallback used when /meta/config cannot be reached. */
const FALLBACK = {
  api: { version: '1.0.0', environment: 'unknown' },
  features: {
    recognition: true,
    describeScene: true,
    videoRecognition: true,
    search: true,
    watchlist: true,
    history: true,
    accounts: true,
    whereToWatch: true,
    sceneMatching: false,
    serverSideVideoFrames: false,
  },
  regions: [{ code: 'US', name: 'United States', language: 'en-US' }],
  defaults: { region: 'US', language: 'en-US', theme: 'dark' },
  uploads: {
    maxImageBytes: 10 * 1024 * 1024,
    maxVideoBytes: 50 * 1024 * 1024,
    maxVideoDurationSeconds: 120,
    maxVideoFrames: 6,
    maxImageDimension: 6000,
    minImageDimension: 120,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    clientPreprocessing: { resize: true, compress: true, perceptualHash: true, extractVideoFrames: true },
  },
  providers: {
    ai: { name: 'unknown', mode: 'unknown' },
    tmdb: { name: 'unknown', mode: 'unknown' },
    streaming: { name: 'unknown', mode: 'unknown' },
    sceneMatcher: { name: 'unknown', mode: 'unknown' },
  },
  anyMock: false,
  mockNotice: null,
  warnings: [],
  limits: { recognitionPerHour: 20, confidenceThresholds: { noMatch: 0.34, uncertain: 0.56, likely: 0.76 } },
  cost: { maxSearchQueriesPerRecognition: 6, maxDetailFetchesPerRecognition: 8 },
  __fallback: true,
};

export async function loadCapabilities({ force = false } = {}) {
  const existing = store.getState().capabilities;
  if (existing && !force) return existing;

  try {
    const payload = await api.get('/meta/config');
    // `__fallback: false` must be set explicitly: the spread would otherwise keep
    // the marker from FALLBACK and the app would wrongly announce that the server
    // is unreachable while it is answering requests perfectly well.
    const capabilities = { ...FALLBACK, ...payload.config, __fallback: false };
    actions.setCapabilities(capabilities);
    return capabilities;
  } catch (error) {
    actions.setCapabilitiesError(error);
    const capabilities = { ...FALLBACK, __error: error.kind ?? 'UNKNOWN', __fallback: true };
    actions.setCapabilities(capabilities);
    return capabilities;
  }
}

export function getCapabilities() {
  return store.getState().capabilities ?? FALLBACK;
}

/** True when a feature exists AND is not merely a placeholder. */
export function can(feature) {
  return Boolean(getCapabilities().features?.[feature]);
}

export function providerModes() {
  return getCapabilities().providers ?? FALLBACK.providers;
}

export function isSimulated() {
  return Boolean(getCapabilities().anyMock);
}

export function mockNotice() {
  return getCapabilities().mockNotice ?? null;
}

export function uploadLimits() {
  return getCapabilities().uploads ?? FALLBACK.uploads;
}

export function regions() {
  return getCapabilities().regions ?? FALLBACK.regions;
}

export default {
  loadCapabilities,
  getCapabilities,
  can,
  providerModes,
  isSimulated,
  mockNotice,
  uploadLimits,
  regions,
  FALLBACK,
};
