# skkuverse-server

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22_LTS-339933?style=for-the-badge&logo=node.js&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-368_tests-C21325?style=for-the-badge&logo=jest&logoColor=white)
![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge)

> Production API server powering **[skkuverse](https://skkuverse.com)** — real-time campus shuttle tracking, AI-summarized department notices across 147 sources, and building search for Sungkyunkwan University students.

---

## Ecosystem

The mobile client (**skkuverse-app**, React Native + Expo + TypeScript) reads this server over HTTPS with a Firebase `Bearer <idToken>`. Sibling services under the same Oracle VM:

- **skkuverse-crawler** (Python) — writes the `notices` MongoDB collection; pings this server's `/internal/notices` endpoint at cycle end.
- **skkuverse-ai** (FastAPI) — summarizes notices for the crawler; this server does not call it.
- **skkuverse-codepush** (Expo OTA, `ota.skkuverse.com`) — independent of this server.
- **FCM Cloud Function** — this server triggers it via HTTPS; the function reads device tokens from Firestore and sends FCM v1.

What the app shows users (and what this server provides):

- **Real-time shuttle bus positions** — HSSC campus shuttle (10s polling)
- **City bus arrivals** — 종로02 / 종로07 (15s polling)
- **Campus shuttle schedules** — Inja–Jain intercampus (weekday / Friday / weekend), no-service on Korean public holidays and SKKU rest days
- **Bus stop arrival ETA** — 혜화역 (15s polling)
- **Building & space search** — SKKU campus map
- **Server-driven UI** — home screen lists / sections / map config
- **Notices** — 147-source crawler-backed feed with FCM dispatch
- **Ads** — per-placement weighted random selection, impression/click tracking

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 22 (LTS) |
| Language | TypeScript (`strict`, `noUncheckedIndexedAccess`) |
| Framework | NestJS 11 |
| Database | MongoDB 7 (native driver) |
| Auth | Firebase Admin SDK (optional, with 5-min token cache) |
| Security | Helmet, express-rate-limit, pino-http (request-id) |
| HTTP client | Axios (external API polling) |
| Date/time | moment-timezone (`Asia/Seoul`) |
| Testing | Jest + Supertest (368 tests, 34 suites) |
| Linting | ESLint (0 errors + 0 warnings enforced) |
| Container | Docker + Docker Compose (3 services) |

---

## Project Structure

```
skkuverse-server/
├── src/
│   ├── main.ts               # Entry point: bootstrap NestJS app
│   ├── app.module.ts         # Root module
│   ├── config/               # Env validation + ConfigModule wiring
│   ├── infra/                # Shared infra (db, firebase, i18n, logger)
│   ├── common/               # Auth middleware, rate-limit, response interceptor
│   ├── health/               # /health + /health/ready
│   ├── scheduling/           # Poller registry service (in-flight guard)
│   ├── bus/                  # HSSC shuttle, jongro, campus ETA, schedules, station
│   ├── notices/              # 147-source feed, tabs, FCM dispatch, internal endpoint
│   ├── ad/                   # Ad placements + impression/click events
│   ├── building/             # Building detail + sync poller
│   ├── map/                  # Map config, markers, overlays
│   ├── app/                  # App version gate (iOS/Android min/update URL)
│   └── ui/                   # SDUI fragments (bus list, campus list, scroll config)
├── __tests__/
│   ├── nest/                 # Jest integration tests (34 suites, 368 tests)
│   └── helpers/              # Shared mock factories + mini-app builders
├── docs/                     # Architecture decisions, runbooks
├── scripts/                  # One-off migration + data-collection utilities
├── infra/nginx/              # Nginx site configs deployed by CI/CD
└── docker-compose.yml        # poller + api-1 (3001) + api-2 (3002)
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 22 (`.nvmrc`; run `nvm use` to align)
- A running MongoDB instance (Atlas in production, local for dev)
- A `.env` file (see below). Missing required vars cause `process.exit(1)` at startup.

### Install & Run

```bash
# Install dependencies
npm install

# Development mode (TypeScript build + live reload; dev DB + dev API)
npm run dev

# Staging check (dev DB + production API)
npm run dev:prod-api

# Production (NODE_ENV must be set externally)
npm start
```

### Docker

```bash
docker compose up --build
```

Runs 3 services on the same image: `poller` (no HTTP), `api-1` (127.0.0.1:3001), `api-2` (127.0.0.1:3002). `NODE_ENV=production`, distinguished by `ROLE` env var.

---

## Environment Variables

Required at startup (missing any one → `process.exit(1)`). Optional ones marked `(opt)`. See `src/config/env.validation.ts` for the canonical list.

```env
# --- MongoDB ---
MONGO_URL=mongodb+srv://...
MONGO_DB_NAME_BUS_CAMPUS=skkubus
MONGO_AD_DB_NAME=skkubus_ads
MONGO_BUILDING_DB_NAME=skkubus_building
MONGO_NOTICES_DB_NAME=skkubus_notices
MONGO_DB_NAME_INJA_WEEKDAY=INJA_weekday
MONGO_DB_NAME_INJA_FRIDAY=INJA_friday
MONGO_DB_NAME_INJA_WEEKEND=INJA_weekend
MONGO_DB_NAME_JAIN_WEEKDAY=JAIN_weekday
MONGO_DB_NAME_JAIN_FRIDAY=JAIN_friday
MONGO_DB_NAME_JAIN_WEEKEND=JAIN_weekend

# --- External bus APIs ---
API_HSSC_NEW_PROD=https://...
API_HSSC_NEW_DEV=https://...           # (opt — falls back to PROD if missing)
# Shared Seoul TOPIS service key (URL-encoded form). Jongro per-route URLs
# are composed at runtime from this key + busRouteId in
# src/bus/registry/jongro-routes.json. Adding a Jongro route = JSON entry, no
# new env vars.
SEOUL_BUS_SERVICE_KEY=...               # URL-encoded — see .env.example
API_STATION_HEWA=https://...

# --- Naver Maps ---
NAVER_API_KEY_ID=...
NAVER_API_KEY=...
NAVER_MAP_STYLE_ID=...

# --- Notices dispatch (FCM via Cloud Function) ---
NOTICES_SERVICE_START_DATE=2026-04-01
FCM_FUNCTION_URL=https://...cloudfunctions.net/dispatchNotice
FCM_API_KEY=...
INTERNAL_DISPATCH_TOKEN=...            # shared secret with skkuverse-crawler

# --- Firebase (opt) ---
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}   # omit → auth pass-through

# --- App version gate (opt) ---
APP_IOS_MIN_VERSION=1.0.0
APP_IOS_UPDATE_URL=https://apps.apple.com/...
APP_ANDROID_MIN_VERSION=1.0.0
APP_ANDROID_UPDATE_URL=https://play.google.com/...

# --- Tuning (opt) ---
BUILDING_SYNC_INTERVAL_MS=604800000    # default 7d
NOTICES_DISPATCH_SWEEP_MS=1800000      # default 30min
```

Per-execution-context (not in `.env`): `NODE_ENV`, `USE_PROD_API`, `ROLE` (`poller` / `api` / `combined`), `PORT`.

---

## API Overview

Every successful response uses the envelope `{ meta: { lang, ... }, data: ... }`. Errors return `{ error: { code, message } }`. Auth column: `—` = none, `firebase` = optional Firebase ID token (rate-limit keyed by uid when present, IP otherwise), `internal` = `X-Internal-Token` shared secret.

### Health / probe
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Liveness |
| GET | `/health/ready` | — | Readiness (DB ping + poller running, unless `ROLE=api`) |

### Bus & station
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/bus/realtime/*` | — | HSSC shuttle + 종로 bus positions |
| GET | `/bus/station/*` | — | Station list with ETAs |
| GET | `/bus/campus/*` | — | Driving ETA between Inja–Jain campuses |
| GET | `/bus/schedule/*` | — | Inja/Jain intercampus shuttle schedules by service ID |
| GET | `/bus/config/*` | — | Bus list config (lines, colors, ordering) |
| GET | `/bus/route/*` | — | Route polyline overlays |
| GET | `/station/*` | — | 혜화역 stop arrival info |

### Notices (147 sources via crawler)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notices/tabs` | firebase | Server-driven tab config (per-lang, 1hr cache) |
| GET | `/notices/source/:sourceId` | firebase | Single-source list, cursor-paginated |
| GET | `/notices` | firebase | Multi-source merged list (`?sourceIds=cs,sw&...`) |
| GET | `/notices/:sourceId/:articleNo` | firebase | Detail view |
| GET | `/notices/proxy/attachment` | firebase | Attachment proxy (Referer bypass) |
| POST | `/internal/notices` | internal | Crawler cycle-end ping → triggers FCM dispatch |

### Map, building, UI, app
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/map/config` | — | Map style, campuses, layers, chips, camera defaults |
| GET | `/map/markers/campus` | — | Building markers, both layers |
| GET | `/map/markers/event` | — | Festival booth markers of the live layer set, while its window is open |
| GET | `/map/overlays` | — | Polygon/route overlays |
| GET | `/building/search` | — | Ranked building + room search (`?q=`, optional `?campus=`) — see [ADR 0006](docs/decisions/0006-building-search-relevance-ranking.md) |
| GET | `/building/*` | — | Building detail + list |
| GET | `/ui/*` | — | SDUI fragments (bus list, campus list, scroll config) |
| GET | `/app/version` | — | iOS/Android min version + update URL |

### Ads
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/ad/placements` | firebase | Active ads (weighted random) per placement |
| POST | `/ad/events` | firebase | Record impression or click |

Rate limits: notices (120/min, uid-keyed), everything else general (120/min, IP-keyed). All limiters fall back to IP when uid is absent.

---

## Environment Modes

| Mode | `NODE_ENV` | `USE_PROD_API` | DB | API |
|---|---|---|---|---|
| Development | `development` | unset | `*_dev` | dev endpoints |
| Staging check | `development` | `true` | `*_dev` | prod endpoints |
| Production | `production` | forced `true` | production | prod endpoints |

---

## Multi-Container Topology

`docker-compose.yml` runs 3 services backed by the same image. The `ROLE` env var picks the boot path:

- **`poller`** — polls external APIs and writes snapshots to the `bus_cache` MongoDB collection. No HTTP listener.
- **`api`** (api-1 / api-2 on 3001 / 3002) — serves HTTP from `bus_cache`. Skips poller startup so replicas can scale horizontally.
- **`combined`** (default for local) — runs both poller and HTTP in one process.

Behind Nginx with TLS via Cloudflare. Deployed to Oracle Cloud Free Tier VM by `.github/workflows/deploy.yml` on push to `main`.

---

## Running Tests

```bash
npm test              # all tests with coverage (368 tests, 34 suites)
npx jest __tests__/nest/bus/schedule.routes.test.ts  # single file
npm run lint          # ESLint (0 errors + 0 warnings expected)
npm run typecheck     # tsc --noEmit for both src and test tsconfigs
```

---

## Further Reading

- **`docs/README.md`** — documentation index & conventions (Diátaxis structure, frontmatter schema, writing rules). Start here.
- **`docs/reference/notices-api.md`**, **`docs/explanation/notices-architecture.md`**, **`docs/decisions/`** — the notices feature, fully documented (contract, design rationale, ADRs, incident postmortem)
- **`CLAUDE.md`** — guidance for Claude Code (some Architecture sections are pre-NestJS, see the banner there)
- **`docs/cicd-and-branch-protection.md`**, **`docs/project-docs.md`** — legacy docs pending migration (see backlog in `docs/README.md`)

---

## License

[Apache License 2.0](LICENSE) — Copyright 2024-2026 spencer0124
