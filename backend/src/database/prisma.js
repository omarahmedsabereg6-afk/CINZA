/**
 * Prisma client singleton + startup health check.
 *
 * One connection pool for the process. In development the instance is cached on
 * globalThis so `node --watch` restarts do not leak connections.
 */
import { PrismaClient } from '@prisma/client';
import config from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('db');

function create() {
  return new PrismaClient({
    log: config.isDev
      ? [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'stdout', level: 'error' }],
    errorFormat: config.isProduction ? 'minimal' : 'pretty',
  });
}

const globalRef = globalThis;
export const prisma = globalRef.__cinzaPrisma ?? create();
if (!config.isProduction) globalRef.__cinzaPrisma = prisma;

if (config.isDev && typeof prisma.$on === 'function') {
  prisma.$on('warn', (e) => log.warn(e.message));
  prisma.$on('error', (e) => log.error(e.message));
}

/**
 * Turns Prisma's engine errors into an actionable instruction. Getting these
 * wrong is the single most common local-setup failure, so we spell out the fix.
 */
export function friendlyDatabaseError(error) {
  const message = String(error?.message || error || '');
  const provider = config.database.provider;

  const hints = [
    {
      test: /must start with the protocol `file:`|URL must start with the protocol/i,
      hint:
        'The generated Prisma client does not match DATABASE_URL.\n' +
        `         DATABASE_URL is a ${provider} URL.\n` +
        (provider === 'sqlite'
          ? '         Fix: npm run db:dev:generate && npm run db:dev:push'
          : '         Fix: npm run db:generate && npm run db:migrate:dev'),
    },
    {
      test: /Can't reach database server|ECONNREFUSED|P1001/i,
      hint:
        'No database server is reachable at DATABASE_URL.\n' +
        '         Start PostgreSQL, or switch to the built-in zero-setup SQLite dev database:\n' +
        '           DATABASE_URL=file:./dev.db   then:  npm run db:dev:generate && npm run db:dev:push',
    },
    {
      test: /does not exist|P1003|Unknown database/i,
      hint: 'The database exists but the tables do not. Run: npm run db:migrate (postgres) or npm run db:dev:push (sqlite).',
    },
    {
      test: /query engine|Query engine library|P1012|did not initialize yet/i,
      hint: 'The Prisma client was never generated. Run: npm run db:dev:generate  (sqlite)  or  npm run db:generate  (postgres).',
    },
  ];

  const match = hints.find((h) => h.test.test(message));
  return match ? `${message}\n         ${match.hint}` : message;
}

/** Boot-time connectivity probe. Returns a status object; never throws. */
export async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, provider: config.database.provider };
  } catch (error) {
    return {
      ok: false,
      provider: config.database.provider,
      message: friendlyDatabaseError(error),
    };
  }
}

export async function disconnectDatabase() {
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore shutdown races */
  }
}

export default prisma;
