# SKKUBUS Server

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-6.x-47A248?logo=mongodb&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Admin-FFCA28?logo=firebase&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Jest](https://img.shields.io/badge/Tested_with-Jest-C21325?logo=jest&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-0_errors-4B32C3?logo=eslint&logoColor=white)

> Backend API server for the **스꾸버스 (SKKUBUS)** app — a campus navigation and real-time shuttle tracker for Sungkyunkwan University (성균관대학교).

---

## What It Does

The companion Flutter app ([skkumap](../skkumap)) shows students:

- **Real-time shuttle bus positions** — the HSSC campus shuttle (인사캠 셔틀), updated every 10 seconds
- **City bus arrival times** — 종로02 / 종로07 routes, updated every 15 seconds
- **Campus shuttle schedules** — 인자셔틀 (Inja–Jain intercampus), by weekday/friday/weekend
- **Building & room search** — queries the SKKU campus map API
- **Bus stop arrival ETA** — 혜화역 stop with computed shuttle ETAs
- **Ad placements** — per-placement ads with weighted random selection, impression/click tracking

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20 |
| Framework | Express 4 |
| Database | MongoDB 6 (native driver) |
| Auth | Firebase Admin SDK (optional) |
| Security | Helmet, express-rate-limit |
| HTTP client | Axios (external API polling) |
| Date/time | moment-timezone (`Asia/Seoul`) |
| API docs | Swagger (swagger-autogen + swagger-ui-express) |
| Testing | Jest + Supertest (130 tests) |
| Linting | ESLint |
| Container | Docker + Docker Compose |

---

## Project Structure

```
skkumap-server-express/
├── index.js              # Entry point: routes, startup, graceful shutdown
├── lib/
│   ├── config.js         # Env var loading & validation
│   ├── db.js             # MongoDB singleton client
│   ├── pollers.js        # Background polling registry
│   ├── asyncHandler.js   # Wraps async route handlers
│   ├── authMiddleware.js # Firebase token verification (optional)
│   └── firebase.js       # Firebase Admin initialization
├── features/
│   ├── bus/              # HSSC shuttle + 종로02/07 routes & fetchers
│   ├── station/          # 혜화역 stop arrival info
│   ├── search/           # SKKU building & room search
│   ├── campus/           # Inja/Jain intercampus shuttle schedules (MongoDB)
│   ├── mobile/           # Static config endpoints for the Flutter app
│   └── ad/               # Ad management: placements, events, stats
├── __tests__/            # Jest integration & unit tests
├── swagger/              # Swagger autogen config & output
├── scripts/              # Data collection utilities
└── docker-compose.yml
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- A running MongoDB instance
- A `.env` file (see below)

### Install & Run

```bash
# Install dependencies
npm install

# Development mode (dev DB + dev API, live reload)
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

Runs on host port **1398** → container port **3000**, `NODE_ENV=production`.

---

## Environment Variables

Create a `.env` file in the project root:

```env
# MongoDB
MONGO_URL=mongodb://...
MONGO_DB_NAME_BUS_CAMPUS=skkubus
MONGO_DB_NAME_INJA_WEEKDAY=INJA_weekday
MONGO_DB_NAME_INJA_FRIDAY=INJA_friday
MONGO_DB_NAME_INJA_WEEKEND=INJA_weekend
MONGO_DB_NAME_JAIN_WEEKDAY=JAIN_weekday
MONGO_DB_NAME_JAIN_FRIDAY=JAIN_friday
MONGO_DB_NAME_JAIN_WEEKEND=JAIN_weekend
MONGO_AD_DB_NAME=skkubus_ads

# Bus API endpoints
API_HSSC_NEW_PROD=https://...
API_HSSC_NEW_DEV=https://...
API_JONGRO07_LIST_PROD=https://...
API_JONGRO07_LIST_DEV=https://...
API_JONGRO02_LIST_PROD=https://...
API_JONGRO02_LIST_DEV=https://...
API_JONGRO07_LOC_PROD=https://...
API_JONGRO07_LOC_DEV=https://...
API_JONGRO02_LOC_PROD=https://...
API_JONGRO02_LOC_DEV=https://...
API_STATION_HEWA=https://...

# Firebase (optional — auth bypassed if not set)
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

`NODE_ENV` and `USE_PROD_API` are set per execution context (CLI/Docker), not in `.env`.

---

## API Overview

All endpoints return `{ metaData: {...}, dataItems: [...] }` unless noted.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Liveness check |
| GET | `/bus/hssc/v1/buslocation` | — | Real-time HSSC shuttle positions |
| GET | `/bus/hssc/v1/busstation` | — | HSSC station list with ETAs |
| GET | `/bus/jongro/v1/busstation/:line` | — | 종로02/07 station list (`line`: `02` or `07`) |
| GET | `/bus/jongro/v1/buslocation/:line` | — | 종로02/07 bus positions |
| GET | `/station/v1/:stationId` | — | 혜화역 arrival info (`stationId`: `01592`) |
| GET | `/campus/v1/campus/:bustype` | — | Intercampus shuttle schedule (e.g. `INJA_monday`) |
| GET | `/search/all/:query` | Firebase (optional) | Building + room search |
| GET | `/search/detail/:buildNo/:id` | Firebase (optional) | Building floor detail |
| GET | `/mobile/v1/mainpage/buslist` | — | Static bus list config for app home screen |
| GET | `/ad/v1/placements` | Firebase | Active ad placements (weighted random) |
| POST | `/ad/v1/events` | Firebase | Record impression or click event |

Swagger UI is available at `/api-docs` in non-production environments after running `npm run swagger`.

---

## Environment Modes

| Mode | `NODE_ENV` | `USE_PROD_API` | DB | API |
|---|---|---|---|---|
| Development | `development` | unset | `*_dev` | dev endpoints |
| Staging check | `development` | `true` | `*_dev` | prod endpoints |
| Production | `production` | forced `true` | production | prod endpoints |

---

## Running Tests

```bash
npm test          # run all tests with coverage
npx jest __tests__/hssc-transform.test.js  # single file
npm run lint      # ESLint (0 errors expected)
```

---

## License

ISC
