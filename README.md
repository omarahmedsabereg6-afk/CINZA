# CINZA

**What movie is this?** Show us a scene and we'll find it.

CINZA identifies films and TV series from a screenshot, a photo of a paused screen, or
a written description. It is a real Android + iOS application built with **HTML, CSS
and vanilla JavaScript** inside **Capacitor**, backed by a **Node.js / Express** API
with **PostgreSQL + Prisma**.

It is not a website in a wrapper: it uses native camera, native photo picker, native
haptics, hardware back button, safe-area layout, and on-device image processing.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Quick start](#quick-start)
4. [Environment variables](#environment-variables)
5. [Enabling live providers](#enabling-live-providers)
6. [Database](#database)
7. [Backend](#backend)
8. [The app](#the-app)
9. [API reference](#api-reference)
10. [Running the tests](#running-the-tests)
11. [Building the native apps](#building-the-native-apps)
12. [How recognition actually works](#how-recognition-actually-works)
13. [Honesty rules this project follows](#honesty-rules-this-project-follows)
14. [Security](#security)
15. [Cost control](#cost-control)
16. [Troubleshooting](#troubleshooting)
17. [Project layout](#project-layout)

---

## What it does

| Flow | Detail |
|---|---|
| **Recognise a scene** | Camera, photo library, or a video clip. The AI vision stage reads the frame, the backend generates candidates, scores them against TMDB metadata, verifies the winner, and reports a calibrated confidence. |
| **Describe a scene** | Text-only identification, for when you remember the film but have no screenshot. |
| **Result** | Backdrop, poster, title, year, runtime, genres, cast, directors, confidence with margin, "Why this match" breakdown, and alternative candidates. |
| **Matched Scene** | Your image next to a genuinely matched reference frame — or an explicit statement that no frame-level reference exists. |
| **TV series** | Season picker, episode list, episode stills, and a season/episode result when it can be established. |
| **Where to Watch** | Region-aware, legal providers only, split into Stream / Rent / Buy. |
| **History** | On-device for anonymous users, synced to the account when signed in. |
| **Watchlist** | Movies, series and individual episodes. |
| **Search** | Titles, people and directors through TMDB, on the server. |

---

## Architecture

```mermaid
flowchart TD
    subgraph Device["📱 Device (Capacitor webview)"]
        UI["HTML + CSS + vanilla JS<br/>app/js/**, app/pages/**, app/css/**"]
        IMG["image.js<br/>validate · compress · perceptual hash · thumbnail"]
        VID["video.js<br/>extract frames on-device"]
        SEC["secureStore.js<br/>Keychain / Keystore"]
        UI --> IMG --> VID --> SEC
    end

    subgraph API["🖥️ Express API (backend/src)"]
        R["routes / controllers"]
        P["recognition/pipeline.js"]
        AI["integrations/ai<br/>vision provider"]
        TM["integrations/tmdb<br/>catalog provider"]
        ST["integrations/streaming<br/>availability provider"]
        M["recognition/matching<br/>8 scorers + verification + calibration"]
        SM["recognition/sceneMatcher<br/>perceptual-hash index"]
        R --> P
        P --> AI
        P --> SM
        P --> M
        M --> TM
        M --> ST
    end

    subgraph DB["🗄️ PostgreSQL (Prisma)"]
        T["users · recognitions · candidates<br/>catalog mirror · watchlist · fingerprints"]
    end

    UI -->|"REST + bearer token"| R
    P --> DB
    TM --> DB
    ST --> DB
```

Three provider boundaries exist so nothing is hard-wired to one vendor:

| Boundary | File | Implementations |
|---|---|---|
| Vision | `backend/src/integrations/ai/index.js` | `openai` (any OpenAI-compatible endpoint), `mock` |
| Catalog | `backend/src/integrations/tmdb/index.js` | `tmdb`, `mock` |
| Availability | `backend/src/integrations/streaming/index.js` | `tmdb`, `mock` (+ a documented slot for JustWatch/Watchmode) |

Adding a fourth streaming provider means writing one file that implements
`availability()` and registering it. No service, controller or app code changes.

---

## Quick start

Requires **Node.js 18+**. Nothing else — no database server, no Docker, no API keys.

```bash
npm install                 # installs backend + app workspaces

npm run db:dev:generate     # generate the Prisma client for the SQLite dev schema
npm run db:dev:push         # create prisma/dev.db with the full schema

cp .env.example .env        # Windows: copy .env.example .env

npm run dev                 # API on :8787 + app on :5173
```

Open **http://localhost:8787** — in development the API also serves the built app, so
everything runs on one origin with no CORS involved. (Or open
http://localhost:5173 for the standalone dev server with live rebuilds.)

You will see a **"Simulated result"** banner. That is correct: without an AI key the
vision stage cannot really analyse an image. See
[Enabling live providers](#enabling-live-providers).

### Individual commands

```bash
npm run dev:api         # backend only, with --watch
npm run dev:app         # app only: rebuilds on change + serves on :5173
npm run build           # production bundle into app/www
npm run test:api        # end-to-end API test suite (API must be running)
npm run db:studio       # Prisma Studio
```

---

## Environment variables

One file: `.env` at the repository root (copy `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | API port |
| `API_URL` | `http://localhost:8787` | Public API URL, used to build links |
| `DATABASE_URL` | `file:./dev.db` | `file:` for SQLite, `postgresql://…` for Postgres |
| `JWT_SECRET` | *(empty)* | **Required in production.** Ephemeral in dev |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `30d` | Token lifetimes |
| `AI_PROVIDER` | `mock` | `mock` or `openai` |
| `OPENAI_API_KEY` | *(empty)* | Real OpenAI server-side key for the vision provider |
| `OPENAI_MODEL` | `gpt-5.6-terra` | OpenAI multimodal model name |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible gateway |
| `AI_MAX_CALLS_PER_RECOGNITION` | `2` | Hard cap on paid calls per recognition |
| `TMDB_PROVIDER` | `mock` | `mock` or `tmdb` |
| `TMDB_ACCESS_TOKEN` | *(empty)* | TMDB v4 read token (preferred) |
| `TMDB_API_KEY` | *(empty)* | TMDB v3 key (alternative) |
| `STREAMING_PROVIDER` | `mock` | `mock` or `tmdb` |
| `MAX_IMAGE_BYTES` | `10485760` | Server-side upload cap |
| `MAX_VIDEO_DURATION_SECONDS` | `120` | Clip length limit |
| `MAX_VIDEO_FRAMES` | `6` | Frames sampled per clip |
| `CORS_ORIGINS` | local + Capacitor schemes | CORS allow-list |
| `RATE_LIMIT_MAX` / `RECOGNITION_RATE_LIMIT_MAX` | `120` / `20` | Requests per window |
| `SERVE_APP` | `true` | Serve `app/www` from the API in development |
| `SCENE_MATCHER` | `local` | `local` or `off` |

**No secret is ever exposed to the app.** `GET /api/meta/config` is hand-built and
returns capability flags, limits and region lists only — never a key. The API test
suite asserts this.

---

## Enabling live providers

### AI vision

CINZA uses the server-side OpenAI Responses API; the key never reaches the browser.

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6-terra
```

If the key is missing, or if the model call fails, the backend gracefully falls back
to the `mock` vision adapter and marks results as simulated. Switching back to mock
is as simple as:

```env
AI_PROVIDER=mock
```

### TMDB — https://www.themoviedb.org/settings/api

Create an account, request an API key, then use the **API Read Access Token** (the
long `eyJ…` string, not the 32-character key):

```env
TMDB_PROVIDER=tmdb
TMDB_ACCESS_TOKEN=eyJhbGciOi...
STREAMING_PROVIDER=tmdb
```

Restart the API. The boot log and the in-app **About** screen both report
`live`/`mock` per provider.

> TMDB requires attribution as a data source. Add their logo or the text
> "This product uses the TMDB API but is not endorsed or certified by TMDB" before
> shipping to a store.

---

## Database

Prisma, with **two schemas that differ only in the datasource provider**:

| File | Provider | Used for |
|---|---|---|
| `prisma/schema.prisma` | `postgresql` | Production. Canonical |
| `prisma/schema.dev.prisma` | `sqlite` | Local dev. **Generated** — do not edit |

`tools/gen-dev-schema.mjs` derives the SQLite schema from the canonical one by
swapping only the datasource block. For that to be valid, the canonical schema avoids
PostgreSQL-only features — no `enum`, no `String[]`, no `Json`, no `@db.*`. Structured
payloads are stored as strings and go through `backend/src/utils/json.js`. This is a
deliberate trade-off: it buys a zero-setup local database.

### Local (SQLite, no server)

```bash
npm run db:dev:generate && npm run db:dev:push
```

### Production (PostgreSQL)

```env
DATABASE_URL=postgresql://cinza:cinza@localhost:5432/cinza?schema=public
```

```bash
npm run db:generate
npm run db:migrate:dev      # create a migration during development
npm run db:migrate          # apply migrations in CI/production
```

Both schemas read the **same** `DATABASE_URL` variable, so switching environments is a
one-line change. If the generated client and the URL disagree, the API says so at
startup and prints the exact command to fix it.

### Models

`User`, `RefreshToken`, `PasswordResetToken`, `Recognition`, `RecognitionImage`,
`RecognitionCandidate`, `RecognitionFeedback`, `Movie`, `TVSeries`, `TVSeason`,
`TVEpisode`, `WatchlistItem`, `SearchHistory`, `StreamingAvailability`,
`FrameFingerprint`, `ApiCallMetric`, `RecognitionCache`.

---

## Backend

```bash
npm run dev:api                 # node --watch, development
npm --workspace backend start   # production start
```

On boot the API prints a capability table so there is never any doubt about what is
live and what is simulated:

```
INFO  boot CINZA API starting
WARN  ai   AI vision is running in MOCK mode — analyses are simulated…
INFO  boot   database   sqlite (file:./dev.db)
INFO  boot   ai         MOCK (set AI_PROVIDER + AI_API_KEY)
INFO  boot   tmdb       MOCK (set TMDB_PROVIDER + TMDB_ACCESS_TOKEN)
INFO  boot   database   connected (sqlite)
INFO  boot listening on http://localhost:8787
```

### Middleware order

`requestId → securityHeaders → cors → accessLog → bodyParsers → /api → static app → 404 → errorHandler`

Every error response is `{ error: { code, message, details? } }` with a
machine-readable `code` the app switches on.

---

## The app

The frontend is plain HTML, CSS and JavaScript — **no framework** — but it does have a
build step, for one specific reason: Capacitor plugins are npm packages with bare
specifiers (`@capacitor/camera`) that a browser cannot resolve. `app/build.mjs`
(esbuild) bundles `app/js/main.js` into `app/www/js/bundle.js` and copies the static
shell.

```
app/
  index.html            app shell + inline SVG icon sprite
  css/                  tokens · base · layout · components · animations · screens
  pages/                one HTML partial per screen
  components/           reusable HTML partials (poster card, banner, episode…)
  js/
    main.js             bootstrap
    config.js           API base resolution
    core/               router · store · dom · template · feedback · errors · format · cache
    services/           api · auth · secureStore · media · image · video · capture
                        recognition · history · watchlist · catalog · settings · capabilities
    screens/            home · camera · preview · result · detail · search · history
                        watchlist · profile · settings · about · auth
    ui/                 artwork · components
  www/                  build output (this is Capacitor's webDir)
```

### Development

```bash
npm run dev:app       # rebuild on change + serve on :5173
```

### Architecture notes worth knowing

- **Hash routing.** There is no server to rewrite paths on a `capacitor://` scheme, so
  `#/route/param` is the only form that survives a reload on all three platforms.
- **Templates live in HTML.** Screen partials are fetched once, cached as
  `<template>`, and filled with `{{placeholder}}` substitution that escapes
  unconditionally. API metadata can never inject markup.
- **`[hidden]` is forced to `display: none !important`.** Without it, a layout class
  like `.scanning { display: flex }` outranks the user-agent rule and the element both
  renders and swallows taps.
- **Images are processed on-device.** An 8 MB phone photo becomes ~250 KB, and the
  perceptual hashes can only be computed where the pixels are.

---

## API reference

`GET /api` returns the full route index. `GET /api/meta/config` returns capabilities.

### Meta

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api` | Route index |
| `GET` | `/api/meta/config` | Sanitised capabilities. **No secrets** |
| `GET` | `/api/meta/health` | `200` healthy, `503` degraded |
| `GET` | `/api/meta/metrics` | Calls, cache hit rates, timings |

### Auth

| Method | Path |
|---|---|
| `POST` | `/api/auth/register` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/refresh` |
| `POST` | `/api/auth/logout` · `/api/auth/logout-all` |
| `POST` | `/api/auth/forgot-password` · `/api/auth/reset-password` |
| `GET` | `/api/auth/me` · `/api/auth/settings` |
| `PATCH` | `/api/auth/profile` |
| `DELETE` | `/api/auth/account` |

### Recognition & history

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/recognitions` | multipart: `images[]`, `frame[]`, `video`, `meta` |
| `GET` | `/api/recognitions` | Capability probe |
| `GET` | `/api/recognitions/:id` | Owner only |
| `DELETE` | `/api/recognitions/:id` | |
| `GET` | `/api/history` · `/api/history/stats` | |
| `DELETE` | `/api/history` | Clear all |
| `POST` | `/api/feedback` | Confirm or correct |

### Catalog

| Method | Path |
|---|---|
| `GET` | `/api/search?q=&type=all\|movie\|tv\|person` |
| `GET` | `/api/search/recent` |
| `GET` | `/api/discover` |
| `GET` | `/api/movies/:id` · `/api/tv/:id` · `/api/tv/:id/seasons/:n` |
| `GET` | `/api/movie\|tv/:id/stills` |
| `GET` | `/api/movie\|tv/:id/availability?region=US` |
| `GET` | `/api/people/:id` |

### Watchlist

`GET /api/watchlist` · `POST /api/watchlist` · `GET /api/watchlist/check` ·
`DELETE /api/watchlist/:id` · `DELETE /api/watchlist` · `DELETE /api/watchlist/all`

---

## Running the tests

```bash
npm run dev:api        # terminal 1
npm run test:api       # terminal 2
```

`tools/api-smoke.mjs` runs **70 checks** against a live API with no mocking of our own
code. It generates a real PNG, uploads it, and asserts the full contract — including
that no secret appears in `/api/meta/config`, that uploaded bytes are not echoed back,
that one user cannot read another's recognition, and that a timestamp is never
invented.

```
Meta                      ✓ config leaks no secrets — clean
Auth                      ✓ refresh token reuse is rejected
Recognition               ✓ non-image bytes rejected by content sniffing
History                   ✓ another caller cannot read it — status 404
Watchlist                 ✓ watchlist requires auth
Privacy / deletion        ✓ deleted account cannot sign in

70/70 checks passed
```

---

## Building the native apps

The `android/` and `ios/` projects are **already generated and configured** —
permissions, usage descriptions, dark themes and bundle ids are in place. See
`capacitor/README.md` for what was changed and why.

> **Environment note.** This project was authored on Windows without a JDK, without
> the Android SDK and without macOS. Everything that can be prepared on any platform
> has been. Compiling needs the toolchain below.

### Android

**Requirements:** JDK 21, Android SDK (via Android Studio).

```bash
# one-time
winget install --id EclipseAdoptium.Temurin.21.JDK
winget install --id Google.AndroidStudio

# point Gradle at the SDK
# app/android/local.properties ->  sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk

npm run cap:sync            # build the web bundle + copy into the native projects
npm run android:build:debug # -> app/android/app/build/outputs/apk/debug/app-debug.apk
npm run android:build:release
npm run cap:open:android    # open Android Studio
npm run android:run         # build + install on a connected device
```

Debug output: `app/android/app/build/outputs/apk/debug/app-debug.apk`
Release AAB: `app/android/app/build/outputs/bundle/release/app-release.aab`

Release builds need a keystore — instructions and the Gradle snippet are in
`capacitor/README.md`. **Never commit a keystore.**

### iOS

**Requirements:** macOS with Xcode. Apple does not permit iOS builds on Windows or
Linux; the project is ready, but the compile step must happen on a Mac.

```bash
# on a Mac
npm install
npm run cap:sync
npm run cap:open:ios        # Xcode
npm run ios:build           # xcodebuild archive
```

Simulator: `npx cap run ios`.
Physical device and App Store: set a Team and enable automatic signing in Xcode
(`capacitor/README.md` has the details), then Product → Archive.

### Icons and splash

The generated projects currently use the **Capacitor default icon**, which is another
product's branding. Replace it before shipping:

```bash
npm i -D @capacitor/assets
# put a 1024x1024 icon-only.png and a 2732x2732 splash.png in app/assets/
npx capacitor-assets generate --android --ios
```

Export them from `app/assets/img/logo.svg` — a viewfinder frame around a three-blade
iris. Any image editor or a headless browser can rasterise it.

---

## How recognition actually works

```
validate (magic bytes, dimensions)         app/js/services/image.js + backend preprocess.js
      ↓
compress + hash on-device                  ~250 KB upload, aHash/dHash/pHash computed
      ↓
result cache lookup                        identical bytes never pay twice
      ↓
vision analysis                            structured JSON, zod-validated, repair-tolerant
      ↓
fingerprint lookup                         SceneMatcher: exact frame match, if indexed
      ↓
candidate generation                       up to 6 TMDB searches, rank-weighted
      ↓
pre-rank → top 8 → detail + credits        bounded expensive stage
      ↓
8 weighted scorers                         title, cast, characters, clues, year, genre,
                                           visible text, content type
      ↓
verification                               adversarial contradiction checks
      ↓
confidence calibration                     evidence + model self-report + margin
      ↓
scene resolution                           season/episode verified, reference frame
      ↓
persist + index fingerprints               only the thumbnail and hashes are stored
```

**Confidence bands.** `≥76%` strong · `56–76%` likely · `34–56%` uncertain ·
`<34%` reported as "could not identify" rather than shown as a guess.

**Exact scene matching** (section 31) is an index of frames *this deployment has
already confirmed* — not a worldwide frame database, and it says so in the app. The
first time a scene is identified there is nothing to match against; the second time it
matches instantly and for free. `backend/src/recognition/sceneMatcher/index.js`
documents exactly how to swap in image embeddings and pgvector without touching the
pipeline.

**Video** frames are extracted on-device with `<video>` + canvas, so no ffmpeg is
required. If ffmpeg *is* present the server detects it and accepts a raw upload too; if
it is absent the API reports that honestly instead of failing silently.

---

## Honesty rules this project follows

These are enforced in code, not just in documentation.

| Rule | Where it is enforced |
|---|---|
| A simulated result is always labelled | `isMock` travels end-to-end; the app renders a "Simulated result" banner; mock confidence is capped at 62% so it can never reach "strong" |
| A timestamp is never invented | `buildScene()` in `pipeline.js` sets `timestamp: null` with "Scene identified — exact timestamp unavailable."; the test suite asserts it |
| Availability is never fabricated | Only providers returned for the user's region are shown; an empty result renders "No legal viewing options found for your region." |
| A reference frame is never faked | The Matched Scene reference image comes only from a real fingerprint match; otherwise the app explains that no frame-level reference exists |
| Artwork is never invented | The mock catalog ships `poster_path: null`; the UI draws a generated placeholder rather than stock art |
| Buttons are never decorative | Video and describe features are gated on `/api/meta/config`; if the server cannot do it, the control is not rendered |
| Anonymous history is private | Anonymous recognitions have `userId = null` and are **404** through the API; they exist only on the device |
| No credential reaches the client | `publicConfig()` lists keys explicitly; the test suite asserts `/api/meta/config` leaks no secret-looking identifier |

---

## Security

- **Keys stay server-side.** The app never receives an AI, TMDB or streaming key.
- **Uploads are verified by content.** MIME types are re-derived from magic bytes;
  dimensions are read from headers, so a decompression bomb is rejected without being
  decoded. A `.jpg` that is really a script is rejected.
- **Nothing is written to disk.** `multer` uses memory storage; uploaded bytes live
  for one request. Only a small preview thumbnail and non-reversible hashes persist,
  and they are deleted with the history entry.
- **Auth.** bcrypt (cost 12), short-lived HS256 access tokens, opaque refresh tokens
  stored **hashed**, rotated on every use. Reuse of a rotated token revokes the whole
  session family. No cookies, therefore no CSRF surface.
- **No user enumeration.** Login and password reset return identical responses for
  known and unknown addresses, and login runs a dummy hash comparison so timing does
  not leak account existence either.
- **Headers and limits.** Helmet with a CSP that allow-lists only TMDB images, an
  explicit CORS allow-list including the Capacitor schemes, three tiered rate limits
  and zod validation on every mutating endpoint with unknown keys stripped.
- **Token storage.** iOS Keychain / Android EncryptedSharedPreferences when
  `capacitor-secure-storage-plugin` is installed; `@capacitor/preferences` (app-private
  but not encrypted) otherwise. The About screen reports which is in use.

---

## Cost control

| Mechanism | Effect |
|---|---|
| On-device compression | An 8 MB photo becomes ~250 KB — the largest single lever on vision cost |
| Result cache | Identical bytes return the cached answer; zero AI, zero TMDB |
| Vision cache | Same image + description never pays twice |
| Bounded candidate generation | Max 6 search queries per recognition |
| Two-pass matching | Details + credits fetched for only the top 8 candidates |
| TMDB TTL caches | Searches and details cached for 24h; availability for 6h |
| AI call budget | `AI_MAX_CALLS_PER_RECOGNITION` enforced by the adapter itself |
| Frame budgeting | Video analyses at most `AI_MAX_CALLS_PER_RECOGNITION + 1` frames |
| Persisted telemetry | `ApiCallMetric` rows record calls, status, duration and cache hits |
| Live metrics | `GET /api/meta/metrics` and Profile → About → "Show pipeline metrics" |

---

## Troubleshooting

**`npm.cmd` vs `npm` on Windows.** If PowerShell's execution policy is Restricted,
`npm.ps1` refuses to run. Use `npm.cmd`, or run
`Set-ExecutionPolicy -Scope Process Bypass`.

**"The generated Prisma client does not match DATABASE_URL."**
You changed `DATABASE_URL` without regenerating. Run the matching pair:
`npm run db:dev:generate && npm run db:dev:push` (SQLite) or
`npm run db:generate && npm run db:migrate:dev` (PostgreSQL). The API prints this hint
itself.

**"DATABASE_URL is not set" / tables missing.** `npm run db:dev:push` has not been
run, or you are in a different directory than the `.env` file (it must be at the
repository root).

**"SERVE_APP is on but no index.html was found."** The app has not been built:
`npm run build`.

**The app shows "Simulated result" on everything.** Correct and intentional — no AI
key is configured. See [Enabling live providers](#enabling-live-providers).

**"The CINZA server is not reachable."** The app resolved a different API base. Check
`GET /api/meta/config` in a browser, then Profile → Settings → "Change API endpoint" to
point the device at the right host. On a physical device, `localhost` refers to the
phone; use your machine's LAN IP and make sure the dev server is reachable on it.

**Posters are blank rectangles.** Expected without a TMDB key: the mock catalog ships
no artwork, so the app draws a generated placeholder with the title. With
`TMDB_PROVIDER=tmdb` real posters load.

**Video recognition says frames could not be extracted.** Some containers cannot be
decoded by a given webview (notably certain `.mkv` and HEVC variants). Try `.mp4`
(H.264) or shorten the clip.

**Android: `gradlew` fails with "A JDK is required".** Install JDK 21 and reopen the
terminal — `tools/gradle.mjs` detects this and prints the install command.

**Android: "No Android SDK configured".** Set `ANDROID_HOME`, or create
`app/android/local.properties` containing `sdk.dir=…`.

**iOS build fails on Windows.** Expected: iOS requires macOS and Xcode. The project is
generated and configured; move it to a Mac (see `capacitor/README.md`).

---

## Project layout

```
CINZA/
├── app/                        Capacitor application (HTML/CSS/vanilla JS)
│   ├── index.html              App shell + icon sprite
│   ├── build.mjs               esbuild bundler + dev static server
│   ├── capacitor.config.json   appId, webDir, plugin settings
│   ├── css/  pages/  components/  js/  assets/
│   ├── www/                    Build output (Capacitor webDir)
│   ├── android/                Generated Android project (configured)
│   └── ios/                    Generated Xcode project (configured)
├── backend/                    Express API
│   └── src/
│       ├── server.js  app.js
│       ├── config/             env loading + validation
│       ├── middleware/         auth, upload, validation, rate limits, errors
│       ├── routes/  controllers/
│       ├── services/           auth, recognition, watchlist, catalog, metrics
│       ├── integrations/       ai/, tmdb/, streaming/  (each with a mock adapter)
│       ├── recognition/        pipeline, preprocessing, matching, sceneMatcher
│       ├── database/           Prisma client, repositories, constants
│       └── utils/              logger, errors, cache, similarity, image probe
├── prisma/
│   ├── schema.prisma           Canonical (PostgreSQL)
│   └── schema.dev.prisma       Generated (SQLite)
├── capacitor/README.md         Native edits explained
├── tools/                      dev + build + test scripts
├── .env.example
└── README.md
```

---

## Credits

Movie and TV metadata by [TMDB](https://www.themoviedb.org). Region-aware availability
is derived from TMDB's watch-provider data, which is provided by
[JustWatch](https://www.justwatch.com).

CINZA is not endorsed or certified by TMDB.
