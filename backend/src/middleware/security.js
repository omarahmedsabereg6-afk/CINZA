/**
 * Security headers + CORS (section 28).
 *
 * CORS is an ALLOW-LIST, not `*`, because the app authenticates with a bearer token
 * and is served from a known set of origins (the Capacitor schemes included). The
 * native app does not send an Origin header at all, so it is unaffected.
 */
import helmet from 'helmet';
import cors from 'cors';
import config from '../config/env.js';

/** Origins a packaged Capacitor app uses. Android = https://localhost, iOS = capacitor://localhost. */
const NATIVE_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'];

export function securityHeaders() {
  return helmet({
    // The app is a local bundle; the only cross-origin resources are TMDB images,
    // which we allow explicitly rather than disabling CSP.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://image.tmdb.org', 'https://www.themoviedb.org'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", ...config.security.corsOrigins],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // required so TMDB images can be embedded
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    // We serve a mobile webview bundle, not a website: X-Frame-Options stays off
    // only for the local schemes, which helmet does not model, so we keep it on.
    frameguard: { action: 'deny' },
  });
}

export function corsMiddleware() {
  const allowList = new Set([...config.security.corsOrigins, ...NATIVE_ORIGINS]);

  return cors({
    origin(origin, callback) {
      // No Origin header: native app, same-origin fetch, curl, or a server-to-server call.
      if (!origin) return callback(null, true);
      if (allowList.has(origin)) return callback(null, true);
      if (!config.isProduction && /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.0\.0\.\d+):\d+$/.test(origin)) {
        // Convenience for testing a physical device against a dev machine on the LAN.
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: false, // bearer tokens, not cookies -> credentials are not required
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Client-Platform', 'X-Client-Version'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 600,
  });
}

export default { securityHeaders, corsMiddleware };
