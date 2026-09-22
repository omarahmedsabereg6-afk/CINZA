#!/usr/bin/env node
/**
 * CINZA app build.
 *
 * Why a bundler at all? Capacitor plugins are npm packages exposed as ES modules
 * with bare specifiers (`@capacitor/camera`). A browser cannot resolve those, so
 * the app must be bundled. esbuild is used because it is a single fast binary and
 * needs no config file.
 *
 * What it does:
 *   1. Copies the static shell (index.html, css/, pages/, components/, assets/) to www/
 *   2. Bundles js/main.js -> www/js/bundle.js  (IIFE, so it works on every scheme)
 *
 * Modes:
 *   node build.mjs                 one-off dev build
 *   node build.mjs --prod          minified build with NODE_ENV=production
 *   node build.mjs --watch --serve dev build, rebuild on change, serve www/ on :5173
 */
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(fileURLToPath(import.meta.url), '..');
const WWW = join(ROOT, 'www');
const argv = new Set(process.argv.slice(2));
const PROD = argv.has('--prod');
const WATCH = argv.has('--watch');
const SERVE = argv.has('--serve');
const PORT = Number(process.env.APP_PORT || 5173);

/** Static assets copied verbatim into www/ */
const STATIC = ['index.html', 'manifest.webmanifest', 'robots.txt', 'css', 'pages', 'components', 'assets'];

function log(...a) {
  console.log('[build]', ...a);
}

function copyStatic() {
  mkdirSync(WWW, { recursive: true });
  for (const entry of STATIC) {
    const from = join(ROOT, entry);
    if (!existsSync(from)) continue;
    cpSync(from, join(WWW, entry), { recursive: true });
  }
  // Stamp the build so the app can show it in Profile > About and log it to the API.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  writeFileSync(
    join(WWW, 'build.json'),
    JSON.stringify({ version: pkg.version, mode: PROD ? 'production' : 'development', builtAt: new Date().toISOString() }, null, 2)
  );
}

const esbuildOptions = {
  absWorkingDir: ROOT,
  entryPoints: [join(ROOT, 'js/main.js')],
  outfile: join(WWW, 'js/bundle.js'),
  bundle: true,
  format: 'iife',
  target: ['es2020', 'chrome90', 'safari15'],
  platform: 'browser',
  sourcemap: PROD ? false : 'inline',
  minify: PROD,
  legalComments: 'none',
  logLevel: 'warning',
  define: {
    __CINZA_BUILD__: JSON.stringify(PROD ? 'production' : 'development'),
  },
  banner: { js: '/* CINZA — bundled build. Source lives in app/js/. */' },
};

async function main() {
  if (!PROD && existsSync(WWW)) {
    // keep www/ but let esbuild overwrite; static copy handles the rest
    rmSync(join(WWW, 'js'), { recursive: true, force: true });
  }
  copyStatic();

  if (WATCH) {
    const ctx = await esbuild.context({
      ...esbuildOptions,
      plugins: [
        {
          name: 'cinza-static',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length) {
                console.error(`[build] bundle failed with ${result.errors.length} error(s)`);
              } else {
                log('bundle rebuilt', new Date().toLocaleTimeString());
              }
            });
          },
        },
      ],
    });
    await ctx.watch();
    log('watching app/js for changes');
    watchStatic();
    if (SERVE) serveStatic();
  } else {
    await esbuild.build(esbuildOptions);
    log(`built ${PROD ? 'production' : 'development'} bundle -> www/js/bundle.js`);
  }
}

/* ------------------------------------------------------------------ *
 * Static file watcher.
 *
 * The server only ever serves www/, but esbuild's watcher only knows about the
 * JS entry graph — so without this, editing css/ (or any page partial) during
 * `npm run dev` changes nothing that the browser can see, and the stale stylesheet
 * looks like a failed edit. Re-copy on change so CSS iteration actually works.
 * ------------------------------------------------------------------ */
function watchStatic() {
  let queued = false;
  const reCopy = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      try {
        copyStatic();
        log('static files re-copied', new Date().toLocaleTimeString());
      } catch (error) {
        console.error('[build] static re-copy failed:', error.message);
      }
    }, 60);
  };

  const targets = [...STATIC, 'build.json'];
  for (const entry of targets) {
    const target = join(ROOT, entry);
    if (!existsSync(target)) continue;
    try {
      watch(target, { recursive: true }, reCopy);
    } catch (error) {
      console.warn(`[build] could not watch ${entry}: ${error.message}`);
    }
  }
  log('watching app/css, app/pages, app/components, app/assets for changes');
}

/* ------------------------------------------------------------------ *
 * Minimal static server so `npm run dev` needs no extra dependency.
 * ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const target = normalize(join(WWW, rel));
    if (!target.startsWith(WWW + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(target)) {
      // SPA-ish fallback: unknown non-asset paths render the shell
      if (!extname(rel)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(readFileSync(join(WWW, 'index.html')));
        return;
      }
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(readFileSync(target));
  });
  server.listen(PORT, () => {
    log(`app served at http://localhost:${PORT}`);
    log(`(API expected on http://localhost:${process.env.API_PORT || 8787})`);
  });
}

main().catch((err) => {
  console.error('[build] fatal:', err);
  process.exit(1);
});
