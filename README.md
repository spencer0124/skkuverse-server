# skkuverse-server

![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-26_LTS-339933?style=for-the-badge&logo=node.js&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7+-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge)

The API server behind **[skkuverse](https://skkuverse.com)**, an app for students of Sungkyunkwan University (SKKU): live campus shuttle and city bus positions, shuttle timetables, subway arrivals, department notices with push alerts, building search, the campus and festival map, and the server-driven home screen.

[한국어 요약](#korean-summary) <!-- conventions:allow-korean: the link to the Korean summary (decision C3) -->

## What it does

The mobile app reads this server over HTTPS. The server:

- **Polls public transit APIs** in the background and keeps snapshots in MongoDB: shuttle and city bus positions and arrivals, subway arrivals.
- **Serves timetables and estimates**: intercampus and commute shuttles, shuttle arrival estimates, a journey planner across shuttle, bus and subway.
- **Serves department notices** that a separate crawler writes to MongoDB, with search and push alerts through a Firebase Cloud Function.
- **Serves the map and the home screen**: map config, campus overlays, bus route lines, festival layers, buildings and rooms, cafeterias and their menus, and a server-driven home layout.
- **Hosts mini apps**: their registry and the push messages each one sends.

## Quick start

You need Node.js 26 (`.nvmrc`; run `nvm use`) and a MongoDB of your own, version 7 or later. You do not need any of the maintainers' accounts or secrets.

```bash
docker run --rm -d --name skkuverse-mongo -p 127.0.0.1:27017:27017 mongo:8
npm ci
```

Create `.env` in the repository root. The maintainers render theirs from a private secret store; you do not need it. The server refuses to start while a required variable is missing (`src/infra/required-env.ts`), so give every one a value. Placeholders work for the upstream API keys you do not have:

```dotenv
MONGO_URL=mongodb://127.0.0.1:27017
MONGO_DB_NAME_BUS_CAMPUS=bus_campus
MONGO_BUILDING_DB_NAME=building
MONGO_NOTICES_DB_NAME=notices
MONGO_EVENTMAP_DB_NAME=eventmap
MONGO_MINIAPPS_DB_NAME=miniapps
MONGO_MEALS_DB_NAME=meals
MONGO_CONTENT_DB_NAME=content
NOTICES_SERVICE_START_DATE=2026-01-01
API_HSSC_NEW_PROD=http://127.0.0.1:9/
API_HSSC_NEW_DEV=http://127.0.0.1:9/
FCM_FUNCTION_URL=http://127.0.0.1:9/
SEOUL_BUS_SERVICE_KEY=placeholder
SEOUL_SUBWAY_API_KEY=placeholder
DATA_GO_KR_SERVICE_KEY=placeholder
NAVER_API_KEY_ID=placeholder
NAVER_API_KEY=placeholder
NAVER_MAP_STYLE_ID=placeholder
TMAP_APP_KEY=placeholder
FCM_API_KEY=placeholder
INTERNAL_DISPATCH_TOKEN=placeholder
SUBWAY_ACCURACY_TOKEN=placeholder
```

Then start it:

```bash
npm run dev        # builds, then watches; listens on http://127.0.0.1:3000
curl http://127.0.0.1:3000/health/ready
```

`npm run dev` sets `NODE_ENV=development`, `PERIMETER_MODE=local-dev` and `HOST=127.0.0.1`:

- **`_dev` databases.** In development every database name gets a `_dev` suffix (`building` becomes `building_dev`).
- **A stand-in perimeter.** `local-dev` mode answers authentication, rate limiting and the other access decisions with simple stand-ins that work only on loopback (ADR 0023, [docs/decisions/0023-perimeter-ports.md](docs/decisions/0023-perimeter-ports.md)).
- **Paid and limited APIs off.** Development turns off push delivery, caching and the paid or quota-limited upstream calls (`src/infra/runtime-switches.ts`).
- **Pollers that fail are reported, not fatal.** A poller whose upstream rejects a placeholder key logs `poller.failing`; the rest of the server keeps serving. Pollers still call the public upstreams that development leaves on, such as the Seoul bus API (TOPIS), with your placeholder key, and get refused.
- **Simulator and emulator only.** `local-dev` answers only requests sent straight to a loopback address, from this machine. The iOS simulator reaches `http://localhost:3000`, and the Android emulator does after `adb reverse tcp:3000 tcp:3000`. A physical phone needs `overlay` mode, which needs the production configuration ([docs/how-to/test-the-app-against-a-local-server.md](docs/how-to/test-the-app-against-a-local-server.md)).

### What answers on an empty database

An empty database is enough to boot. The production data is not part of this repository (see below), so these routes answer as follows:

| Routes | Answer | Why |
| --- | --- | --- |
| `/health`, `/notices/tabs`, `/map/config`, `/map/overlays/campus`, `/map/overlays/transit`, `/map/overlays/event`, `/map/overlays/event/details`, `/subway/stations`, `/ui/home/scroll`, `/bus/realtime/data/hssc`, `/bus/config/fasttrack` | `200` | Built from committed files and code, or empty where they read the database |
| `/notices`, `/notices/overview`, `/building/list`, `/building/search`, `/meals/cafeterias?campus=hssc`, `/meals?campus=hssc` | `200`, empty | Notices, buildings and menus are written by a separate crawler; your collections are empty |
| `/app/config`, `/ui/home`, `/ui/home/campus`, `/ui/home/transit`, `/ui/home/transitlist`, `/miniapps`, `/games`, the other `/bus/*` routes, `/journey/routes`, `/subway/stations/:stationId/arrivals` | `503` with a `*_UNAVAILABLE` code | They read datasets that live in MongoDB, edited with `npm run data` (ADR 0013), which your database does not have |

`npm run schedule` does not fill the bus timetables on an empty database. It writes `scripts/data/campus-schedule.json` to the `_dev` database (production only with `--prod`), but first checks the stop times against the stored `bus-stops` dataset, and refuses, writing nothing, while that dataset is missing. The dataset is not in this repository.

`npm start` runs the build with whatever `NODE_ENV`, `PERIMETER_MODE`, `HOST` and `ROLE` you set. `local-dev` mode refuses to start unless `NODE_ENV=development` and the host is loopback, and `overlay` mode, which production uses, refuses to start without the production perimeter configuration.

## Tests

```bash
npm test                 # Jest with coverage; thresholds in jest.config.js
NODE_OPTIONS=--experimental-vm-modules npx jest __tests__/nest/bus/schedule.routes.test.ts   # one file; Jest needs the flag for the ESM-only NestJS packages
npm run typecheck        # Jest does not type-check, so run this after a TypeScript change
npm run lint             # ESLint, then markdownlint over docs/; 0 errors and 0 warnings
```

Tests need no network and no database of yours: they start an in-memory `mongod` (mongodb-memory-server, whose install script downloads it during `npm ci`) and fail any connection that leaves loopback. npm 11 runs a dependency's install script only when `allowScripts` in `package.json` lists it, and this one is listed; if a test reports no `mongod` binary, run `npm rebuild mongodb-memory-server`. `npm run check:ci` runs everything CI checks, in CI's order: typecheck, build, the contract and conventions checks, tests, lint and knip. CI runs it on every pull request and every push to `dev` ([docs/cicd-and-branch-protection.md](docs/cicd-and-branch-protection.md)).

## Architecture

| Read | For |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Commands, the `src/` map and the rules, written for coding agents and humans alike |
| [docs/decisions/0010-server-architecture.md](docs/decisions/0010-server-architecture.md) | Where code goes: one module shape, `src/building/` is the reference module |
| [docs/decisions/0011-test-strategy.md](docs/decisions/0011-test-strategy.md) | How the code is tested |
| [docs/decisions/0012-runtime-roles.md](docs/decisions/0012-runtime-roles.md) | One image, three roles: `poller`, `api` replicas, `combined` |
| [docs/decisions/0013-runtime-data-in-mongodb.md](docs/decisions/0013-runtime-data-in-mongodb.md) | Runtime data lives in MongoDB as datasets, edited with `npm run data` |
| [docs/decisions/0023-perimeter-ports.md](docs/decisions/0023-perimeter-ports.md) | The ports every access decision sits behind |
| [docs/README.md](docs/README.md) | The docs index: reference, explanation, how-to and every decision record |

In short: NestJS 12 on Node.js 26, TypeScript `strict`, the native MongoDB driver, zod at every boundary, pino for logs. Each feature is a module under `src/` (`bus`, `subway`, `journey`, `notices`, `map`, `building`, `meals`, `miniapps`, `ui` and others), split into one sub-module per flow. `__tests__/architecture/` and the ESLint rules enforce the layout. The `ROLE` variable picks the boot path: `poller` polls and serves nothing, `api` serves and polls nothing, `combined` (the local default) does both.

Every success is `{ meta: { lang }, data }` and every error `{ error: { code, message } }`. The module docs under [docs/reference/](docs/reference/) hold the request and response contracts, and `contracts/produced/` holds a JSON Schema for every shape the server sends to another repository.

## What is not in this repo

Production configuration and data are kept outside this repository. Running and testing the server needs neither.

Data copied from school and public sites (timetables, the notice source lists) belongs to its sources, and trimmed third-party content in test fixtures is not covered by the license: see [NOTICE](NOTICE).

## Contributing and security

- Issues are welcome. Pull requests are by invitation: read [CONTRIBUTING.md](CONTRIBUTING.md) first.
- Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes: GitHub private vulnerability reporting or [team@skkuverse.com](mailto:team@skkuverse.com).

## Korean summary

skkuverse 앱의 API 서버입니다. 셔틀·시내버스 실시간 위치, 셔틀 시간표, 지하철 도착 정보, 학과 공지와 푸시 알림, 건물 검색, 캠퍼스·축제 지도, 서버 주도 홈 화면을 제공합니다. <!-- conventions:allow-korean: C3 summary -->

- **로컬 실행:** Node.js 26과 직접 띄운 MongoDB만 있으면 됩니다. 위 [Quick start](#quick-start)의 `.env`를 만들고 `npm run dev`를 실행하세요. 운영자의 계정이나 비밀 값은 필요 없습니다. <!-- conventions:allow-korean: C3 summary -->
- **테스트:** `npm test`. 인메모리 MongoDB를 쓰고 외부 네트워크에 접속하지 않습니다. <!-- conventions:allow-korean: C3 summary -->
- **이 저장소에 없는 것:** 운영 환경의 설정과 데이터. 로컬 실행과 테스트에는 필요 없습니다. <!-- conventions:allow-korean: C3 summary -->
- **기여:** 이슈는 환영합니다. 풀 리퀘스트는 요청받은 경우에만 받습니다([CONTRIBUTING.md](CONTRIBUTING.md)). 보안 취약점은 [SECURITY.md](SECURITY.md)에 따라 비공개로 제보해 주세요. <!-- conventions:allow-korean: C3 summary -->

## License

[Apache License 2.0](LICENSE). Copyright 2024-2026 spencer0124. Third-party data and fixture content: [NOTICE](NOTICE).
