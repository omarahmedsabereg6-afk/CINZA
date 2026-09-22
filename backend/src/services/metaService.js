/**
 * Meta service: the small, sanitised surface that describes the API to the app.
 *
 * SECURITY BOUNDARY (section 28): this is the ONLY place configuration is exposed,
 * and it is hand-built. No API keys, tokens, database URLs or secrets are ever
 * included — `publicConfig()` lists keys explicitly rather than spreading `config`.
 */
import config, { startupWarnings } from '../config/env.js';
import { prisma } from '../database/prisma.js';
import { checkDatabase } from '../database/prisma.js';
import { REGIONS } from '../database/constants.js';
import { getVisionProvider } from '../integrations/ai/index.js';
import { getTmdb } from '../integrations/tmdb/index.js';
import { getStreamingProvider } from '../integrations/streaming/index.js';
import { getSceneMatcher } from '../recognition/sceneMatcher/index.js';
import { snapshot } from './metricsService.js';
import { feedbackStats, historyStats } from './recognitionService.js';
import { probeFfmpeg } from '../recognition/videoFrames.js';
import { MAX_QUERIES } from '../recognition/candidateGenerator.js';
import { MAX_DETAIL_FETCHES } from '../recognition/matching/index.js';
import { THRESHOLDS } from '../recognition/matching/confidence.js';

/**
 * Everything the app is allowed to know. Used to drive UI capability gating:
 * e.g. if `video.enabled` is false the Upload Video button is hidden rather than
 * being a dead control (section 46 — no fake buttons).
 */
export function publicConfig() {
  const ai = getVisionProvider();
  const tmdb = getTmdb();
  const streaming = getStreamingProvider();
  const sceneMatcher = getSceneMatcher();

  return {
    api: {
      version: '1.0.0',
      environment: config.env,
      url: config.apiUrl,
    },
    features: {
      recognition: true,
      describeScene: true,
      videoRecognition: true,
      search: true,
      watchlist: true,
      history: true,
      accounts: true,
      whereToWatch: true,
      sceneMatching: sceneMatcher.name !== 'disabled',
      serverSideVideoFrames: probeFfmpeg().available,
    },
    regions: REGIONS,
    defaults: {
      region: config.streaming.defaultRegion,
      language: 'en-US',
      theme: 'dark',
    },
    uploads: {
      maxImageBytes: config.uploads.maxImageBytes,
      maxVideoBytes: config.uploads.maxVideoBytes,
      maxVideoDurationSeconds: config.uploads.maxVideoDurationSeconds,
      maxVideoFrames: config.uploads.maxVideoFrames,
      maxImageDimension: config.uploads.maxImageDimension,
      minImageDimension: config.uploads.minImageDimension,
      allowedImageTypes: config.uploads.allowedImageTypes,
      // Tells the app to compress and hash on-device before uploading.
      clientPreprocessing: { resize: true, compress: true, perceptualHash: true, extractVideoFrames: true },
    },
    /**
     * Honesty block. The app renders a visible banner whenever any of these is a
     * mock, so a simulated result can never be presented as a real identification
     * (section 32).
     */
    providers: {
      ai: { name: ai.name, mode: ai.isMock ? 'mock' : 'live', model: ai.isMock ? null : config.ai.model },
      tmdb: { name: tmdb.name, mode: tmdb.isMock ? 'mock' : 'live' },
      streaming: { name: streaming.name, mode: streaming.isMock ? 'mock' : 'live' },
      sceneMatcher: { name: sceneMatcher.name, mode: sceneMatcher.name === 'disabled' ? 'off' : 'local' },
    },
    anyMock: ai.isMock || tmdb.isMock || streaming.isMock,
    mockNotice:
      ai.isMock
        ? 'Recognition is running in simulated mode: no AI key is configured. Results are labelled as simulated and are not real identifications.'
        : tmdb.isMock
          ? 'TMDB data is running in simulated mode: the app is using the built-in fixture catalog and not live metadata.'
          : streaming.isMock
            ? 'Streaming availability is running in simulated mode: legal viewing options are coming from the built-in fixture data.'
            : null,
    warnings: config.isProduction ? [] : startupWarnings,
    limits: {
      recognitionPerHour: config.security.rateLimit.recognitionMax,
      // Exposed so the app can explain why a result was withheld.
      confidenceThresholds: THRESHOLDS,
      fallbackThreshold: config.ai.fallbackThreshold,
    },
    cost: {
      maxSearchQueriesPerRecognition: MAX_QUERIES,
      maxDetailFetchesPerRecognition: MAX_DETAIL_FETCHES,
    },
  };
}

export async function health() {
  const [db, sceneMatcherStats] = await Promise.all([
    checkDatabase(),
    getSceneMatcher()
      .stats()
      .catch(() => null),
  ]);

  const ffmpeg = probeFfmpeg();

  return {
    status: db.ok ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
    dependencies: {
      database: { ok: db.ok, provider: db.provider, message: db.message ?? null },
      ai: { mode: getVisionProvider().isMock ? 'mock' : 'live' },
      tmdb: { mode: getTmdb().isMock ? 'mock' : 'live' },
      streaming: { mode: getStreamingProvider().isMock ? 'mock' : 'live' },
      ffmpeg: { available: ffmpeg.available, reason: ffmpeg.reason ?? null },
      sceneMatcher: sceneMatcherStats,
    },
  };
}

/** Aggregate metrics for the Profile > Developer screen (section 41). */
export async function metrics() {
  const [history, feedback] = await Promise.all([
    historyStats({ userId: undefined }).catch(() => null),
    feedbackStats().catch(() => null),
  ]);

  return {
    process: snapshot(),
    history,
    feedback,
    providers: {
      ai: getVisionProvider().name,
      tmdb: getTmdb().name,
      streaming: getStreamingProvider().name,
      sceneMatcher: getSceneMatcher().name,
    },
    database: { provider: config.database.provider },
  };
}

export default { publicConfig, health, metrics };
