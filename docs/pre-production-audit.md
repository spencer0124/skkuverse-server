# Pre-Production Audit

## Context

Full-codebase audit before deploying to production. Steps 1-7 of production-ready.md are complete. This document tracks remaining issues found during the audit, categorized by severity.

---

## P0 — MUST FIX (blocks production)

### 1. `npm audit fix` — 10 CVEs (6 high)

**Problem**: `axios` (^1.6.8) has SSRF + DoS CVEs. `express` (^4.18.3) has vulnerable transitive deps (body-parser, qs, path-to-regexp ReDoS, cookie, send XSS). All fixable via `npm audit fix`.

**Status**: DONE
- `npm audit fix` upgraded 17 packages: axios ^1.6.8 → ^1.9.0, express ^4.18.3 → ^4.21.3, plus transitive deps
- `npm audit` → 0 vulnerabilities
- `npm test` → 128/128 passed

---

### 2. Token cache unbounded growth

**Problem**: `lib/authMiddleware.js:4` — `tokenCache` Map grows forever. Expired entries are checked on read (line 28) but never deleted. Slow memory leak under sustained traffic.

**Status**: DONE
- Added `MAX_CACHE_SIZE = 10000` — clears entire cache when limit reached (simple, avoids LRU complexity)
- Added `setInterval` cleanup every 5 minutes — evicts expired entries proactively
- `.unref()` on interval so it doesn't block process exit
- Added 2 tests in `security.test.js` (cache hit verification, size cap)
- `npm test` → 130/130 passed

---

### 3. No axios timeout on fetchers

**Problem**: All `axios.get()` calls lack timeout. If an external API hangs, the fetcher hangs forever, pollers queue up, memory grows.

Files: `hssc.fetcher.js:37`, `jongro.fetcher.js:20,71`, `station.fetcher.js:9`, `search.space.js:27`, `search.building.js:34`, `search.building-detail.js:13`

**Status**: DONE
- Added `{ timeout: 10000 }` (10 seconds) to all 7 `axios.get()` calls
- Files: `hssc.fetcher.js`, `jongro.fetcher.js` (×2), `station.fetcher.js`, `search.space.js`, `search.building.js`, `search.building-detail.js`
- Decision: 10s is generous for typical API responses but prevents indefinite hangs

---

### 4. HSSC and Station fetcher registrations missing `.catch()`

**Problem**: `hssc.fetcher.js:92` and `station.fetcher.js:21` pass async functions directly to `registerPoller()` without `.catch()`. Jongro fetcher already wraps correctly (line 99-104). Unhandled promise rejection risk.

**Status**: DONE
- Wrapped both registrations in arrow functions with `.catch()`, matching Jongro pattern
- `hssc.fetcher.js`: `pollers.registerPoller(() => { updateHSSCBusList().catch(...) }, ...)`
- `station.fetcher.js`: `pollers.registerPoller(() => { updateStation().catch(...) }, ...)`

---

### 5. `lib/firebase.js:7` — `JSON.parse()` without try-catch

**Problem**: If `FIREBASE_SERVICE_ACCOUNT` is malformed JSON, the server crashes at module load. No clean error message.

**Status**: DONE
- Wrapped `JSON.parse()` + `admin.initializeApp()` in try-catch
- Logs descriptive error: `[firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT: ...`
- Server continues without Firebase auth (graceful degradation — auth middleware already handles missing Firebase)

---

### 6. `express.json()` has no explicit body size limit

**Problem**: `index.js:19` — `express.json()` defaults to 100KB. Should be explicit for production clarity and to prevent future Express version changes.

**Status**: DONE
- Changed to `express.json({ limit: "100kb" })` — same default, now explicit
- Decision: 100KB is sufficient for this API (largest POST is ad event at ~200 bytes)

---

## P1 — SHOULD FIX (before launch)

### 7. `search.space.js:28` — query not encoded

**Problem**: `inputQuery` interpolated directly into URL. `search.building.js` uses `encodeQuery()` but `search.space.js` doesn't. URL injection risk.

**Status**: DONE
- Added `const { encodeQuery } = require("./search.helpers")` import
- Changed `${inputQuery}` to `${encodeQuery(inputQuery)}` in URL template
- Now consistent with `search.building.js` pattern

---

### 8. No MongoDB connection check at startup

**Problem**: `lib/db.js:6-11` — lazy connection. If `MONGO_URL` is wrong, server starts fine but all DB routes return 500.

**Status**: DONE
- Added `ping()` function to `lib/db.js` — runs `db.admin().command({ ping: 1 })`
- Called at startup in `index.js` before ad init — non-fatal (warn + continue)
- Decision: non-fatal because bus/station/search features work without MongoDB

---

### 9. Shutdown has no timeout

**Problem**: `index.js:87-94` — if `closeClient()` hangs, process never exits. Docker sends SIGKILL after 30s.

**Status**: DONE
- Added 5s `setTimeout` + `process.exit(1)` as forced exit fallback
- `.unref()` on timer so it doesn't keep event loop alive if cleanup finishes first
- Decision: 5s is well under Docker's default 10s stop_grace_period

---

### 10. `swagger-autogen` in dependencies

**Problem**: `package.json:24` — only used to generate `swagger-output.json` at dev time. Bloats production install.

**Status**: DONE
- Moved `swagger-autogen` from `dependencies` to `devDependencies`
- `npm run swagger` still works in dev; `npm ci --omit=dev` skips it in Docker

---

### 11. No `.env.example`

**Problem**: New developers/deployers have no reference for required env vars.

**Status**: DONE
- Created `.env.example` with all 27 env vars from `lib/config.js`
- Grouped by category: MongoDB, Bus API, Station API, Firebase, Server
- Marked optional vars with defaults

---

### 12. No Node.js version pinning

**Problem**: Docker uses `node:20-alpine` but nothing enforces this for local dev.

**Status**: DONE
- Added `"engines": { "node": ">=20.0.0" }` to `package.json`
- npm warns on mismatch; enforced if `engine-strict=true` in `.npmrc`

---

## P2 — NICE TO HAVE (post-launch)

| # | Finding | File | Status |
|---|---------|------|--------|
| 13 | Error handler logs full stack to stdout | `index.js:60` | PENDING |
| 14 | No request logging (morgan/pino) | `index.js` | PENDING |
| 15 | Docker compose: no `mem_limit` or log rotation | `docker-compose.yml` | PENDING |
| 16 | No readiness probe (`/health/ready`) | `index.js` | PENDING |
| 17 | Fix 4 ESLint warnings (unused vars) | Various | PENDING |
| 18 | Test coverage gaps: search.routes 37%, ad.data 30%, campus.routes 0% | Various | PENDING |
| 19 | MongoClient has no pool config | `lib/db.js:8` | PENDING |
| 20 | Poller overlap possible (no in-flight guard) | `lib/pollers.js` | PENDING |

---

## Files Modified (by item)

| Item | Files | Tests |
|------|-------|-------|
| 1 | `package.json`, `package-lock.json` | `npm audit` |
| 2 | `lib/authMiddleware.js` | `__tests__/security.test.js` |
| 3 | All fetchers + search modules | `__tests__/edge-cases.test.js` |
| 4 | `hssc.fetcher.js`, `station.fetcher.js` | — |
| 5 | `lib/firebase.js` | `__tests__/security.test.js` |
| 6 | `index.js` | — |
| 7 | `search.space.js` | `__tests__/search.test.js` |
| 8 | `lib/db.js`, `index.js` | — |
| 9 | `index.js` | — |
| 10 | `package.json`, `package-lock.json` | — |
| 11 | `.env.example` (new) | — |
| 12 | `package.json` | — |

## Verification

All P0 (1-6) and P1 (7-12) items complete:
1. `npm test` → 130/130 passed
2. `npm run lint` → 0 errors, 4 warnings (pre-existing, tracked in P2 Item 17)
3. `npm audit` → 0 vulnerabilities (Item 1)

P2 items (13-20) deferred to post-launch.

---

## Second Audit (2026-03-01)

Deep inspection across security, reliability, and deployment. Items A-G are new fixes; H-M are hardening.

### A. `trust proxy` not configured — rate limiter sees wrong IP behind proxy

**Problem**: Behind Docker/nginx, `req.ip` is always `127.0.0.1`. All clients share one rate-limit bucket.

**Status**: DONE
- Added `app.set("trust proxy", 1)` in `index.js` before helmet/rate-limiters
- `1` = trust first proxy (Docker/nginx). Express uses `X-Forwarded-For` header for `req.ip`

---

### B. Swagger UI exposed in production

**Problem**: `index.js:23-25` — `/api-docs` serves full API schema to anyone in production.

**Status**: DONE
- Changed gate to `if (swaggerFile && !config.isProduction)` — Swagger UI only mounts in dev
- `config.isProduction` already defined in `lib/config.js`

---

### C. `placement`/`event` not type-checked in POST /ad/v1/events

**Problem**: `ad.routes.js:39` — sending `{"placement": {"$gt": ""}}` passes truthiness check, inserts malformed doc into MongoDB.

**Status**: DONE
- Added `typeof placement !== "string" || typeof event !== "string"` to validation
- NoSQL injection via object-typed body fields now returns 400

---

### D. No resource limits in docker-compose

**Problem**: `docker-compose.yml` — no `mem_limit` or `cpus`. Memory leak could crash the host.

**Status**: DONE
- Added `mem_limit: 512m` and `cpus: 1.0` to `docker-compose.yml`
- 512MB is generous for this Express app; caps runaway memory leaks

---

### E. No logging limits in docker-compose

**Problem**: Default `json-file` driver with no `max-size` can fill disk.

**Status**: DONE
- Added `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }`
- Caps container logs at 30MB total (3 × 10MB rotated files)

---

### F. HTTP server not closed during shutdown

**Problem**: `index.js:84,95` — `app.listen()` server not `.close()`'d. In-flight requests killed by `process.exit()`.

**Status**: DONE
- Captured `app.listen()` return in `const server`
- Added `server.close()` in shutdown handler before `closeClient()`
- In-flight HTTP requests now drain before exit

---

### G. Double SIGINT runs shutdown twice

**Problem**: `index.js:106-107` — pressing Ctrl+C twice runs shutdown concurrently. Potential double-close on MongoClient.

**Status**: DONE
- Added `let shuttingDown = false` guard with early return at top of `shutdown()`
- Second SIGINT/SIGTERM is now a no-op

---

### H. Jongro fetcher crashes on unknown station ID

**Problem**: `jongro.fetcher.js:52` — `busStationMapping[busnumber][lastStnId]` throws if station ID not in mapping. Entire update fails silently.

**Status**: DONE
- Added `const mapping = busStationMapping[busnumber]?.[lastStnId]` with `if (!mapping) return null`
- Added `.filter(Boolean)` after `.map()` to strip nulls
- Unknown station IDs now silently skipped instead of crashing the entire update

---

### I. Station fetcher crashes on empty itemList

**Problem**: `station.fetcher.js:11` — `apiData[0].arrmsg1` throws if API returns empty array. Stale value persists.

**Status**: DONE
- Added `if (!apiData || apiData.length === 0) return` guard before array access
- On empty response, last known value is preserved (stale > crashed)

---

### J. Remove vestigial `yarn.lock`

**Problem**: Docker uses `npm ci`. `yarn.lock` (184KB) is dead weight in image and repo.

**Status**: DONE
- Deleted `yarn.lock` (184KB)
- Added `yarn.lock` to `.gitignore` to prevent recreation

---

### K. Add `docs/`, `scripts/` to `.dockerignore`

**Problem**: Dev-only files copied into production Docker image unnecessarily.

**Status**: DONE
- Added `docs/`, `scripts/`, `yarn.lock` to `.dockerignore`
- Reduces Docker build context and final image size

---

### L. Remove stale `NAVER_API_KEY*` from CLAUDE.md

**Problem**: `CLAUDE.md:80` references `NAVER_API_KEY_ID` and `NAVER_API_KEY` but they don't exist anywhere in code.

**Status**: DONE
- Replaced `Naver Maps keys (NAVER_API_KEY_ID, NAVER_API_KEY)` with `Firebase credentials (FIREBASE_SERVICE_ACCOUNT)`
- Verified: `NAVER_API_KEY` has zero references in source code

---

### M. Remove deprecated `version` key from docker-compose.yml

**Problem**: `version: "3.8"` is ignored by Docker Compose V2 and generates a warning.

**Status**: DONE
- `version` key was already removed during Item D/E edit

---

## Second Audit — Files Modified

| Item | Files | Notes |
|------|-------|-------|
| A | `index.js` | `trust proxy` setting |
| B | `index.js` | Swagger production gate |
| C | `features/ad/ad.routes.js` | `typeof` validation |
| D | `docker-compose.yml` | `mem_limit`, `cpus` |
| E | `docker-compose.yml` | Log rotation config |
| F | `index.js` | `server.close()` in shutdown |
| G | `index.js` | `shuttingDown` guard |
| H | `features/bus/jongro.fetcher.js` | Null guard + `.filter(Boolean)` |
| I | `features/station/station.fetcher.js` | Empty array guard |
| J | `yarn.lock` (deleted), `.gitignore` | Removed + gitignored |
| K | `.dockerignore` | Added `docs/`, `scripts/`, `yarn.lock` |
| L | `CLAUDE.md` | Replaced stale NAVER refs with Firebase |
| M | `docker-compose.yml` | Already done in D/E |

## Second Audit — Verification

All items A-M complete:
1. `npm test` → 130/130 passed
2. `npm run lint` → 0 errors, 4 warnings (pre-existing, tracked in P2 Item 17)
3. `yarn.lock` deleted, `.dockerignore` updated
