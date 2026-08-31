---
title: Migrate the App to Map Overlays
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-31
audience: internal
---

# Migrate the App to Map Overlays

> The client half of the overlay change, for whoever works in `skkuverse-app`. The server side is deployed and this break is live, so read [Urgency](#urgency) first. Full wire contract: [reference/map-overlays-api.md](../reference/map-overlays-api.md).

## Urgency

**This is already in production and the shipped app is broken by it.** The
marker routes return 404, so `parseMarkerData` reads an absent `data.markers`,
coalesces to `[]`, and the map draws nothing — no building pins, no booths. A
festival activation was open at deploy time, so this is user-visible now.

Ships JS-only over OTA, so adoption is not gated on a store release.

## What changed

| Before | Now |
| --- | --- |
| `GET /map/markers/{campus,event}` | `GET /map/overlays/{campus,event}` |
| `data.markers` | `data.overlays` |
| `lat: number`, `lng: number` | `geometry` — RFC 7946, `[lng, lat]` |
| renderer chosen by `layer.type` | renderer chosen by each overlay's `kind` |
| `MapLayerDef.type: 'marker' \| 'polyline'` | field removed |
| `pinPriority` on every marker | on `kind: "marker"` only |

Everything else on an overlay is byte-identical: `id`, `layerId`, `campus`,
`text`, `subtitle`, `hours`, `fields`, `actions`, `order`, `tap`.

Route URLs are **not** hardcoded — they arrive as `layers[].endpoint` from
`/map/config` — with one exception, below.

## Steps

1. **Fix `DEFAULT_MAP_CONFIG` first.** It hardcodes `/map/markers/campus` on
   both building layers. That is the app's fallback when `/map/config` fails, so
   until it is repointed at `/map/overlays/campus` a config hiccup lands on a
   404. Nothing else in the app hardcodes a map URL.

2. **Parse `data.overlays`, dispatch on `kind`.** Replace `parseMarkerData`'s
   `data.markers` read. Model the result as a discriminated union on `kind`
   (`"marker" | "polygon" | "path"`), and keep the existing per-field guards —
   `toFiniteNumber`, the campus allowlist, the drop-on-bad-coordinate rule.

3. **Convert coordinates in one place.** `geometry.coordinates` is
   `[longitude, latitude]`; the SDK wants `{ latitude, longitude }`. Write one
   named, tested adapter and let every renderer call it — this is the seam where
   a swap gets introduced, and a swapped Seoul coordinate lands in the Yellow
   Sea without throwing.

4. **Reverse polygon rings in that same adapter.** The server emits RFC 7946
   winding — exterior counter-clockwise, holes clockwise. `NaverMapPolygonOverlay`
   documents the **opposite** and warns that a wrongly wound ring may "draw
   abnormally or not receive events", i.e. a zone that is visible but untappable.
   The server guarantees its direction, so reverse unconditionally rather than
   measuring.

   ```ts
   // geometry.coordinates[0] → coords, the rest → holes
   const [outer, ...holes] = geometry.coordinates;
   <NaverMapPolygonOverlay
     coords={outer.reverse().map(toCoord)}
     holes={holes.map((h) => h.reverse().map(toCoord))}
   />
   ```

5. **Delete `MapLayerDef.type` and the `LAYER_TYPES` allowlist.** The
   `if (layer.type === 'polyline')` dispatch in `CampusScreen` goes with them —
   a layer no longer names a renderer, so one layer can hold pins, a zone and a
   line at once. Filter by `layerId`, then render each overlay by its own `kind`.

6. **Give the `kind` switch a `default:` that returns `null`.** Never an
   exhaustive switch asserting `never`. `kind` is an open enum — five more are
   reserved — and adding one is a non-breaking server change *only* if an
   unknown value is skipped. Skip the single overlay, never its layer or its
   siblings, and log it.

7. **Keep one query per endpoint.** Two layers over one URL must stay one fetch
   and one cache entry, as today. Return the whole `overlays` array from that
   query and let each layer component filter it.

8. **Build `placesById` from every overlay, not just markers.** It backs the
   detail sheet and the `skkuverse://map?place=…` deep link. A zone carries
   `tap: { kind: "event", placeId }` exactly as a booth does, so it should open
   the same sheet — that is the whole reason zones ride on the marker query's
   endpoint rather than a separate one.

9. **Honour `tap: null`.** It is a backdrop — drawn, not pressable. Do not wire
   `onTap` for it.

10. **Delete the dead polyline path.** `MapPolylineLayer`, `parsePolylineData`,
    `useLayerPolyline` and `PolylineCoord` all served `/map/overlays/:overlayId`,
    which is deleted (404). Line geometry now arrives as `kind: "path"` in the
    ordinary collection.

## New style fields

`MapLayerStyle` gains four, all optional. Two are effectively required for
polygons because of the SDK's own defaults:

| Field | Maps to | Why it matters |
| --- | --- | --- |
| `fillOpacity` | compose into `color` as `rgba()` | The SDK's polygon `color` defaults to **opaque black** — without this a zone hides the booths it groups |
| `outlineWidth` | `outlineWidth` | The SDK defaults it to **0**, i.e. no border at all |
| `minZoom` / `maxZoom` | `BaseOverlayProps` | Footprints are noise at campus-wide zoom |

`color` is the layer's **primary paint** — marker tint, line stroke, polygon
fill — and `outlineColor` is the stroke. Both are bare hex with no `#`; use the
existing `toCssColor`, not `MapPolylineLayer`'s `hexToRgba`, which ignores that
convention and yields `rgba(NaN,…)` on anything but a 6-digit value.

## Verification

- Building pins and labels draw on both campuses; tapping one opens the building
  sheet.
- Booth pins draw while a festival window is open; tapping one opens the peek
  sheet, and a deep link resolves.
- A layer served with an unrecognised `kind` renders its siblings and drops only
  that overlay.
- `/map/config` failing falls back to a config whose endpoints resolve.
- Live endpoints to test against are in
  [reference/map-overlays-api.md §5](../reference/map-overlays-api.md).

## Related

- [reference/map-overlays-api.md](../reference/map-overlays-api.md) — the wire contract, the `kind` rules, the ring guarantees
- [how-to/configure-map-overlays.md](configure-map-overlays.md) — the server-side runbook
- [explanation/map-architecture.md](../explanation/map-architecture.md) — why the union is tagged on the renderer
