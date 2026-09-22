/**
 * Central, typed configuration.
 *
 * Rules:
 *  - Every value here is SERVER-SIDE ONLY. Nothing from this file is ever sent
 *    to the mobile app (section 28). The only config the app receives is the
 *    sanitised object built by `publicConfig()` in services/metaService.js.
 *  - Missing optional credentials do NOT crash the process. They downgrade the
 *    relevant integration to its mock adapter and record a loud warning, so the
 *    whole product is runnable before any keys exist (section 32).
 *  - Missing *critical* config (JWT secret in production) refuses to boot.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..', '..');
const projectRoot = resolve(backendRoot, '..');

// Root .env is the documented location; backend/.env may override it locally.
const rootEnv = resolve(projectRoot, '.env');
const backendEnv = resolve(backendRoot, '.env');
if (existsSync(rootEnv)) loadDotenv({ path: rootEnv, quiet: true });
if (existsSync(backendEnv)) loadDotenv({ path: backendEnv, override: true, quiet: true });

const warnings = [];

function str(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : String(v).trim();
}

function num(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key, fallback) {
  const v = str(key).toLowerCase();
  if (v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function list(key, fallback = []) {
  const v = str(key);
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Runtime
 * ------------------------------------------------------------------ */
const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
const port = num('PORT', 8787);
const apiUrl = str('API_URL', `http://localhost:${port}`);

/* ------------------------------------------------------------------ *
 * Database
 * ------------------------------------------------------------------ */
const databaseUrl = str('DATABASE_URL', 'file:./dev.db');
const databaseProvider = databaseUrl.startsWith('postgres')
  ? 'postgresql'
  : databaseUrl.startsWith('mysql')
    ? 'mysql'
    : 'sqlite';

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */
const PLACEHOLDER_SECRET = 'replace-me-with-a-long-random-string';
let jwtSecret = str('JWT_SECRET', '');
if (!jwtSecret || jwtSecret === PLACEHOLDER_SECRET) {
  if (isProduction) {
    console.error(
      '[config] FATAL: JWT_SECRET is unset or still the placeholder value.\n' +
        '         Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
        '         Refusing to start in production with a known secret.'
    );
    process.exit(1);
  }
  // Dev/test only: derive an ephemeral secret so tokens cannot be forged across restarts.
  jwtSecret = str('JWT_DEV_FALLBACK_SECRET', `cinza-dev-${Math.random().toString(36).slice(2)}-insecure`);
  // NOTE: startup warnings are surfaced to the app's developer screen, so they must
  // never contain a credential-looking identifier (see GET /api/meta/config).
  warnings.push('Token signing secret is not configured — using an ephemeral development secret. Sessions end when the server restarts.');
}

/* ------------------------------------------------------------------ *
 * Integrations (all default to mock so the app runs with zero credentials)
 * ------------------------------------------------------------------ */
const aiProvider = str('AI_PROVIDER', 'mock').toLowerCase();
const openAiApiKey = str('OPENAI_API_KEY', str('AI_API_KEY'));
const geminiApiKey = str('GEMINI_API_KEY');
const aiApiKey = aiProvider === 'gemini'
  ? (geminiApiKey || str('AI_API_KEY'))
  : (openAiApiKey || str('AI_API_KEY'));
const aiModel = aiProvider === 'gemini'
  ? str('GEMINI_MODEL', str('AI_VISION_MODEL', 'gemini-3.1-flash-lite'))
  : str('OPENAI_MODEL', str('AI_VISION_MODEL', 'gpt-5.6-terra'));
const geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
const openAiBaseUrl = str('AI_BASE_URL', 'https://api.openai.com/v1');
const aiBaseUrl = aiProvider === 'gemini' ? geminiBaseUrl : openAiBaseUrl;
const aiActive = aiProvider !== 'mock' && aiApiKey !== '';
const recognitionFallbackThreshold = num('RECOGNITION_FALLBACK_THRESHOLD', 0.7);
if (aiProvider !== 'mock' && !aiApiKey) {
  warnings.push(`A live AI provider (${aiProvider}) was requested but no credential was supplied — falling back to the mock vision adapter.`);
}

const tmdbProvider = str('TMDB_PROVIDER', 'mock').toLowerCase();
const tmdbApiKey = str('TMDB_API_KEY');
const tmdbAccessToken = str('TMDB_ACCESS_TOKEN');
const tmdbHasCredentials = tmdbApiKey !== '' || tmdbAccessToken !== '';
const tmdbActive = tmdbProvider === 'tmdb' && tmdbHasCredentials;
if (tmdbProvider === 'tmdb' && !tmdbHasCredentials) {
  warnings.push('A live TMDB source was requested but no read token or key was supplied — falling back to the mock catalog.');
}

const streamingProvider = str('STREAMING_PROVIDER', tmdbActive ? 'tmdb' : 'mock').toLowerCase();
const streamingActive = streamingProvider === 'tmdb' ? tmdbActive : streamingProvider !== 'mock';

const rottenTomatoesEnabled = bool('ROTTEN_TOMATOES_ENABLED', false);
const rottenTomatoesApiKey = str('ROTTEN_TOMATOES_API_KEY');
const rottenTomatoesBaseUrl = str('ROTTEN_TOMATOES_BASE_URL').replace(/\/+$/, '');
const rottenTomatoesConfigured = rottenTomatoesEnabled && rottenTomatoesApiKey !== '' && rottenTomatoesBaseUrl !== '';
if (rottenTomatoesEnabled && !rottenTomatoesConfigured) {
  warnings.push('Rotten Tomatoes ratings were enabled, but official credentials or base URL are missing — the provider will remain unavailable.');
}

if (str('STORAGE_DRIVER')) {
  warnings.push('The legacy storage-driver setting is ignored — DATABASE_URL selects the database.');
}

export const config = {
  env: nodeEnv,
  isProduction,
  isTest,
  isDev: !isProduction && !isTest,
  port,
  apiUrl,
  logLevel: str('LOG_LEVEL', isProduction ? 'info' : 'debug'),

  paths: { projectRoot, backendRoot, appDir: resolve(projectRoot, 'app') },
  serveApp: bool('SERVE_APP', !isProduction),

  database: { url: databaseUrl, provider: databaseProvider },

  auth: {
    jwtSecret,
    accessTtl: str('JWT_ACCESS_TTL', '15m'),
    refreshTtl: str('JWT_REFRESH_TTL', '30d'),
    accessTtlMs: 15 * 60 * 1000,
    refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
  },

  ai: {
    /** true only when a real key is present AND the provider is not `mock` */
    enabled: aiActive,
    provider: aiActive ? aiProvider : 'mock',
    requestedProvider: aiProvider,
    apiKey: aiApiKey,
    baseUrl: aiBaseUrl.replace(/\/+$/, ''),
    model: aiModel,
    timeoutMs: num('AI_TIMEOUT_MS', 45000),
    maxImageEdge: num('AI_MAX_IMAGE_EDGE', 1024),
    maxCallsPerRecognition: num('AI_MAX_CALLS_PER_RECOGNITION', 2),
    fallbackThreshold: recognitionFallbackThreshold,
  },

  tmdb: {
    enabled: tmdbActive,
    provider: tmdbActive ? 'tmdb' : 'mock',
    requestedProvider: tmdbProvider,
    apiKey: tmdbApiKey,
    accessToken: tmdbAccessToken,
    baseUrl: str('TMDB_BASE_URL', 'https://api.themoviedb.org/3').replace(/\/+$/, ''),
    imageBaseUrl: str('TMDB_IMAGE_BASE_URL', 'https://image.tmdb.org/t/p').replace(/\/+$/, ''),
    language: str('TMDB_LANGUAGE', 'en-US'),
    cacheTtlMs: num('TMDB_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
  },

  streaming: {
    enabled: streamingActive,
    provider: streamingActive ? streamingProvider : 'mock',
    requestedProvider: streamingProvider,
    apiKey: str('STREAMING_API_KEY'),
    defaultRegion: str('STREAMING_DEFAULT_REGION', 'US').toUpperCase(),
  },

  ratings: {
    rottenTomatoes: {
      enabled: rottenTomatoesConfigured,
      requestedEnabled: rottenTomatoesEnabled,
      apiKey: rottenTomatoesApiKey,
      baseUrl: rottenTomatoesBaseUrl,
      timeoutMs: num('ROTTEN_TOMATOES_TIMEOUT_MS', 4500),
      cacheTtlMs: num('ROTTEN_TOMATOES_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
    },
  },

  uploads: {
    maxImageBytes: num('MAX_IMAGE_BYTES', 10 * 1024 * 1024),
    maxVideoBytes: num('MAX_VIDEO_BYTES', 50 * 1024 * 1024),
    maxVideoDurationSeconds: num('MAX_VIDEO_DURATION_SECONDS', 120),
    maxVideoFrames: num('MAX_VIDEO_FRAMES', 6),
    maxImageDimension: num('MAX_IMAGE_DIMENSION', 6000),
    minImageDimension: num('MIN_IMAGE_DIMENSION', 120),
    allowedImageTypes: list('ALLOWED_IMAGE_TYPES', ['image/jpeg', 'image/png', 'image/webp']),
  },

  security: {
    corsOrigins: list('CORS_ORIGINS', [
      'http://localhost:8787',
      'http://localhost:5173',
      'capacitor://localhost',
      'https://localhost',
      'http://localhost',
    ]),
    rateLimit: {
      windowMs: num('RATE_LIMIT_WINDOW_MS', 60000),
      max: num('RATE_LIMIT_MAX', 120),
      recognitionMax: num('RECOGNITION_RATE_LIMIT_MAX', 20),
    },
    trustProxy: num('TRUST_PROXY', 0),
    // Uploaded image bytes are never written to disk (section 40).
    persistUploads: false,
  },

  /** Human readable capability summary printed once at boot. */
  summary() {
    return {
      env: nodeEnv,
      port,
      database: `${databaseProvider} (${databaseUrl.replace(/:\/\/[^@]*@/, '://***@')})`,
      ai: config.ai.enabled ? `live:${config.ai.provider}/${config.ai.model}` : 'MOCK (set AI_PROVIDER + AI_API_KEY)',
      tmdb: config.tmdb.enabled ? 'live:tmdb' : 'MOCK (set TMDB_PROVIDER=tmdb + TMDB_ACCESS_TOKEN)',
      streaming: config.streaming.enabled ? `live:${config.streaming.provider}` : 'MOCK (set STREAMING_PROVIDER=tmdb + TMDB_ACCESS_TOKEN)',
      ratings: config.ratings.rottenTomatoes.enabled ? 'live:rotten_tomatoes' : 'off:rotten_tomatoes',
      serveApp: config.serveApp,
    };
  },
};

export const startupWarnings = warnings;
export default config;
