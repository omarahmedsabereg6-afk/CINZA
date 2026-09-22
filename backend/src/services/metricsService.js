/**
 * Usage telemetry + API cost control bookkeeping (section 41).
 *
 * Counters live in memory for cheap reads, and are flushed to the
 * `ApiCallMetric` table so they survive restarts and can be aggregated later.
 * Persistence is best-effort: telemetry must never break a recognition.
 */
import { prisma } from '../database/prisma.js';
import { cacheReport } from '../utils/cache.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('metrics');

const counters = {
  recognitions: 0,
  recognitionsSucceeded: 0,
  recognitionsFailed: 0,
  recognitionsCached: 0,
  aiCalls: 0,
  aiCallsSkippedByCache: 0,
  tmdbCalls: 0,
  tmdbCallsSkippedByCache: 0,
  streamingCalls: 0,
  imagesUploaded: 0,
  videoFramesProcessed: 0,
  totalProcessingMs: 0,
  errors: 0,
  startedAt: Date.now(),
};

export function bump(key, by = 1) {
  if (key in counters) counters[key] += by;
}

/** Fire-and-forget persistence of a single upstream call. */
export function recordApiCall({ kind, provider, operation, status, ok = true, cacheHit = false, durationMs }) {
  prisma.apiCallMetric
    .create({ data: { kind, provider, operation, status: status ?? null, ok, cacheHit, durationMs: durationMs ?? null } })
    .catch((error) => log.debug('metric persist failed', { message: error.message }));
}

export function snapshot() {
  const completed = counters.recognitionsSucceeded + counters.recognitionsFailed;
  return {
    counters: { ...counters },
    averages: {
      processingMs: completed === 0 ? 0 : Math.round(counters.totalProcessingMs / completed),
      aiCallsPerRecognition: counters.recognitions === 0 ? 0 : Number((counters.aiCalls / counters.recognitions).toFixed(2)),
      tmdbCallsPerRecognition: counters.recognitions === 0 ? 0 : Number((counters.tmdbCalls / counters.recognitions).toFixed(2)),
    },
    caches: cacheReport(),
    uptimeSeconds: Math.round((Date.now() - counters.startedAt) / 1000),
  };
}

/** Rolling window of recent calls from the database. */
export async function recentActivity({ hours = 24, limit = 500 } = {}) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const [ai, tmdb, streaming] = await Promise.all([
    prisma.apiCallMetric.count({ where: { kind: 'ai', createdAt: { gte: since } } }),
    prisma.apiCallMetric.count({ where: { kind: 'tmdb', createdAt: { gte: since } } }),
    prisma.apiCallMetric.count({ where: { kind: 'streaming', createdAt: { gte: since } } }),
  ]);
  const slowest = await prisma.apiCallMetric.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { durationMs: 'desc' },
    take: 5,
    select: { kind: true, operation: true, durationMs: true, createdAt: true },
  });
  return { windowHours: hours, ai, tmdb, streaming, slowest };
}

export function reset() {
  for (const key of Object.keys(counters)) {
    if (key !== 'startedAt') counters[key] = 0;
  }
}

export default { bump, recordApiCall, snapshot, recentActivity, reset };
