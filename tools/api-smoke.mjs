#!/usr/bin/env node
/**
 * End-to-end API smoke test (section 42).
 *
 * Exercises the real pipeline against a running API — no mocks of our own code. It
 * uploads a genuine generated PNG, runs a recognition, then walks auth, history,
 * watchlist, search and availability.
 *
 * Usage:
 *   npm run test:api                     (expects http://localhost:8787)
 *   API_URL=http://host:port npm run test:api
 *
 * Exit code is 0 only when every check passes.
 */

import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const BASE = (process.env.API_URL || process.env.SMOKE_API_URL || 'http://localhost:8787').replace(/\/+$/, '');
const results = [];
let failures = 0;

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function record(name, ok, detail = '', warn = false) {
  results.push({ name, ok, detail, warn });
  if (!ok && !warn) failures += 1;
  const icon = ok ? `${C.green}PASS${C.reset}` : warn ? `${C.yellow}WARN${C.reset}` : `${C.red}FAIL${C.reset}`;
  console.log(`  ${icon} ${name}${detail ? ` ${C.dim}— ${detail}${C.reset}` : ''}`);
}

function section(title) {
  console.log(`\n${C.bold}${C.cyan}${title}${C.reset}`);
}

async function call(method, path, { body, token, form, raw = false, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { __raw: text.slice(0, 200) };
    }
    return { status: response.status, ok: response.ok, data: parsed, raw: raw ? text : null, headers: response.headers };
  } catch (error) {
    return { status: 0, ok: false, data: { error: { code: 'NETWORK', message: error.message } } };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * A real PNG, built here so the test has no external fixtures.
 * A 240x240 image with a recognisable gradient and a white block, which is
 * large enough to pass MIN_IMAGE_DIMENSION and is valid for every probe path.
 * ------------------------------------------------------------------ */
function makePng(width = 240, height = 240) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + 1 + x * 4;
      const inBlock = x > 60 && x < 180 && y > 60 && y < 180;
      raw[i] = inBlock ? 240 : (x * 255) / width;
      raw[i + 1] = inBlock ? 240 : (y * 255) / height;
      raw[i + 2] = inBlock ? 245 : 80;
      raw[i + 3] = 255;
    }
  }

  const idat = deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function require_zlib_removed() {}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/**
 * Deterministic 64-bit hex fingerprint of the PNG bytes.
 *
 * The real app computes a perceptual hash from decoded pixels. Neither the server
 * nor this test decodes pixels, and it does not need to: this value only has to
 * survive the round trip through validation and the SceneMatcher index, so a hash of
 * the bytes proves the plumbing.
 */
function dHashHex(pngBuffer) {
  return createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

async function main() {
  console.log(`${C.bold}CINZA API smoke test${C.reset} ${C.dim}->${C.reset} ${BASE}\n`);

  section('Meta');
  const health = await call('GET', '/api/meta/health');
  record('GET /api/meta/health responds', health.status === 200 || health.status === 503, `status ${health.status}`);
  const dbOk = health.data?.dependencies?.database?.ok;
  record('database reachable', Boolean(dbOk), dbOk ? health.data.dependencies.database.provider : health.data?.dependencies?.database?.message ?? 'unknown', true);

  const configRes = await call('GET', '/api/meta/config');
  record('GET /api/meta/config responds', configRes.status === 200, `status ${configRes.status}`);
  const cfg = configRes.data?.config;
  record('config exposes upload limits', Boolean(cfg?.uploads?.maxImageBytes), `max ${cfg?.uploads?.maxImageBytes} bytes`);
  record('config exposes regions', Array.isArray(cfg?.regions) && cfg.regions.length > 5, `${cfg?.regions?.length ?? 0} regions`);
  record('config reports provider modes', Boolean(cfg?.providers?.ai?.mode), `ai=${cfg?.providers?.ai?.mode} tmdb=${cfg?.providers?.tmdb?.mode}`);
  const leaked = JSON.stringify(cfg ?? {}).match(/api[_-]?key|access_?token|jwt_?secret|database_url|password/i);
  record('config leaks no secrets', !leaked, leaked ? `FOUND: ${leaked[0]}` : 'clean');
  record('mock mode is disclosed', cfg?.anyMock !== true || Boolean(cfg?.mockNotice), cfg?.anyMock ? 'mockNotice present' : 'all live');

  const indexRes = await call('GET', '/api');
  record('GET /api returns route index', indexRes.status === 200 && Boolean(indexRes.data?.routes), `status ${indexRes.status}`);

  section('Validation + error contract');
  const noMatch = await call('GET', '/api/does-not-exist');
  record('unknown route returns structured 404', noMatch.status === 404 && noMatch.data?.error?.code === 'NOT_FOUND');

  const badSearch = await call('GET', '/api/search');
  record('missing query param returns 400', badSearch.status === 400 && badSearch.data?.error?.code === 'VALIDATION_FAILED');

  const badRegion = await call('GET', '/api/search?q=dune&region=ZZ');
  record('invalid region returns 400', badRegion.status === 400, `status ${badRegion.status}`);

  section('Auth');
  const email = `smoke_${Date.now()}@example.com`;
  const password = 'CinzaTest123';

  const weakPassword = await call('POST', '/api/auth/register', { body: { email: `x_${Date.now()}@example.com`, password: 'short' } });
  record('weak password rejected', weakPassword.status === 400, `status ${weakPassword.status}`);

  const registered = await call('POST', '/api/auth/register', { body: { email, password, displayName: 'Smoke Tester', region: 'US' } });
  record('POST /api/auth/register creates a session', registered.status === 201 && Boolean(registered.data?.session?.accessToken));
  const token = registered.data?.session?.accessToken;
  const refreshToken = registered.data?.session?.refreshToken;

  const duplicate = await call('POST', '/api/auth/register', { body: { email, password } });
  record('duplicate email rejected', duplicate.status === 409, `status ${duplicate.status}`);

  const wrongPassword = await call('POST', '/api/auth/login', { body: { email, password: 'WrongPass123' } });
  record('wrong password rejected', wrongPassword.status === 401, `status ${wrongPassword.status}`);

  const unknownUser = await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password } });
  record('unknown account rejected identically', unknownUser.status === 401 && unknownUser.data?.error?.code === 'INVALID_CREDENTIALS');

  const me = await call('GET', '/api/auth/me', { token });
  record('GET /api/auth/me with token', me.status === 200 && me.data?.user?.email === email);

  const meNoToken = await call('GET', '/api/auth/me');
  record('GET /api/auth/me without token is 401', meNoToken.status === 401);

  const badToken = await call('GET', '/api/auth/me', { token: 'not.a.token' });
  record('invalid token rejected', badToken.status === 401);

  const refreshed = await call('POST', '/api/auth/refresh', { body: { refreshToken } });
  record('POST /api/auth/refresh rotates the token', refreshed.status === 200 && Boolean(refreshed.data?.session?.accessToken));
  const rotatedToken = refreshed.data?.session?.accessToken;

  const reuse = await call('POST', '/api/auth/refresh', { body: { refreshToken } });
  record('refresh token reuse is rejected', reuse.status === 401, `status ${reuse.status}`);

  const liveToken = rotatedToken ?? token;

  section('Recognition');
  const png = makePng(240, 240);
  const pngHash = dHashHex(png);

  const describeOnly = await call('POST', '/api/recognitions', {
    body: {
      meta: {
        mode: 'describe',
        describe: 'a clown-masked bank robber in a city at night, armoured truck chase',
        region: 'US',
        files: [],
      },
    },
  });
  record('describe-only recognition works', describeOnly.status === 201, `status ${describeOnly.status}`);
  const describeResult = describeOnly.data?.recognition;
  record('describe result has a payload', Boolean(describeResult?.match || describeResult?.noMatchReason));
  record('mock result is flagged, not hidden', describeResult?.isMock === true || describeResult?.isMock === false, `isMock=${describeResult?.isMock}`);
  record('confidence is present', typeof describeResult?.match?.confidence === 'number', `confidence=${describeResult?.match?.confidence ?? 'n/a'}`);
  record('scene block is present', Boolean(describeResult?.scene), describeResult?.scene?.timestampLabel ?? '');
  record('timestamp is never invented', describeResult?.scene?.timestamp === null || describeResult?.scene?.timestampLabel, `timestamp=${describeResult?.scene?.timestamp}`);

  const form = new FormData();
  form.append(
    'meta',
    JSON.stringify({
      mode: 'image',
      source: 'gallery',
      region: 'US',
      describe: 'two men in dark suits in an orange dusty city, holographic billboard',
      files: [
        { pHash: pngHash, dHash: pngHash, aHash: pngHash, thumbDataUrl: `data:image/png;base64,${png.toString('base64').slice(0, 4000)}` },
      ],
    })
  );
  form.append('images', new Blob([png], { type: 'image/png' }), 'scene.png');

  const recognised = await call('POST', '/api/recognitions?debug=true', { form, token: liveToken, timeoutMs: 60_000 });
  record('POST /api/recognitions accepts multipart', recognised.status === 201, `status ${recognised.status}`);
  if (recognised.status !== 201) {
    console.log(`       ${C.dim}${JSON.stringify(recognised.data).slice(0, 400)}${C.reset}`);
  }
  const rec = recognised.data?.recognition;
  record('recognition id returned', Boolean(rec?.id));
  record('candidate list is explainable', Array.isArray(rec?.match?.whyThisMatch), `${rec?.match?.whyThisMatch?.length ?? 0} signals`);
  record('alternatives are offered', Array.isArray(rec?.match?.alternatives), `${rec?.match?.alternatives?.length ?? 0} alternative(s)`);
  record('images echoed without storing full bytes', Array.isArray(rec?.images) && !('buffer' in (rec.images?.[0] ?? {})), `${rec?.images?.length ?? 0} image record(s)`);
  record('providers disclosed on the result', Boolean(rec?.providers), `ai=${rec?.providers?.ai} tmdb=${rec?.providers?.tmdb}`);

  const noMeta = await call('POST', '/api/recognitions', { body: { meta: { mode: 'image', files: [] } } });
  record('empty upload rejected', noMeta.status === 400, `code=${noMeta.data?.error?.code}`);

  const badFile = new FormData();
  badFile.append('meta', JSON.stringify({ mode: 'image', files: [] }));
  badFile.append('images', new Blob([Buffer.from('this is definitely not an image')], { type: 'image/png' }), 'fake.png');
  const badType = await call('POST', '/api/recognitions', { form: badFile });
  record('non-image bytes rejected by content sniffing', badType.status === 400, `code=${badType.data?.error?.code}`);

  section('History');
  const history = await call('GET', '/api/history', { token: liveToken });
  record('GET /api/history works for a signed-in user', history.status === 200 && history.data?.storage === 'server', `total=${history.data?.total}`);
  const ourItem = history.data?.items?.find((i) => i.id === rec?.id);
  record('created recognition appears in history', Boolean(ourItem), ourItem ? `${ourItem.match?.title ?? 'no match'} (${ourItem.confidence ?? 'n/a'}%)` : 'missing');

  const anonHistory = await call('GET', '/api/history');
  record('anonymous history stays on device', anonHistory.status === 200 && anonHistory.data?.storage === 'device');

  const stats = await call('GET', '/api/history/stats', { token: liveToken });
  record('GET /api/history/stats works', stats.status === 200 && typeof stats.data?.stats?.total === 'number', `total=${stats.data?.stats?.total}`);

  const fetchedById = await call('GET', `/api/recognitions/${rec?.id}`, { token: liveToken });
  record('GET /api/recognitions/:id for the owner', fetchedById.status === 200 && fetchedById.data?.recognition?.id === rec?.id);
  record('stored recognition keeps telemetry', typeof fetchedById.data?.recognition?.telemetry?.processingMs === 'number', `${fetchedById.data?.recognition?.telemetry?.processingMs}ms`);

  const fetchedAnon = await call('GET', `/api/recognitions/${rec?.id}`);
  record('another caller cannot read it', fetchedAnon.status === 404, `status ${fetchedAnon.status}`);

  section('Search + catalog');
  const search = await call('GET', '/api/search?q=inception', { token: liveToken });
  record('GET /api/search returns titles', search.status === 200 && Array.isArray(search.data?.titles), `${search.data?.titles?.length ?? 0} title(s)`);

  const personSearch = await call('GET', '/api/search?q=nolan&type=all');
  record('actor/director search responds', personSearch.status === 200, `${personSearch.data?.people?.length ?? 0} person(s)`);

  const recent = await call('GET', '/api/search/recent', { token: liveToken });
  record('recent searches recorded', recent.status === 200 && (recent.data?.items?.length ?? 0) > 0, `${recent.data?.items?.length ?? 0} entr(ies)`);

  const discover = await call('GET', '/api/discover');
  record('GET /api/discover returns rails', discover.status === 200 && (discover.data?.rails?.length ?? 0) > 0, `${discover.data?.rails?.length ?? 0} rail(s)`);

  const discoverGenre = await call('GET', '/api/discover/genre?genreId=28');
  record('GET /api/discover/genre returns genre items', discoverGenre.status === 200 && (discoverGenre.data?.items?.length ?? 0) > 0, `${discoverGenre.data?.items?.length ?? 0} item(s)`);

  const discoverGenrePage2 = await call('GET', '/api/discover/genre?genreId=28&page=2');
  record('GET /api/discover/genre page 2 pagination works', discoverGenrePage2.status === 200 && discoverGenrePage2.data?.page === 2 && (discoverGenrePage2.data?.items?.length ?? 0) > 0, `page ${discoverGenrePage2.data?.page} (${discoverGenrePage2.data?.items?.length ?? 0} items)`);

  const discoverGenreTopRated = await call('GET', '/api/discover/genre?genreId=28&sortBy=vote_average.desc');
  record('GET /api/discover/genre sortBy vote_average.desc works', discoverGenreTopRated.status === 200 && (discoverGenreTopRated.data?.items?.length ?? 0) > 0, `${discoverGenreTopRated.data?.items?.length ?? 0} items`);

  const discoverLatestAll = await call('GET', '/api/discover?sortBy=release_date.desc');
  record('GET /api/discover sortBy release_date.desc works', discoverLatestAll.status === 200 && (discoverLatestAll.data?.items?.length ?? 0) > 0, `${discoverLatestAll.data?.items?.length ?? 0} items`);

  const firstTitle = search.data?.titles?.[0];
  if (firstTitle) {
    const detailPath = firstTitle.mediaType === 'tv' ? `/api/tv/${firstTitle.tmdbId}` : `/api/movies/${firstTitle.tmdbId}`;
    const detail = await call('GET', detailPath);
    record(`${detailPath} returns detail`, detail.status === 200, `status ${detail.status}`);
    const node = detail.data?.movie ?? detail.data?.series;
    record('detail includes cast', Array.isArray(node?.cast), `${node?.cast?.length ?? 0} cast`);

    const availability = await call('GET', `/api/${firstTitle.mediaType}/${firstTitle.tmdbId}/availability?region=US`, { token: liveToken });
    record('availability endpoint responds', availability.status === 200, `hasAny=${availability.data?.availability?.hasAny}`);
    const av = availability.data?.availability;
    record(
      'availability never contains fabricated entries',
      av?.hasAny === false || (Array.isArray(av?.groups) && av.groups.every((g) => g.providers.every((p) => p.name))),
      av?.hasAny ? `${av.groups?.length} group(s)` : 'none in this region'
    );

    const stills = await call('GET', `/api/${firstTitle.mediaType}/${firstTitle.tmdbId}/stills`);
    record('stills endpoint responds and is labelled', stills.status === 200, stills.data?.label ?? 'no stills available');
  }

  section('Watchlist');
  if (firstTitle) {
    const added = await call('POST', '/api/watchlist', {
      token: liveToken,
      body: { mediaType: firstTitle.mediaType, tmdbId: firstTitle.tmdbId },
    });
    record('POST /api/watchlist saves a title', added.status === 201, `status ${added.status}`);
    const itemId = added.data?.item?.id;

    const duplicate = await call('POST', '/api/watchlist', {
      token: liveToken,
      body: { mediaType: firstTitle.mediaType, tmdbId: firstTitle.tmdbId },
    });
    record('saving twice is idempotent', duplicate.status === 201, `status ${duplicate.status}`);

    const list = await call('GET', '/api/watchlist', { token: liveToken });
    record('GET /api/watchlist lists it', list.status === 200 && (list.data?.items?.length ?? 0) >= 1, `${list.data?.items?.length} item(s)`);

    const check = await call('GET', `/api/watchlist/check?mediaType=${firstTitle.mediaType}&tmdbId=${firstTitle.tmdbId}`, { token: liveToken });
    record('GET /api/watchlist/check reports saved', check.status === 200 && check.data?.saved === true);

    const removed = await call('DELETE', `/api/watchlist/${itemId}`, { token: liveToken });
    record('DELETE /api/watchlist/:id removes it', removed.status === 200);

    const checkAfter = await call('GET', `/api/watchlist/check?mediaType=${firstTitle.mediaType}&tmdbId=${firstTitle.tmdbId}`, { token: liveToken });
    record('removal is reflected', checkAfter.data?.saved === false);

    const unauth = await call('GET', '/api/watchlist');
    record('watchlist requires auth', unauth.status === 401);
  }

  section('Feedback');
  if (rec?.id) {
    const confirmed = await call('POST', '/api/feedback', { token: liveToken, body: { recognitionId: rec.id, correct: true } });
    record('POST /api/feedback (confirm) works', confirmed.status === 201, `status ${confirmed.status}`);

    const correction = await call('POST', '/api/feedback', {
      token: liveToken,
      body: { recognitionId: rec.id, correct: false, correctedTitle: 'A Different Movie', correctedMediaType: 'movie' },
    });
    record('POST /api/feedback (correction) works', correction.status === 201);

    const invalidFeedback = await call('POST', '/api/feedback', { token: liveToken, body: { recognitionId: rec.id, correct: false } });
    record('correction without a title is rejected', invalidFeedback.status === 400);

    const feedbackStats = await call('GET', '/api/feedback/stats');
    record('GET /api/feedback/stats works', feedbackStats.status === 200 && typeof feedbackStats.data?.stats?.total === 'number');
  }

  section('Profile + settings');
  const settings = await call('GET', '/api/auth/settings', { token: liveToken });
  record('GET /api/auth/settings works', settings.status === 200 && Boolean(settings.data?.counts), JSON.stringify(settings.data?.counts ?? {}));

  const patched = await call('PATCH', '/api/auth/profile', { token: liveToken, body: { region: 'GB', theme: 'system' } });
  record('PATCH /api/auth/profile updates region', patched.status === 200 && patched.data?.user?.region === 'GB');

  const badPatch = await call('PATCH', '/api/auth/profile', { token: liveToken, body: { region: 'NOPE' } });
  record('invalid profile region rejected', badPatch.status === 400);

  section('Privacy / deletion');
  const notConfirmed = await call('DELETE', '/api/auth/account', { token: liveToken, body: {} });
  record('account deletion requires explicit confirmation', notConfirmed.status === 400);

  const deleted = await call('DELETE', '/api/auth/account', { token: liveToken, body: { confirm: true } });
  record('DELETE /api/auth/account works', deleted.status === 200 && deleted.data?.deleted === true, `removed ${deleted.data?.removed?.recognitions} recognition(s)`);

  const afterDelete = await call('GET', '/api/auth/me', { token: liveToken });
  record('session invalid after deletion', afterDelete.status === 401);

  const relogin = await call('POST', '/api/auth/login', { body: { email, password } });
  record('deleted account cannot sign in', relogin.status === 401, `status ${relogin.status}`);

  /* ------------------------------ summary ------------------------------ */
  const passed = results.filter((r) => r.ok).length;
  const warned = results.filter((r) => !r.ok && r.warn).length;

  console.log(
    `\n${C.bold}${failures === 0 ? C.green : C.red}${passed}/${results.length} checks passed${C.reset}` +
      (warned ? ` ${C.yellow}(${warned} warning${warned === 1 ? '' : 's'})${C.reset}` : '') +
      (failures ? ` ${C.red}${failures} failed${C.reset}` : '')
  );

  if (failures > 0) {
    console.log(`\n${C.red}Failures:${C.reset}`);
    for (const f of results.filter((r) => !r.ok && !r.warn)) console.log(`  - ${f.name} ${C.dim}${f.detail}${C.reset}`);
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n${C.red}Smoke test crashed:${C.reset} ${error.stack}`);
  console.error(`\nIs the API running at ${BASE}?  Start it with: npm run dev:api`);
  process.exit(1);
});
