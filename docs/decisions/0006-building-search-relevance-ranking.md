---
title: Building Search — Relevance Ranking over a Declarative Tier Table
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-06
audience: internal
---

# 0006. Building Search — Relevance Ranking over a Declarative Tier Table

## Status

Accepted — 2026-08-06. Issue [#91](https://github.com/spencer0124/skkuverse-server/issues/91) (sub-issues #92–#96).

## Context

`GET /building/search` had three defects that compounded into "searching `27` shows random dormitory rooms, and a room only appears once you type its whole code".

**1. `spaceCd` was matched by exact equality.** `building.data.ts` pushed `{ spaceCd: query }` — an equality test, not a regex — so `27` could never match room `27101`. Rooms surfaced only when their *building name* happened to contain the digits ("제2공학관27동"). Buildings with digit-free names lost entirely: `q=204` returned **9** rows when 100 rooms contain `204`, because 법학관's `20401`, `20404`, … are reachable only through their own code.

**2. There was no `.sort()` anywhere.** `explain` showed `LIMIT → FETCH(regex post-filter) → IXSCAN campus_1` with **no SORT stage**. Which 20 of 209 matches a user saw was arbitrary physical order — and `building.sync.ts` phase 3 ends with `deleteMany({syncedAt: {$lt: syncTime}})` followed by re-upserts, so that order **reshuffled every 7 days**. Dormitory rooms named `남자숙실(1227)` matched on `name.ko` and could occupy the entire window. The reported bug was therefore not reliably reproducible week to week.

**3. Counts were a second, hand-written copy of the predicate.** `countSearchSpaces` rebuilt the same `$or` independently, so the two could drift; and it counted all 209 while the list returned 20, so the badge contradicted the visible rows.

## Decision

### The ranking signal comes from SKKU's numbering, not a heuristic

`toDisplayNo()` strips the campus digit from `buildNo`: `"227"` + `nsc` → `"27"`. The user-facing 건물번호 *is* `displayNo`, and SKKU codes every room in that building as `displayNo` + floor + room — `27101`, `27422`. The same holds on HSSC (수선관별관 `displayNo` 62 → rooms `627xx`).

So **"`spaceCd` starts with the query" is literally "rooms in building N"**. That is why `spaceCd` prefix is the top tier: it is the university's own scheme, not something we invented.

### Tiers are declarative data, compiled two ways

`src/building/building.search.ts` holds a tier table compiled to a Mongo `$switch` for production and to a JS predicate (`scoreLocally`) for tests. Both derive their pattern from one `tierRegex()`.

This shares the **pattern**, not the execution — MongoDB matches with PCRE2, the twin with the JS engine. That is safe only because the table emits an escaped literal with optional anchors, where the two agree. Do not add free-form patterns without re-checking that.

The payoff is testability: the four search functions previously had **no direct test** (every case stubbed `BuildingService` wholesale), which is exactly how an equality survived. Ranking intent is now pinned by pure unit tests with no MongoDB.

Room tiers, highest first: `spaceCd` exact (60) → `spaceCd` prefix (50) → `buildingName` prefix (40) → `name` prefix (30) → `spaceCd` substring (20) → `buildingName` substring (10) → `name` substring (5).

Sort is a **total order** — `{_score: -1, spaceCd: 1}` for rooms, `{_score: -1, _id: 1}` for buildings — so output is stable across syncs. `_id` is safe for buildings because it is the SKKU-assigned **integer** id, upserted by `{_id: skkuId}`, and sync never deletes from `buildings`; an ObjectId would not be, since the spaces delete/reinsert cycle regenerates those.

### Buildings match `displayNo`, never `buildNo`

`buildNo`'s leading digit is an internal campus prefix (1 = hssc, 2 = nsc), so `buildNo: /^27/` would surface `270` 대강당, `271` 의학관, `272` 체육관 to someone who meant building 27.

### Rows and counts come from one `$facet`

Six collection scans per request became two, and divergence became structurally impossible rather than merely unlikely.

Counts stay **campus-agnostic on purpose** — they feed the app's campus toggle badge and must report both campuses regardless of the `campus` param. The keyword `$match` is therefore campus-free at the top and `campus` is applied inside the rows facet only. Hoisting `{campus}` up would restore an `IXSCAN campus_1` but silently break the badge; that optimisation is rejected.

### Row caps sized from the data

`SPACE_SEARCH_LIMIT = 1000`, `BUILDING_SEARCH_LIMIT = 100`.

| measured | value |
| --- | --- |
| Largest single building (기숙사신관 `298`) | **801 rooms** |
| Widest realistic building-number query (`q=29`) | 895 |
| Pathological one-character query (`q=실`) | 6173 |
| Row size | ~247 B avg |

1000 returns every room of any building on either campus (~250 KB worst case). Removing the cap entirely was rejected: `q=실` would ship ~1.5 MB to a phone.

The useful side effect: for any query under the cap, `meta.spaceCount === meta.counts.space.total`. The app renders the row count in the section header and the uncapped count on the campus tab, so raising the cap makes them agree **by construction** — the badge contradiction closes with no app release. `meta.limits` ships additively so a pathological query records the cut instead of presenting 1000 rows as the whole result.

### The legacy `/search/*` proxy is deleted

`src/search/*` was a live axios proxy to `campusMap.do` — no DB, no ranking, four sequential upstream calls per request. It existed for old app clients; the current app never calls it. Keeping it meant a second, unranked search surface that nothing exercised. Old clients now 404 there, which is accepted.

The auth-before-rate-limiter invariant it carried was **preserved, not dropped**: `__tests__/nest/common/auth-ratelimit-order.test.ts` moved to `POST /ad/events`, the only remaining route pairing `FirebaseAuthMiddleware` with a `byUidOrIp` limiter.

## Consequences

**Cost, stated honestly.** ~1242 docs examined (~4 ms) became 7691 (~20 ms) per scan. You cannot rank a set you have not enumerated, and **no index removes this**: a `$or` uses index-union only if *every* branch is indexed, and `name.*` / `buildingName.*` are not, so the plan is `SUBPLAN → COLLSCAN` regardless — `$options: "i"` would defeat prefix-anchoring anyway. Net across the endpoint it is still a win (six scans → two). `spaces` is ~2.5 MB and fully cached.

**Landmines encoded in the code.** Two production rows carry `spaceCd: null`, and `$regexMatch` **throws** on non-string input — every scored path is wrapped in `$ifNull`, which is load-bearing, not padding. Exactly one row has a lowercase code (`712115b`), so matching is case-insensitive rather than uppercase-normalised.

**Watch the `$facet` ceiling.** Each facet stage is capped at 100 MB and **cannot** spill to disk (`allowDiskUse` does not apply); the emitted document is bound by the 16 MB BSON limit. At 1000 rows × ~247 B this is far away, but it is the first thing to break if `spaces` grows.

**Future upgrade path.** If `spaces` grows ~10×, Atlas Search with an `autocomplete`/`edgeGram` mapping on `spaceCd` is the only thing that removes the collscan (`searchIndexesCount` is currently 0 cluster-wide). Not this change.

## Verification

Against the production `skkumap` cluster:

- `q=27` → 293 matches (nsc 269 + hssc 24, matching SKKU upstream exactly), all 293 returned; first rows `27101, 27102, 27104…` all 제2공학관27동; dormitory rows last. Tiers: 168 prefix / 105 code-substring / 20 name-only.
- `q=204` → **9 → 100**; first rows `20401, 20404, 20405…` all 법학관.
