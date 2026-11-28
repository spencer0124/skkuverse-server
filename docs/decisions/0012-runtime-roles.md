---
title: Runtime Roles — Pollers Write, Api Replicas Read
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-11-28
audience: internal
---

# 0012. Runtime Roles — Pollers Write, Api Replicas Read

> What each `ROLE` (`poller`, `api`, `combined`) may do: who calls upstream APIs, who writes MongoDB, what an api replica may do at boot, which configuration each role needs, and how soon one process's write reaches the others. Read it before you add a poller, a boot hook, a required variable or a cache in front of data another process writes. Accepted 2026-10-19 (PR #288).

## Context

- One image boots three ways (`src/main.ts`). Production runs one poller and several api replicas against one shared database.
- The role used to gate only the poller timers; every module and boot hook loaded everywhere. So a read could fall back to what a poller held in the same process, which only `combined` has, and a local run answered differently from production; api replicas seeded collections and ran index DDL at boot on collections other processes write; an api replica needed the pollers' upstream keys to boot; and a script's or poller's write reached the replicas only after a TTL of up to an hour, or a restart.
- Runtime data moving into MongoDB ([ADR 0013](0013-runtime-data-in-mongodb.md)) relies on one guarantee: a writer stores it, and every replica reads the same thing soon after.

## Decision

### D1. Pollers write; api replicas read

A process that runs pollers (`poller`, `combined`) calls the upstream data APIs (HSSC, TOPIS, the Seoul subway API and train map, NAVER, TMAP, data.go.kr, the SKKU campus map, the first-party mini-app manifest origins) and writes what it learns to MongoDB. An api replica reads MongoDB through caches and calls none of them, at boot or while serving. Scripts and other repositories (skkuverse-crawler) are writers too.

A read that serves a client takes its data from MongoDB only, never from a value a poller holds in the same process, so `combined` and `api` answer alike for the same stored data. State a poller carries from tick to tick (an HSSC bus's first sighting, a Jongro vehicle's last observation, a pending registry change) stays in its memory and reaches clients only through what it writes. `__tests__/nest/infra/api-role-boot.test.ts` pins that an api boot fetches nothing.

### D2. Four request-scoped upstream calls stay in api

An api replica calls an upstream only on behalf of the request it serves, and only for: the notice attachment proxy, the FCM Cloud Function for notice dispatch and for mini-app push, and Firebase ID token verification. Any other upstream call belongs in a poller.

### D3. No writes at boot from api

An api replica inserts, updates and deletes nothing and creates no index or collection while it boots (`api-role-boot.test.ts`); `ensureIndexesAtBoot` runs only where pollers run. The deploy rolls the api replicas first and the poller last, so **a new or renamed index that an api read or write depends on ships one deploy ahead of the code that needs it**. Rejected: a separate `ROLE=migrate` job for index DDL, one more deploy step for idempotent `createIndex` calls the poller makes anyway.

A collection that must hold a document before anything can serve it gets it from a writer, never from a committed snapshot: the Jongro poller bootstraps a missing registry route from TOPIS, and the daily route-line sync writes a missing line.

Rejected: every role seeding the Jongro registry and route lines at boot, so that a host with no poller could serve on its first deploy ([ADR 0009](0009-multi-origin-active-active.md)). A poller ships in every deploy.

### D4. Required configuration follows the role

Each required value names the roles that need it (`src/infra/required-env.ts`): `poller` for the upstream keys only pollers use, `api` for what only serving uses (the NAVER map style, the internal dispatch token, the notices start date), `all` for both (MongoDB, the FCM function). A process exits at boot naming each missing value its role needs and ignores the rest. A value read in a role that does not require it throws at its first read, so a wrongly scoped value fails loudly instead of becoming `undefined` in a URL; never spread a `config` section that holds one: the spread reads every getter and throws in the role that lacks it. One rendered `.env` still feeds every container; the scope is what boot requires, not what is present.

### D5. Runtime switches gate writers only

A switch that turns a poller off (`SUBWAY`, `SHUTTLE_ETA`, `GBIS`) stops its upstream calls and writes, and does not change what an api replica reads: with nothing fresh written, a read serves what its own rules serve for missing data.

A poller that spends no paid quota and writes only its own environment's database gets no switch: the mini-app manifest pollers fetch the production origins from development too (mini apps have no development origin), one anonymous GET per origin every four minutes.

### D6. Freshness by TTL, not by cross-process signals

A process sees another's write when its cache entry expires; no writer notifies readers and nothing restarts them. Rejected: a shared version document readers poll, which every writer, scripts included, must bump. A cache's bound is its TTL only if, once the TTL has passed, a read waits for the reload instead of answering from the expired value: true with no stale window, or with `serveStale: "on-reload-failure"` (`src/infra/cached-loader.ts`). A cache whose stale window also answers while a reload runs (the default mode) is late by up to TTL plus one reload, and states its bound that way. A writer may clear its own process's cache after a write. Each reader's spec that cites this decision pins its bound. A cache on top adds its TTL: the festival event overlay routes serve a `map-layer-sets` push within about 65 s (`EVENT_CACHE_TTL_MS` over the 60 s dataset read).

Reference data that a database outage must not take down (bus schedules and overrides, stored holidays, route lines, datasets, mini-app manifests) keeps a stale window that covers only a failed reload: it serves the last good value and logs `cache.reload_failed`. In that mode the first read after each TTL waits for the reload, so while the database is unreachable such a read can stall for up to `serverSelectionTimeoutMS` (`src/infra/db.ts`) about once per TTL; accepted.

## Consequences

- **`combined` is an honest local copy of production**: a stopped poller shows locally as it does in production, as empty realtime data.
- **api replicas boot and scale without the pollers' keys or quotas**, and a failing upstream cannot slow an api boot.
- **A fresh `_dev` or `_test` database serves no bus configuration until the poller has bootstrapped every Jongro route from TOPIS, which needs buses running**, so overnight it waits for the morning. `/bus/config` and the ui transit routes read every Jongro route at once and answer 503 as a whole until the last is stored; no route line serves until the first daily sync. The resync how-to inserts a route by hand.
- **An index exists only after a poller boots.** If the poller never boots, api serves without the indexes it relies on; readiness and the deploy cover that case.
- **Shorter TTLs cost reads**: a one-minute schedule cache adds a few reads per second across all processes. If database load shows a step, the TTL and the bound rise together.
- **Exactly one poller stays an assumption**: daily caps, the registry's pending counts and the freezing of shuttle estimates rely on it. A second poller needs leader election first (ADR 0009).
- The Hyehwa station route (`GET /bus/station/:stationId`) was deleted, not ported: the app does not call it, and its upstream answered "no result" in every recorded sample.
