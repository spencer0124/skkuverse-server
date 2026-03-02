# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Development mode (dev DB + dev API, with nodemon)
- `npm run dev:prod-api` — Staging check mode (dev DB + prod API, with nodemon)
- `npm start` — Start the server (NODE_ENV should be set externally)
- `npm test` — Run Jest tests with coverage
- `npx jest __tests__/hssc-transform.test.js` — Run a single test file
- `npm run swagger` — Regenerate Swagger docs (`swagger/swagger-output.json`)
- `npm run lint` — Run ESLint (0 errors expected, warnings OK)
- `docker compose up --build` — Build and run via Docker (NODE_ENV=production, 3 services: poller + api-1:3001 + api-2:3002)

## App

flutter project using this server is located in /project/skkumap

## Architecture

Express API server for SKKU (Sungkyunkwan University) campus map. Serves real-time bus locations, campus shuttle schedules, building search, station arrival info, and ad management.

### Directory Layout

- `index.js` — Entry point: mounts routes, initializes ad system, starts pollers, prints startup banner, handles graceful shutdown
- `lib/` — Shared infrastructure (config, db, pollers, asyncHandler, responseHelper, langMiddleware, i18n)
- `features/` — Feature modules, each with routes + data/fetcher files
- `__tests__/` — Jest integration and unit tests (mocked externals)
- `swagger/` — Swagger autogen config and generated OpenAPI spec
- `scripts/` — Data collection utilities

### Feature Module Pattern

Each feature in `features/` follows: `{name}.routes.js` (Express router), `{name}.fetcher.js` (background data polling), `{name}.data.js` or `{name}.stations.js` (static data/DB access).

Route modules are mounted in `index.js` at their path prefix (e.g., `/bus/hssc`, `/search`, `/station`, `/ui`, `/app`).

### Background Polling System

`lib/pollers.js` provides a registry for background fetchers. Fetchers call external APIs on intervals (HSSC: 10s, Jongro/Station: 15s), cache results in memory, and expose getter functions to route handlers. Pollers start on server boot and stop on SIGTERM/SIGINT.

### Key Patterns

- **asyncHandler** (`lib/asyncHandler.js`): Wraps all async route handlers to forward errors to Express error middleware. Always use this for new routes.
- **Config** (`lib/config.js`): Centralized env var loading with environment separation. `NODE_ENV` controls DB suffix (`_dev`/`_test`/none), `USE_PROD_API` controls API endpoint selection independently. Required values validated at startup (process.exit(1) if missing, skipped in test mode).
- **MongoDB singleton** (`lib/db.js`): Lazy-initialized MongoClient via `getClient()`. Closed on shutdown via `closeClient()`.
- **Response format**: All endpoints use a standardized envelope: `{ meta: { lang, ... }, data: { ... } or [ ... ] }`. Errors return `{ error: { code, message } }`. Response helpers `res.success(data, meta)` and `res.error(statusCode, code, message)` are attached by `lib/responseHelper.js` middleware.
- **Language middleware** (`lib/langMiddleware.js`): Parses `Accept-Language` header, sets `req.lang` (ko/en/zh, default: ko). Auto-injected into `meta.lang` by `res.success()`.
- **i18n** (`lib/i18n.js`): Translation map `t(key, lang)` for server-generated text (SDUI titles, subtitles). Korean is default.
- **Observability**: pino-http generates `X-Request-Id` (UUID) per request, logs `appVersion` and `platform` from client headers. `X-Response-Time` header set by responseHelper.
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

Tests mock external dependencies (axios, MongoDB, pollers) so no real API calls or DB connections are needed. Uses `jest.doMock()` before `require()` to inject mocks. Test fixtures live in `__fixtures__/` (gitignored, generated by `scripts/collect-api-data.js`).

### Environment Variables

Requires `.env` with: MongoDB connection (`MONGO_URL`, `MONGO_DB_NAME_*`, `MONGO_AD_DB_NAME`), bus API endpoints (`API_HSSC_*_PROD`, `API_HSSC_*_DEV`, `API_JONGRO*_PROD`, `API_JONGRO*_DEV`, `API_STATION_*`), Firebase credentials (`FIREBASE_SERVICE_ACCOUNT`), and app config (`APP_IOS_MIN_VERSION`, `APP_IOS_LATEST_VERSION`, `APP_IOS_UPDATE_URL`, `APP_ANDROID_*` equivalents). See `lib/config.js` for the full list. `NODE_ENV` and `USE_PROD_API` are set per execution context (CLI/Docker), not in `.env`.
