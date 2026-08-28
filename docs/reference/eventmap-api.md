---
title: Event Map API Reference
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-28
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

> [!IMPORTANT]
> **Superseded.** `/map/config` **is** now extended: it lists the live layer set's marker layers and
> chips while an activation window is open — both authored in this feature's config file (§2.1) —
> and booth markers are served from `GET /map/markers/event` in the shared marker schema rather
> than from the snapshot. The independence this section claimed is
> preserved by containment instead of by separation — the activation lookup in `map-config.data.ts`
> swallows its own failures and serves the base layers, so a Mongo problem cannot blank the campus
> map. The manifest and snapshot endpoints below are still described as built; the map no longer
> reads them. That contract — the shared marker schema, the layer flags, the three routes — is
> [map-markers-api.md](map-markers-api.md).

The map itself is generic: it renders **places**. A booth is a place, addressed exactly like a
building. Everything event-specific reaches the user through the **action union** (§8) on sheet
buttons.

## 2. Storage tiers

Config is split by **who edits it**, not by what it is.

| Tier | Home | Edited by | Change cost |
| --- | --- | --- | --- |
| Structure — map layers, chips, name/emoji/camera, sorts, card templates, category → layer table | `src/eventmap/config/*.json` | developer | PR + deploy |
| Activation — `activeFrom`, `activeUntil`, `enabled` | Mongo `activations` | ops | one field |
| Content — places, sessions | Mongo `places`, `sessions` | ops | one field |

> [!WARNING]
> Any new `.json` under `src/` must be registered in `scripts/copy-build-assets.js`. `tsc` does not
> copy JSON, and a miss breaks **production only** — dev reads from `src/`.

### 2.1 Structure file schema

One file per layer set, `src/eventmap/config/<layerSetId>.json`, named after the id it declares
(mismatch is a load error). `eventmap.config.ts` lists them explicitly in `CONFIG_FILES` rather than
`readdir`ing, so a file missing from `copy-build-assets.js` surfaces as a named `ENOENT` instead of a
silently absent event map — which is indistinguishable from a finished festival.

| Field | Notes |
| --- | --- |
| `configVersion` | **A human label only.** Excluded from `configHash` *and* from the payload — see §6.5 |
| `campus`, `timezone` | Copied to the wire |
| `name`, `emoji` | The festival's display name and mark. They become the synthesised **reset chip** on the campus map ([map-markers-api.md §8.5](map-markers-api.md)); `name` is `{ko, en?, zh?}` |
| `camera` | Where every festival chip points the campus map: `{lat, lng, zoom, tilt, bearing, durationMs}`, **all required**. `lat` is range-checked against ±90. Not on the snapshot |
| `refreshAfterSec` | Manifest poll cadence while active. `300` is served when nothing runs |
| `stackKeyBy` | `"placeId"` \| `"zone"` — the density lever of §7.2 |
| `layers[]` | The festival's **map layers**, as `/map/config` will serve them: `{ id, label, color, defaultVisible }`. `color` is bare six-digit hex. Ids are unique and may not reuse a base layer's; at least one is `defaultVisible`. Geometry is the map's, not authored here |
| `chips[]` | `{ id, emoji, layerIds, label? }` — the narrowing chips. `layerIds` name this set's layers; `label` may be omitted only for a single-layer chip. The reset chip is **not** authored — see map-markers-api.md §8.5 |
| `sorts[]` | `by ∈ {order, title, startAt}`. `distance` is deliberately absent until the app depends on `expo-location` |
| `cardTemplates[]` | `slots[]` of `title \| subtitle \| hours \| thumbnail \| tags \| field{fieldKey,label}` |
| `itemDefaults` | `byCategory` + `fallback`, each `{layerId, pinPriority, cardTemplateId}` |

**There is no `schemaVersion` in the file.** It is a fact about this server's materializer
(`EVENTMAP_SCHEMA_VERSION` in `src/eventmap/types.ts`), stamped on every payload and manifest; a file
that carries one is refused, because a copy left behind after a bump would tell every client the old
shape while shipping the new one. Clients ignore a snapshot whose value exceeds theirs.

`itemDefaults` is how a session becomes a *marker and a card*: `layerId`, `pinPriority` and
`cardTemplateId` appear on every wire item but exist on no Mongo document, so they are looked up by
the session's `category`. `layerId` is the join key between a snapshot item and its `/map/markers`
marker — the **same table, resolved by the same `presentationFor`**, stamps both, so a booth's pin
and its list row cannot land on different layers.

**`byCategory` keys are NOT validated against anything.** `category` is an open string edited in
Mongo (§4.2), so an unmapped value is *content*, and content falls back to `itemDefaults.fallback`
and logs. Compare the references *inside* each presentation — `layerId`, `cardTemplateId` — which
are structure→structure and block publication outright. The line is drawn by who can fix it: a PR,
or an ops person at 22:00 (ADR 0004 invariant 2).

A festival's chips are validated here too, against the **full** row `/map/config` will serve — base
layers and chips included — by the map's own validator, so the two domains cannot disagree about a
chip. The rules and the failure posture are [map-markers-api.md §8.6](map-markers-api.md).

There is no icon table and no predicate language any more. A booth is an ordinary marker drawn by
the app's one renderer, coloured by its layer; the pins, the chip groups and the filters the snapshot
used to carry left with the surface that rendered them.

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

> [!WARNING]
> **`docker-compose.local-verify.yml` must override every DB we write.** It runs `NODE_ENV=production`
> on purpose (§ its own header), so `devDbName()` is a no-op and `env_file: .env` injects the *real*
> names. `MONGO_EVENTMAP_DB_NAME=eventmap_dev` is now set on all three services; without it
> `npm run verify:serve` would have the materializer publishing into the production `eventmap`
> database. Add every future DB there too.

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
  _id: string;                    // `${layerSetId}:${version}`
  layerSetId: string;
  version: number;                // monotonic per layerSetId
  /** ALL THREE LANGUAGES IN ONE DOCUMENT — see below. */
  payloads: Record<"ko" | "en" | "zh", EventMapSnapshot>;
  etags: Record<"ko" | "en" | "zh", string>;
  /** md5 over INPUTS ONLY — see §6.5. EXCLUDES `now`, so an idle tick produces
   *  no version; otherwise `immutable, max-age=1y` would thrash every 60 s. */
  contentHash: string;
  materializedAt: Date;
  publishedAt: Date;
  /** null for the ACTIVE version — Mongo's TTL monitor ignores non-Date values,
   *  so an active snapshot is never reaped. Superseded versions get now + 7d. */
  gcAt: Date | null;
}
```

**Why one document rather than three keyed by `lang`.** `insertMany` is not atomic
across documents, so with a per-language split two writers racing on the same version could
interleave: version N ending up with writer A's `ko` and writer B's `en`/`zh` — three rows agreeing
on `contentHash` while their payloads differ, all served `immutable, max-age=1y`. Worse, the loser's
duplicate-key retry probes one language to decide whether it lost, so A would re-read its **own** `ko`,
see a matching hash, and report `unchanged` — never learning that half of version N belonged to
someone else. A Korean user and an English user on version N would then see different maps for a
year. One document makes the interleaving unrepresentable, and turns the unique index on
`{layerSetId, version}` into a clean mutex. The ETag stays **per language**, because each language is
a distinct resource with its own bytes.

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
| `snapshots` | `{layerSetId, version}` **unique** | serve latest **and** the concurrency primitive (§6.3). Not keyed by lang — §4.4 |
| `snapshots` | `{gcAt}` TTL `expireAfterSeconds: 0` | reap superseded versions |

No text index — substring search over ~50 items is a client-side `.filter()`.

## 6. Materialization

### 6.1 Structure

| Module | Responsibility |
| --- | --- |
| `eventmap.config.ts` | Loads + validates the structure tier — including the festival's map layers and chips, against the base map's — and computes `configHash` over the snapshot's slice of it |
| `eventmap.active.ts` | "Which layer set is live, and is its config usable" — the one answer `/map/config` and `/map/markers/event` both read, with a bad set reported once per process |
| `eventmap.materialize.ts` | **Pure.** No DB, no clock — both injected. Carries the 75 % line-coverage gate cheaply, as `weightedRandomSelect` does in `src/ad/ad.data.ts` |
| `eventmap.data.ts` | Raw-driver I/O, `ensureIndexes` (no `seedIfEmpty` — there is no sensible default event) |
| `eventmap-materializer.service.ts` | Registers with `PollerRegistryService` (60 s); owns `publish()` |

Use `PollerRegistryService`, **not** `@nestjs/schedule` — the registry provides the in-flight guard,
the warm-up immediate run, and `.catch().finally()` semantics.

`publish({layerSetId?, dryRun?})` is the single entry point for both the poller and the force-publish
route, so a festival-night correction exercises exactly the path that has been running all week.

**The config loader never throws at import — for a config file.** `src/miniapps/miniapps.ts` does,
because there the registry *is* the feature; here a previously published snapshot is already being
served, and step 3 below is explicit that an invalid config is skipped rather than fatal. Instead the
loader returns `{config, configHash, error: null}` or `{config: null, error}`, logs loudly, and the
materializer declines to publish. (It does import `src/map/map-chips.data.ts`, which throws at
import for a bad *base* chip — repo TypeScript that a PR fixes, the miniapps posture applied where it
belongs.) A rejected config also takes the festival off the campus map, since `/map/config` reads
the same verdict — see map-markers-api.md §8.6 for why that is preferred to drawing from a table the
server could not validate.

### 6.2 One pass

1. Load the enabled activation whose window contains `now`. None → publish nothing.
2. Load `places` (`lifecycle: "active"`) and `sessions` (`lifecycle ∈ {published, cancelled}`, `deletedAt: null`).
3. `assertValidConfig()` — dangling `cardTemplateId` / `layerId`, duplicate ids, empty layers, a layer id reused from the base map, a bad chip (map-markers-api.md §8.6), a file carrying its own `schemaVersion`. **On failure: log and skip.** The previous snapshot stays live.
4. Join session → place. **The one and only coordinate conversion site:**

   ```ts
   // Mongo/GeoJSON is [lng, lat]; the wire carries NAMED lat/lng and no positional
   // tuples. location is non-nullable, so there is no null branch to forget.
   const lngLat = place.location.coordinates;
   const lat = lngLat[1];
   const lng = lngLat[0];
   ```

   Convention, enforced by review: any variable holding a GeoJSON pair is named `lngLat`.
5. Build `tags[]` (§6.4). A session is **dropped into `dropped[]` with a reason** — never aborting
   the pass — when its `placeId` does not resolve, its `title` is blank in every language, its plot
   has unusable coordinates, or **`startAt`/`endAt` are not Dates**. Every drop is logged and
   reported by `dryRun`.

   That last one is not defensive padding. Mongo stores whatever it is handed, and the primary
   workflow here is a festival-night `mongosh` edit: `$set: { startAt: "2026-09-16T09:00:00Z" }`,
   with quotes instead of `ISODate(...)`, round-trips as a **string**. Unguarded that becomes
   `.getTime()` on a string — a throw out of the entire pass, so the poller publishes nothing ever
   again for that layer set *and* `dryRun`, the tool for diagnosing it, returns the same error
   instead of naming the row. `deriveStatus` is likewise total against a non-Date bound: `NaN`
   comparisons are all false, so an unguarded version would silently report `closed` — a booth that
   is open telling everyone it is shut.

   A malformed **action** drops that button only, into a separate `rejectedActions[]`, because the
   booth still renders and nothing about the result would otherwise say anything went wrong.
6. Compute `status` as of `materializedAt`. **`cancelled` is evaluated FIRST**, before the time
   comparisons — the table below reorders the original for that reason. `lifecycle` is an explicit
   ops action while a null bound is merely data shape, so a cancelled always-on facility must still
   read closed.

   | Condition | Status |
   | --- | --- |
   | `lifecycle === "cancelled"` | `closed` + `fields.cancelled` |
   | `startAt == null && endAt == null` | `open` (always-on facilities) |
   | only one bound set | `unknown` |
   | `now < startAt` | `upcoming` |
   | `startAt <= now < endAt` | `open` |
   | `now >= endAt` | `closed` |

   **ONE RULE: an item ships bounds if and only if its status can change.** The client's rule is
   "both bounds null → trust the shipped status, otherwise recompute" (§9), so null bounds are the
   server's only lever for "do not recompute this one", and it is pulled for every item whose status
   is fixed:

   - `cancelled` has a real window, but shipping it would make a rain-cancelled 주점 flip itself back
     to 운영중 on every device at its original start time, with no way for the server to intervene.
   - A **one-sided** window is permanently `unknown`, and shipping its single bound sends the client
     into `deriveStatus(startAt, null, now)` — behaviour neither side specifies. It would then
     disagree with the `["status",["open"]]` chip filtering it, and since one-sided sessions
     contribute no boundaries, no republish ever corrects the drift.

   The rule is tied to the boundary set rather than to `lifecycle`, so the two cannot drift: whatever
   cannot move the map also cannot move on the device. The hours survive in `hoursLabel`, which is
   display text and is never re-derived.
7. `nextChangeAt` = min `{startAt, endAt}` strictly greater than `now`, else `null`. Sessions that are
   `cancelled` or one-sided contribute **no** boundaries: their status never changes, and waking every
   device for a non-event is worse than not waking it.
8. Resolve i18n per lang → three payloads. Resolution is `text[lang] → text.en → text.ko`, treating a
   **blank** string as absent — `??` alone would accept an ops-typed `en: ""` and ship a nameless pin.
9. `contentHash` over inputs only (§6.5). Equal to the active snapshot's → **return, no write.**
10. `version = max + 1`; ETag per payload; `insertMany([ko,en,zh], {ordered:false})`; previous version's `gcAt = now + 7d`.
11. Clear the manifest memo — in **this process only** (§7.1).

### 6.3 ROLE topology — who may publish

`PollerRegistryService.onApplicationBootstrap` starts pollers only when `ROLE !== "api"`, so the
scheduled materializer runs on **exactly one process**.

The real race is force-publish, which must live on the api replicas so it works when the poller is
wedged — and there are two. **There is deliberately no lock collection:** the unique
`{layerSetId, version, lang}` index is the primitive. Two writers racing on the same version number
collide, one wins, and the loser takes a duplicate-key `11000` — the idiom already in
`ad.data.ts:seedIfEmpty`. Document this, or the next reader will "fix" it with a lock.

**But the usual justification has a gap worth naming.** "Both computed the same `contentHash`, so
both would have written identical bytes" is true only when both processes read the *same inputs*. If
an ops edit lands between the two reads, the hashes diverge and the loser is holding the **newer**
materialization; exiting on `11000` there would silently discard a festival-night correction. So the
loser re-reads and branches:

- the winner's `contentHash` equals ours → done, nothing was lost;
- it differs → recompute `version = latest + 1` and retry, bounded at 3 attempts.

`ROLE=combined` also runs pollers — right for dev, but never run one alongside the production
topology or two writers race the version counter.

### 6.4 Tags

`tags[]` is what ops wrote — `session.tags` then `place.tags` — lowercased, blanks dropped,
deduplicated. Nothing is derived. The `cat:` / `day:` / `slot:` / `tenant:` / `kind:` / `place:` /
`zone:` axes existed for the predicate filters, and with those gone the only reader left is the
card's `tags` slot, which renders every entry as a badge, verbatim; a machine tag there is a
`tenant:econ-council` pill on a booth card. `status` was never a tag and still is not — the client
recomputes it against the device clock (§9).

### 6.5 The two hashes

Both are md5 over `canonicalStringify` — object keys sorted at every depth, `Date` → ISO. Array order
is preserved, because it is meaningful (sort order, card slot order).

| Hash | Over | Reacts to |
| --- | --- | --- |
| `configHash` | the **snapshot's slice** of the parsed config — `schemaVersion`, `layerSetId`, `campus`, `timezone`, `stackKeyBy`, `sorts`, `cardTemplates`, `itemDefaults` — and nothing else | meaning only, and only meaning that reaches a payload |
| `contentHash` | `configHash` + `layerSetId` + the activation + every contributing place and session, whole and `_id`-sorted | any input change except `now` |

**`configHash` is not a hash of the file text, nor of the whole file.** Raw text would change on a
`prettier` run or a reordered key, and each such no-op would mint a version and throw away every
client's one-year, ~90 KB snapshot cache. Nor is it a manual `configVersion`: a forgotten bump would
leave a deployed structure change permanently withheld behind `max-age=1y`. And since the file now
also feeds `/map/config` — `layers`, `chips`, `name`, `emoji`, `camera` — and the manifest
(`refreshAfterSec`), none of which enters a payload, those are excluded too: a chip-emoji edit must
not republish a byte-identical snapshot. The rule in both directions: **anything on the wire is in
the hash, and nothing else is.** `SnapshotInputs` in `eventmap.config.ts` names the slice, and the
config tests pin every member's effect, so a field added to the file cannot join the hash by accident.

**`contentHash` covers whole documents, not `[_id, updatedAt]` pairs.** The pair form is cheaper but
assumes every writer stamps `updatedAt`, and the entire point of this feature is a festival-night
`mongosh` edit: a `$set` that fixes a price and forgets `updatedAt` would leave the pair-hash
identical and the correction would never publish. 62 places + ~50 sessions of canonical JSON is not a
cost worth that failure mode. The importer's discipline (§10) stays correct and simply stops being
load-bearing.

Sorting by `_id` before hashing is what lets two api replicas agree: BSON field order alone does not
survive an ops edit identically on both.

## 7. Endpoints

### 7.1 `GET /eventmap/manifest`

`ETag` · `Cache-Control: public, max-age=15` · `Vary: Accept-Language` ·
`Access-Control-Expose-Headers: ETag`

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

`activeLayerSetId: null` (with `version`/`snapshotUrl` null) when nothing runs — including when an
activation is live but nothing has been published yet, since there would be no `snapshotUrl` to
follow. `snapshotUrl` is formed **entirely server-side including `?lang=`** — the client never builds
it. `refreshAfterSec` is server-driven polling: `300` normally, `60` during an event.

**`nextChangeAt` is derived per request, not echoed from the snapshot.** The snapshot's own field is
a fact as of materialization, and an idle tick mints no version (§6.5), so a stored value is in the
past within minutes. The client arms a one-shot timer on this field to re-render at the moment a
booth opens; echo a past instant and it arms nothing, and a 주점 opening at 18:00 reads 준비중 until
the next poll. The derivation is a scan of the memoized items, so it costs no DB read.

**`Access-Control-Expose-Headers` is set app-wide, in `src/common/expose-headers.ts`, not per route.**
Both endpoints answer a matching `If-None-Match` with `res.status(304).end()`, which returns before
setting a header of its own, and the degraded branch above sets only `Cache-Control` — so a per-route
`res.set` would miss exactly the responses that need it — a 304 is precisely the response whose
`ETag` a client still needs to read, and `ETag` is not CORS-safelisted.

`Date` and `Age` were exposed here too, for the client's clock-offset measurement. That layer was
removed: §9's derivation now runs against the device clock unadjusted, so neither header has a
reader.

CORS was enabled in skkuverse#17 for the first-party origins in `infra/origins.ts`, so this header
does something for those origins. Native clients read it regardless of CORS.

This handler must **never throw**; any DB error degrades to `activeLayerSetId: null`.

**The degraded answer is not cached.** A genuine "nothing is running" — kill switch, event over — is
a real answer and gets the normal `max-age=15`. A caught DB error returns the same body with
`Cache-Control: no-store` and no strong `ETag`, so a two-second Mongo hiccup cannot pin "festival off"
into shared caches. (Express still attaches its own *weak* validator inside `res.json()`; there is no
clean per-route suppression, and it is harmless — `no-store` forbids storing the response, and a
client that revalidates anyway only gets a 304 while the server is still degraded.)

**Memo invalidation is process-local.** §6.2 step 11 clears only the publishing process. When the
poller publishes, api-1 and api-2 keep their own memos until `manifestCacheTtlMs` (15 s) expires, so
that TTL — not the clear — is the real bound in §12 and behind the kill switch's "~75 s". The clear
is a latency win for one process, not distributed invalidation; adding real invalidation would be a
distributed-systems problem in exchange for 15 seconds.

The memo is a **single entry, not one per language**: version, `publishedAt` and the status
boundaries are identical across ko/en/zh, and only `snapshotUrl`'s `?lang=` differs. It reads the
`ko` document and builds the rest per request.

### 7.2 `GET /eventmap/snapshot/:layerSetId/:version?lang=ko`

`ETag` · `Cache-Control: public, max-age=31536000, immutable` · `Vary: Accept-Language` ·
`Access-Control-Expose-Headers: ETag`

Validation order is the repo rule — **400 → 404 → 304**:

1. `version` not a positive integer, or `lang` **missing** or ∉ `{ko,en,zh}` → `400 INVALID_PARAM`
2. no snapshot for `(layerSetId, version, lang)` → `404 SNAPSHOT_NOT_FOUND`
3. `If-None-Match` matches the stored ETag → `304`
4. otherwise `sendSuccess(req, res, payload)` via `@Res()`

An unknown id with a stale `If-None-Match` returns **404, not 304**. Pin this in a test: a client
holding a TTL-reaped version needs to be sent back to the manifest, and a 304 tells it the opposite.

**`?lang=` is required, with no `Accept-Language` fallback.** RFC 8246 `immutable` is a promise that
this URL's representation will not change for its freshness lifetime; a header-derived fallback would
make one URL return three bodies under a one-year promise. `Vary: Accept-Language` protects a
conforming cache, but a year is too long to bet on every intermediary — and on the app's own HTTP
cache — honouring it. The manifest always emits `?lang=`, so no real client is affected.

**`gcAt` (7 d) and `max-age=1y` disagree on purpose, and the client absorbs it.** RFC 8246 scopes
`immutable` to the freshness lifetime, and a stale response is revalidated normally — so a client
that slept past the TTL reap can hold a version that no longer exists. That is a `404`, and the
client rule is: invalidate the manifest, refetch, retry once, never surface an error.

Snapshots are memoized in-process, keyed by `(layerSetId, version, lang)` and capped at six entries.
Version-keyed means an entry can never be stale, only surplus; six is two versions' worth of
languages, enough to cover the minutes around a publish when clients are split. A **miss is not
cached** — a reaped version is a 404 the client recovers from, and caching the absence would only
delay that.

Payload (abridged; content and the card/sort structure travel together, so a sort change costs zero
network — the map layers and chips a booth is filtered by ride in `/map/config`, not here):

```jsonc
{
  "schemaVersion": 2,
  "id": "eskara-2026", "version": 17, "lang": "ko",
  "materializedAt": "…", "nextChangeAt": "…", "timezone": "Asia/Seoul",
  "campus": "nsc",

  "sorts": [
    { "id": "manual", "label": "추천순", "by": "order" },
    { "id": "title",  "label": "이름순", "by": "title" }
  ],

  "items": [{
    "id": "eskara-2026-d1-cse-booth",
    "placeId": "nsc-plaza-a3", "stackKey": "nsc-plaza-a3",
    "lat": 37.294118, "lng": 126.976334,
    "title": "소융대 티셔츠 부스", "subtitle": "정보통신대학 학생회",
    "tags": ["featured"],
    "status": "open",
    "startAt": "2026-09-16T03:00:00.000Z", "endAt": "2026-09-16T07:00:00.000Z",
    "hoursLabel": "12:00–16:00",
    "layerId": "eskara26_booth", "pinPriority": 20,
    "cardTemplateId": "booth",
    "actions": [
      { "id": "entry", "label": "입장 안내", "style": "primary",
        "actionType": "webview",
        "actionValue": "https://webview.skkuverse.com/eskara/entry" },
      { "id": "sponsor", "label": "후원사 페이지", "style": "secondary",
        "actionType": "external", "actionValue": "https://example.com/sponsor" }
    ]
  }]
}
```

~50 items × ~500 B ≈ 25 KB, gzipping under 10 KB.

The example above is abridged; this is the complete member list, because the client's failure mode
for a field it cannot find is to **render nothing for that slot**, so an omission here shows up as a
blank card rather than an error.

| Member | Notes |
| --- | --- |
| top level | `schemaVersion · id · version · lang · materializedAt · nextChangeAt · timezone · campus · sorts · **cardTemplates** · items` |
| `items[]` | `id · placeId · stackKey · lat · lng · title · subtitle · tags · status · startAt · endAt · hoursLabel · **layerId** · pinPriority · cardTemplateId · **order** · **media** · **fields** · actions` |

The ones easiest to forget, and what each is for:

- **`cardTemplates`** — what every `items[].cardTemplateId` resolves against. Without it on the wire,
  no card renders at all.
- **`layerId`** — the `/map/config` layer this item's category resolved to. The join between an item
  and its marker, and how the app lists "what the 주점 chip is showing" against the layers the map is
  currently drawing.
- **`order`** — backs `sorts[].by === "order"`, the `manual` sort that most layers name.
- **`media.thumbnailUrl`** — backs the `thumbnail` slot.
- **`fields`** — backs `{kind:"field"}` slots, including the `cancelled` badge of §6.2.

**`pinPriority`** survives without a pin to prioritise: it is what orders the items of one
`stackKey` inside the peek sheet, which decides the lead.

**`subtitle` falls back to `tenant.name`** when a session has none, which is why a booth with no
subtitle still shows the club running it.

**`items[]` carries flat `lat`/`lng`, never GeoJSON.** Naver RN takes flat scalars; GeoJSON adds a
per-render transform plus payload bloat, and RFC 7946 §6.1 defines no processing model for foreign
members. GeoJSON stays in Mongo where it earns the 2dsphere index.

**`stackKey`** groups items sharing a plot so the client draws one marker. Normally `placeId`; set it
to `zone` if 대운동장 is too dense — a server edit, no data change, no app release.

### 7.3 `POST /internal/eventmap/publish`

`X-Internal-Token` + `crypto.timingSafeEqual` via `src/common/internal-token.ts`, shared with
`notices.internal.controller.ts` rather than duplicated — one implementation of a constant-time
comparison. The secret is `INTERNAL_DISPATCH_TOKEN`, deliberately the same one: both callers are us,
behind the same boundary, and a second env var is one more thing to have missing on the host at 22:00.

`@HttpCode(200)`. Body `{ layerSetId?: string, dryRun?: boolean }`. **Not** rate-limited —
`EventMapModule.configure()` binds the limiter to the `eventmap` prefix only, which does not match
`internal/eventmap`. During an incident ops must be able to hammer this.

`dryRun: true` validates and materializes, returning the summary **without writing**. With no admin
UI this is the ops safety net; the summary carries `counts` and the `dropped[]` list with reasons.

**An explicit `layerSetId` skips the window check *and* `enabled`.** Without an id, the active layer
set is resolved as the poller does. With one, the activation is loaded by `_id` alone — validating and
pre-materializing next week's festival before it opens is the whole value of `dryRun`, and impossible
if the lookup demands a live window. Publishing a version for a not-yet-active or disabled set is
harmless: the manifest still reports `activeLayerSetId: null`. (Note that `enabled` is a `contentHash`
input, so a force-publish after flipping the kill switch *will* mint a version.)

**`force: true` publishes even when `contentHash` is unchanged**, and it is the lever for the one
case the hash structurally cannot see. The hash covers the *inputs*; it does not cover the
materializer's own output logic or the server-generated strings in `infra/i18n.ts`. After a deploy
that changes either, every input hash is identical, so the poller reports `unchanged` forever and
clients hold the pre-deploy payload for up to a year with no guarantee that an ops content edit will
arrive to dislodge it. It is explicit rather than automatic because mixing a build identifier into the
hash would republish on every deploy, discarding every client's cache for changes that usually touch
neither the payload nor the strings on it.

> **Run `force` after any deploy that changes the wire payload or `infra/i18n.ts`.**
>
> ```bash
> curl -s -X POST https://api.skkuverse.com/internal/eventmap/publish \
>   -H "X-Internal-Token: $INTERNAL_DISPATCH_TOKEN" -H 'Content-Type: application/json' \
>   -d '{"force":true}' | jq
> ```

Summary `reason` is one of `published · unchanged · dry-run · no-active-layer-set ·
unknown-layer-set · invalid-config · conflict`.

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

**`actionValue` shape is checked per type**, and a button failing the check is dropped while the booth
survives — ops authored it, and losing one button is recoverable.

| `actionType` | Required shape |
| --- | --- |
| `content` | any non-blank string — it is prose, so spaces and newlines are fine |
| `route` | starts with `/` but **not** `//`, and contains no whitespace |
| `webview` | a root-relative path (**preferred**), or an absolute URL on `WEBVIEW_ORIGIN`. Either way it must address a real page: **no fragment at all**, and the path may not be `/` |
| `external` · `miniapp` | absolute `https://` URL, no whitespace |

**A `webview` value is resolved against `WEBVIEW_ORIGIN` at materialization**, so `/eskara/entry`
stored in Mongo reaches the client as `https://webview.skkuverse.com/eskara/entry`. The wire still
carries a complete URL; only the storage form is relative.

That exists so nobody types a host. `src/infra/origins.ts` is the single source for it, and the four
webview URLs this API emits sat as literals until spencer0124/skkuverse#46 moved them — an action
authored in Mongo or by the console has no compiler to stop it repeating that.

An absolute value is still accepted, because the console writes one, but it must land on
`WEBVIEW_ORIGIN` **and** name a real page. The second half is the subtle one:
`https://webview.skkuverse.com/#/eskara/entry` satisfies any prefix check, yet a fragment never
reaches the origin, so `BrowserRouter` resolves it to `/`, the SPA fallback answers with the shell at
**HTTP 200**, and the app's webview only raises its error overlay above status 400. The user lands on
the wrong page with no retry affordance and nothing on either side logs a failure.

Both halves of the rule are needed, and neither catches the other's case:

| Value | `pathname` | `hash` | |
| --- | --- | --- | --- |
| `«O»/#/eskara/entry` | `/` | `#/eskara/entry` | rejected — fragment stripped, lands on the shell |
| `«O»/` · `«O»` · `«O»/#` | `/` | | rejected — the shell root, which renders the 404 page |
| `«O»/eskara#/entry` | `/eskara` | `#/entry` | rejected — **the worse one**, see below |
| `«O»/eskara/entry?day=1` | `/eskara/entry` | | accepted |

> [!WARNING]
> **An anchor on a real path is no longer accepted, and that is a revoked guarantee.** This section
> previously promised that `«O»/eskara/entry#tickets` would survive "because it addresses a real
> page". True, and it was the hole: `«O»/eskara#/entry` keeps a real `pathname` too, passes an
> origin-and-path check, and still opens the ESKARA **index** rather than the entry page. That failure
> is worse than a bare origin — the user arrives somewhere plausible rather than somewhere obviously
> broken, and has no reason to suspect it. No first-party page uses an anchor, so the allowance bought
> nothing.

The mini-app registry applies the same rule to `startUrl`, but **only when the URL is on
`WEBVIEW_ORIGIN`**. Four of the five registered mini-apps are third parties, `assertValidRegistry`
runs at import and throws, and `skkuw`'s `startUrl` is already a bare root path — so applying our
routing choice to their hosts would turn someone else's site into a boot failure here.

Both call sites share one definition, `src/infra/webview-url.ts`. It exports a predicate rather than
a validator that throws, because the two callers want opposite failure modes: the materializer drops
one button and reports it in `rejectedActions`, the registry refuses to boot.

Anchors alone do not do this: `$` without the `m` flag still matches **before a final newline**, so
`"https://evil.com\n"` satisfies an otherwise correct `^...$` pattern — and a spreadsheet paste is
exactly how a trailing newline reaches Mongo. The whitespace check is therefore explicit. `//evil.com`
is rejected for `route` because it is a protocol-relative URL wearing a path's clothes.

The prose rule "always a complete URL" is about the *openers*: a relative string handed to one is the
shape of an open redirect. `route` is the documented exception (`/(tabs)/transit`), which is why the
check is per type rather than global. There is no server-side version gating and no per-client
rewriting: the app ships over the air, so responses vary only on `Accept-Language`.

### 8.1 Linking to the map

The map has its own universal scheme, independent of any consumer:

```text
skkuverse://map?place=<placeId>
```

A booth and a building are addressed identically, because both are places. Emit this from anywhere
that means "show this on the map" — a notification, a mini-app page, another sheet. Do **not** invent
an event-specific variant.

> [!IMPORTANT]
> **The bare form above still works; the agreed form carries the kind.** Map markers carry
> `tap: { kind, placeId }`, and the link is literally those two fields —
> `skkuverse://map?place=event:nsc-truck-05`, `skkuverse://map?place=skku_building:2` — so a link
> can never disagree with the marker it came from. The app's `PLACE_ID_RE` accepts both forms;
> `event` in its `PLACE_KINDS` allowlist is part of the app half of this change. ADR 0004 invariant 1
> still specifies the bare form and needs amending. See
> [map-markers-api.md §9.2](map-markers-api.md).

## 9. Status semantics

Immutable snapshots and live status are mutually exclusive — re-materializing whenever a booth opens
would bump the version several times an hour and defeat the caching design.

So the snapshot ships **facts**: `startAt`, `endAt`, `status` as of `materializedAt`, and
`nextChangeAt`. The client recomputes against its own clock, falling back to the shipped status when
**both bounds are null**. Because the bounds are absolute instants rather than wall-clock strings, a
device in the wrong timezone still derives correctly; a device whose clock is genuinely wrong does
not, and that is accepted rather than corrected. The planned mitigation, not yet implemented, is an
app-side warning when the device timezone is not `Asia/Seoul` — the one misconfiguration the client
can still detect on its own, now that it no longer compares its clock against the server's.
Side benefit: the map keeps telling the truth on a dead network, which is the actual festival
condition.

That last fallback is why §6.2 step 6b nulls a cancelled session's bounds: it is the only lever the
server has to say "do not recompute this one". Anything whose status must not move on the device —
today that is `cancelled`, tomorrow it could be something else — has to ship without bounds.

**All of this is the snapshot's contract, not the map's.** `GET /map/markers/event` carries no
`status` field at all: it ships the window alone, and a cancelled session is simply not served, which
frees both-bounds-null to mean "always" and nothing else. The consequence is that the map pin for a
cancelled booth disappears rather than showing as cancelled — the opposite of what `SessionDoc`'s own
comment asks for, and a trade made knowingly. Reasoning in
[map-markers-api.md §3](map-markers-api.md).

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

Four scripts do this, over two pure readers and one shared writer module:

| Script | Role |
| --- | --- |
| `scripts/lib/eventmap-csv.js` | pure CSV → `PlaceDoc` reader + validation. No DB, no clock — hence unit-tested |
| `scripts/lib/eventmap-sessions.js` | pure JSON → `SessionDoc` reader + validation. No DB; takes `now` as a parameter rather than reading a clock, so it stays deterministic |
| `scripts/lib/eventmap-db.js` | the Mongo writers every script shares |
| `scripts/import-eventmap-csv.js` | ops sheet → `places`. `--dry-run`, `--retire-missing` |
| `scripts/import-eventmap-sessions.js` | authored line-up → `sessions`. `--dry-run`, `--delete-missing` |
| `scripts/seed-eventmap-demo.js` | demo `sessions` over the real places, times relative to `now`. `_dev` only |

### 10.1 Why sessions are JSON and places are CSV

A place is flat — an id, a name, two coordinates — so a spreadsheet is the right editor and
`csv-parse` the right reader. A session is not: `actions[]`, `media.images[]`, `fields{}` and every
I18n value are nested, and a spreadsheet can only carry those as embedded JSON inside a cell, which
is strictly worse than JSON throughout. Spreadsheet authoring for sessions is what skkuverse#19's
dashboard is for; until it exists the JSON file is the ops surface and `--dry-run` is the safety net.

**`timeBase` is a file-level, mutually exclusive choice.** `"absolute"` carries ISO instants and is
what real festival content uses; the reader rejects a bare date or a zone-less datetime, because
`Date.parse("2026-09-16")` is UTC midnight and a Seoul-authored time would silently move nine hours
with nothing downstream noticing. `"relative"` carries minute offsets from the import instant, which
is what a pipeline verification run wants — it puts closed, open, upcoming and unknown on the map at
once and crosses status boundaries while someone is watching.

A relative file is **not** idempotent: it resolves to new instants on every run, so every document is
rewritten and the next publish mints a version. That is correct — it genuinely is a new dataset each
time — but it is the one case the diff discipline below cannot deliver, so the importer says so on
stdout rather than letting the numbers imply otherwise.

**`days: [1, 2]` expands into one document per day**, suffixing `-d1` / `-d2` onto the id. A
`SessionDoc` is ONE occupancy interval, so a 양일주점 running both nights is two documents; authoring
it twice is how the two copies drift apart. Omit `days` entirely for an always-on facility.

**A `placeId` is a soft reference** — no FK, and §4.2 explains why there is no tenants collection to
give it one. A dangling reference therefore fails silently at materialize time, dropping the booth
with nothing on the map to say so, which is why `import-eventmap-sessions.js` resolves every
`placeId` against `places` before writing and hard-fails on a miss, on a campus that disagrees with
the plot's, and on a plot that is not `lifecycle: "active"`.

Parsing is `csv-parse` (a devDependency — scripts never ship in the runtime image). The ops sheet is
edited in a spreadsheet, so quoted commas, doubled quotes and a UTF-8 BOM all occur; `bom: true` is
not optional, because without it the first header key becomes `U+FEFF` + `placeId` and every row
fails for a missing id, blaming the data for an encoding problem.

**`updatedAt` is only written when a place actually changed.** The importer diffs against what is
stored and skips untouched documents.

This was originally load-bearing: `contentHash` hashed the contributors' `[_id, updatedAt]`, so
stamping every document on every import would have published a new version after a re-import that
changed nothing, and `immutable, max-age=1y` would have thrashed. §6.5 now hashes the whole
documents, which reverses the dependency — an unchanged document serializes identically whether or
not its `updatedAt` moved, so the importer's discipline is correct but no longer the thing holding
the caching design up. Keep it anyway: it is still the cheapest way to keep a re-import a no-op.

**Only the demo seed ever flips `enabled`.** The places importer's activation write is
`$setOnInsert`, so it can create the document but never modify it, and the sessions importer does not
touch `activations` at all. That is what makes the scripts' run order irrelevant, and more
importantly it means re-importing a corrected sheet or line-up **during** the festival cannot take
the live map down — nor can importing one early bring the map up before its window.

The same asymmetry is what makes a pre-flight publish safe. `POST /internal/eventmap/publish` with an
explicit `layerSetId` looks the activation up by id, without the window or `enabled` check (§7.3), so
a snapshot can be materialized, published and fetched at its own URL while `GET /eventmap/manifest`
still reports `activeLayerSetId: null` to every client. Content can therefore be staged and verified
end to end on production before anyone can see it.

## 11. Error codes

| Code | Status | When |
| --- | --- | --- |
| `INVALID_PARAM` | 400 | non-positive or non-integer `version`; `lang` **missing** or unsupported |
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

### 13.1 Loading content

The scripts resolve the database the same way `infra/config.ts` does, so **production needs
`NODE_ENV=production` stated explicitly** — without it they write to `<base>_dev`. That default is
deliberate: the dangerous direction should be the one you have to type.

```bash
# 1. Plots. Creates the activation if absent, DISABLED, and can never re-enable one.
NODE_ENV=production node scripts/import-eventmap-csv.js --dry-run
NODE_ENV=production node scripts/import-eventmap-csv.js

# 2. Line-up. Every placeId is resolved against `places` before anything is written.
NODE_ENV=production node scripts/import-eventmap-sessions.js --dry-run
NODE_ENV=production node scripts/import-eventmap-sessions.js
```

Read the dry run's `categories` line against the `itemDefaults.byCategory` keys in
`config/<layerSetId>.json`: a category with no entry still materializes and IS drawn — on
`itemDefaults.fallback.layerId`, with the fallback's `pinPriority` — so a typo shows up as booths
under the wrong chip and colour, and nothing reports an error.

### 13.2 Publishing

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

Read the dry run's `dropped` and `rejectedActions` before publishing for real. A dropped session
leaves no trace on the map, and a rejected action leaves the booth with one fewer button — neither
looks like a failure to anyone reading the result.

### 13.3 Staging on production before the window opens

An explicit `layerSetId` publishes without requiring the window (§7.3, §10), so a snapshot can be
staged and verified against the real CDN while the manifest still advertises nothing:

```bash
# The manifest must still be all-null after this — that is the proof of no exposure.
curl -s https://api.skkuverse.com/eventmap/manifest | jq '.data'

# The snapshot is reachable at its own URL regardless, so caching can be checked now.
curl -sI "https://api.skkuverse.com/eventmap/snapshot/eskara-2026/1?lang=ko"
```

Worth checking here rather than during the event: `Cache-Control: immutable, max-age=1y` on the
snapshot, a matching `If-None-Match` returning 304, and a distinct ETag per `lang`.

### 13.4 The window — and the kill switch

`scripts/eventmap-window.js` is the only lever that decides whether anybody sees the event map.

```bash
npm run eventmap -- status --prod
npm run eventmap -- open --prod --minutes 10
npm run eventmap -- close --prod
```

**`--prod`, not `NODE_ENV`.** Every other script here resolves its database from `NODE_ENV`, which is
right for an importer: the dangerous direction is the one you have to type. It is the wrong mechanism
here, because an env var is silently lost the moment a command is pasted across two lines, and the
failure is invisible — a cheerful success against a database nobody meant to touch. That happened on
the first real run. Omit the flag and the target is `<name>_dev`, printed on its own line either way.

`open` defaults to **15 minutes**, not open-ended: a rehearsal is the common case and a forgotten
`enabled: true` is the expensive mistake, so `activeUntil` is a dead man's switch. A real festival
states its length once, deliberately. The script never creates an activation — an unknown id is an
error rather than an upsert, so a typo cannot look like a success.

`--no-expiry` writes `activeUntil: null` and gives up that switch. It is right in exactly two
situations, and "I do not want to pick a number" is neither:

1. **Nothing that can render the layer set is deployed.** Before the client ships in a release or an
   OTA, no user's app carries the code to fetch the manifest at all, so the window's audience is
   whoever runs a dev build. Check the shipped tree, not the branch — `main` containing the code
   proves nothing about what users have:

   ```bash
   git ls-tree -r --name-only ota/prod/<tag> | grep eventmap
   ```

2. **A long event whose end is genuinely unknown**, where a wrong `activeUntil` would drop the map
   mid-festival — a worse failure than a forgotten one.

`status` prints `NO EXPIRY — stays up until somebody runs close` on every read in that state, which
is the only thing standing between "we meant to leave it up" and "nobody remembered it was up".

The npm script carries `--dns-result-order=ipv4first` (§13.5) so the incident path does not depend on
remembering it.

`refreshAfterSec` flipping from 300 to the config's value is what confirms the window is genuinely
open: 300 is `IDLE_REFRESH_AFTER_SEC`, served whenever nothing is active, and is not a value anyone
edits.

`close` is the **kill switch** for a rain cancellation or anything else going wrong. Clients fall
back to the base campus map within ~75 s (§12) — the delay applies to closing exactly as it does to
opening. **Rehearse before the festival**, not during one.

### 13.5 When Atlas refuses with `SSL alert number 80`

A TCP connection that is accepted and then dropped before the handshake completes is Atlas rejecting
the source IP, not a client TLS fault. Two causes, and they look identical:

1. The machine's IP is not in Network Access. Check the current one and add it.
2. **The traffic is leaving over NAT64.** If `openssl s_client` to the shard host succeeds while the
   Node driver still fails, this is the one. `dig AAAA` shows nothing because it queries DNS
   directly; the synthesis happens in `getaddrinfo`:

   ```bash
   node -e 'require("dns").lookup("<shard-host>",{all:true,verbatim:true},(e,a)=>console.log(a))'
   ```

   A `64:ff9b::/96` address in that list is the RFC 6052 well-known prefix — the resolver has
   synthesized an IPv6 address for an IPv4-only host. Node 18+ defaults to `verbatim` order and picks
   it first, so the connection exits through the NAT64 gateway and Atlas sees *its* address rather
   than the allowlisted one. Prefix the command:

   ```bash
   NODE_OPTIONS=--dns-result-order=ipv4first node scripts/import-eventmap-sessions.js --dry-run
   ```

   This is a property of the network the script is run from, which is why it stays an environment
   variable rather than a hardcoded `family: 4` in the driver options. `npm run eventmap` already
   carries it, since that is the one command somebody runs while something is going wrong.

## 14. Source of truth (file map)

| Concern | File |
| --- | --- |
| Storage + wire types | `src/eventmap/types.ts` |
| Structure load, validation, both hashes | `src/eventmap/eventmap.config.ts` |
| Pure materialization | `src/eventmap/eventmap.materialize.ts` |
| Publish orchestration + poller | `src/eventmap/eventmap-materializer.service.ts` |
| Manifest / snapshot reads + memos | `src/eventmap/eventmap.service.ts` |
| HTTP | `src/eventmap/eventmap.controller.ts`, `eventmap.internal.controller.ts` |
| Shared internal-token check | `src/common/internal-token.ts` |
| I/O + indexes | `src/eventmap/eventmap.data.ts` (no `seedIfEmpty` — there is no sensible default event) |
| Ops sheet → places | `scripts/import-eventmap-csv.js` + `scripts/lib/eventmap-{csv,db}.js` |
| Line-up → sessions | `scripts/import-eventmap-sessions.js` + `scripts/lib/eventmap-{sessions,db}.js` |
| Authored content | `scripts/data/eskara-2026-{places.csv,sessions.json}` |
| Window + kill switch | `scripts/eventmap-window.js` |
| Local demo dataset | `scripts/seed-eventmap-demo.js` |
| Sessions → map markers (the `/map` surface) | `src/map/map-event-markers.data.ts` — see [map-markers-api.md](map-markers-api.md) |
| Live layer set + usable config | `src/eventmap/eventmap.active.ts` |
| Category → presentation (`layerId`, card), both producers | `presentationFor` in `src/eventmap/types.ts` |
| Map layers, chips, name, emoji, camera, sorts, card templates, category table | `src/eventmap/config/*.json` (+ `CONFIG_FILES` and `copy-build-assets.js`) |
| DB + collection names | `src/infra/config.ts` `eventmap` block |
| Tests | `__tests__/nest/eventmap/`, helper `__tests__/helpers/nest/build-eventmap-app.ts` |

No contract is registered for this feature in the umbrella manifest. An earlier revision listed a
`predicate-vectors.json` parity fixture as planned; it was never registered, and with the predicate
language gone there is nothing for it to pin.

## 15. Related

- [map-markers-api.md](map-markers-api.md) — the shared marker schema and the `/map/*` routes that draw booths beside buildings
- [ADR 0004 — event map layer ownership](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md)
- [Umbrella ADR 0002 — pull-based config contracts](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0002-pull-based-config-contracts.md) — the shared-artifact mechanism
- [skkuverse-app `docs/eventmap-rendering.md`](https://github.com/spencer0124/skkuverse-app/blob/main/docs/eventmap-rendering.md)
- [Implementation plan — skkuverse#11](https://github.com/spencer0124/skkuverse/issues/11)
- Shuttle 증차 is a **separate** system — `bus_overrides` + `scripts/seed-eskara.js`. Link via a `route` action; do not rebuild
