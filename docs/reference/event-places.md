---
title: Event Places — Storage, Authoring and Operations
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-29
audience: internal
---

# Event Places

> How a festival's booths are stored, authored and switched on. The WIRE they reach the app over is
> [map-markers-api.md](map-markers-api.md) — one shared marker schema for booths and buildings alike.
> Cross-repo ownership is [ADR 0004](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md).

## 1. Summary

| | |
| --- | --- |
| Collections | `places`, `activations` (database: `MONGO_EVENTMAP_DB_NAME`) |
| Served by | `GET /map/markers/event` and `GET /map/config` — there is no `/eventmap` route |
| Authored by | `scripts/data/<layerSetId>-places.json` → `npm run eventmap:import` |
| Switched by | `npm run eventmap -- open\|close` |
| Structure tier | `src/map/config/<layerSetId>.json` — layers, chips, category table |

### 1.1 What this replaced

There were three tiers and a publish pipeline: `places` (plots) joined to `sessions` (one occupancy
interval each) and `activations`, materialized every 60 s into versioned, hashed, per-language
`snapshots` served `immutable, max-age=1y`.

One session per interval meant a booth open on both festival days was **two documents**, so the app
listed every place twice with nothing on the card to tell the rows apart. The plots were day-scoped
too — `nsc-daybooth-01`, `nsc-nightbar-d1-02` and `nsc-nightbar-d2-03` sat on one coordinate — which
is why the map needed a clock filter to stay legible at all.

The days are `hours` on a single document now. The snapshot tier, the materializer, both routes and
the whole notion of a plot separate from its occupant are gone.

## 2. `places` — one operating entity

One document is one booth, one bar, one 화장실. Not a thing-on-a-day.

```ts
interface MapPlaceDoc {
  _id: string;                 // "eskara-2026-bar-01" — layer set prefixed
  layerSetId: string;
  campus: "hssc" | "nsc";
  category: string;            // OPEN string → layerId via the config's table
  location: { type: "Point"; coordinates: [number, number] };   // [lng, lat]
  title: I18n;
  subtitle?: I18n | null;
  hours: { startAt: Date; endAt: Date }[];   // [] = always open
  fields: { label: I18n; value: I18n }[];    // ordered card rows
  actions: PlaceAction[];
  order: number;
  updatedAt: Date;
}
```

Three rules the code states once and only once:

- **`hours: []` means always open, and only that.** The old `startAt: null, endAt: null` had to mean
  both an always-on 화장실 and a rain-cancelled bar, which is exactly why a `status` field had to
  exist to tell them apart. There is no `lifecycle` here — a cancelled booth is **deleted** — so
  there is no second meaning left to encode.
- **Both bounds inside a window are required.** Half-bounded is not expressible: you write two
  windows, or none. Allowing one open end would hand `hours` a second way to say "no limit".
- **`category` is an OPEN string.** An unmapped value lands on the config's fallback layer rather
  than vanishing, because a booth nobody can see is not a failure anyone can report.

`_id` is prefixed with the layer set so two festivals may each hold a `bar-01`, and so an id read off
a deep link says which festival it belongs to.

## 3. `activations` — the ops lever

```ts
interface ActivationDoc {
  _id: string;                 // layerSetId
  activeFrom: Date | null;     // null = unbounded
  activeUntil: Date | null;
  enabled: boolean;            // one-field kill switch
  updatedAt: Date;
}
```

This tier survived the snapshot deletion deliberately. The window could have moved into the config
file, which would have made `activeLayerSet` pure and synchronous and deleted a fair amount of
error-swallowing at the `/map/config` seam. Keeping it in Mongo is what buys a kill switch that does
not need a deploy — see §6.2.

## 4. Indexes

Three, created by `MapService.onModuleInit` (`src/map/map-places.data.ts`):

| Index | Why |
| --- | --- |
| `places {layerSetId: 1}` | The one scan the projection makes. No lifecycle key — there is no lifecycle. |
| `places {location: "2dsphere"}` | **Not** a query index. It is what makes Mongo reject a malformed coordinate pair at insert, which is the cheapest available guard against the `[lng, lat]` swap (ADR 0004 invariant 3). |
| `activations {enabled: 1}` | The liveness read on every `/map/config`. |

## 5. Authoring

One file per layer set: `scripts/data/<layerSetId>-places.json`.

```json
{
  "layerSetId": "eskara-2026",
  "campus": "nsc",
  "places": [
    {
      "id": "bar-01",
      "category": "bar",
      "lat": 37.294749,
      "lng": 126.97076,
      "title": "슈퍼 정통 X 경영 브라더스",
      "subtitle": "연합 주점",
      "hours": [
        { "startAt": "2026-08-27T18:00:00+09:00", "endAt": "2026-08-28T00:00:00+09:00" },
        { "startAt": "2026-08-28T18:00:00+09:00", "endAt": "2026-08-29T00:00:00+09:00" }
      ],
      "fields": [{ "label": "메뉴", "value": "골뱅이소면 · 감자튀김 · 하이볼" }],
      "order": 70
    }
  ]
}
```

- **A bare string is Korean shorthand** for `{"ko": …}`. The sheet is hand-typed and overwhelmingly
  Korean-only, so requiring the object form on every string would be noise around the few that carry
  a translation.
- **`lat`/`lng` are named here** and become GeoJSON `[lng, lat]` in the reader — one conversion site
  on the write path, mirroring the projection on the read path.
- **A window crossing midnight** is written with the next day's date. That is why the 주점 entries
  end at `00:00` on the following morning.
- **`order` has no default.** A silent `0` would make list order arbitrary while looking deliberate.
- **A webview action stays root-relative.** Resolving it needs `WEBVIEW_ORIGIN`, which is server
  config; an importer holding its own copy would disagree with the server the moment it changed. The
  projection resolves at serve time, and drops a button it cannot resolve.

### 5.1 The old keys fail loudly

`days`, `slot`, `startOffsetMin`, `endOffsetMin`, `hoursLabel`, `lifecycle`, `placeId`, the tenant
triplet, and the root-level `timeBase` and `sessions` are all **rejected by name**, each naming its
replacement.

`days: [1, 2]` is the one that matters: it is the key the old importer expanded into `-d1` and `-d2`
documents, which is the duplication this format exists to remove. A pasted old-format file has to
fail rather than import each place once and silently lose its second day.

### 5.2 Why JSON and not a spreadsheet

`hours`, `fields` and `actions` are lists. A CSV cell cannot carry one without inventing a separator
to get wrong later — the same argument the previous sessions reader made for itself. The coordinate
survey used to be a CSV because a plot was flat; a place is not.

## 6. Operations

### 6.1 Loading content

```bash
# Validate and report. Writes nothing.
NODE_ENV=production npm run eventmap:import -- --dry-run

# Import. Creates the activation if absent, DISABLED, and can never re-enable one.
NODE_ENV=production npm run eventmap:import

# Remove places that have left the sheet.
NODE_ENV=production npm run eventmap:import -- --delete-missing
```

Nothing is written if any place is rejected: a half-imported map is worse than none, because the
missing booths are invisible and the ones that made it look authoritative.

`--delete-missing` really deletes — there is no `lifecycle: "retired"` to fall back on. It is opt-in
because a truncated sheet plus an automatic delete is how a festival disappears mid-afternoon.

### 6.2 The window — and the kill switch

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

1. **Nothing that can render the layer set is deployed.** Check the shipped tree, not the branch —
   `main` containing the code proves nothing about what users have.
2. **A long event whose end is genuinely unknown**, where a wrong `activeUntil` would drop the map
   mid-festival — a worse failure than a forgotten one.

`status` prints `NO EXPIRY — stays up until somebody runs close` on every read in that state, which
is the only thing standing between "we meant to leave it up" and "nobody remembered it was up".

**This is why the activation stayed in Mongo.** `close` is the kill switch for a rain cancellation or
anything else going wrong, and it takes effect without a deploy: `/map/config` reads the activation
per request, so the layers and the chip row turn over immediately, while `/map/markers/event` is
`public, max-age=60`, so a booth already fetched can linger for up to a minute. **Rehearse before the
festival**, not during one.

### 6.3 Staging before the window opens

Import at any time. `/map/config` advertises no festival layers and `/map/markers/event` returns `[]`
until `activeFrom`, so content can sit on production with zero exposure.

### 6.4 When Atlas refuses with `SSL alert number 80`

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
   NODE_OPTIONS=--dns-result-order=ipv4first node scripts/import-eventmap-places.js --dry-run
   ```

   This is a property of the network the script is run from, which is why it stays an environment
   variable rather than a hardcoded `family: 4` in the driver options. Both npm scripts already carry
   it, since those are the commands somebody runs while something is going wrong.

## 7. Source of truth (file map)

| Concern | File |
| --- | --- |
| Stored documents | `src/map/map-places.types.ts` |
| I/O + indexes | `src/map/map-places.data.ts` (no `seedIfEmpty` — there is no sensible default event) |
| Places → map markers | `src/map/map-event-markers.data.ts` — see [map-markers-api.md](map-markers-api.md) |
| Live layer set + usable config | `src/map/map-active-layerset.ts` |
| Structure load + validation | `src/map/map-layerset.config.ts` |
| Structure types, `presentationFor` | `src/map/map-layerset.types.ts` |
| Layers, chips, name, emoji, camera, category table | `src/map/config/*.json` (+ `CONFIG_FILES` and `copy-build-assets.js`) |
| Sheet → documents (pure) | `scripts/lib/map-places-file.js` |
| Importer | `scripts/import-eventmap-places.js` + `scripts/lib/eventmap-db.js` |
| Authored content | `scripts/data/eskara-2026-places.json` |
| Window + kill switch | `scripts/eventmap-window.js` |
| DB + collection names | `src/infra/config.ts` `eventmap` block |
| Tests | `__tests__/nest/map/` |

## 8. Related

- [map-markers-api.md](map-markers-api.md) — the shared marker schema and the `/map/*` routes
- [ADR 0004 — event map layer ownership](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md)
- Shuttle 증차 is a **separate** system — `bus_overrides` + `scripts/seed-eskara.js`. Link via a `route` action; do not rebuild it here.
