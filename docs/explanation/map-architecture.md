---
title: The Map Module, In Reading Order
type: explanation
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-31
audience: internal
---

# The Map Module, In Reading Order

> Why `src/map/` is shaped the way it is, and the order to read it in. Opened alphabetically the module is a pile; opened in this order it is four short legs, each depending only on the one before it. Endpoint contracts live in [reference/map-overlays-api.md](../reference/map-overlays-api.md); the ops-side storage contract is [reference/event-places.md](../reference/event-places.md).

> [!NOTE]
> `src/map/` is the SSOT. File and symbol names below are pointers to help you navigate, not enshrined
> truth — no line numbers are quoted here on purpose, because they drift on every edit. Grep for the
> symbol.

## 1. The four nouns

Most confusion about this module is vocabulary, not code. Four things sound alike and are not.

| Noun | What it is | Decides |
| --- | --- | --- |
| **layer** | One kind of thing with one on/off switch | What gets drawn, in what colour, behind which toggle |
| **layer set** | One festival's whole bundle — its layers, chips, camera and category table — as one JSON file | Which festival's layers and chips exist right now |
| **chip** | One pill in the row above the map | What a tap does: move the camera, and set which layers are on |
| **chip group** | A `chipGroupId` field on every layer | Which layers a chip is allowed to switch off. `null` means none, ever |

Only the first and third are visible on screen. A layer set and a chip group never draw a pixel — they
are the rules that decide what fills the layer list and the chip row.

Two consequences fall out of this and are worth holding onto:

- **A layer is a switch, not a download.** Every festival layer points at one shared marker endpoint
  (`EVENT_OVERLAYS_ENDPOINT`), and both building layers point at another. The app keys its overlay cache
  on the endpoint string, so layers sharing a source cost one fetch between them; each renders the
  subset of markers carrying its own `layerId`.
- **A chip does two things at once.** It carries a camera *and* a list of layer ids. That pairing is
  why chips exist instead of just more toggles.

## 2. The territory: two requests, one chokepoint

The module serves several endpoints, but only two are interesting, and they meet in the same function.

```text
  GET /map/config              GET /map/overlays/event
         │                              │
         ▼                              ▼
  map-config.data              map-event-overlays.data
         │                              │
         └──────────────┬───────────────┘
                        ▼
              activeEventConfig()            <- map-active-layerset.ts
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
  findActiveActivation()        getLayerSetConfig()
  `activations` collection      `config/<layerSetId>.json`
  MONGO, read per request       REPO, parsed once at import
```

Both endpoints ask the same question through the same small file. That is deliberate: asking
separately would be two reads for one answer, and the two could disagree if the activation window
closed between them — serving a chip row pointing at layers no longer in the response.

> [!IMPORTANT]
> The most useful single fact about this module: **the JSON config is read from disk exactly once, at
> import; the Mongo activation is read on every request.** Editing a layer set's JSON needs a
> redeploy. Flipping `enabled: false` on its activation takes the festival down without one.

## 3. Ownership tiers

The module is organised by who can change a thing, not by what the thing does. Every file belongs to
one of three tiers, and knowing which one answers most "where do I edit this" questions.

| Tier | What lives there | To change it |
| --- | --- | --- |
| **repo** | TypeScript, plus committed JSON under `src/map/config/` | PR and deploy |
| **mongo** | The `places` and `activations` collections | Ops edit live, mid-festival, no deploy |
| **wire** | The shapes the app receives (`MapOverlay`, `MapChip`, the config response) | Deploy *and* an app release |

This split is also the fail-loud / fail-soft boundary, per the reasoning in
[reference/event-places.md](../reference/event-places.md): a bad value in the repo tier is a developer
mistake that a PR fixes, so it fails loudly at boot; a bad value in the Mongo tier is content, so it is
logged and skipped while the rest of the map keeps serving.

## 4. Leg 1 — the door

Three thin files. Read them to learn what exists, then stop thinking about them; they hold almost no
logic on purpose.

- **`map.module.ts`** — the endpoint list and the rate limiter. The only file that shows the module's
  full surface in one screen: three endpoints across two prefixes, `/map/config` and
  `/map/overlays/{campus,event}`. It imports `BuildingModule`, because the campus overlay path reaches
  into the building feature for both its buildings and its `campus_shapes`. There is no poller: the
  feature is purely HTTP.
- **`controllers/`** — HTTP concerns only. Worth one careful read for the caching, which is where the
  real decisions are. The campus route reads a `degraded` flag from its data module and downgrades to
  `no-store` when the buildings projection fell back to its hardcoded list; without that, a brief empty
  read during a re-seed would pin a near-empty campus into every client and edge cache for a day, on a
  stable URL with nothing to bust it. The event route uses a much shorter TTL, short enough that an ops
  correction is live before anyone walks there.
- **`map.service.ts`** — delegates 1:1 to the data modules; it exists so Nest has something injectable.
  One thing here is not delegation: `onModuleInit` calls `ensureIndexes()` inside a non-fatal
  try/catch. It used to also hold a bus-route coordinate map imported from `src/bus/` — the one place
  this module reached sideways into another feature's data — and that went with the legacy overlay
  routes.

## 5. Leg 2 — the contracts

Five type files plus one tiny geometry module, zero runtime behaviour beyond a shoelace sum. Read them
before touching any logic: their doc comments *are* the design record, and every later file is these
shapes being filled in.

### `map-overlay.types.ts`

The most important file in the module. `MapOverlay` is the one drawable schema, shared by buildings,
festival booths, zones and route lines alike. Buildings and booths used to ship different shapes, which
is what forced the app to carry two rendering paths; every producer imports this now, so a field can no
longer be added to one and forgotten in the others.

Four things to understand before anything else:

- `kind` — which renderer draws this overlay, and the SINGLE discriminant. It names the renderer rather
  than the geometry, because four of the client's overlay components consume the same coordinate
  sequence and differ only in how they paint it — a geometry-shaped tag could not tell them apart. It
  is an OPEN enum: a client skips a `kind` it does not know, dropping that one overlay and never its
  layer or its siblings.
- `layerId` — which layer draws this overlay. Not unique across layers: one building is drawn once per
  building layer, and both overlays share an `id`.
- `hours: []` — an empty window list means **always open**, and that is its only meaning. There is
  deliberately no `status` field; it was only ever a cache of this arithmetic, and it forced
  "both bounds null" to mean two opposite things.
- `pinPriority` — the *second* step of the client's collision ladder, after openness. Ordering it first
  would hide an open booth behind a bar that is shut. It lives on the `marker` arm alone: two
  overlapping zones are a design choice, not a collision, and a union makes it unrepresentable
  elsewhere rather than merely unused.

`MarkerTap` is a discriminated union whose `placeId` is a string for every kind, including buildings
whose id is numeric in Mongo. One addressing scheme is the point, and it makes the deep link literally
the two fields of the tap. `tap: null` is how a backdrop is expressed — drawn, not pressable.

### `geo/geojson.types.ts` and `geo/ring-winding.ts`

The RFC 7946 vocabulary, shared by storage and the wire, and the one operation performed on it.

The geometry object in Mongo and the geometry object in the response are the SAME object. There is no
converter on the server, and that is the whole design: an axis swap can only be introduced at a
conversion, and swapped Seoul coordinates land in the Yellow Sea without ever throwing.

`ring-winding.ts` is the single exception, and it earns it. RFC 7946 §3.1.6 requires exterior rings
counter-clockwise; Mongo's `2dsphere` validates closure and self-intersection but **never orientation**,
so a reversed ring stores silently and the client's polygon overlay then draws it wrong or refuses its
taps. Normalisation runs on READ rather than in the importer for two reasons: `scripts/` is CommonJS and
outside tsconfig, so an importer doing this would need a second copy of the shoelace; and hand-editing
Mongo is a blessed ops workflow, so an import-time-only fix would miss the edits most likely to be
wrong. It reorders ring elements only, so it cannot transpose a `[lng, lat]`, and it returns the same
object untouched when nothing needed changing.

### `map-chip.types.ts`

`MapChip`, `MapChipAction` and `MapCamera`. The action is discriminated on `kind` — a `webview` chip
opens a page, a `focus` chip carries a camera and a `layerIds` array. The comment on that array states
the two rules governing what a tap may change; they are enforced two files later, in `map-chips.data`.

Also recorded here: a reserved third variant that is written down but not built, and a warning that the
client cannot honour `tilt`/`bearing` and `durationMs` at the same time — an SDK limitation the server
deliberately does not bake into the wire.

### `map-layerset.types.ts`

`EventMapConfig`, the authored shape of a festival JSON, plus `presentationFor` — the one resolver that
turns a booth's `category` into a layer and a pin priority.

```ts
// map-layerset.types.ts — `Object.hasOwn`, not `??`: `category` is ops-typed
// and `byCategory` is a plain object, so "constructor" or "toString" would
// otherwise resolve to a prototype member — truthy, and not a presentation —
// and the booth would ship with no layer, silently.
return Object.hasOwn(byCategory, category) ? byCategory[category]! : fallback;
```

`category` is an **open** string edited in Mongo, so an unmapped value is content rather than a config
bug: it falls back to the config's fallback layer rather than dropping the booth off the map.

### `map-places.types.ts`

The two stored document shapes. Nothing here is a wire type. `MapPlaceDoc` is one operating entity —
this booth, on this spot, open during these intervals. `ActivationDoc` is the ops lever, and its
`enabled` field is the whole reason the activation tier lives in Mongo rather than in the config file:
it buys a kill switch that does not need a deploy.

Note what is absent: no `lifecycle`, no `deletedAt`, no `status`. A cancelled booth is deleted, and
that is exactly what frees `hours: []` to mean one thing.

## 6. Leg 3 — the assembly

Five files that build one `GET /map/config` response. Read them in this order; it is also the import
order, and section 8 explains why that is enforced rather than conventional.

1. **`map-layers.data.ts`** — the layer catalogue. `BASE_LAYERS` holds the building layers, hardcoded
   and present every day of the year. `eventLayerSpecs()` manufactures the live festival's layers from
   its config. `chipGroupOf()` resolves a layer id to its exclusivity group. A leaf module: it imports
   only types, so nothing can create a cycle through it.

   Two fields on the generated specs carry the whole festival story — `type` is hardcoded to `marker`
   (see section 12), and `chipGroupId` is set to the layer set's own id, which is what makes each
   festival its own fence.

2. **`map-chips.data.ts`** — the chip validator, the synthesised reset chip, and the spec → wire
   projection. The validator accumulates errors rather than throwing on the first, so a bad edit is
   fixed in one pass. `BASE_CHIPS` is validated **at import**, so an invalid permanent chip aborts the
   boot rather than surfacing on the first request.

   `resetChip()` is derived from the layer list, never authored: it names the layers belonging to the
   festival's default view, which is not necessarily all of them — a layer that ships hidden stays out
   of it. Deriving it is what makes drift impossible; a second hand-written list of the same ids is
   exactly the parallel structure that quietly stops turning one category back on.

3. **`map-layerset.config.ts`** — reads `config/*.json` off disk, validates every field, freezes the
   result. Most of the file is hand-rolled primitive validators that each throw a message naming the
   exact path; skim those and read `assertValidConfig` and `loadOne` properly.

   `loadOne` is where the fail-soft posture lives: a rejected config is logged with the filename and
   skipped, so `/map/config` keeps serving the base layers and only the festival is missing. Silence
   here would look exactly like "the festival is over".

   Near the end of `assertValidConfig`, the chip validator runs over the base chips *plus* the
   festival's, against the base layers *plus* the festival's — the row exactly as it will be served.
   That is the only place a collision with the synthesised reset chip can be caught at all, since that
   chip is authored nowhere.

4. **`map-active-layerset.ts`** — the smallest file in the module and the one to memorise. It answers
   one question, "which layer set is live, and is its config usable?", and returns `null` for three
   distinct causes: no festival today, an activation naming a layer set this build has no file for, or
   a file that failed validation. None is a reason to fail a request, and each deploy-or-ops mistake is
   logged once per process rather than once per request.

5. **`map-config.data.ts`** — assembles the response. Two things to read closely. `activeEvent()` wraps
   the lookup in a try/catch that answers "no festival" on failure, preserving the never-fails property
   the route had before it had any DB dependency at all; without it a Mongo hiccup would trade a missing
   festival for a blank campus map, because the app's own fallback config holds no building layers
   either. And the layer list is built by concatenating the two origins and mapping over them **once**:

   ```ts
   // map-config.data.ts
   const layerSpecs = event
     ? [...BASE_LAYERS, ...eventLayerSpecs(event)]
     : BASE_LAYERS;
   ```

   One mapping with a `...rest` spread, not a field-by-field copy, so a member added to `LayerSpec`
   reaches the wire in one edit. The festival layers used to be built by a separate hand-copied
   mapping, which meant a new member shipped on the buildings and was silently missing from the booths
   with `tsc` green.

   On the wire the two origins are indistinguishable — one flat `layers` array, no field marking where
   a layer came from. That is what lets the app hold one renderer with no "festival mode" branch. It
   also creates a shared namespace, which is why a festival layer reusing a base layer id is rejected
   at config load.

## 7. Leg 4 — the markers

Where pins are produced. Two independent producers, one shared output schema, and the raw Mongo layer
underneath them.

- **`map-places.data.ts`** — collection getters, `ensureIndexes()`, and `findActiveActivation()`. The
  sort on that query is not cosmetic: nothing stops ops enabling two overlapping layer sets, and an
  unsorted `findOne` would let the poller and each api replica pick a different one, making the served
  festival flap between requests. The `2dsphere` index is not for geo queries — none are run — it
  exists because Mongo rejects a malformed coordinate pair at insert, which is the cheapest guard
  against a `[lng, lat]` swap.
- **`map-campus-overlays.data.ts`** — everything permanent, in one collection: buildings into marker
  overlays, plus hand-authored `campus_shapes` into polygons and paths, plus a small hardcoded fallback
  for an empty buildings collection. A building is emitted once per layer — same document, different
  field in `text` — but that is the common case rather than a guarantee: three filters apply
  independently, so a building can land on two layers, one, or none. Read the comments on the `||`
  coalescing and the `Number.isFinite` guard; both document real upstream data defects that TypeScript
  cannot catch. The two reads are concurrent and the shapes read is caught, so campus geometry can fail
  without taking the campus map with it — which keeps `degraded` meaning exactly one thing.
- **`map-event-overlays.data.ts`** — places into overlays, the other end of the same schema. The header
  comment is the best summary of the event map's history in the repo, including the three fields that
  were deleted and why. One unrenderable document is skipped and counted in the log rather than taking
  the other sixty with it; a malformed sheet button is dropped and named, rather than dropping the whole
  booth. `kind` is derived from the stored `geometry.type` rather than stored beside it, because a
  second field saying the same thing could disagree with the first.

Both producers pass Point and LineString geometry through **by reference**. Only a polygon's rings are
touched, and only to normalise winding.

## 8. Why the reading order is the import order

Leg 3 must be read in that sequence because the imports only run one way, and a lint rule keeps them
that way.

```text
                       map-config.data          <- builds the response
                              ▲
                              │
                      map-active-layerset       <- "which festival is live?"
                              ▲
                              │
                      map-layerset.config       <- loads and validates the JSON
                         ▲          ▲
                         │          │
             map-layers.data    map-chips.data  <- LEAVES: type-only imports
                (catalogue)      (validator)
```

Chips reference layer ids, and a chip's `layerIds` must resolve to a `chipGroupId` to be validated —
so the config loader needs both leaves at runtime, to check a festival against the full served
catalogue. Keeping the catalogue and the validator in leaf modules is what makes that possible without
a cycle. A back edge from either leaf would close one, and `eslint.config.js` refuses it by path: the
rule is code, not prose.

## 9. Boot time versus request time

Getting this wrong is the most common way to be confused about the module. Roughly half the work
happens once, at process start, and never again.

| When | What runs | If it fails |
| --- | --- | --- |
| import | Base chips validated against base layers | Boot aborts — repo TypeScript, a PR fixes it |
| import | Every `config/*.json` read, parsed, validated, frozen | Logged and skipped; the base map keeps serving |
| boot | `ensureIndexes()` on `places` and `activations` | Warn and continue; indexes are a nicety, not a prerequisite |
| per request | Activation lookup — is a festival live right now? | Caught; serves base layers only |
| per request | Layer and chip lists built, labels resolved to `meta.lang` | — |
| per request | Places scanned by `layerSetId` and projected to overlays | Unrenderable rows skipped and counted in the log |
| per request | Polygon rings normalised to RFC 7946 winding | — (a degenerate ring is left alone) |

The pattern behind that table: **fail loud where a PR fixes it, fail soft where content broke, and
never fail the request.** The building layers must survive a typo in an ops spreadsheet.

## 10. Change map

The practical index. The last column is section 3's ownership split, applied.

| To do this | Touch | Deploy? |
| --- | --- | --- |
| Take the festival down right now | `activations` doc → `enabled: false` | No |
| Move a booth, fix a title, add a sheet button | `places` collection | No — live within the event route's TTL |
| Add a festival zone or route line | the sheet's `geometry` key → `npm run eventmap:import` | No |
| Make a category a backdrop rather than a tap target | the layer set JSON → `itemDefaults` → `interactive: false` | Yes |
| Add a building footprint, a boundary, a path | `scripts/data/campus-shapes.json` → `npm run campus:shapes` | No |
| Change festival dates | `activations` → `activeFrom` / `activeUntil` | No |
| Add, rename or recolour a festival layer | the layer set JSON → `layers[]` | Yes |
| Add a festival chip | the layer set JSON → `chips[]` | Yes |
| Map a new booth category to a layer | the layer set JSON → `itemDefaults.byCategory` | Yes |
| Add next year's festival | New JSON **and** `CONFIG_FILES` **and** `scripts/copy-build-assets.js` | Yes — three coordinated edits |
| Add a permanent, off-season chip | `map-chips.data.ts` → `BASE_CHIPS` | Yes |
| Bring the bus route lines back | Give them `campus_shapes` documents with LineString geometry | No |
| Change how a pin is drawn (size, z-index) | `map-layers.data.ts` → `BASE_LAYERS[].style` or `EVENT_LAYER_STYLE` | No — the client reads these as of app `ced0352` |
| Add a field to every overlay | `map-overlay.types.ts`, then **every** producer | Yes, plus an app release |
| Add a new overlay kind (circle, ground image) | A `MapOverlay` arm, a producer branch, a client renderer | Yes, plus an app release |

> [!WARNING]
> Adding a layer set is the three-edit row above, and forgetting the third breaks **production only** —
> the dev server reads from `src/`, the built image reads from `dist/`. `map-config-assets.test.ts`
> exists to make that failure loud at test time, and is the reason `CONFIG_FILES` is an explicit list
> rather than a `readdirSync`.

## 11. What the tests pin

Under `__tests__/nest/map/`. When you change something, this is which one will shout — and reading a
test is often faster than reading the file it covers.

| Test | Pins |
| --- | --- |
| `map-layerset.config.test.ts` | Every validator rejection path, by exact message |
| `map-chips.test.ts`, `map-chips-wire.test.ts` | The chip group rules, reset chip synthesis, spec → wire projection |
| `map-active-layerset.test.ts`, `map-window.test.ts` | The chokepoint, and window arithmetic including null bounds |
| `map-event-overlays.test.ts`, `map-overlay-coordinates.test.ts` | Projection, the unrenderable-row skip, `[lng, lat]` ordering |
| `map-campus-overlays.test.ts` | Both building layers from one call, campus geometry beside them, the degraded fallback |
| `map-geometry.test.ts` | Winding and closure — the one guarantee Mongo does not give |
| `map-overlay-interactive.test.ts` | `interactive: false` → `tap: null`, one layer holding both |
| `campus-shapes-import.test.ts` | The campus authoring reader |
| `building-indexes.test.ts` | The `campus_shapes` 2dsphere exists, on the right collection |
| `map-config-assets.test.ts` | That every declared layer set is also in the build-asset copy list |

## 12. What an overlay can be

A recurring question, and it used to have a confusing answer because the renderer was named twice —
once by the layer's `type` and once by the geometry. There is one discriminant now, `kind`, on the
overlay itself.

| `kind` | Server emits it | Client renders it | Geometry it carries |
| --- | --- | --- | --- |
| `marker` | Yes | Yes | RFC 7946 `Point` |
| `polygon` | Yes | Yes | RFC 7946 `Polygon` (exterior + holes) |
| `path` | Yes | Yes | RFC 7946 `LineString` |
| `polyline` | Reserved | No | `LineString` — dashes, cap/join, a lower z-plane |
| `arrowheadPath` | Reserved | No | `LineString` — `headSizeRatio` |
| `circle` | Reserved | No | **none** — a centre and a radius in metres |
| `multiPath` | Reserved | No | **none** — parts with per-part colour, one shared progress |
| `groundImage` | Reserved | No | **none** — an image on a bounding box |

A **layer** no longer constrains any of this. It is a filter and a toggle, so one layer can draw pins, a
zone and a route line together — turning on 부스 can show all three.

### Why the tag names the renderer and not the geometry

This is the load-bearing decision in the module, and the reserved rows above are the argument for it.

`path`, `polyline`, `arrowheadPath` and `multiPath` all carry the **same** geometry — a coordinate
sequence — and differ only in how they are painted. A geometry-shaped format cannot tell them apart at
all; it would need a `renderAs` field beside the geometry, which is this union again, only hidden
somewhere nothing can validate it. And `circle`, `multiPath` and `groundImage` have no RFC 7946
representation whatsoever: GeoJSON has no circle type and no raster concept, and a `MultiLineString`
is one geometry with one properties bag, so per-part colours have nowhere to live.

Every mapping stack that supports these puts them **outside** the feature model for the same reason —
Mapbox makes an image a separate *source type*, KML makes `<GroundOverlay>` a separate element, MapKit
a separate `MKOverlay` subclass. Every mobile map SDK's own hierarchy is renderer-shaped, and matching
the SDK taxonomy is matching the domain.

The rule that keeps this from drifting into a private dialect: **where RFC 7946 can express the
geometry, embed it verbatim under `geometry`; invent a shape only where the spec genuinely cannot.**
Three documented exceptions is defensible; twenty is a format.

### Adding one

A new `kind` is additive and non-breaking, in three edits: an arm on `MapOverlay`, a branch in whichever
producer emits it, and a renderer plus a `LAYER_KINDS` entry on the client. A client that has not
shipped the third simply skips it — dropping that one overlay, never its layer or its siblings.

> [!NOTE]
> That skip is a contract, not an implementation detail. A client must not model `kind` with an
> exhaustive switch asserting `never`, which is precisely what turns an additive server change into a
> crash on an old build.

## Related

- [how-to/configure-map-overlays.md](../how-to/configure-map-overlays.md) — the runbook: what can be drawn, which tier to edit, and what to check when a shape does not appear
- [reference/map-overlays-api.md](../reference/map-overlays-api.md) — the endpoint and overlay contract
- [reference/event-places.md](../reference/event-places.md) — the `places` / `activations` storage contract and the window kill-switch runbook
- [explanation/notices-architecture.md](notices-architecture.md) — the sibling explanation doc, same shape for a different feature
- [docs/README.md](../README.md) — writing rules
