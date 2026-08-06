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

### Row caps are split into two bands

A single flat cap cannot serve both goals. Measured on prod:

| measured | value |
| --- | --- |
| Largest single building (기숙사신관 `298`) | **801 rooms** |
| Widest building-number query (`q=29`) | 895 |
| `q=연구` | 1765 |
| `q=기숙` | 1728 |
| `q=실` | 6173 |
| Row size | ~247 B avg |

Keeping every building whole needs ~1000. But the app renders results in a plain `ScrollView` with an eager `.map()` (`SearchScreen.tsx:274,374`), both sections force-expanded on every keystroke and **no minimum query length** — so every returned row is mounted at once, ~8 React elements each. A flat 1000 would mean `q=연구` mounts ~8000 elements; typing "27101" with a pause after the first digit would do it on `q=2`. The old ceiling was 20 rows.

So the cap is split by relevance band:

- **strong** — `_score >= SPACE_STRONG_MIN_SCORE` (50), i.e. the query is a prefix of the room's own code. That *is* "rooms in building N", so it is returned in full (cap 1000, above the 801-room maximum).
- **weak** — everything the query merely appears inside. Capped at 100.

| query | strong | weak | shipped |
| --- | --- | --- | --- |
| `27` | 168 | 100 | 268 of 293 |
| `204` | 100 | 100 | 200 |
| `298` | 801 | 100 | 901 |
| `연구` | 0 | 100 | **100** (was 1000) |
| `실` | 0 | 100 | **100** (was 1000) |

Buildings use the same shape with the cut below the name-substring tier, so description-only matches (a field the results list never renders — `q=관` has 29 of them) are capped at 10 instead of padding the list.

Concatenating strong then weak preserves relevance order for free, since every strong score is by definition above every weak one. `_score` is computed once before the `$facet` rather than inside each band — both bands read it, so hoisting costs one pass instead of two.

Removing the cap entirely was rejected: `q=실` would ship ~1.5 MB and 6173 rows to a phone.

**The band split does not bound a short NUMERIC query, and it was never going to.** `spaceCd` prefixes are dense at one digit: `^2` matches **1839** rooms, `^9` 1122, `^7` 848. Those are genuinely strong matches, so they fill the strong band up to its 1000 cap — and `q=2` is exactly what fires while a user types "27101" with a pause. The server cannot distinguish that from someone who means building 2.

So the client-side cost is fixed on the client: `skkuverse-app` now renders results in a `FlatList` instead of a `ScrollView` with an eager `.map()` (branch `feat/search-virtualized-list`). The two changes are complementary — the band split removes the *pointless* rows (`q=연구`: 1765 → 100) and virtualization removes the *rendering* cost of the legitimate ones (`q=298`: 801 rooms windowed instead of mounted). Neither alone is sufficient.

The useful side effect: for a query under the cap **and no `campus` filter**, `meta.spaceCount === meta.counts.space.total`. The app renders the row count in the section header and the uncapped count on the campus tab, so raising the cap makes those agree — the badge contradiction closes with no app release. With `?campus=` set the two legitimately differ (`spaceCount` is campus-scoped, `counts` is campus-agnostic by design); the app is unaffected because it reads the badge from a separate campus-less request. `meta.limits` ships additively so a pathological query records the cut instead of presenting a truncated list as the whole result.

### The legacy `/search/*` proxy is deleted

`src/search/*` was a live axios proxy to `campusMap.do` — no DB, no ranking, four sequential upstream calls per request. It existed for old app clients; the current app never calls it. Keeping it meant a second, unranked search surface that nothing exercised. Old clients now 404 there, which is accepted.

The auth-before-rate-limiter invariant it carried was **preserved, not dropped**: `__tests__/nest/common/auth-ratelimit-order.test.ts` moved to `POST /ad/events`, the only remaining route pairing `FirebaseAuthMiddleware` with a `byUidOrIp` limiter.

## Consequences

**Cost, stated honestly.** ~1242 docs examined (~4 ms) became 7691 (~20 ms) per scan. You cannot rank a set you have not enumerated, and **no index removes this**: a `$or` uses index-union only if *every* branch is indexed, and `name.*` / `buildingName.*` are not, so the plan is `SUBPLAN → COLLSCAN` regardless — `$options: "i"` would defeat prefix-anchoring anyway. Net across the endpoint it is still a win (six scans → two). `spaces` is ~2.5 MB and fully cached.

**Landmines encoded in the code.** `$regexMatch` **throws** on non-string input — verified against the cluster, the error is `$regexMatch needs 'input' to be of type string`. Two production rows already carry `spaceCd: null`, so every scored path is coerced before matching.

The coercion tests `$type`, **not** `$ifNull`. `$ifNull` covers null and missing but would still hand a *number* to `$regexMatch`. `building.sync.ts` passes SKKU's JSON values straight through, and `SkkuSpaceListItem.spaceCd: string` is a compile-time assertion about an external payload, not a runtime guarantee. Had SKKU ever emitted `"spaceCd": 27101` as a number, one row would have made the aggregate throw and **every** `/building/search` request 500 — for every query, not just ones touching that row. The old `find({spaceCd: {$regex}})` merely failed to match. An unguarded `$ifNull` would therefore have converted a one-row data blip into a total endpoint outage. `readPath` in the JS twin uses the same `typeof === "string"` rule so the two compilers cannot disagree on non-string scalars.

Exactly one row has a lowercase code (`712115b`), so matching is case-insensitive rather than uppercase-normalised.

**Watch the `$facet` ceiling.** Each facet stage is capped at 100 MB and **cannot** spill to disk (`allowDiskUse` does not apply); the emitted document is bound by the 16 MB BSON limit. At 1000 rows × ~247 B this is far away, but it is the first thing to break if `spaces` grows.

**Future upgrade path.** If `spaces` grows ~10×, Atlas Search with an `autocomplete`/`edgeGram` mapping on `spaceCd` is the only thing that removes the collscan (`searchIndexesCount` is currently 0 cluster-wide). Not this change.

## Verification

Against the production `skkumap` cluster:

- `q=27` → 293 matches (nsc 269 + hssc 24, matching SKKU upstream exactly), all 293 returned; first rows `27101, 27102, 27104…` all 제2공학관27동; dormitory rows last. Tiers: 168 prefix / 105 code-substring / 20 name-only.
- `q=204` → **9 → 100**; first rows `20401, 20404, 20405…` all 법학관.
