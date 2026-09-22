/**
 * Server entry point.
 *
 * Boot sequence:
 *   1. print a capability summary (what is live vs. mocked)
 *   2. verify the database and print the exact fix if it is not reachable
 *   3. probe optional tooling (ffmpeg for server-side video frames)
 *   4. listen, and shut down gracefully on SIGINT/SIGTERM so `node --watch`
 *      restarts do not leave connections dangling
 */
import config, { startupWarnings } from './config/env.js';
import { createLogger } from './utils/logger.js';
import { createApp } from './app.js';
import { checkDatabase, disconnectDatabase, friendlyDatabaseError } from './database/prisma.js';
import { probeFfmpeg } from './recognition/videoFrames.js';
import { getVisionProvider } from './integrations/ai/index.js';
import { getTmdb } from './integrations/tmdb/index.js';
import { getStreamingProvider } from './integrations/streaming/index.js';
import { getSceneMatcher } from './recognition/sceneMatcher/index.js';

const log = createLogger('boot');

/** Forces the lazy provider getters to log their mode banner before we print the table. */
function warmProviders() {
  return {
    ai: getVisionProvider(),
    tmdb: getTmdb(),
    streaming: getStreamingProvider(),
    sceneMatcher: getSceneMatcher(),
  };
}

async function main() {
  log.info('CINZA API starting');

  const providers = warmProviders();
  const ffmpeg = probeFfmpeg();

  const summary = {
    ...config.summary(),
    sceneMatcher: providers.sceneMatcher.name,
    ffmpeg: ffmpeg.available ? 'available (server-side video frames)' : `unavailable — ${ffmpeg.reason}`,
  };
  for (const [key, value] of Object.entries(summary)) {
    log.info(`  ${key.padEnd(10)} ${value}`);
  }

  for (const warning of startupWarnings) log.warn(`  ⚠ ${warning}`);

  const db = await checkDatabase();
  if (!db.ok) {
    log.error('Database is not reachable.');
    log.error(friendlyDatabaseError({ message: db.message }));
    log.error('The API will start and report 503 from /api/meta/health until this is fixed.');
  } else {
    log.info(`  database   connected (${db.provider})`);
  }

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    log.info(`listening on http://localhost:${config.port}`);
    log.info(`  health     http://localhost:${config.port}/api/meta/health`);
    log.info(`  config     http://localhost:${config.port}/api/meta/config`);
    if (config.serveApp) log.info(`  app        http://localhost:${config.port}`);
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  const shutdown = async (signal) => {
    log.info(`${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      log.info('closed cleanly');
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
  process.on('uncaughtException', (error) => {
    log.error(`uncaught exception: ${error.message}`, { stack: error.stack?.split('\n').slice(0, 4).join('\n') });
  });
}

main().catch((error) => {
  log.error(`fatal boot error: ${error.message}`, { stack: error.stack });
  process.exit(1);
});
