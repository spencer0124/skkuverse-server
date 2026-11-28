# CLAUDE.md

NestJS 12 + TypeScript (strict) API behind the skkuverse app for SKKU: shuttle and city-bus tracking, campus shuttle timetables, notices with FCM push, building search, the campus and festival map, server-driven UI and mini apps. When sources disagree, trust code in `src/` first, then `README.md`, then `docs/` ([docs/README.md](docs/README.md) is the index and the doc-writing rules), then this file.

## Commands

- `npm run dev` — build, then watch with dev DB + dev APIs. `npm run dev:prod-api`: dev DB + prod APIs.
- `npm test` — Jest with coverage; the thresholds in `jest.config.js` fail the run. The script adds Node's `--experimental-vm-modules`, without which Jest cannot load the ESM-only NestJS packages and `__tests__/helpers/esm-flag-guard.ts` fails every file. One file: `NODE_OPTIONS=--experimental-vm-modules npx jest __tests__/nest/bus/schedule.routes.test.ts`.
- `npm run typecheck` — `tsc` over `src/` and the tests. Jest does not type-check (ts-jest `diagnostics: false`), so run it after every TS change.
- `npm run lint` — ESLint, then markdownlint over `docs/**`.
- `npm run knip` — unused files, dependencies and binaries.
- `npm run check:ci` — every check CI runs, in CI's order (`scripts/check-ci.sh`): the mongod binary, typecheck, build, contract and conventions checks, the full Jest run with coverage, lint and knip. CI runs it after `sfw npm ci`. A local hook runs `npm run check:ci -- --skip test` before a push: `--skip <step>` (repeatable) leaves a step out and says so, an unknown step fails, and CI never passes it.
- `npm run build` — `tsc` into `dist/`, then `scripts/copy-build-assets.js`. A JSON file that `src/` reads with `fs.readFileSync` must be listed there, or production dies at boot.
- `npm run env:pull` — maintainers only: render `.env` from the secret store with the names in `config/env.dev.keys`. Without access, write `.env` yourself with those names.
- `npm run verify:serve` / `npm run verify:serve:down` — the production topology on your machine (poller + every api replica, `NODE_ENV=production`), with every DB name overridden to `_dev`, `PUSH_DELIVERY=suppressed`, `DISPATCH_SWEEP_ENABLED=false` and `SENTRY_DSN=disabled` (`docker-compose.local-verify.yml`). It needs the production perimeter configuration and refuses to start without it (`scripts/verify-serve.js`). Never run plain `docker compose up` locally: production mode adds no `_dev` suffix, so it writes to the databases named in `.env`.
- Data scripts (`npm run schedule`, `eventmap`, `eventmap:import`, `campus:shapes`) write to MongoDB and choose prod vs `_dev` differently. Read the script header before running one.
- `npm run data -- <pull|push|history|rollback|copy-prod-to-dev|check> [<dataset>]` — edit runtime datasets in the content database (ADR 0013). Builds first, targets `_dev` unless `--prod`, and confirms a production write. `docs/how-to/edit-runtime-data.md`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/main.ts` | Bootstrap: the HTTP pipeline via `bootstrapHttpApp` (`src/http/http-app.bootstrap.ts`), the `ROLE` branch, graceful shutdown |
| `src/instrument.ts` | Sentry init; must stay the first import in `main.ts` |
| `src/app.module.ts` | Root module; registers every module and sub-module, in route order |
| `src/config/` | `ConfigModule`: throws at bootstrap on a missing required var (`validateEnv()` in `src/infra/required-env.ts`) |
| `src/infra/` | Plain modules, not Nest: `config.ts` (every env read), `required-env.ts` (the required list), `db.ts` and `mongo.ts` (the Mongo client, typed collections, `ensureIndexesAtBoot`), `fcm.ts` (the FCM Cloud Function call), `clock.ts`, `cached-loader.ts`, `config-file.ts`, logging (`logger.ts`, `http-logging.ts`, `log-redact.ts`, `nest-logger.ts`), Sentry options, `i18n.ts`, `origins.ts` (the first-party web and mini-app origins), `response-time.ts` (`X-Response-Time`) |
| `src/http/` | The HTTP pipeline: response envelope (`withMeta`, `@CacheControl`), `AppError`, `ZodValidationPipe`, lang middleware, and the perimeter bindings: the authentication and rate-limit middleware (`REQUEST_AUTHENTICATOR`, `RATE_LIMIT_POLICY`), CORS (`ORIGIN_TRUST`), `@InternalRoute(scope)` (`INTERNAL_AUTHORIZER`) |
| `src/perimeter/` | ADR 0023: the ports every access decision sits behind (`perimeter.ports.ts`), the `PERIMETER_MODE` check, the registry that provides each mode's implementations, and the `local-dev/` ones. Feature code and `src/http/` import only the ports file |
| `src/shared/` | Pure cross-feature helpers and wire pieces (`link-action.wire.ts`, GeoJSON, ring winding, `captureGroups`); imports no feature |
| `src/scheduling/` | `PollerRegistryService`, which runs every background poller |
| `src/health/` | `/health` and `/health/ready` |
| `src/calendar/` | No route: `CalendarService`, the door every feature asks whether a date is a public holiday, a school rest day or in a semester, over `public_holidays` and `academic_calendars` (skkuverse-crawler writes both) and the `skku-rest-days` dataset (ADR 0021) |
| `src/building/` | **The reference module**: copy its shape for a new module. Sub-modules `catalog/` (list, detail), `search/`, `cafeteria-list/` (the cafeterias other features list), `place/` (the place index, and `display/`, which names a stored place id); it writes nothing it serves: skkuverse-crawler writes `buildings`, `spaces` and `facilities`, parsed where they are read; the root holds the module file and what they share |
| `src/meals/` | Read-only, for the cafeteria-menu screen: `catalog/` (`/meals/cafeterias`, building's `facilities` read through `BuildingCafeteriaListService`) and `menus/` (`/meals`, each listed cafeteria's menus for a day, which skkuverse-crawler writes) |
| `src/bus/` | `realtime/` (`hssc/`, `jongro/`, `gbis/`, `group/`, `arrival/`, `hssc-eta/`), `live/` (`/bus/live`), `schedule/` (timetables; data via `npm run schedule`) and `schedule-content/`, `eta/` (shuttle estimates: `live/`, `baseline/`, `smart/` and the sources they read), `departures/` (the journey planner's door), `config/`, `registry/` (Jongno stations, `jongro_routes`), `route-path/` (Jongno route lines from TOPIS `busRouteInfo`, `jongro_route_paths`), `route-attributes/`, `hssc-route-line/`, `stops/` (the stop catalog), `stop-index/`, `stop-list/` and `stop-arrivals/` (`/bus/stops`), `cache/` (`bus_cache`); the root holds the TOPIS route ids (`JONGRO_ROUTES`, `REGIONAL_ROUTES`) and what the flows share |
| `src/subway/` | Arrivals at the served subway stations: `stations/`, `topology/`, `station-coords/` and `timetable/` (the doors to the network and the `subway-topology`, `subway-station-coords` and `subway-timetables` datasets; `timetable/departures/` is the journey planner's door), `seoul-api/` and `seoul-trainmap/` (the upstream clients), `seoul/` (the provider and its poller), `tracking/`, `matching/`, `estimate/`, `countdown/`, `state/` and `platform-arrivals/` (from upstream rows to `subway_arrivals`), `arrivals/` (`/subway/stations/:stationId/arrivals`), `station-list/` (`/subway/stations`), `history/` (`/internal/subway/accuracy`); the root holds the network (`SUBWAY_NETWORK`) and the `subway_arrivals` repository |
| `src/journey/` | The route planner, `/journey/routes`: the root reads the `journey-routes` dataset (ADR 0022); `routes/` (the route), `departures/` (each bus and subway source's departures, through their doors), `places/` (each cited stop, building and station); it writes nothing |
| `src/notices/` | `tabs/`, `list/` (by source and multi-source, search), `detail/`, `schedule/` (the crawler's `schedule`, parsed for the detail), `overview/` (a stub: a null overview for every valid search), `attachment/` (the proxy), `dispatch/` (FCM dispatch + `/internal/notices`); the root holds the module file, the crawler document type, the tab files' loader and the contract-pinned files |
| `src/map/` | `/map/config` and `/map/overlays/*`, one sub-module per route (`config/`, `campus/`, `transit/` (the Jongno route lines), `event/`, `event-details/`); `layer-set/` holds the festival layer-set JSON files, their loader and the live-event service |
| `src/miniapps/` | The registry at the root: the `miniapps` dataset (ADR 0013), read and snapshotted by `MiniappsService`, checked at push by its schema and rules; `catalog/` (`/miniapps`), `manifest/` (fetches and stores each mini app's manifest), `notifications/` (a mini app's signed push send and history), `sender/` (every perimeter decision about a push sender) |
| `src/games/` | `/games` and `/games/:id`: the registry of hosted games, the `games` dataset (ADR 0013), which says only whether and where the app may open each one; one flow, so the controller sits at the root |
| `src/ui/` | Server-driven UI under `/ui/home`, one sub-module per route: `home/` (the layout), `campus/` (the campus sheet), `transit-list/` (bus cards), `transit/` (the stored transit layout), `scroll/`; the root holds the shared banner carousel |
| `src/app-config/` | `/app/config`: each platform's minimum version, minimum OS and update URL (the `app-platform-gates` dataset), the webview bridge allowlist and the first-party mini-app and game origins |
| `contracts/produced/` | JSON Schema per `.wire` export, `index.json` (id → routes) and trimmed fixtures; `npm run contracts:export` (ADR 0010 D13) |
| `contracts/consumed/` | JSON Schema a producer repository publishes and the umbrella vendors, hash-locked: the crawler's `notice-schedule.schema.json`, mirrored in zod by `src/notices/schedule/` under `__tests__/contracts/notice-schedule.test.ts` (ADR 0010 D13) |
| `__tests__/nest/` | Route and infrastructure tests, one folder per `src/` module, on `buildTestApp` (`__tests__/helpers/nest/build-test-app.ts`). Unit tests sit next to their source as `src/**/*.spec.ts` |
| `__tests__/architecture/` | The ADR 0010 and 0011 rules, their reasoned `exemptions/` and the per-file size caps |
| `scripts/` | One-off data and maintenance scripts (CommonJS, outside `tsconfig`). Host configuration is not in this repository |

## Runtime topology

One image, three boot paths picked by `ROLE` (`src/main.ts`): `poller` polls external APIs into the `bus_cache` collection and binds no port; `api` serves HTTP and starts no pollers, so replicas scale horizontally; `combined` (the default, used locally) does both. What each role may do (pollers write, api reads MongoDB only and writes nothing at boot, role-scoped required values, switches gate writers, freshness by TTL) is ADR 0012 (`docs/decisions/0012-runtime-roles.md`). `/health/ready` is 503 unless the DB pings and, outside `ROLE=api`, the pollers are running. An api replica in `docker-compose.yml` must also appear in `docker-compose.local-verify.yml`: `__tests__/nest/infra/replica-topology.test.ts` fails until the two agree.

## Rules

- **Architecture: ADR 0010** (`docs/decisions/0010-server-architecture.md`). The architecture tests (`__tests__/architecture/`) and the ESLint import rules are the source of truth for where code goes; `.claude/rules/architecture.md` holds the placement rules no test can check. Every rule is strict over all of `src/`: no allowlist holds a file there; a file a rule cannot fit takes a reasoned entry in `__tests__/architecture/exemptions/` that cites a decision. New code follows `src/building/`. One role file per folder: a second repository, mapper or controller means a sub-module.
- **Tests: ADR 0011** (`docs/decisions/0011-test-strategy.md`). The conventions to follow are in `.claude/rules/tests.md`, which loads when you touch `__tests__/` or a `src/**/*.spec.ts`; the architecture tests (`__tests__/architecture/`) enforce them.
- **Branches.** `dev` is the working trunk, and the only PR into `main` is `dev` → `main`, except a Dependabot security PR, which GitHub opens against `main`: merge it by hand as soon as `ci / gate` passes, with no wait, close it if it is a major bump, then merge `main` back into `dev` at once (`docs/cicd-and-branch-protection.md`). Behavior changes are written test-first (ADR 0011, D9).
- **Responses.** A controller returns its payload and the global `ResponseInterceptor` (`src/http/response.interceptor.ts`) wraps it as `{ meta: { lang }, data }`, leaving `lang` out when the `Cache-Control` is `public` or `s-maxage` (a shared cache keys without `Accept-Language`). Extra `meta`: return `withMeta(data, meta)`. A `Cache-Control` header: `@CacheControl(...)` (`src/http/cache-control.decorator.ts`). Request input: `ZodValidationPipe` (`src/http/zod-validation.pipe.ts`). ETag/304: `EtagInterceptor` (`src/http/etag.interceptor.ts`). Only the attachment stream and `/health` take `@Res()`. Errors: `throw new AppError(code, message, status)`, rendered as `{ error: { code, message } }` by `HttpExceptionFilter`. Only `/health` writes raw JSON.
- **App-wide middleware goes in `bootstrapHttpApp`** (`src/http/http-app.bootstrap.ts`, called by `src/main.ts`) as raw Express middleware, which runs ahead of every module's `forRoutes` middleware (its WHY). Route tests build their app with `buildTestApp`, so they get it from there.
- **Naming** follows `.claude/rules/naming.md`, which loads when you edit `src/`: how to pick a name, name shapes and words to avoid. Each feature module's glossary is in `docs/explanation/<module>-architecture.md`, loaded by `.claude/rules/<module>.md`. File and class names, method verbs against return types, brand casts and minters, section-divider comments and top-level folders are tests in `__tests__/architecture/`.
- **Comments: the code says what; a comment says only what the code cannot** (ADR 0010, D10). Default to none: a name, a constant, an `is…` predicate, a function or a type carries the meaning. A comment is allowed only for (1) behavior outside this repo that the code relies on (an upstream API, MongoDB, Cloudflare, a reverse proxy, FCM, the app), (2) another repo or script that writes or reads this data, named, (3) the evidence behind a value (a measurement or an external limit), or (4) a deliberate choice a reader would undo, and it opens with that kind's tag: `QUIRK(<system>):`, `CONTRACT(<repo>):` citing `<repo>/<path>`, `EVIDENCE:`, `WHY:`, or `SEE: docs/<path>` for a pointer (`SEE: docs/<path> ("<Heading>")` names a section, which must be a heading of that doc). A comment in a shared layer names no feature. Never what the code does, its history, a heading, a restated signature or a list of callers. At most three lines per comment in `src/`; a longer rationale goes to `docs/` and the comment cites its path. Comments in specs follow `.claude/rules/tests.md`. Checked by `comment-tags`, `comment-blocks`, `history-comments`, `route-comments`, `section-comments`, `shared-comments` and `paths` in `__tests__/architecture/`, and `max-lines` counts comment lines.
- **Logging** is lint-enforced in `src/`: `logger.<level>({ event: "domain.subject.verb", ...fields, err }, "static message")`, no `console`. Log headers, query values and errors only through the allowlists in `src/infra/log-redact.ts`; never log a raw request, headers object or axios config. Conventions: `docs/reference/logging.md`.
- **Pollers report by resolving or rejecting.** A poller fn must not catch and log its own failure: `src/scheduling/poller-registry.service.ts` turns outcomes into `poller.failing` / `poller.still_failing` / `poller.recovered`, and withholds the heartbeat ping (`HEALTHCHECKS_POLLER_PING_URL`) while a fast poller is declared failing.
- **Runtime data lives in MongoDB** (ADR 0013, `docs/decisions/0013-runtime-data-in-mongodb.md`). Data moved out of the repository is a dataset in the content database, edited only with `npm run data`, never by hand or by a committed file. Run `npm run data -- check --prod` from the new checkout before merging a change that tightens a dataset's schema or removes an identity a dataset references.
- **Config fails fast, never silently.** A required value has no default. The list is `src/infra/required-env.ts`: a missing value exits at boot (`src/infra/config.ts`) and throws in Nest (`src/config/config.module.ts`). Read config from `src/infra/config.ts`.
- **Hot reads go through `createCachedLoader`** (`src/infra/cached-loader.ts`: single-flight TTL, optional stale window), and hot queries pass `maxTimeMS: HOT_READ_MAX_TIME_MS` (`src/infra/db.ts`). Never load-test against a shared database.
- **The event map is timezone-free on purpose.** Opening windows are absolute instants (`src/map/map.document.ts`); do not add KST conversion. Bus and notices date logic uses `moment-timezone` with `Asia/Seoul`.
- **Vendored contract files are hash-locked** (`.contracts.lock.json`: `src/notices/{sources,categories,exclude-reasons}.json`, `scripts/render_env.py`, `.markdownlint.jsonc`, `docs/_template.md`, `contracts/consumed/notice-schedule.schema.json`, `.github/contract-tools/`). Do not hand-edit them. Change the producer repo, then run `python3 exported/sync_contracts.py pull --repo server` in the umbrella repo `skkuverse`. CI checks the hashes.
- **Lint must finish with 0 errors and 0 warnings.** CI (`.github/workflows/ci.yml`, pull requests to `dev`/`main` and pushes to `dev`) calls `.github/workflows/checks.yml`, which installs with `sfw npm ci`, checks registry signatures, runs `npm run check:ci`, lints the workflows with actionlint and zizmor, and reviews new dependencies; the ruleset requires its `ci / gate`.
- **Dependencies are pinned to exact versions** (no `^`/`~`; `.npmrc` sets `save-exact`). Bump one package per change and rerun `npm run check:ci`. Routine updates take only versions at least 5 days old (`min-release-age=5` in `.npmrc`). Each month, bump what an open alert names that Dependabot cannot fix, to a version at least 5 days old. Node 26 LTS only (`.nvmrc`, `engines`, `engine-strict`, `devEngines`, both Dockerfile stages): 22 reaches end of life on 2027-04-30, and 24 a year before 26. `devEngines` makes `npm run` refuse any other Node.
- **This repository is public: it says nothing about how production runs or is guarded.** No hosting provider, host or reverse-proxy detail, monitoring or alerting setup, secret-store or config name, quota, capacity or cost figure, link to a private repository or name of one this code shares no contract with, incident or vulnerability history, or statement of what a route lacks, such as a missing limit or check. Keep the names code reads (env vars, log events, `QUIRK` tags), state the current rule, and write "outside this repository" for the rest. This holds for code, comments, tests, docs and commit messages.
- **English everywhere** (code, comments, docs, commits). Korean is allowed only in user-facing product copy, whose files `.conventions.json` lists under `productCopy`.

## Working here

- **The main session orchestrates.** It plans, writes the subagent briefs, reviews what each subagent returns and reports to the user. Subagents do the hands-on work: reading across many files, edits, test runs, investigations and browser work.
- **A subagent sees only its brief.** The brief carries the goal, the files to read and the constraints the work must meet.
- **Code work runs under the pstack `poteto-mode` skill** (`/pstack:poteto-mode`). Enter it before you plan a code change.

## Reviews

Reviewing a PR or a diff, here or through `@claude` (`.github/workflows/claude.yml`):

- Number findings `F1`, `F2`, …, never `#1`: GitHub links `#N` to an issue or PR.
- Mark a claim about code you did not read as **Unverified**.
- Before proposing a fix, check it against the ESLint boundary blocks (`eslint.config.js`) and the architecture tests (`__tests__/architecture/`); a fix one of them rejects is not a fix.

## Environment

| Mode | `NODE_ENV` | `USE_PROD_API` | DB names | HSSC API (`API_HSSC_NEW_*`) |
| --- | --- | --- | --- | --- |
| Development | `development` | unset | `<name>_dev` | `_DEV`, falls back to `_PROD` |
| Staging check | `development` | `true` | `<name>_dev` | `_PROD` |
| Production | `production` | forced `true` | `<name>` | `_PROD` |

Logic: `dbNameFor()` and `apiUrl()` in `src/infra/required-env.ts`. Tests run under `NODE_ENV=test`: DB names get `_test`, and missing config does not exit. `NODE_ENV`, `USE_PROD_API`, `ROLE`, `PORT`, `PERIMETER_MODE` and `HOST` are set per execution context, never in `.env`: `npm run dev` runs `PERIMETER_MODE=local-dev` on `HOST=127.0.0.1`, the containers `overlay` on `0.0.0.0`, Jest `test` (ADR 0023).

**Runtime switches** (`src/infra/runtime-switches.ts`), also per execution context: development defaults `PUSH_DELIVERY=suppressed` (no Cloud Function call), `CACHE=off` (in-process caches pass through, every `Cache-Control` becomes `no-store`), `SHUTTLE_ETA=off` (no NAVER Directions or TMAP call for shuttle arrival estimates), `SUBWAY=off` (no Seoul subway API or Seoul Metro train-map call), `REGIONAL_BUS=off` (no TOPIS call for the regional routes, 7800) and `GBIS=off` (no GBIS call for 7800's seats); production and test keep all six on. `PUSH_DELIVERY=live` in development, and `CACHE=off` in production, refuse to boot. `PERIMETER_MODE` chooses the limiter (ADR 0023). The boot line logs the resolved values. Pointing the app at a local server: `docs/how-to/test-the-app-against-a-local-server.md`.

**Env values live outside this repository.** `config/env.prd.keys` and `config/env.dev.keys` list exactly the names production and development read; `.env` is rendered from them with `scripts/render_env.py`, and the values are never committed. Never print a secret value.

**Adding a required variable** touches `src/infra/required-env.ts`, where it takes the scope of the code that reads it (`poller`, `api`, or `all` when both do; ADR 0012, D4), and the value in `src/infra/config.ts` (a `poller` or `api` value is a `roleScoped` getter), both `config/env.*.keys` files and the dummy values in `jest.setup.ts`; a maintainer sets the value. `__tests__/nest/config/env-manifest.test.ts` checks the code and key lists against each other. Removing one takes two releases, because a deploy that fails health restarts the previous image against the new environment: the first release removes the code and the required entry but keeps the name in both `config/env.*.keys` (`KEPT_FOR_ROLLBACK` in the env-manifest test), and the second, once the first is healthy, removes the name from both lists.

## Ecosystem

Sibling repositories:

- `skkuverse-app` — React Native client; calls this API with a Firebase `Bearer <idToken>`.
- `skkuverse-crawler` — owns writes to the `notices` collection (this server only reads it) and calls `POST /internal/notices/dispatch-pending` at the end of each cycle to trigger FCM dispatch.
- `skkuverse-ai` — summarizes notices for the crawler; this server does not call it.
- `skkuverse-web` (`apps/webview`), `skkuverse-mini` (mini apps) — web clients whose origins live in `src/infra/origins.ts`.
- `skkuverse` — umbrella repo: cross-repo contracts and shared conventions.
- `skkuverse-codepush` — OTA update server; independent of this one.

Push: this server never talks to FCM directly. It calls a deployed Cloud Function (`FCM_FUNCTION_URL`), which reads device tokens from Firestore.

## Docs

- Notices: `docs/reference/notices-api.md`, `docs/explanation/notices-architecture.md`, ADRs in `docs/decisions/` (dispatch claim lease: 0003)
- Map: `docs/explanation/map-architecture.md`, `docs/reference/map-overlays-api.md`, `docs/how-to/configure-map-overlays.md`, `docs/reference/event-places.md`
- Mini apps and home: `docs/reference/miniapps-api.md`, `docs/how-to/register-a-miniapp.md`, `docs/how-to/configure-home.md`
- Production config and data are kept outside this repository. CI and branch rules: `docs/cicd-and-branch-protection.md`
- Bus: `docs/explanation/bus-architecture.md`, `docs/reference/bus-live-api.md`, `docs/reference/bus-stops-api.md`, `docs/how-to/change-a-shuttle-timetable.md`
- Test conventions: `.claude/rules/tests.md` (loads when you touch `__tests__/` or a `src/**/*.spec.ts`)
