/**
 * Structured logger. Plain text in development (readable in a terminal),
 * single-line JSON in production (ingestible by log collectors).
 */
import config from '../config/env.js';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, scope, message, meta) {
  if (LEVELS[level] > threshold) return;
  const ts = new Date().toISOString();

  if (config.isProduction) {
    process.stdout.write(`${JSON.stringify({ ts, level, scope, message, ...(meta ? { meta } : {}) })}\n`);
    return;
  }

  const palette = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
  const color = palette[level] ?? '';
  const reset = '\x1b[0m';
  const tag = `${color}${level.toUpperCase().padEnd(5)}${reset}`;
  let line = `${ts.slice(11, 23)} ${tag} ${scope} ${message}`;
  if (meta !== undefined) {
    const text = typeof meta === 'string' ? meta : safe(meta);
    if (text) line += ` ${text}`;
  }
  process.stdout.write(`${line}\n`);
}

function safe(value) {
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    return '';
  }
}

export function createLogger(scope) {
  return {
    error: (msg, meta) => emit('error', scope, msg, meta),
    warn: (msg, meta) => emit('warn', scope, msg, meta),
    info: (msg, meta) => emit('info', scope, msg, meta),
    debug: (msg, meta) => emit('debug', scope, msg, meta),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger('cinza');
export default logger;
