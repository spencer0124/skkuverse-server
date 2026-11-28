---
title: Docs Index & Conventions
type: reference
status: accepted
owner: spencer0124
last-updated: 2026-11-06
audience: internal
---

# Docs Index & Conventions

> The index of skkuverse-server's docs and the single source of truth for how to write them. Read it before you write a new doc. Why this structure: [decisions/0001](decisions/0001-adopt-diataxis-docs-structure.md).

## Which source wins (when docs disagree)

This absorbs the rules once scattered through the legacy flat docs. When two docs, or a doc and the code, disagree, trust them in this order:

1. **The code (`src/`)**: the final word on file names, constants and endpoints. A doc points here instead of copying values.
2. **`README.md`**: the current stack, layout and how to run it (it reflects the 2026-05-31 NestJS migration).
3. **`docs/` (as this index lists it)**: the Diátaxis docs. `status: accepted` is authoritative; `draft` is a draft.
4. **`CLAUDE.md`**: the agent guide: commands, the `src/` map and the hard rules, pointing at code and docs instead of copying them. Area-specific agent rules live in `.claude/rules/`.
5. **Legacy pointer stubs** (`notices-api-architecture.md`, `skku-notice-sources.md`): kept for their inbound links. The least trusted.

## Folder structure (Diátaxis)

Docs are split by [Diátaxis](https://diataxis.fr/). **A doc is classified by the reader's need, not by its topic.**

| Folder | Need | Contents |
| --- | --- | --- |
| `how-to/` | Get it done (a task) | Runbooks: the steps to reach one goal |
| `reference/` | Look it up (information) | The authoritative facts: API contracts, specs, error codes |
| `explanation/` | Understand it (context) | Why it is the way it is: the design rationale |
| `decisions/` | — | ADR (`NNNN-kebab-title.md`) |
| `plans/` | — | Work queues (`type: plan`); an item is deleted when it lands |
| `archive/` | — | Historical snapshots (superseded) |

**One doc, one need.** When steps and background mix, split the doc and link the parts to each other.

## Docs index

### how-to (runbooks)

| Document | Summary |
| --- | --- |
| [verify-notices-changes.md](how-to/verify-notices-changes.md) | How to verify a `/notices/*` change before merging and deploying it |
| [test-the-app-against-a-local-server.md](how-to/test-the-app-against-a-local-server.md) | Pointing a simulator or phone at `npm run dev` — the `PUSH_DELIVERY`/`CACHE` switches a local run defaults to off, the base URL per device, and what still reaches production |
| [configure-home.md](how-to/configure-home.md) | What `GET /ui/home` serves — the banner carousel (images, rotation, the app default's place, time windows) and the tile grids (mini apps, bundled games and links, mixed); uploading a banner and why released apps still read `hidden` |
| [edit-runtime-data.md](how-to/edit-runtime-data.md) | Editing a dataset in the content database with `npm run data` — pull, edit, push, history, rollback, copying production into `_dev`, the `_dev` default and the production confirmation, and `check --prod` before a schema change or removing a referenced identity |
| [change-a-shuttle-timetable.md](how-to/change-a-shuttle-timetable.md) | Changing what a timetabled shuttle serves — a semester's timetable with `npm run schedule`, a day off as a rest day or an override, a day with its own runs, and the code a new timetabled service needs |
| [edit-bus-stops.md](how-to/edit-bus-stops.md) | Changing a shuttle stop, its photo, street view or map guide, a sequence's labels, or an HSSC station label with `npm run data -- pull/push bus-stops` and no deploy — what a push checks, what stays in code, `_dev` then production, roll back |
| [update-subway-timetables.md](how-to/update-subway-timetables.md) | Changing the subway timetables with no deploy — pull `subway-timetables`, rerun `convert.py` into the pulled directory, read the push report (tables unchanged, changed with their trains added and removed, added, removed), push to `_dev` then production, roll back |
| [register-a-miniapp.md](how-to/register-a-miniapp.md) | Adding, editing or removing a mini app with `npm run data -- pull/push miniapps` — the index entry and detail, logos, a first-party origin in `origins.ts` before its push, the wait before a layout names it, and the order of a removal |
| [configure-map-overlays.md](how-to/configure-map-overlays.md) | Everything the map can draw and how to add or change one — which tier you edit, whether it needs a deploy, and what to check when a shape does not appear |
| [resync-the-jongro-registry.md](how-to/resync-the-jongro-registry.md) | When the Jongro station registry holds a TOPIS stop list change, or a route's document is missing — reading the held change from its log, checking it against TOPIS, and applying it with a guarded write on `jongro_routes` |
| [raise-the-minimum-app-version.md](how-to/raise-the-minimum-app-version.md) | Raising `minVersion` or `minOsVersion` on `/app/config` — the store release live for everyone, `npm run app-gate:check`, counting the gated devices, the `npm run data` push, the two 60-second caches, rollback, and creating the dataset from the live response (never the test fixture) |

Production configuration and data are kept outside this repository.

### reference (contracts and specs)

| Document | Summary |
| --- | --- |
| [notices-api.md](reference/notices-api.md) | The `/notices/*` and `/internal/notices/*` request and response contracts, error codes and file map |
| [event-places.md](reference/event-places.md) | How festival places are stored, written and run: the `places` and `activations` collections, their indexes, the sheet importer, a place's `detail` (the sheet's body) and the media-origin photo rule, and the runbook for the window kill switch |
| [map-code-map.md](reference/map-code-map.md) | Where each part of `src/map/` lives, boot-time vs request-time work, which test pins what, and a change map |
| [map-overlays-api.md](reference/map-overlays-api.md) | The one overlay schema every map layer draws — pins, zones and route lines tagged by `kind` — the `defaultVisibleWhen`/`userConfigurable` layer flags, and `GET /map/config` + `/map/overlays/{campus,transit,event}` + `/map/overlays/event/details` |
| [miniapps-api.md](reference/miniapps-api.md) | `GET /miniapps` + `/miniapps/:id` — index and detail fields, the `shell` merge order (default < registry < the mini app's own manifest), first-party manifest fetch rules, push validation, and the broadcast feed endpoints |
| [bus-live-api.md](reference/bus-live-api.md) | `GET /bus/live/:groupId` — a realtime line's vehicles and each station's next arrivals in one shape for Jongno and the HSSC shuttle: arrivals as instants, statuses, stops away, vehicles and positions, stop ids and pole numbers, open-enum fallbacks and the client's clock, minute and marker rules |
| [bus-stops-api.md](reference/bus-stops-api.md) | `GET /bus/stops` + `/bus/stops/:stopId/arrivals` — stop ids (a Jongno pole's nine-digit station id, with `seoul-<ARS number>` as a legacy alias; slugs for the shuttle and HSSC stops; aliases and stop areas), the stop list, the stop block, the live and timetable entries in configuration order, the next runs as scheduled arrivals, error codes, freshness and cost |
| [subway-api.md](reference/subway-api.md) | `GET /subway/stations/:stationId/arrivals` — the served stations, each field, what `source` means, counting down from `arrivalAt` with the device clock, `stopsAway` and the previous and next stations, the stale fallback and what `SUBWAY=off` stops, error codes and upstream data notes — and `GET /internal/subway/accuracy`, the error report by station, direction, horizon and source |
| [games-api.md](reference/games-api.md) | `GET /games` + `/games/:id` — the registry the app resolves a game id against before it opens a hosted game, what a push of the `games` dataset is checked for, and the first-party game origins |
| [logging.md](reference/logging.md) | What a log line contains (`event`, `reqId` = client id or CF-Ray), how to write one (lint-enforced), which lines become Sentry Issues, and what is never logged |
| [cicd-and-branch-protection.md](cicd-and-branch-protection.md) | This repository's GitHub workflows, what CI checks, where deploys run instead (outside this repository), and the rules that protect `main` |

### explanation (mechanisms and background)

| Document | Summary |
| --- | --- |
| [notices-architecture.md](explanation/notices-architecture.md) | What `/notices` and its routes serve, the crawler documents and tab files they read, the push dispatch, and which app screen reads which field |
| [map-architecture.md](explanation/map-architecture.md) | What `/map/config` and the three overlay routes serve, the `map-layer-sets` dataset and the collections they read, the glossary, and which app screen reads which field |
| [web-origins.md](explanation/web-origins.md) | Why every first-party host is a constant in `src/infra/origins.ts`, bridge vs CORS, the first-party mini-app table, and why the web view and media URL checks are strict |
| [bus-architecture.md](explanation/bus-architecture.md) | What `/bus` and its routes serve, the pollers, timetables and estimates behind them, and which app screen reads which field |
| [building-architecture.md](explanation/building-architecture.md) | What `src/building/` mirrors from SKKU's campus map, what each id means, the three routes, and which app screen reads which field |
| [app-config-architecture.md](explanation/app-config-architecture.md) | What `GET /app/config` tells the app at boot: the version gate and minimum OS per platform and the origins it may trust |
| [health-architecture.md](explanation/health-architecture.md) | What `/health` and `/health/ready` answer, who probes them, and what a 503 means |
| [meals-architecture.md](explanation/meals-architecture.md) | What `src/meals/` serves for the cafeteria-menu screen: the cafeterias it lists and where they come from, and the daily menus it reads from skkuverse-crawler on `GET /meals` |
| [calendar-architecture.md](explanation/calendar-architecture.md) | What `src/calendar/` answers about a date: the public holiday it mirrors from the official special-day calendar, the school rest day and the semester or vacation it reads from the rest days dataset and the crawled academic calendars, and what happens when a source fails |
| [journey-architecture.md](explanation/journey-architecture.md) | What `GET /journey/routes` plans for the route planner, the `journey-routes` dataset it reads, the doors departures come through and how each cited place resolves |
| [subway-architecture.md](explanation/subway-architecture.md) | What `src/subway/` serves about the stations nearest the two campuses, how a station is identified, where its data comes from, and what adding a station or a provider touches |
| [ui-architecture.md](explanation/ui-architecture.md) | What `/ui/home` and its four siblings serve, the datasets and modules they read, and which app screen reads which field |
| [miniapps-architecture.md](explanation/miniapps-architecture.md) | What `/miniapps` and its routes serve, the registry and manifests they read, the broadcast feed and its send path, and which app screen reads which field |
| [games-architecture.md](explanation/games-architecture.md) | What `/games` and `/games/:id` serve: the registry of hosted games, which says only whether and where the app may open each one, and which app screen reads which field |

### decisions (ADR)

| Document | Status |
| --- | --- |
| [0001-adopt-diataxis-docs-structure.md](decisions/0001-adopt-diataxis-docs-structure.md) | accepted |
| [0003-fcm-dispatch-cloud-function-claim-lease.md](decisions/0003-fcm-dispatch-cloud-function-claim-lease.md) | accepted (backfilled) |
| [0004-strict-config-pre-deploy-dry-load.md](decisions/0004-strict-config-pre-deploy-dry-load.md) | accepted (backfilled) |
| [0005-notice-dispatch-content-group.md](decisions/0005-notice-dispatch-content-group.md) | accepted |
| [0006-building-search-relevance-ranking.md](decisions/0006-building-search-relevance-ranking.md) | accepted |
| [0007-notice-ordering-key.md](decisions/0007-notice-ordering-key.md) | accepted |
| [0008-dispatch-age-gate-on-publication-date.md](decisions/0008-dispatch-age-gate-on-publication-date.md) | accepted |
| [0009-multi-origin-active-active.md](decisions/0009-multi-origin-active-active.md) | deprecated (superseded by 0012) |
| [0010-server-architecture.md](decisions/0010-server-architecture.md) | accepted |
| [0011-test-strategy.md](decisions/0011-test-strategy.md) | accepted |
| [0012-runtime-roles.md](decisions/0012-runtime-roles.md) | accepted (supersedes 0009's every-role seeding) |
| [0013-runtime-data-in-mongodb.md](decisions/0013-runtime-data-in-mongodb.md) | accepted |
| [0014-jongro-realtime-from-topis.md](decisions/0014-jongro-realtime-from-topis.md) | accepted |
| [0015-campus-shuttles.md](decisions/0015-campus-shuttles.md) | accepted |
| [0017-subway-arrivals.md](decisions/0017-subway-arrivals.md) | accepted |
| [0018-hssc-arrival-estimates.md](decisions/0018-hssc-arrival-estimates.md) | accepted |
| [0019-bus-live-api.md](decisions/0019-bus-live-api.md) | accepted |
| [0020-miniapp-push-link-policy.md](decisions/0020-miniapp-push-link-policy.md) | accepted |
| [0021-academic-calendar.md](decisions/0021-academic-calendar.md) | accepted |
| [0022-journey-and-call-spec.md](decisions/0022-journey-and-call-spec.md) | accepted |
| [0023-perimeter-ports.md](decisions/0023-perimeter-ports.md) | accepted |

### plans (work queues)

No plan is open. A finished plan moves to `archive/` as `<name>-YYYY-MM.md`.

### archive (historical)

| Document | Summary |
| --- | --- |
| [api-v2-migration-2026-03.md](archive/api-v2-migration-2026-03.md) | The 2026-03 envelope unification and v2 route cleanup, as a migration record |
| [flutter-client-guides-2026-03.md](archive/flutter-client-guides-2026-03.md) | The 2026-03 integration guides for the legacy Flutter client |
| [building-data-2026-03.md](archive/building-data-2026-03.md) | The 2026-03 building data survey and connections guide, from the legacy `project-docs.md` |
| [transit-route-planner-2026-10.md](archive/transit-route-planner-2026-10.md) | The route planner's implementation plan against ADR 0022: the PR sequence (a) to (h), the `journey-routes` dataset, the doors, the planner and the subway probes, as written |
| [7800-unified-arrivals-2026-10.md](archive/7800-unified-arrivals-2026-10.md) | The plan that brought 7800 onto `/bus/live` and the stop page and gave timetabled shuttles the same arrival shape, as written |

### Legacy (stubs and docs not yet migrated)

The two pointer stubs are kept for their inbound links.

| Document | Status |
| --- | --- |
| [notices-api-architecture.md](notices-api-architecture.md) | superseded: split into the docs above; only a pointer stub is left |
| [skku-notice-sources.md](skku-notice-sources.md) | deprecated: only a pointer stub is left. The sources' source of truth is `src/notices/sources.json` and the crawler's `sources.json` and coverage |

## Writing rules

### 1. Frontmatter (required)

Every doc starts with YAML frontmatter:

```yaml
---
title: <Title Case title>
type: how-to | reference | explanation | tutorial | adr | plan | postmortem
status: draft | accepted | superseded | deprecated
owner: spencer0124
last-updated: YYYY-MM-DD
audience: internal | public
---
```

- With `status: superseded` or `deprecated`, link the current source of truth at the top of the body.
- Update `last-updated` whenever you change a doc's substance.

### 2. Skeleton

After the frontmatter, always: one `# H1` per doc, then a `> one-line summary`. Then `##` sections, never skipping a level. Start a new doc from a copy of [`_template.md`](_template.md).

### 3. Point at the source, never copy a value

**Never hard-code a file path, a version, a count or a test count in a doc.** A doc that silently starts lying when the code changes was the root cause of this repository's drift (the Express layout frozen into the docs).

- ❌ `the notices logic is in features/notices/notices.routes.js`
- ✅ `the notices routes: src/notices/list/notices-list.controller.ts (source of truth)`
- When you need an example value, say "as of writing" or use a `<placeholder>`.

### 4. File names

- **kebab-case, lowercase, `.md`**
- ADR: `NNNN-kebab-title.md` (a zero-padded sequence number)
- Postmortem: `YYYY-MM-topic.md`
- ALL-CAPS only for GitHub's special files (`README`, `LICENSE`)

### 5. Formatting

- Every code fence **takes a language tag** (`bash`, `ts`, `js`, `json`, `jsonc`, `yaml`, `text`)
- Structured facts (parameters, paths, options) go in a table
- Notes and warnings use GitHub admonitions: `> [!NOTE]`, `> [!WARNING]`
- **Write the body in English.** This is a rule shared across the maintainers' repositories. The one exception is product copy shown to users (`label.ko`, i18n strings), which is data, not documentation; this repository declares those paths in `.conventions.json`.
  - This line once said "write the body in Korean". A Korean doc that remains has not been migrated yet: translate the part you touch.
- Lint: `npm run lint:md` (markdownlint-cli2). **The rules are `.markdownlint.jsonc`**, vendored from the maintainers' umbrella repository as the `conventions.markdownlint` contract and hash-locked. Do not edit it here: the maintainers change it at its source and run `sync_contracts.py pull`. Only which paths are checked (globs and ignores) stays local, in the root `.markdownlint-cli2.jsonc`. Module docs (`explanation/<module>-architecture.md`) follow [`_module-template.md`](_module-template.md) instead of `_template.md`; their fixed sections are checked by the MD043 override in `docs/.markdownlint-cli2.jsonc` and by the `module-docs` and `glossary-coverage` tests.

### 6. Lifecycle

- When you split a legacy doc into Diátaxis, move the settled knowledge to `reference/` or `explanation/` and shrink the original to a `status: superseded` stub (a table of pointers). Do not delete it: that keeps its git history and inbound links.
- A structural decision gets one ADR in `decisions/` (Context, Decision, Consequences).
- When you find a doc that disagrees with the code, fix it on the spot, or at least leave a `> [!WARNING]` stale banner.
