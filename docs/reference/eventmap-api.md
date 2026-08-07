---
title: Event Map API Reference
type: reference
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-08-06
audience: internal
---

# Event Map API

> Storage, materialization and HTTP contract for the temporary event map layer. Cross-repo ownership
> is [ADR 0004](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md);
> the client side is [skkuverse-app `docs/eventmap-rendering.md`](https://github.com/spencer0124/skkuverse-app/blob/main/docs/eventmap-rendering.md).

## 1. Summary

| | |
| --- | --- |
| Route prefix | `/eventmap` (public), `/internal/eventmap` (shared-secret) |
| Database | `eventmap` (`_dev` / `_test` via `devDbName()`) |
| Collections | `places`, `sessions`, `activations`, `snapshots` |
| Auth | none on public routes; `X-Internal-Token` on publish |
| Rate limit | `BusRateLimitMiddleware` on `eventmap` only |
| Writes | materializer poller (`ROLE !== "api"`) + force-publish endpoint |

The existing `/map/config` is **not** extended — see ADR 0004. The two map systems are independent
so a failure in one cannot take down the other.

The map itself is generic: it renders **places**. A booth is a place, addressed exactly like a
building. Everything event-specific reaches the user through the **action union** (§8) on sheet
buttons.

## 2. Storage tiers

Config is split by **who edits it**, not by what it is.

| Tier | Home | Edited by | Change cost |
| --- | --- | --- | --- |
| Structure — layers, chips, filters, sorts, card templates, icons | `src/eventmap/config/*.json` | developer | PR + deploy |
| Activation — `activeFrom`, `activeUntil`, `enabled` | Mongo `activations` | ops | one field |
| Content — places, sessions | Mongo `places`, `sessions` | ops | one field |

> [!WARNING]
> Any new `.json` under `src/` must be registered in `scripts/copy-build-assets.js`. `tsc` does not
> copy JSON, and a miss breaks **production only** — dev reads from `src/`.

## 3. Config wiring

`src/infra/config.ts`, after the `notices` block:

```ts
  eventmap: {
    // Strict: no fallback. A missing MONGO_EVENTMAP_DB_NAME must crash at boot
    // rather than silently writing event content into bus_campus.
    dbName: devDbName(process.env.MONGO_EVENTMAP_DB_NAME),
    collections: {
      activations: "activations",
      places: "places",
      sessions: "sessions",
      snapshots: "snapshots",
    },
    materializeIntervalMs:
      parseInt(process.env.EVENTMAP_MATERIALIZE_INTERVAL_MS || "", 10) || 60_000,
    manifestCacheTtlMs: 15_000,
  },
```

Add `["eventmap.dbName", config.eventmap.dbName, "MONGO_EVENTMAP_DB_NAME"]` to `required[]` — and to
the **same list mirrored in `src/config/env.validation.ts`**, which is what actually throws at Nest
bootstrap. Adding it in only one place leaves the bootstrap silently permissive: the deploy
workflow's pre-deploy dry-load still passes and the container boots missing config. `jest.setup.ts`
needs the var too, or every suite that transitively imports config logs a spurious FATAL.

> [!WARNING]
> **Deploy ordering.** `config.ts` validates required env at boot with `process.exit(1)`. Set
> `MONGO_EVENTMAP_DB_NAME` on the host **before** deploying the code that requires it, or the deploy
> workflow's config dry-load aborts and `git checkout $PREV_COMMIT`.

## 4. Collections

### 4.1 `places` — the physical plot

```ts
export type Campus = "hssc" | "nsc";   // mirrors src/building/types.ts

export interface PlaceDoc {
  /** HUMAN-AUTHORED slug, not ObjectId — the ops coordinate sheet is keyed by it. */
  _id: string;                    // "nsc-plaza-a3"
  layerSetId: string;
  campus: Campus;                 // closed union: an unexpected value is a data bug
  name: I18n;                     // "A-3 구역" — the PLOT, not the occupant
  /**
   * GeoJSON Point, [lng, lat], as BuildingDoc.location. REQUIRED — a place without
   * coordinates cannot be drawn, and a nullable field would only defer the failure
   * to render time. A plot exists once surveyed, and not before (§10).
   */
  location: { type: "Point"; coordinates: [number, number] };
  zone?: string | null;           // "우측 구역" — the stackKey fallback lever
  tags: string[];
  lifecycle: "draft" | "active" | "retired";   // never delete
  updatedAt: Date;
  extensions?: Record<string, unknown>;
}

/** ko required. Resolution at materialization: text[lang] ?? text.en ?? text.ko. */
export interface I18n { ko: string; en?: string; zh?: string }
```

### 4.2 `sessions` — one occupancy interval

The source of every wire item.

```ts
export interface SessionDoc {
  _id: string;                    // "eskara-2026-d1-cse-booth"
  layerSetId: string;
  placeId: string;                // → PlaceDoc._id, joined by the materializer only
  campus: Campus;                 // denormalized → index-only scans

  /** Occupant embedded with a SOFT slug, not a tenants collection (§4.5). */
  tenant: { id: string | null; name: I18n; kind: string };

  title: I18n;
  subtitle?: I18n | null;
  category: string;               // OPEN string — "전시" next year must be a Mongo edit
  tags: string[];

  dayIndex: number | null;
  /** Civil festival day, "2026-09-16". NOT derivable from startAt: a 22:00–02:00
   *  session belongs to day 1 but ends on day 2's UTC date. */
  date: string | null;
  slot: string | null;            // "day" | "night" | null — OPEN string
  startAt: Date | null;           // ABSOLUTE instant; null = always-on / unknown
  endAt: Date | null;
  hoursLabel?: I18n | null;

  media: { thumbnailUrl: string | null; images: string[] };
  actions: SessionAction[];       // → item.actions (§8)
  fields?: Record<string, I18n | string | number>;

  order: number;
  /**
   *  draft     → never materialized
   *  published → materialized
   *  hidden    → ops kill switch, recoverable
   *  cancelled → MATERIALIZED as closed + badge. A cancelled booth must be VISIBLY
   *              cancelled, not silently absent — people walk there otherwise.
   */
  lifecycle: "draft" | "published" | "hidden" | "cancelled";
  deletedAt: Date | null;
  updatedAt: Date;
}
```

### 4.3 `activations` — the ops lever

```ts
export interface ActivationDoc {
  _id: string;                    // layerSetId, "eskara-2026"
  activeFrom: Date | null;        // null = unbounded
  activeUntil: Date | null;
  /** One-field kill switch. `false` takes the event map down immediately. */
  enabled: boolean;
  updatedAt: Date;
}
```

`activeUntil` should run to the morning **after** the last day. 주점 end after midnight and people
check the map going home; cutting at 00:00 flips the map back while users are still on site.

### 4.4 `snapshots` — the published bundle

```ts
export interface SnapshotDoc {
  _id: string;                    // `${layerSetId}:${version}:${lang}`
  layerSetId: string;
  version: number;                // monotonic per layerSetId
  lang: "ko" | "en" | "zh";       // text resolved server-side, so lang is identity
  payload: EventMapSnapshot;
  etag: string;
  /** md5 over INPUTS ONLY — configVersion + sorted [_id, updatedAt] of contributors.
   *  EXCLUDES `now`, so an idle tick produces no version. Otherwise
   *  `immutable, max-age=1y` would thrash every 60 seconds. */
  contentHash: string;
  materializedAt: Date;
  publishedAt: Date;
  /** null for the ACTIVE version — Mongo's TTL monitor ignores non-Date values,
   *  so an active snapshot is never reaped. Superseded versions get now + 7d. */
  gcAt: Date | null;
}
```

### 4.5 Why there is no `tenants` collection

A tenant table buys a canonical club profile and cross-event identity — neither needed, and with no
admin UI every write is hand-typed JSON where a dangling FK fails silently. The one query it enables
is answered by `["has","tenant:cse-council"]` against the flat tag array at zero join cost. OSM,
Overture and Foursquare all fold occupant into the place record for pop-ups. `tenant.id` preserves
the upgrade path: sessions already carry the join key.

## 5. Indexes

Created by `ensureIndexes()` in `eventmap.data.ts`, called **non-fatally** from `onModuleInit`, as
`building` and `ad` do.

| Collection | Index | Why |
| --- | --- | --- |
| `places` | `{layerSetId, lifecycle}` | materializer's primary scan |
| `places` | `{location: "2dsphere"}` | **not** for `$near` — it makes Mongo reject a malformed coordinate pair at insert, the cheapest guard against the `[lng,lat]` swap |
| `sessions` | `{layerSetId, lifecycle, deletedAt}` | materializer scan |
| `sessions` | `{layerSetId, placeId}` | join side, and "what else is on this plot" |
| `sessions` | `{layerSetId, dayIndex, slot}` | the axis query; also the shape ops type into Atlas by hand |
| `sessions` | `{layerSetId, startAt}` | `nextChangeAt` = min future boundary |
| `activations` | `{enabled}` | manifest read path |
| `snapshots` | `{layerSetId, version, lang}` **unique** | serve latest **and** the concurrency primitive (§6.3) |
| `snapshots` | `{gcAt}` TTL `expireAfterSeconds: 0` | reap superseded versions |

No text index — substring search over ~50 items is a client-side `.filter()`.

## 6. Materialization

### 6.1 Structure

| Module | Responsibility |
| --- | --- |
| `eventmap.materialize.ts` | **Pure.** No DB, no clock — both injected. Carries the 75 % line-coverage gate cheaply, as `weightedRandomSelect` does in `src/ad/ad.data.ts` |
| `eventmap.data.ts` | Raw-driver I/O, `ensureIndexes`, `seedIfEmpty` |
| `eventmap-materializer.service.ts` | Registers with `PollerRegistryService` (60 s) |

Use `PollerRegistryService`, **not** `@nestjs/schedule` — the registry provides the in-flight guard,
the warm-up immediate run, and `.catch().finally()` semantics.

### 6.2 One pass

1. Load the enabled activation whose window contains `now`. None → publish nothing.
2. Load `places` (`lifecycle: "active"`) and `sessions` (`lifecycle ∈ {published, cancelled}`, `deletedAt: null`).
3. `assertValidConfig()` — dangling `cardTemplateId` / `iconId` / `sortId`, unknown predicate nodes, duplicate ids, empty layers. **On failure: log and skip.** The previous snapshot stays live.
4. Join session → place. **The one and only coordinate conversion site:**

   ```ts
   // Mongo/GeoJSON is [lng, lat]; the wire carries NAMED lat/lng and no positional
   // tuples. location is non-nullable, so there is no null branch to forget.
   const lngLat = place.location.coordinates;
   const lat = lngLat[1];
   const lng = lngLat[0];
   ```

   Convention, enforced by review: any variable holding a GeoJSON pair is named `lngLat`.
5. Build `tags[]` (§6.4).
6. Compute `status` as of `materializedAt`:

   | Condition | Status |
   | --- | --- |
   | `startAt == null && endAt == null` | `open` (always-on facilities) |
   | `lifecycle === "cancelled"` | `closed` + `fields.cancelled` |
   | `now < startAt` | `upcoming` |
   | `startAt <= now < endAt` | `open` |
   | `now >= endAt` | `closed` |
   | only one bound set | `unknown` |

7. `nextChangeAt` = min `{startAt, endAt}` strictly greater than `now`, else `null`.
8. Resolve i18n per lang → three payloads.
9. `contentHash` over inputs only. Equal to the active snapshot's → **return, no write.**
10. `version = max + 1`; ETag per payload; `insertMany([ko,en,zh], {ordered:false})`; previous version's `gcAt = now + 7d`.
11. Clear the manifest memo.

### 6.3 ROLE topology — who may publish

`PollerRegistryService.onApplicationBootstrap` starts pollers only when `ROLE !== "api"`, so the
scheduled materializer runs on **exactly one process**.

The real race is force-publish, which must live on the api replicas so it works when the poller is
wedged — and there are two. **There is deliberately no lock collection:** both replicas compute the
same `contentHash` → same version → same `_id`, so the unique index makes one win with a duplicate-key
`11000` and the loser re-reads, the idiom already in `ad.data.ts:seedIfEmpty`. Both serve
byte-identical bytes, so the race is correct by construction. Document this, or the next reader will
"fix" it with a lock.

`ROLE=combined` also runs pollers — right for dev, but never run one alongside the production
topology or two writers race the version counter.

### 6.4 Tag generation

| Source | Tag |
| --- | --- |
| `category` | `cat:<category>` |
| `dayIndex` | `day:<n>` |
| `slot` | `slot:<slot>` |
| `tenant.id` | `tenant:<id>` |
| `tenant.kind` | `kind:<kind>` |
| `placeId` | `place:<id>` |
| `place.zone` | `zone:<zone>` |
| author-supplied | `...session.tags`, `...place.tags` |

Lowercased, nulls dropped, deduplicated. `status` is **not** a tag — it is a separate predicate node
kind because the client recomputes it against the device clock (§9).

## 7. Endpoints

### 7.1 `GET /eventmap/manifest`

`ETag` · `Cache-Control: public, max-age=15` · `Vary: Accept-Language`

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "schemaVersion": 1,
    "activeLayerSetId": "eskara-2026",
    "version": 17,
    "snapshotUrl": "/eventmap/snapshot/eskara-2026/17?lang=ko",
    "refreshAfterSec": 60,
    "nextChangeAt": "2026-09-16T03:00:00.000Z",
    "publishedAt": "2026-09-15T23:40:11.000Z"
  }
}
```

`activeLayerSetId: null` (with `version`/`snapshotUrl` null) when nothing runs. `snapshotUrl` is
formed **entirely server-side including `?lang=`** — the client never builds it. `refreshAfterSec` is
server-driven polling: `300` normally, `60` during an event.

This handler must **never throw**; any DB error degrades to `activeLayerSetId: null`.

### 7.2 `GET /eventmap/snapshot/:layerSetId/:version?lang=ko`

`ETag` · `Cache-Control: public, max-age=31536000, immutable` · `Vary: Accept-Language`

Validation order is the repo rule — **400 → 404 → 304**:

1. `version` not a positive integer, or `lang` ∉ `{ko,en,zh}` → `400 INVALID_PARAM`
2. no snapshot for `(layerSetId, version, lang)` → `404 SNAPSHOT_NOT_FOUND`
3. `If-None-Match` matches the stored ETag → `304`
4. otherwise `sendSuccess(req, res, payload)` via `@Res()`

An unknown id with a stale `If-None-Match` returns **404, not 304**. Pin this in a test.

Payload (abridged; structure and items travel together so a layer toggle costs zero network):

```jsonc
{
  "schemaVersion": 1,
  "id": "eskara-2026", "version": 17, "lang": "ko",
  "materializedAt": "…", "nextChangeAt": "…", "timezone": "Asia/Seoul",
  "campus": "nsc", "camera": { "lat": 37.29412, "lng": 126.97633, "zoom": 17.2 },

  "icons": {
    "bar":     { "kind": "remote", "uri": "https://skkuverse.com/eventmap/eskara-2026/bar.png", "width": 32, "height": 40 },
    "generic": { "kind": "symbol", "symbol": "green" }
  },

  "layers": [
    { "id": "food", "render": "pin", "label": "먹거리", "defaultVisible": true,
      "filter": ["hasAny", ["cat:food", "cat:bar"]], "minZoom": 15,
      "iconId": "generic", "sortId": "manual" }
  ],

  "chipGroups": [
    { "id": "day", "selection": "single", "chips": [
      { "id": "day_all", "label": "전체", "defaultSelected": true, "predicate": ["all"] },
      { "id": "day_1",   "label": "1일차", "predicate": ["has", "day:1"] } ] },
    { "id": "now", "selection": "multi", "chips": [
      { "id": "open_now", "label": "지금 운영중", "predicate": ["status", ["open"]] } ] }
  ],

  "sorts": [
    { "id": "manual", "label": "추천순", "by": "order" },
    { "id": "title",  "label": "이름순", "by": "title" }
  ],

  "items": [{
    "id": "eskara-2026-d1-cse-booth",
    "placeId": "nsc-plaza-a3", "stackKey": "nsc-plaza-a3",
    "lat": 37.294118, "lng": 126.976334,
    "title": "소융대 티셔츠 부스", "subtitle": "정보통신대학 학생회",
    "tags": ["cat:food", "day:1", "slot:day", "tenant:cse-council", "place:nsc-plaza-a3"],
    "status": "open",
    "startAt": "2026-09-16T03:00:00.000Z", "endAt": "2026-09-16T07:00:00.000Z",
    "hoursLabel": "12:00–16:00",
    "iconId": "bar", "iconIdClosed": "bar_off", "pinPriority": 10,
    "cardTemplateId": "booth",
    "actions": [
      { "id": "entry", "label": "입장 안내", "style": "primary",
        "actionType": "webview",
        "actionValue": "https://webview.skkuuniverse.com/#/eskara/entry" },
      { "id": "sponsor", "label": "후원사 페이지", "style": "secondary",
        "actionType": "external", "actionValue": "https://example.com/sponsor" }
    ]
  }]
}
```

~50 items × ~600 B ≈ 30 KB, gzipping under 10 KB.

**`items[]` carries flat `lat`/`lng`, never GeoJSON.** Naver RN takes flat scalars; GeoJSON adds a
per-render transform plus payload bloat, and RFC 7946 §6.1 defines no processing model for foreign
members. GeoJSON stays in Mongo where it earns the 2dsphere index.

**`stackKey`** groups items sharing a plot so the client draws one marker. Normally `placeId`; set it
to `zone` if 대운동장 is too dense — a server edit, no data change, no app release.

### 7.3 `POST /internal/eventmap/publish`

`X-Internal-Token` + `crypto.timingSafeEqual`, copied from `notices.internal.controller.ts`.
`@HttpCode(200)`. Body `{ layerSetId?: string, dryRun?: boolean }`. **Not** rate-limited.

`dryRun: true` validates and materializes, returning the summary **without writing**. With no admin
UI this is the ops safety net.

## 8. Actions

A sheet button carries one action. The server picks the type per button; the app renders what it is
handed and never interprets.

```ts
export interface SessionAction {
  id: string;
  label: I18n;
  actionType: "content" | "route" | "webview" | "external" | "miniapp";
  actionValue: string;            // ALWAYS a complete URL (except `content`)
  style?: "primary" | "secondary";
}
```

| `actionType` | Behaviour | Notes |
| --- | --- | --- |
| `content` | Rendered inline in the sheet | `actionValue` is the body, not a URL |
| `route` | Internal app route | e.g. `/(tabs)/transit` for the shuttle timetable |
| `webview` | In-app shell with native header | **ESKARA's primary type** |
| `external` | System browser | For leaving the app deliberately — sponsor pages |
| `miniapp` | Mini-app scheme | **Deferred** — the platform is unreleased. Emitting it today would degrade badly on clients that predate the parser fix |

**ESKARA 2026 emits `webview` and `external` only.** Switching a button to `miniapp` later is a
payload change with no app release.

`actionValue` is always a complete URL. A relative string handed to a URL opener is the shape of an
open redirect. There is no server-side version gating and no per-client rewriting: the app ships over
the air, so responses vary only on `Accept-Language`.

### 8.1 Linking to the map

The map has its own universal scheme, independent of any consumer:

```text
skkuverse://map?place=<placeId>
```

A booth and a building are addressed identically, because both are places. Emit this from anywhere
that means "show this on the map" — a notification, a mini-app page, another sheet. Do **not** invent
an event-specific variant.

## 9. Status semantics

Immutable snapshots and live status are mutually exclusive — re-materializing whenever a booth opens
would bump the version several times an hour and defeat the caching design.

So the snapshot ships **facts**: `startAt`, `endAt`, `status` as of `materializedAt`, and
`nextChangeAt`. The client recomputes against its own clock, falling back to the shipped status when
device time is more than an hour off the response `Date` header. Side benefit: the map keeps telling
the truth on a dead network, which is the actual festival condition.

## 10. Authoring order

`PlaceDoc.location` is required, which fixes the order:

```text
survey coordinates → insert places → insert sessions → publish
```

A session references a `placeId`, so a plot must exist before anything can occupy it, and a plot
cannot exist without coordinates. This puts the survey on the critical path in exchange for never
carrying a nullable coordinate through the materializer, the wire format and the renderer.

The CSV importer **rejects** rows with missing or non-numeric coordinates rather than inserting a
partial document — and rejects the whole file if any single row is bad, because a half-imported map
hides its own gaps.

Two scripts do this, over one shared reader:

| Script | Role |
| --- | --- |
| `scripts/lib/eventmap-csv.js` | pure CSV → `PlaceDoc` reader + validation. No DB, no clock — hence unit-tested |
| `scripts/lib/eventmap-db.js` | the Mongo writers both scripts share |
| `scripts/import-eventmap-csv.js` | ops sheet → `places`. `--dry-run`, `--retire-missing` |
| `scripts/seed-eventmap-demo.js` | demo `sessions` over the real places, times relative to `now`. `_dev` only |

Parsing is `csv-parse` (a devDependency — scripts never ship in the runtime image). The ops sheet is
edited in a spreadsheet, so quoted commas, doubled quotes and a UTF-8 BOM all occur; `bom: true` is
not optional, because without it the first header key becomes `U+FEFF` + `placeId` and every row
fails for a missing id, blaming the data for an encoding problem.

**`updatedAt` is only written when a place actually changed.** The importer diffs against what is
stored and skips untouched documents. This is not an optimisation — §6.2 computes `contentHash` from
the contributors' `[_id, updatedAt]`, so stamping every document on every import would publish a new
snapshot version after a re-import that changed nothing, and `immutable, max-age=1y` would thrash.

**Only the demo seed ever flips `enabled`.** The importer's activation write is `$setOnInsert`, so it
can create the document but never modify it. That is what makes the two scripts' run order
irrelevant, and more importantly it means re-importing a corrected sheet **during** the festival
cannot take the live map down.

## 11. Error codes

| Code | Status | When |
| --- | --- | --- |
| `INVALID_PARAM` | 400 | non-numeric `version`, unsupported `lang` |
| `SNAPSHOT_NOT_FOUND` | 404 | unknown `layerSetId`, or a version reaped by TTL |
| `UNAUTHORIZED` | 401 | missing or wrong `X-Internal-Token` |

## 12. Staleness budget

```text
Atlas edit → ≤60 s materializer tick   (0 s via force-publish)
           → ≤15 s api-replica memo
           → ≤60 s client refreshAfterSec (0 s via silent push)
           ≈ 135 s worst case
```

State this as an SLO — the failure mode is an ops person re-editing the same field three times inside
the propagation window.

## 13. Operations

```bash
# Validate without publishing
curl -s -X POST https://api.skkuverse.com/internal/eventmap/publish \
  -H "X-Internal-Token: $INTERNAL_DISPATCH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"layerSetId":"eskara-2026","dryRun":true}' | jq

# Publish (bumps version immediately)
curl -s -X POST https://api.skkuverse.com/internal/eventmap/publish \
  -H "X-Internal-Token: $INTERNAL_DISPATCH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"layerSetId":"eskara-2026"}' | jq

# What clients now see
curl -s https://api.skkuverse.com/eventmap/manifest | jq '.data'
```

**Kill switch** — rain cancellation or anything going wrong:

```js
db.activations.updateOne({ _id: "eskara-2026" }, { $set: { enabled: false } })
```

Clients fall back to the base campus map within ~75 s. **Rehearse before the festival.**

## 14. Source of truth (file map)

| Concern | File |
| --- | --- |
| Storage types | `src/eventmap/types.ts` |
| Pure materialization | `src/eventmap/eventmap.materialize.ts` |
| I/O + indexes | `src/eventmap/eventmap.data.ts` (no `seedIfEmpty` — there is no sensible default event) |
| Ops sheet → places | `scripts/import-eventmap-csv.js` + `scripts/lib/eventmap-{csv,db}.js` |
| Local demo dataset | `scripts/seed-eventmap-demo.js` |
| Layer/chip/filter structure | `src/eventmap/config/*.json` |
| DB + collection names | `src/infra/config.ts` `eventmap` block |
| Tests | `__tests__/nest/eventmap/`, helper `__tests__/helpers/nest/build-eventmap-app.ts` |
| Predicate parity fixture | **origin** `skkuverse/contracts/predicate-vectors.json`; vendored copy under `__tests__/`, hash-locked in `.contracts.lock.json`. Never hand-edit the copy — re-run `pull --repo server` |

Only needed if the server ever computes filter option counts. Until then the evaluator lives in the
app alone and the contract stays `status: "planned"` — registered, dormant, nothing to sync.

## 15. Related

- [ADR 0004 — event map layer ownership](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md)
- [Umbrella ADR 0002 — pull-based config contracts](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0002-pull-based-config-contracts.md) — the shared-artifact mechanism
- [skkuverse-app `docs/eventmap-rendering.md`](https://github.com/spencer0124/skkuverse-app/blob/main/docs/eventmap-rendering.md)
- [Implementation plan — skkuverse#11](https://github.com/spencer0124/skkuverse/issues/11)
- Shuttle 증차 is a **separate** system — `bus_overrides` + `scripts/seed-eskara.js`. Link via a `route` action; do not rebuild
