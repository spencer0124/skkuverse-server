---
title: Configure Map Overlays
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-31
audience: internal
---

# Configure Map Overlays

> Everything the map can draw, and how to add or change one — which tier you edit, whether it needs a deploy, and what to check when a shape does not appear. The wire contract is [reference/map-overlays-api.md](../reference/map-overlays-api.md); why the module is shaped this way is [explanation/map-architecture.md](../explanation/map-architecture.md).

## Overview

An **overlay** is one drawable thing: a pin, a zone, a route line. Every overlay
carries a `kind` naming the renderer that draws it, and a `layerId` naming the
toggle it sits behind. Both overlay routes serve one heterogeneous collection —
pins and shapes together — so a client draws the whole map with one fetch.

### What can be drawn

| `kind` | Drawn today | Authorable today | Geometry it carries |
| --- | --- | --- | --- |
| `marker` | Yes | Yes | GeoJSON `Point` |
| `polygon` | Yes | Yes | GeoJSON `Polygon` — exterior ring plus holes |
| `path` | Yes | Yes | GeoJSON `LineString` |
| `polyline` | No | No | `LineString` — a dashed variant, lower draw plane |
| `arrowheadPath` | No | No | `LineString` — direction arrows |
| `circle` | No | No | a centre and a radius in metres |
| `multiPath` | No | No | segments with per-segment colour, one shared progress |
| `groundImage` | No | No | an image pinned to a bounding box |

The first three are real end to end. The rest are **reserved** — written down in
the union's doc comment in `src/map/map-overlay.types.ts`, with the arm, the
producer branch and the client component all still to build. See [Add a new overlay
kind](#add-a-new-overlay-kind) for what that costs.

> [!NOTE]
> A layer does **not** constrain geometry. One layer can hold pins, a zone and a
> route line at once, because the renderer is chosen per overlay by its `kind`.
> Whether to author one mixed layer or several separate toggles is a content
> decision you can change later without touching the wire.

### Which tier you are editing

The single most useful question before any change: **does this need a deploy?**

```text
  scripts/data/*.json ──► npm run <import> ──► Mongo ──► the overlay routes
       (repo, PR)                              (ops, live)      (60 s / 1 day TTL)

  src/map/config/<layerSetId>.json ──► the festival's layers, chips, categories
  src/map/map-layers.data.ts       ──► the permanent layers
       (repo, PR + deploy)
```

| To change | Edit | Deploy? |
| --- | --- | --- |
| A booth, zone or line's position, title, hours, buttons | the sheet, then re-import | No |
| Add or remove a zone, a route line, a footprint | the sheet, then re-import | No |
| Take the whole festival down now | the activation's `enabled` flag | No |
| A layer's colour, opacity, outline, zoom bounds | the layer set JSON, or `map-layers.data.ts` | Yes |
| Which layer a booth category lands on | the layer set JSON's category table | Yes |
| Whether a category is tappable | the layer set JSON's category table | Yes |
| Add a permanent layer | `map-layers.data.ts` | Yes |
| Add a new `kind` | the type union, a producer, and the client | Yes, plus an app release |

## Prerequisites

- `MONGO_URL` and the DB names in `.env` — see `.env.example`. The importers
  resolve the `_dev` suffix from `NODE_ENV` exactly as the server does, so an
  import with `NODE_ENV` unset writes to the dev database.
- A drawing tool that exports RFC 7946 GeoJSON: [geojson.io](https://geojson.io)
  is enough; QGIS and Google My Maps also work.
- Import commands are the `eventmap*` and `campus:shapes` entries in
  `package.json` (SSOT — do not memorise the flags, run with `--dry-run` first).

## Steps

### Draw a festival zone or a route line

Festival geometry lives in the same sheet and the same collection as the booths,
because a zone is a place whose geometry happens to be an area.

1. Draw the shape in geojson.io and copy the **`geometry` object** out of the
   exported Feature — the `{"type": …, "coordinates": …}` half, not the whole
   FeatureCollection.
2. Add an entry to the layer set's sheet under `scripts/data/`. A shape carries
   `geometry` **instead of** `lat`/`lng`:

   ```jsonc
   {
     "id": "zone-main-stage",
     "category": "zone",
     "order": 5,
     "title": "메인 무대 존",
     "hours": [],
     "geometry": {
       "type": "Polygon",
       "coordinates": [[
         [126.9712, 37.2951], [126.9715, 37.2951],
         [126.9715, 37.2949], [126.9712, 37.2949], [126.9712, 37.2951]
       ]]
     }
   }
   ```

   The rule is **a coordinate you type is named; a coordinate you paste is
   GeoJSON.** A booth's position is hand-typed off a survey, so it stays
   `lat`/`lng`; a thirty-vertex ring comes out of a tool in `[lng, lat]` and is
   pasted verbatim. Transcribing one into the other is where a swap gets
   introduced. A place carries one form or the other — both, or neither, is a
   rejected sheet.
3. Make sure the `category` you used resolves to a layer. If it is new, add it to
   the layer set's category table (that half **is** a deploy — see below).
4. Dry-run the import, read the report, then run it for real.
5. The change is live within the event route's TTL. No deploy, no restart.

> [!NOTE]
> Ring orientation is not your problem. RFC 7946 wants the exterior
> counter-clockwise and the client's SDK wants the opposite; the server
> normalises on the way out, so paste whatever your tool produced.

### Draw permanent campus geometry

Building footprints, the campus boundary, walking paths — anything that is not
tied to a festival. Same shape of task, a different sheet and a different
collection (`campus_shapes` in the building DB), and it is **not** a field on
the `buildings` documents, which are a mirror of SKKU's own data.

1. Draw and copy the geometry as above.
2. Add an entry to `scripts/data/campus-shapes.json`:

   ```jsonc
   {
     "id": "bldg-2-footprint",
     "campus": "hssc",
     "layerId": "campus_geometry",
     "title": "수선관 외곽",
     "skkuId": 2,
     "order": 0,
     "geometry": { "type": "Polygon", "coordinates": [[ /* … */ ]] }
   }
   ```

   - **`layerId`** must name a layer in `BASE_LAYERS` (`map-layers.data.ts`).
     There is no category table on this side — permanent geometry has no need to
     invent one mid-festival.
   - **`skkuId`** is the building this outlines, so tapping the footprint opens
     the same sheet its number pin opens. Use `null` for geometry that is not a
     building — a boundary, a lawn, a path — which makes it a backdrop rather
     than a tap target. Absent is **not** the same as `null` and is rejected, so
     forgetting the field cannot silently remove a tap.
3. Run `npm run campus:shapes -- --dry-run`, then for real.

### Turn on the campus geometry layer

`campus_geometry` ships **inert** — it draws nothing and offers no toggle —
because it exists so campus shapes have a `layerId` to name, and nothing had
been drawn when it landed. Once there is geometry worth showing, flip two fields
on its entry in `map-layers.data.ts`:

```ts
defaultVisibleWhen: { kind: "always" },   // was { kind: "never" }
userConfigurable: true,                   // was false
```

That is a deploy. Until then the layer is the "defined but inert" quadrant that
`userConfigurable`'s contract calls out as meaningful — better than shipping a
control that does nothing.

### Make a category a backdrop

A shape that is drawn but not pressable — a 통제 구간 outline, a boundary —
is authored by setting `interactive: false` on its **category** in the layer
set's `itemDefaults`. It resolves to `tap: null` on the wire.

Per category, not per layer or per place: two categories may map to one layer,
so a single 구역 layer can hold tappable stage zones and an inert boundary. An
absent value means `true` — never fail closed — and a non-boolean is rejected at
config load rather than coerced, because `"false"` is truthy.

### Style a layer

Every style knob is optional; a layer sending none renders exactly as one that
never had the field. What each knob paints depends on the overlay drawn under
it, which is why `color` is the *primary paint* rather than three separate
colour fields:

| Knob | On a marker | On a line | On a polygon |
| --- | --- | --- | --- |
| `color` | pin tint | stroke | **fill** |
| `outlineColor` | — | outline | outline |
| `outlineWidth` | — | outline thickness | outline thickness |
| `fillOpacity` | — | — | fill alpha, 0–1 |
| `minZoom` / `maxZoom` | zoom bounds | zoom bounds | zoom bounds |
| `size`, `width`, `height`, `captionTextSize`, `zIndex` | pin geometry | width | draw order |
| `shape` | dot vs pin — **do not send** | — | — |

`shape` is the one knob in that table you should leave alone. A place marker
draws as a small dot and becomes a pin only while it is selected, and the client
owns that default: it reads an absent `shape` as `dotThenPin`, so every festival
layer already behaves that way. Sending `"dotThenPin"` back would freeze a
default that is meant to move with the app that draws it. The field exists only
to opt a single layer **out** — `"pin"` for a handful of landmark markers, where
a teardrop reads better and there is no density to relieve — and the server does
not currently declare it at all, so opting out means adding the member to
`MapLayerStyle` first. Never put a shape in `markerStyle`: that is a closed
allowlist on the client, and an unrecognised member falls through to the
building-number rendering, drawing every booth as a green numbered circle on any
build older than the value.

Two of these are not optional in practice, and the reason is the client's own
defaults: its polygon overlay defaults `color` to **opaque black** and
`outlineWidth` to **zero**, so a zone shipped without `fillOpacity` and an
outline is a solid black blob with no border, hiding the booths inside it.
`EVENT_SHAPE_STYLE` in `map-layers.data.ts` supplies both for every festival
layer, and derives the outline colour from the category colour.

Festival layer colours are authored per layer in the layer set JSON, because a
category colour is content. The permanent layers deliberately send **no**
colour: the base map's palette is a design token that resolves per theme, and a
hex from the server cannot.

### Add a new overlay kind

Adding a `kind` is additive and non-breaking — an old client skips one it does
not recognise, dropping that overlay and never its layer or its siblings. Three
edits:

1. **The union** — a new arm on `MapOverlay` in `map-overlay.types.ts`. Where
   RFC 7946 can express the geometry, embed it verbatim under `geometry`;
   invent a shape only where the spec genuinely cannot, and use named
   `{ lat, lng }` fields when you do, since there is no spec to conform to and a
   named object cannot be transposed by accident.
2. **A producer branch** — whichever of the two `*-overlays.data.ts` modules
   emits it, plus its structural guard so a malformed document is skipped and
   counted rather than thrown.
3. **The client** — a renderer component and a `kind` the parser accepts. Until
   this lands the overlay is served and silently skipped.

The three that cannot be geometry-tagged (`circle`, `multiPath`, `groundImage`)
are the reason the union is tagged on the renderer at all; the argument is in
[map-architecture.md §12](../explanation/map-architecture.md).

## Troubleshooting

Work top-down — the earlier entries are far more common.

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Import rejected, nothing written | A rule in the sheet reader | Read the error list; every message names the exact path. Nothing is written when any row is bad, on purpose |
| Shape imported, never appears | `layerId` names no layer | The server logs a warn naming the id it could not resolve. Campus shapes must name a `BASE_LAYERS` entry |
| Festival shape imported, lands on the wrong layer | Its `category` is not in the category table | An unmapped category silently falls back rather than dropping the booth — check the table in the layer set JSON |
| Shape appears but cannot be tapped | The category is authored `interactive: false`, or a campus shape has `skkuId: null` | Both resolve to `tap: null`, which is the intended spelling for a backdrop |
| Zone renders as a dark blob covering the booths | Its layer has no `fillOpacity` | The client defaults the fill to opaque — see [Style a layer](#style-a-layer) |
| Zone has no border | Its layer has no `outlineWidth` | The client defaults it to zero |
| Nothing on the campus route but a dozen buildings | The buildings collection read empty and the fallback engaged | The response is `no-store` in that state, so it self-heals; check the buildings sync |
| Every festival layer and overlay vanished | The activation window closed, or `enabled` is false | This is the kill switch working. It is a Mongo edit, not a deploy |
| A hand-edited Mongo document broke a shape | Nothing breaks — it is skipped and counted | Grep the logs for the skip warning naming its `_id` |
| Coordinates land in the sea | A `[lat, lng]` paste | The reader's range check catches a wholesale swap on the first vertex; a partial one is caught by the round-trip test over the committed sheet |

> [!WARNING]
> An import writes to whichever database `NODE_ENV` resolves to. Confirm the
> `database` line the importer prints before answering yes to anything — the
> scripts print it precisely so a production write is never a surprise.

## Related

- [reference/map-overlays-api.md](../reference/map-overlays-api.md) — the wire contract: the overlay schema, the `kind` rules, the ring guarantees
- [reference/event-places.md](../reference/event-places.md) — the festival's storage and the window kill-switch runbook
- [explanation/map-architecture.md](../explanation/map-architecture.md) — why `src/map/` is shaped this way, and the order to read it in
- [docs/README.md](../README.md) — writing rules
