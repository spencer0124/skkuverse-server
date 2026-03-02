# Pre-Production Refactoring Plan

## Context

The codebase was recently refactored (response format standardization, module extraction, pure functions, caching). This plan addresses remaining issues found during a full-codebase audit — security gaps, dead code, code smells, and missing infrastructure — before new features are added or the app goes to production.

---

## Step 1: Security Middleware + Firebase Auth + Rate Limiting (P0) — DONE

**Problem**: Zero security middleware. No helmet or rate limiting. Campus users share the same university WiFi IP, so IP-based rate limiting won't work — need per-user (uid) rate limiting via Firebase Anonymous Auth.

### 1a. Helmet + Base Setup
- **Installed**: `helmet`, `express-rate-limit`, `firebase-admin`
- **`index.js:18`**: `app.use(helmet())` before `express.json()`
- No CORS — Flutter native apps don't need it (browser-only policy)

### 1b. Firebase Auth Middleware
- **`lib/firebase.js`** (new): Conditional init — only when `serviceAccount` is set AND not in test mode (`config.isTest`). Prevents Admin SDK initialization in Jest and unconfigured environments.
- **`lib/authMiddleware.js`** (new): Token verification middleware
  - Extracts `idToken` from `Authorization: Bearer <token>` header
  - Verifies via `admin.auth().verifyIdToken(idToken)`, sets `req.uid`
  - Caches verified tokens in a Map with 5-minute TTL (avoids Firebase HTTP call per request)
  - **Lazy config check**: `if (!config.firebase.serviceAccount)` evaluated per-request, not at module load time — required for Jest mock compatibility
  - **Fallback**: No token → pass through (rate limiter falls back to `req.ip`). No Firebase configured → pass through silently.
- **`lib/config.js:63-65`**: `firebase.serviceAccount` from `process.env.FIREBASE_SERVICE_ACCOUNT`
- **`.env`**: `FIREBASE_SERVICE_ACCOUNT` set (project: `skkubus-95723`)

### 1c. Uid-Based Rate Limiting
- **`index.js:28-35`**: `searchLimiter` — 60 req/min per uid
- **`ad.routes.js:8-15`**: `eventLimiter` — 120 req/min per uid (scoped to POST `/events`)
- **Key generator**: `req.uid || ipKeyGenerator(req.ip)` — uses `ipKeyGenerator()` wrapper for IPv6 safety (express-rate-limit v7+ requirement, raw `req.ip` throws `ERR_ERL_KEY_GEN_IPV6`)
- **Route middleware order**: `verifyToken` → rate limiter → route handler
  - `/search/*`: `verifyToken` + `searchLimiter` (`index.js:44`)
  - `/ad/*`: `verifyToken` (`index.js:50`) + `eventLimiter` on POST only (`ad.routes.js:37`)
- Health check and Swagger remain unprotected

### 1d. Input Validation
- **`ad.routes.js:55`**: `adId` regex `/^[0-9a-fA-F]{24}$/` — rejects before `recordEvent()` call
- **`search.building-detail.js:8`**: `/^[A-Za-z0-9_-]+$/` for `buildNo` and `id` — returns empty result on failure (matches existing error shape)
- **`ad.routes.js:41-51`**: `placement` required, `event` must be `view` or `click`
- Removed unused `getStats` import from `ad.routes.js` (pulled forward from Step 3)

### 1e. Tests — 10 tests in `__tests__/security.test.js`
- **Ad event validation** (5): invalid adId → 400, valid adId → 200, auto-match adId from placement, missing placement → 400, invalid event type → 400
- **Auth middleware** (3): no token → 200 passthrough, invalid token → 401, valid token → 200
- **Search validation** (2): special chars (`%26`, `%3D`) → empty result (not crash), valid alphanumeric → 200
- Firebase mock added to `route-responses.test.js:44` and `static-endpoints.test.js:50` (required since `index.js` now imports `authMiddleware`)
- Config mock with `jest.requireActual` spread — overrides only `firebase` block

### 1f. Flutter Client (companion app)
- **`lib/app/utils/api_fetch/api_client.dart`** (new): Singleton HTTP client with Firebase Anonymous Auth
  - `ensureAuth()`: calls `FirebaseAuth.instance.signInAnonymously()` if no current user
  - `_authHeaders()`: attaches `Authorization: Bearer <idToken>` to all requests, graceful fallback on failure
  - `get()` / `post()`: wraps `http.get()`/`http.post()` with auth headers
- **`lib/main.dart:49`**: `await apiClient.ensureAuth()` after `Firebase.initializeApp()`
- **6 fetch files migrated** from `http.get()`/`http.post()` to `apiClient.get()`/`apiClient.post()`:
  - `fetch_ad.dart`, `bus_location.dart`, `fetch_station.dart`, `bus_stationlist.dart`, `mainpage_buslist.dart`, `search_option3.dart`

### Verification
- `npm test` → 127/127 passed (11 suites, 1.0s)
- Coverage: 73.3% stmts, 65.9% branches, 65.6% funcs, 74.5% lines

---

## Step 2: Health Check + Docker Hardening (P0) — DONE

**Problem**: No health endpoint for container orchestration. Dockerfile runs as root.

### 2a. Health Endpoint
- **`index.js:27-30`**: `GET /health` returning `{ status: "ok", uptime: process.uptime() }`. Placed before auth/rate-limiting. Simple liveness check only — no DB ping. A `GET /health/ready` (readiness with DB ping) can be added later if needed for K8s-style orchestration.

### 2b. Dockerfile Hardening
- **`Dockerfile`**: `COPY --chown=node:node . .` + `USER node` (non-root) + `HEALTHCHECK` using `wget --spider` to `/health` (30s interval, 5s timeout, 10s start period, 3 retries)
- Note: `node_modules` stays root-owned (installed before `USER node`). Read access is sufficient for current deps. If a package needs runtime write to `node_modules`, this could cause permission issues.

### 2c. Docker Compose
- **`docker-compose.yml`**: Added matching `healthcheck` block

### 2d. Test
- **`__tests__/route-responses.test.js`**: Health check test — asserts 200 status, `status: "ok"`, `uptime` is number

### Verification
- `npm test` → 128/128 passed (11 suites, 1.1s)

---

## Step 3: Remove Dead Code (P1) — DONE

**Problem**: Unused dependency `cron` in package.json. ~~Unused `getStats` import in ad routes.~~ (done in Step 1)

**Changes**:

- **`package.json`**: Removed `cron` (zero imports anywhere). Moved `node-cron` to `devDependencies` (only used by `scripts/collect-api-data.js:2`, a dev-time fixture collector). Production polling uses `setInterval` via `lib/pollers.js`, not cron.
- ~~**`features/ad/ad.routes.js`**: Remove unused `getStats`~~ — already done in Step 1
- `npm install` regenerated lock file (removed 3 packages)

### Verification
- `npm test` → 128/128 passed

---

## Step 4: Hoist `require()` Calls to Module Level (P1) — DONE

**Problem**: Three fetcher files called `require("moment-timezone")` and `require("../../lib/config")` inside async functions / poller callbacks. This obscures the dependency graph.

**Changes** (moved `require` to top of each file, deleted inline `require`):

- **`jongro.fetcher.js`**: Hoisted `moment-timezone` and `config` to top-level imports; removed inline requires from `updateJongroBusLocation` and poller callback
- **`hssc.fetcher.js`**: Hoisted `config` and `moment-timezone` to top-level imports; removed inline requires from `updateHSSCBusList`
- **`station.fetcher.js`**: Hoisted `config` to top-level import; removed inline require from `updateStation`

### Verification
- `npm test` → 128/128 passed

---

## Step 5: Fix Mutable Array Pattern in Jongro Fetcher (P1) — DONE

**Problem**: `jongro.fetcher.js` used `.length = 0` + `.forEach(push)` to update shared arrays. This exposed a window where readers see an empty array mid-update.

**Changes** in **`features/bus/jongro.fetcher.js`**:

- `updateJongroBusLocation`: Replaced `.length = 0` + `.forEach(push)` with `.map()` → atomic reassignment (`filteredBusLocations[busnumber] = newArray`). Hoisted `currentBusStationTimes` ref outside the loop. Removed now-unnecessary empty-array guard.
- `updateJongroBusList`: Same pattern — `.map()` with direct assignment to `filteredBusStations[busnumber]`. Removed empty-array guard.

### Verification
- `npm test` → 128/128 passed

---

## Step 6: Infrastructure Improvements (P2) — DONE

### 6a. ESLint
- **Installed**: `eslint` (^10.0.2), `@eslint/js` (^10.0.1) as devDependencies
- **`eslint.config.js`** (new): Flat config with `recommended` rules, Node.js globals, Jest globals for `__tests__/`, `no-unused-vars` as warning (ignores `_` and `next` prefixed args), ignores `node_modules/`, `coverage/`, `swagger-output.json`
- **`package.json`**: Added `"lint": "eslint ."`
- Result: 0 errors, 4 warnings (all `no-unused-vars` — existing code, not from this refactor)

### 6b. `.dockerignore` completeness
- Added: `coverage/`, `__tests__/`, `__fixtures__/`, `jest.config.js`, `eslint.config.js`, `*.md`, `.claude/`, `swagger/swagger.js` (keeps `swagger-output.json` for runtime)

### 6c. Jest coverage thresholds
- **`jest.config.js`**: Added `coverageThreshold.global` — branches: 50, functions: 60, lines: 65, statements: 65 (floor below current ~73/66/66/74% to prevent regression)

### 6d. Swagger server URL
- **`swagger/swagger.js`**: `process.env.SWAGGER_SERVER_URL || "http://localhost:3000"`

### Verification
- `npm run lint` → 0 errors, 4 warnings
- `npm test` → 128/128 passed, coverage thresholds met

---

## Step 7: Document Response Key Exceptions in CLAUDE.md — DONE (SUPERSEDED)

> **Note**: The response format exceptions documented here (`placements`, `stationData`, bare POST response) were eliminated in the API v2 migration. All endpoints now use the standardized `{ meta, data }` envelope. See `docs/api-migration-v2.md` for the current API contract.

---

## Files Modified (by step)

| Step | Server Files | Flutter Files (skkumap) |
|------|-------------|------------------------|
| 1 (DONE) | `index.js`, `lib/firebase.js` (new), `lib/authMiddleware.js` (new), `lib/config.js`, `features/ad/ad.routes.js`, `features/search/search.building-detail.js`, `__tests__/security.test.js` (new), `__tests__/route-responses.test.js`, `__tests__/static-endpoints.test.js` | `lib/app/utils/api_fetch/api_client.dart` (new), `lib/main.dart`, `lib/app/utils/api_fetch/fetch_ad.dart`, `lib/app/utils/api_fetch/bus_location.dart`, `lib/app/utils/api_fetch/fetch_station.dart`, `lib/app/utils/api_fetch/bus_stationlist.dart`, `lib/app/utils/api_fetch/mainpage_buslist.dart`, `lib/app/utils/api_fetch/search_option3.dart` |
| 2 | `index.js`, `Dockerfile`, `docker-compose.yml`, `__tests__/route-responses.test.js` | — |
| 3 | `package.json`, `package-lock.json` | — |
| 4 | `features/bus/jongro.fetcher.js`, `features/bus/hssc.fetcher.js`, `features/station/station.fetcher.js` | — |
| 5 | `features/bus/jongro.fetcher.js` | — |
| 6 | `eslint.config.js` (new), `.dockerignore`, `jest.config.js`, `swagger/swagger.js`, `package.json` | — |
| 7 | `CLAUDE.md` | — |

## Verification

After all steps:
1. `npm test` — 128/128 passed (11 suites), coverage thresholds met
2. `npm run lint` — 0 errors, 4 warnings (all pre-existing `no-unused-vars`)
3. `npm run dev` — server starts, `GET /health` returns 200
4. `docker compose up --build` — container starts healthy, HEALTHCHECK passes
