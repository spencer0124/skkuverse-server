# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Development mode (dev DB + dev API, with nodemon)
- `npm run dev:prod-api` — Staging check mode (dev DB + prod API, with nodemon)
- `npm start` — Start the server (NODE_ENV should be set externally)
- `npm test` — Run Jest tests with coverage
- `npx jest __tests__/hssc-transform.test.js` — Run a single test file
- `npm run swagger` — Regenerate Swagger docs (`swagger/swagger-output.json`)
- `npm run lint` — Run ESLint (0 errors AND 0 warnings expected; pre-TS strict rules include `eqeqeq`/`no-var`/`prefer-const`/`curly`/`no-shadow`/`no-throw-literal`/`no-useless-concat` + `no-unused-vars: error`). Enforced by CI (`.github/workflows/ci.yml`) and the `~/.claude/hooks/skkuverse-gate.sh` Stop hook.
- `npm run knip` — Audit unused files + dependencies (exports check off; see `knip.json`)
- `npm run depcheck` — Audit unused npm dependencies (with curated ignore list for dynamic loaders)
- `docker compose up --build` — Build and run via Docker (NODE_ENV=production, 3 services: poller + api-1:3001 + api-2:3002)

## Dependency Policy

All deps/devDeps are pinned to exact versions in `package.json` (no `^`/`~`). `.npmrc` enforces `save-exact=true` + `engine-strict=true`. Pre-TS-migration lock to avoid mixing dep upgrades with TS conversion. Update single package per PR (`npm install foo@X.Y.Z`), confirm `npm test`/`lint`/`knip`/`depcheck`. Express 5 migration deferred to post-TS as single dedicated PR (currently locked at 4.22.2). See `docs/project-docs.md §14`.

**Node runtime: 22 LTS (`.nvmrc` 참고).** `engines.node` ≥22 + `engine-strict=true`로 자동 차단. Node 20 LTS는 2026-04-30 EOL이라 사용 금지. Node 24는 macOS+OpenSSL 3.4 영향으로 일부 TLS 시나리오 회귀 보고(예: [nodejs/node#61448](https://github.com/nodejs/node/issues/61448)) — Atlas 등 외부 TLS 의존 환경에서 검증 부족, 사용 금지. nvm 사용 시 프로젝트 디렉토리에서 `nvm use` 한 번으로 자동 정렬.

## Ecosystem

This server is one node in the skkuverse ecosystem. Sibling repos under `~/project/skkuverse/`:

- **`skkuverse-app`** — React Native + Expo + TypeScript mobile client. Calls this server over HTTPS with Firebase `Bearer <idToken>`. Talks to Firebase Firestore directly for user state.
- **`skkuverse-crawler`** — Python crawler. Owns writes to the `notices` MongoDB collection (this server reads). Calls `skkuverse-ai` per article and POSTs to this server's `/internal/notices` endpoint at cycle end to trigger FCM dispatch.
- **`skkuverse-ai`** — FastAPI summarizer. Called by the crawler (not by this server). Populates `summary*` fields on notice docs.
- **`skkuverse-codepush`** — Expo OTA update server (`ota.skkuverse.com`). Independent of this server.

Push notifications: this server only **triggers** FCM via a deployed Cloud Function (`FCM_FUNCTION_URL`). The Cloud Function reads device tokens from Firestore and sends FCM v1.

## Architecture

Express API server for SKKU (Sungkyunkwan University) campus. Serves real-time bus locations, campus shuttle schedules, building search, station arrival info, map config, server-driven UI, ad management, and notice aggregation/dispatch.

### Directory Layout

- `index.js` — Entry point: mounts routes, initializes indexes/seed/poller-registrations, starts pollers, handles graceful shutdown (5s force-exit safety net)
- `lib/` — Shared infrastructure (config, db, pollers, asyncHandler, responseHelper, langMiddleware, authMiddleware, i18n, firebase, logger, busCache)
- `features/` — Feature modules. Current set: `ad/`, `app/`, `building/`, `bus/`, `map/`, `notices/`, `search/`, `station/`, `ui/`
- `__tests__/` — Jest integration and unit tests (mocked externals)
- `docs/` — Architecture decisions and runbooks. `docs/archive/` holds dated incident reports.
- `swagger/` — Swagger autogen config and generated OpenAPI spec
- `scripts/` — One-off migration and data-collection utilities
- `infra/nginx/` — Nginx site configs deployed to the Oracle VM by CI/CD

### Feature Module Pattern

Each feature in `features/` follows: `{name}.routes.js` (Express router), `{name}.fetcher.js` (background data polling), `{name}.data.js` or `{name}.stations.js` (static data/DB access). Poller registration is a side effect of `require()`-ing the fetcher.

Route prefixes are mounted in `index.js`: `/search`, `/bus/realtime`, `/bus/station`, `/bus/campus`, `/bus/schedule`, `/bus/config`, `/bus/route`, `/ui`, `/ad`, `/app`, `/map/config`, `/map/markers`, `/map/overlays`, `/building`, `/notices`, `/internal/notices`.

### Notices Feature (`features/notices/`)

Client endpoints under `/notices`:

- `GET /notices/tabs` — server-driven tab configuration (per-language, cached 1 hr)
- `GET /notices/source/:sourceId` — single-source list with cursor pagination
- `GET /notices` — multi-source merged list (`?sourceIds=cs,sw&...`)
- `GET /notices/:sourceId/:articleNo` — detail
- `GET /notices/proxy/attachment` — file proxy (Referer bypass)

Internal endpoint under `/internal/notices` (no Firebase auth; protected by `X-Internal-Token` shared secret):

- Called by `skkuverse-crawler` at the end of each cycle to trigger FCM dispatch.

Key modules:

- **`tabConfig.js`** — Loads `sources.json` (147 departments) and `categories.json` (9 tab definitions). Fail-fast validation at startup (`process.exit(1)` on bad JSON). Pre-computes per-language responses with `Object.freeze`. Tagged payload pattern: `tabMode: "fixed"` → `fixed: { sourceId, name, campus }`; `tabMode: "picker"` → `picker: { sources, maxSelection, defaultSourceIds }`.
- **`notices.data.js`** — Read-only Mongo access with forced index hint (`{ sourceId: 1, date: -1, crawledAt: -1, _id: -1 }`) to defend against an orphan 2-key index on prod.
- **`notices.dispatcher.js`** — Claim-lease FCM dispatch. Calls the deployed Cloud Function (`FCM_FUNCTION_URL` + `FCM_API_KEY`). `pushAttempts $not: $gte` filter caps retries at `maxAttempts` (default 5). 5-minute claim lease via Mongo `claimedAt`. `sweepPending(triggerSource, opts = {})` and `claimNext(col, now, opts = {})` accept `{...config.notices.dispatch, ...opts}`-merged overrides so tests can shrink `sweepBatchCap`/`maxAttempts` without mutating the shared config — prod callers (`notices.internal.routes.js`, `notices.dispatch.poller.js`) pass no opts and behave unchanged. dispatchOne has a catch-handler-as-fallback invariant (try-side `updateOne` failure bounces into catch's lease-release `updateOne`, absorbing one DB error as `{result: "failed"}` rather than propagating) — pinned by tests in `__tests__/notices-dispatch.test.js`.
- **`notices.dispatch.poller.js`** — Safety-net cron sweep (default 30 min interval, env-gated). Primary trigger remains the crawler ping.
- **`notices.internal.routes.js`** — Receives the crawler's cycle-end POST and kicks off `sweepPending`.

Architecture doc: `docs/notices-api-architecture.md`.

### Background Polling System

`lib/pollers.js` provides a registry for background fetchers. Fetchers call external APIs on intervals (HSSC: 10s, Jongro/Station: 15s), cache results in memory + mirror to the `bus_cache` MongoDB collection, and expose getter functions to route handlers. Pollers start on boot, stop on SIGTERM/SIGINT, and an in-flight guard prevents overlapping runs of the same fetcher. Poller fn rejections are caught + logged via `Promise.resolve(fn()).catch(...).finally(...)` so a single failing tick can't leak as an unhandled rejection and crash the process under Node 22+'s default `--unhandled-rejections=throw`.

### Multi-Container Topology (`ROLE` env var)

`docker-compose.yml` runs three services backed by the same image:

- `ROLE=poller` — polls external APIs and writes to `bus_cache`. No HTTP listener.
- `ROLE=api` (api-1: 3001, api-2: 3002) — serves HTTP from `bus_cache`. Skips poller startup so two replicas can scale horizontally without duplicate polls.
- `ROLE=combined` (default for single-container / local) — runs both poller and HTTP in one process.

`/health/ready` returns 503 unless DB ping succeeds AND (`role === "api"` OR pollers are running).

### Key Patterns

- **asyncHandler** (`lib/asyncHandler.js`): Wraps all async route handlers to forward errors to Express error middleware. Always use this for new routes.
- **Config** (`lib/config.js`): Centralized env var loading with environment separation. `NODE_ENV` controls DB suffix (`_dev`/`_test`/none), `USE_PROD_API` controls API endpoint selection independently. Required values are validated at startup — missing any one causes `process.exit(1)` (skipped in test mode). No silent defaults. Same fail-fast pattern is used by `features/notices/tabConfig.js` for JSON config validation.
- **MongoDB singleton** (`lib/db.js`): Lazy-initialized MongoClient via `getClient()`. Closed on shutdown via `closeClient()`.
- **Response format**: All endpoints use a standardized envelope: `{ meta: { lang, ... }, data: { ... } or [ ... ] }`. Errors return `{ error: { code, message } }`. Response helpers `res.success(data, meta)` and `res.error(statusCode, code, message)` are attached by `lib/responseHelper.js` middleware. Route handlers must never call `res.json(...)` directly.
- **Language middleware** (`lib/langMiddleware.js`): Parses `Accept-Language` header, sets `req.lang` (ko/en/zh, default: ko). Auto-injected into `meta.lang` by `res.success()`.
- **Auth middleware** (`lib/authMiddleware.js`): Verifies Firebase `Bearer <idToken>` when present, sets `req.uid`. Pass-through when no token or Firebase is not configured. 5-min token cache, capped at 10k entries.
- **i18n** (`lib/i18n.js`): Translation map `t(key, lang)` for server-generated text (SDUI titles, subtitles). Korean is default.
- **Observability**: pino-http generates `X-Request-Id` (UUID) per request, logs `appVersion` and `platform` from client headers. `X-Response-Time` header set by `responseHelper`.
- **Timezone**: All date/time logic uses `moment-timezone` with `Asia/Seoul`.

### Ad System

MongoDB-backed ad management in `features/ad/`. Ads are per-placement (splash, main_banner, main_notice, bus_bottom).

- `ad.data.js`: CRUD with in-memory cache (60s TTL), `ensureIndexes()`, `seedIfEmpty()` for default ads
- `ad.stats.js`: Event recording (impression/click) and aggregation queries via `ad_events` collection
- `ad.routes.js`: `/ad/placements` (GET), `/ad/events` (POST)
- Uses dedicated DB (`config.ad.dbName`): `skkubus_ads` in production, `skkubus_ads_dev` in development

### Environment Separation

`lib/config.js` supports 3 operational modes via two independent flags:

| Mode          | NODE_ENV    | USE_PROD_API | DB suffix | API               |
| ------------- | ----------- | ------------ | --------- | ----------------- |
| Development   | development | (unset)      | `_dev`    | `_DEV` endpoints  |
| Staging check | development | true         | `_dev`    | `_PROD` endpoints |
| Production    | production  | forced true  | none      | `_PROD` endpoints |

- `devDbName()`: Appends `_dev`/`_test` to DB names. INJA/JAIN schedule collections are exempt (read-only shared data).
- `apiUrl()`: Selects `_DEV` or `_PROD` env var with automatic fallback to `_PROD` if `_DEV` is missing.
- Docker always runs as production (`docker-compose.yml` sets `NODE_ENV=production`).

### Testing

Tests mock external dependencies (axios, MongoDB, pollers) so no real API calls or DB connections are needed. Uses `jest.mock()` / `jest.doMock()` before `require()` to inject mocks. Test fixtures live in `__fixtures__/` (gitignored, generated by `scripts/collect-api-data.js`).

**Shared mock factories** live in `__tests__/helpers/` (excluded from `testPathIgnorePatterns` + `coveragePathIgnorePatterns` in `jest.config.js`):

- `helpers/mocks/firebase.js`, `adData.js`, `adStats.js`, `busCache.js`, `busSchedule.js` — factory functions returning fresh mock objects per `jest.mock` invocation; callers pass optional overrides (e.g., `placements`, `uid`) for per-file variations.
- `helpers/miniApp.js` — minimal Express app builder for supertest files that don't want to mount the full `../index` (which would force 6+ jest.mock blocks). Used by `notices-dispatch.test.js` (`injectLangMeta: false`) and `building-routes.test.js` (langMiddleware + meta envelope).

Pattern: `jest.mock("../lib/firebase", () => require("./helpers/mocks/firebase")())`. TS migration will type each helper once via `jest.Mocked<typeof X>` — single point of truth replaces N copies.

**Coverage thresholds** (`jest.config.js`): branches 60 / functions 70 / lines 75 / statements 75. CI and Stop hook both run `npm test`; threshold violations block merge.

### Environment Variables

Required at startup (missing → `process.exit(1)`, see `lib/config.js`):

- **MongoDB**: `MONGO_URL`, `MONGO_DB_NAME_BUS_CAMPUS`, `MONGO_BUILDING_DB_NAME`, `MONGO_AD_DB_NAME`, `MONGO_NOTICES_DB_NAME`, `MONGO_DB_NAME_INJA_*`, `MONGO_DB_NAME_JAIN_*`
- **External bus APIs**: `API_HSSC_NEW_PROD` (+ `_DEV`), `API_JONGRO0[27]_LIST_PROD` (+ `_DEV`), `API_JONGRO0[27]_LOC_PROD` (+ `_DEV`), `API_STATION_HEWA`
- **Naver Maps**: `NAVER_API_KEY_ID`, `NAVER_API_KEY`, `NAVER_MAP_STYLE_ID`
- **Notices dispatch**: `NOTICES_SERVICE_START_DATE`, `FCM_FUNCTION_URL`, `FCM_API_KEY`, `INTERNAL_DISPATCH_TOKEN`

Optional:

- **Firebase**: `FIREBASE_SERVICE_ACCOUNT` (omit → auth pass-through)
- **App version gate**: `APP_IOS_MIN_VERSION`, `APP_IOS_UPDATE_URL`, `APP_ANDROID_MIN_VERSION`, `APP_ANDROID_UPDATE_URL`
- **Tuning**: `BUILDING_SYNC_INTERVAL_MS`, `NOTICES_DISPATCH_SWEEP_MS`, `MONGO_AD_COLLECTION`, `MONGO_AD_EVENTS_COLLECTION`, `MONGO_CACHE_COLLECTION`, `MONGO_NOTICES_COLLECTION`

Set per execution context (CLI/Docker), not in `.env`: `NODE_ENV`, `USE_PROD_API`, `ROLE`, `PORT`.
