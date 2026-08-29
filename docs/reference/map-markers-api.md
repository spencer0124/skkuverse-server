---
title: Map Markers API Reference
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-29
audience: internal
---

# Map Markers API

> The one marker schema every layer of the campus map draws, the two layer flags that say what is
> visible and who may change it, the chips that move the camera and swap layer sets, and the three
> endpoints that carry them. Cross-repo ownership is
> [umbrella ADR 0004](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md);
> the festival's storage, authoring and ops tiers are [event-places.md](event-places.md).

## 1. Summary

| | |
| --- | --- |
| Routes | `GET /map/config`, `GET /map/markers/campus`, `GET /map/markers/event` |
| Auth | none on all three |
| Rate limit | `BusRateLimitMiddleware`, applied to the `/map` prefixes in `MapModule.configure` |
| Wire schema | `src/map/map-marker.types.ts` (markers), `src/map/map-chip.types.ts` (chips) |
| Producers | `src/map/map-markers.data.ts` (buildings), `src/map/map-event-markers.data.ts` (event places) |
| Layer catalogue | `src/map/map-layers.data.ts` — the base layers, and the projection of a festival's `layers[]` from its config |
| Chips | `src/map/map-chips.data.ts` — the base chips, the projection of a festival's `chips[]`, the synthesised reset chip, and the one validator both go through |
| Response builder | `src/map/map-config.data.ts` |
| Envelope | `{ meta: { lang }, data: { markers: [ … ] } }`, `Vary: Accept-Language`, `X-Response-Time` |
| Tests | `__tests__/nest/map/` |

A building and a booth are **the same kind of thing, addressed the same way** (umbrella ADR 0004
invariant 1). Before this contract they were not: the festival shipped its own manifest, snapshot,
cache and marker component beside the base map's, which is a second rendering system for the same
picture. Both producers now import the types in `map-marker.types.ts`, so a field can no longer be
added to one and forgotten in the other.

> [!NOTE]
> This is now the **only** wire the festival travels on. The snapshot tier that used to carry the
> list and card content — `/eventmap/manifest`, `/eventmap/snapshot`, the materializer, the
> `snapshots` collection — is deleted, and the marker carries `subtitle`, `hours`, `fields` and
> `actions` in its place. Storage, authoring and the kill switch are
> [event-places.md](event-places.md).

## 2. The marker schema

Every marker on every layer, from either producer, is exactly this object. Nothing is optional
except `text.zh` — a building fills the booth-shaped half with stated emptiness rather than omitting
it, because an absent field is a second thing for the client to branch on.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Unique **within its layer** — a building id, or a place id. NOT unique across layers: one building is drawn once per building layer and both markers carry the same value, so the client's key has to be layer id plus this |
| `layerId` | `string` | Which layer draws this marker. The server decides membership; the client filters on it. Always one of the ids `GET /map/config` advertises |
| `campus` | `"hssc" \| "nsc"` | The `Campus` literal from `src/building/types.ts` |
| `lat` | `number` | Latitude. Un-swapped from Mongo's GeoJSON `[lng, lat]` by the server, which is the only converter (ADR 0004 invariant 3) |
| `lng` | `number` | Longitude |
| `text` | `I18nWire` | The string this marker **displays** — a building number, a building name, a booth title. The layer's `markerStyle` decides how it is drawn |
| `subtitle` | `I18nWire \| null` | What this marker is, under its name — a tenant, a department. `null` for every building |
| `hours` | `TimeWindow[]` | Every interval this place is open, in authored order. **Empty means always open** |
| `fields` | `{ label: I18nWire; value: I18nWire }[]` | Card rows in authored order, each carrying its own label. Empty for a building |
| `actions` | `MarkerAction[]` | Sheet buttons in authored order. Empty for a building |
| `order` | `number` | Author's sort position, and the last tiebreak in a coordinate collision. Lower wins |
| `pinPriority` | `number` | First step of the collision ladder, from the layer set's category table. Higher wins. `0` for a building |
| `tap` | `MarkerTap \| null` | What a tap resolves to, or `null` for a marker that is not interactive |

```ts
interface I18nWire { ko: string; en: string; zh?: string }

/** Both bounds real. Half-bounded is not expressible — see §3. */
interface TimeWindow { startAt: string; endAt: string }

interface MarkerAction {
  id: string;
  label: I18nWire;
  actionType: "content" | "route" | "webview" | "external" | "miniapp";
  actionValue: string;
  style?: "primary" | "secondary";
}

type MarkerTap =
  | { kind: "skku_building"; placeId: string }
  | { kind: "event"; placeId: string };
```

For an event marker `placeId` is the **place's own id**, so two booths sharing one plot are two taps.
They used to be two sessions collapsing onto one plot id, which is what made a tap ambiguous and
needed a stack to resolve.

### 2.0 `actionValue` is always complete by the time it ships

A `webview` value is authored root-relative (`/eskara/entry`) and resolved against `WEBVIEW_ORIGIN`
at serve time, so the client only ever sees an absolute URL — a relative string handed to a URL
opener is the shape of an open redirect. `route` is the exception and stays root-relative, because it
reaches the app's own navigator rather than an opener.

A button whose label is blank in every language, or whose value is wrong for its type, is **dropped**
and the booth is served without it. Ops authored the value; losing a button is recoverable in a way
that dropping the booth is not.

### 2.1 `text` ships every language, and is not resolved server-side

`text` carries what we hold rather than the one string that matches `meta.lang`, because the two
producers hold different sets: a building has `{ko, en}` only (`BuildingDoc.name`), while an
ops-authored booth title may also carry `zh`. Resolving server-side would mean picking one and
discarding the rest.

`ko` is the source language and always present. `en` falls back to `ko` when the English string is
missing — and **missing means the empty string, not `null`**: both writers of the buildings
collection coalesce a missing English name to `""`, so a `??` fallback there is dead code that ships
blank English labels, and TypeScript cannot flag it because `name.en` is declared non-optional.
`zh` is omitted entirely when nobody authored one, which is the normal case for a building.

### 2.2 `displayNo` and `skkuId` are gone

Two fields left the wire when the schema was unified:

- **`displayNo` folded into `text`.** The two building layers are the same documents differing only
  in which field becomes the visible string, so `text` means "what this marker displays" and
  `markerStyle` decides how to draw it.
- **`skkuId` folded into `tap`.** `placeId` is a **string for every kind**, including a building
  whose id is numeric in Mongo. One addressing scheme is the whole point; the client narrows it back
  to a number inside its building branch, where `/building/:id` needs one.

## 3. Why `hours` is an array, and why there is no `status`

Openness is a pure function of the device clock and the windows:

```text
hours.length === 0 || hours.some(w => now >= w.startAt && now < w.endAt)
```

An **empty list means always open**, and it means only that.

### 3.1 An array, because a place is not a day

`hours` replaced a scalar `startAt`/`endAt` pair. With one window per document, a booth open on both
festival days had to be **two documents** — and the app's list, which renders one row per document,
showed every place twice with nothing on the card to tell the rows apart. In prod that was 28 `bar`
documents over 18 real bars.

Both bounds inside a window are required. Half-bounded is not expressible on purpose: you write two
windows, or none. Allowing one open end would give the field a second way to say "no limit", which is
exactly the ambiguity §3.2 describes.

### 3.2 No `status`

`status` was only ever a cache of the arithmetic above, and caching it forced the old
both-bounds-null to mean two opposite things depending on a sibling field: an always-on 화장실, and a
rain-cancelled truck. That ambiguity is what made the field load-bearing rather than redundant.

A **cancellation is expressed by not serving the marker at all** — a cancelled place is deleted from
the sheet, not flagged. That is what frees `[]` to mean one thing.

### 3.3 Hours do not decide what is drawn

The client does **not** hide a marker outside its windows. Opening hours are here to be filtered on
and displayed; the pin filtering they used to drive was how the old map coped with a crowded field,
which was a workaround for the day-split rather than a feature. Layers and chips do that job now, and
a genuine coordinate collision is resolved with `pinPriority` and `hours` — see §3.4.

Because the bounds are absolute instants rather than wall-clock strings, a device in the wrong
timezone still derives correctly. A device whose clock is genuinely wrong does not, and that is
accepted rather than corrected. The side benefit is the one that matters on the day: the map keeps
telling the truth on a dead network.

### 3.4 Two markers on one coordinate

The server drops, merges and clock-filters nothing; it ships every place of the live set with
everything the client needs to disambiguate. The client keeps one pin per coordinate, choosing by:

1. **open right now** — `hours.length === 0 || hours.some(w => now >= w.startAt && now < w.endAt)`
2. tie → highest `pinPriority`
3. tie → next opening soonest
4. tie → lowest `order`, then `id`

**Openness comes first, and the ordering is load-bearing rather than arbitrary.** A coordinate is
shared for exactly one reason on this map: a spot is used by different occupants at different times.
The west strip is booths from 11:00 and bars from 18:00, and `daybooth-01` shares
`126.971096, 37.295473` with two bars precisely because it is the same stall re-striped at dusk. Only
step 1 knows that. With `pinPriority` first, the operations desk would spend its entire 11:00–18:00
window hidden behind a bar that is shut, because `bar` outranks `booth` on a number that cannot see
the clock.

`pinPriority` still decides between two places that are open at once — a stage over a 화장실 — which
is the question it was always answering. Step 3 then covers the hours when nothing on that spot is
open: the pin becomes whichever occupant is next, so an overnight map still points at the right
stall. A suppressed marker keeps its list row.

Step 2 cannot separate two bars sharing a plot — both are `category: bar`, both priority 30 — and it
does not need to, because their windows are one night apart and step 1 has already answered.

> [!IMPORTANT]
> **The ladder can only resolve a collision the clock can see.** Two places open at the *same*
> moment on the *same* point fall through to `order`, and the loser is then never on the map at any
> time. That is a data error, not a rendering one, so it is caught at import instead: a test over the
> committed sheet rejects any two places whose windows overlap on one coordinate.
>
> It has fired for real. The 2025 부스전 sheet numbered two booths "2" and two booths "4", and both
> pairs were surveyed as a single interpolated point with identical hours — genuinely two stalls, so
> the fix was two coordinates, a quarter of the strip's own step (~1.3 m) apart.

## 4. Layer flags — `defaultVisible` and `userConfigurable`

Two independent axes on every layer entry in `GET /map/config`:

| Flag | Question it answers |
| --- | --- |
| `defaultVisible` | What the value **is** to begin with |
| `userConfigurable` | **Who may change it** |

It is the shape Firefox ships as `{Value, Status}` and GeoServer as `enabled`/`advertised`. The four
combinations are all meaningful:

| `defaultVisible` | `userConfigurable` | Meaning | Example |
| --- | --- | --- | --- |
| `true` | `false` | Always-on background layer | a base layer the product does not let you remove |
| `true` | `true` | Ordinary toggle | 건물번호, 건물이름, most festival layers |
| `false` | `true` | Opt-in | 편의시설 — looked up when wanted, not carried on screen all festival |
| `false` | `false` | Defined but inert — a kill switch | a layer shipped dark, switched on by a config change alone |

### 4.1 Four contract rules

1. **An absent `userConfigurable` means `true`. Never fail closed.** This follows GeoServer ("a
   layer is advertised by default") and Esri's `listMode` default of "show". An old client that has
   never heard of the field keeps every control it had, and a new client reading an old server's
   response does not silently lock the map. The server's own list is explicit on every entry anyway,
   so a new layer cannot forget to decide.
2. **It governs the affordance, not the capability.** A non-configurable layer still renders, is
   still deep-linkable, and is still returned by its marker endpoint. Only the control disappears.
   QGIS says it outright about `LayerFlag::Private`: flags are "used for the UI but are not
   preventing any API call." Nothing here is an authorization boundary.
3. **A chip may not change it either.** A chip tap is a user-initiated change, so `false` here puts
   the layer out of a chip's reach as well as out of the sheet's (§8.2). Inert today, since nothing
   is `false`.
4. **The client must shadow a stored toggle, not overwrite it.** A user's persisted visibility choice
   survives a layer becoming non-configurable and comes back when it becomes configurable again. The
   resolution is a fallback chain, not an assignment — `forced[id] ?? userToggle[id] ??
   defaultVisible`. Writing the forced value into storage would destroy a preference the user cannot
   re-express while the control is hidden.

## 5. Endpoints

One route per **data source**, not per layer: buildings come from the buildings collection, festival
booths from the event map's `places`. See §6 for why layers within a source share one.

### 5.1 `GET /map/config`

No `Cache-Control` of its own. The route returns plainly through the global `ResponseInterceptor`, so
it carries Express's auto-generated `ETag` plus `Vary: Accept-Language` from `LangMiddleware` and
nothing else.

It became `async` when the event marker layers joined the list — they are present only while an
activation window is open, which is a Mongo read. **That read is contained**: any failure inside
`map-config.data.ts` logs and returns `[]`, so the route keeps the never-fails property it had when
it was synchronous. Until the event layers existed this endpoint had no DB dependency at all, and
the app's fallback for a failed config is a bundled default holding no booth layers **but also no
building layers** — so letting a Mongo hiccup here propagate would trade a missing festival for a
blank campus map.

Response, abridged to one event layer of the six, `lang=ko`, with a window open:

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "naver": { "styleId": "<NAVER_MAP_STYLE_ID>" },
    "campuses": [
      {
        "id": "hssc",
        "label": "인사캠",
        "centerLat": 37.587241,
        "centerLng": 126.992858,
        "defaultZoom": 15.8,
        "defaultTilt": 0,
        "defaultBearing": 0,
        "radiusM": 1000
      },
      {
        "id": "nsc",
        "label": "자과캠",
        "centerLat": 37.29358,
        "centerLng": 126.974942,
        "defaultZoom": 15.8,
        "defaultTilt": 0,
        "defaultBearing": 0,
        "radiusM": 1000
      }
    ],
    "layers": [
      {
        "id": "building_numbers",
        "type": "marker",
        "markerStyle": "numberCircle",
        "label": "건물번호",
        "defaultVisible": true,
        "userConfigurable": true,
        "endpoint": "/map/markers/campus",
        "chipGroupId": null,
        "style": { "size": 16 }
      },
      {
        "id": "building_labels",
        "type": "marker",
        "markerStyle": "textLabel",
        "label": "건물이름",
        "defaultVisible": true,
        "userConfigurable": true,
        "endpoint": "/map/markers/campus",
        "chipGroupId": null,
        "style": { "captionTextSize": 7, "zIndex": 100000 }
      },
      {
        "id": "eskara26_stage",
        "type": "marker",
        "markerStyle": "placeDot",
        "label": "공연",
        "defaultVisible": true,
        "userConfigurable": true,
        "endpoint": "/map/markers/event",
        "chipGroupId": "eskara-2026",
        "style": { "color": "F76CA0", "width": 22, "height": 30, "captionTextSize": 9 }
      }
    ],
    "chips": [
      {
        "id": "eskara26_view_stage",
        "label": "공연",
        "icon": { "kind": "emoji", "emoji": "🎤" },
        "action": {
          "kind": "focus",
          "camera": {
            "lat": 37.295129,
            "lng": 126.971234,
            "zoom": 17.5,
            "tilt": 0,
            "bearing": 0,
            "durationMs": 500
          },
          "layerIds": ["eskara26_stage"]
        }
      }
    ],
    "cameraDefaults": {
      "markerFocus": { "zoom": 17.5, "tilt": 0, "bearing": 0, "durationMs": 500 },
      "campusFocus": { "durationMs": 500 }
    }
  }
}
```

`style.color` is **bare hex with no `#`**, the convention the app's `toCssColor` expects and the one
the commented-out bus polyline layers already use. `label` is resolved against `meta.lang` through
`src/infra/i18n.ts` — the labels are the one part of the map that is language-dependent, which is why
the envelope varies on `Accept-Language` while the marker data does not.

`campuses[].radiusM` is how far from the centre still counts as being on a campus; it belongs to the
campus reconciliation feature rather than to markers, and its derivation is in `map-config.data.ts`.

`layers[].style` carries the **marker geometry**, which the app hardcodes: `size` is `DOT_SIZE`,
`width`/`height` are `PIN_WIDTH`/`PIN_HEIGHT` (the tintable base icon's natural proportions, so a
client honouring them does not distort the tint), and `zIndex` is the label layer's `globalZIndex`.

> [!WARNING]
> **The geometry is served and not yet consumed** — see §9.7. `MapMarkerLayer.tsx` still uses its own
> constants, and `parseLayerStyle` does not read `height` or `zIndex` at all. Only `color` and
> `captionTextSize` reach a component today, so editing `size` here changes the wire and nothing on
> screen. Every member is optional, so a server sending none of them renders as before either way.

Colour is deliberately **not** moved for the building layers. Their fill and the placeDot tint fall
back to `SdsColors.brand`, a design token that resolves per theme; a hex from here cannot. Geometry
is theme-independent and belongs on the wire, colour that comes from a token does not. The festival
layers do send `color`, because a category colour is content rather than theme.

`chips` is the chip contract — see §8. `cameraDefaults` holds the camera settings for the moves the
app makes on its own rather than at a chip's request; `markerFocus` was `zoom: 17.5` and
`duration: 500` repeated at three call sites in the client, which meant a chip's camera and a
marker-tap camera were configured in two places that could disagree about how close "close" is.
`campusFocus` carries only a duration, because a campus's zoom, tilt and bearing already sit on its
`CampusEntry`.

### 5.2 `GET /map/markers/campus`

`Cache-Control: public, max-age=86400` — or **`no-store`** on the degraded branch.

Every building, in **both** building layers, in one response. No parameters: the old
`?overlay=number|label` is gone, and an old client still appending it gets the full response rather
than a 400, because nothing validates a parameter nothing reads.

A day is right for the normal path because the buildings collection changes when the university
renames or renumbers something, which is not a thing that happens during a user's session.

**The degraded fallback must not be cached, and the reason is a TTL mismatch that is easy to miss.**
When the buildings collection comes back empty the producer serves a small hardcoded set
(`FALLBACK_MARKERS`) so a cold or broken database still shows something recognisable rather than a
blank campus, and it flags the response `degraded`. Meanwhile `getAllBuildings` caches whatever the
query returned — `[]` included — for five minutes, while this route's normal TTL is a day. A brief
empty read during a re-seed or a migration would therefore pin the fallback map into every client and
edge cache for 24 hours, on a stable URL with no version stamp and no revalidation to bust it. The
event sibling self-heals from the same failure inside its 60-second TTL; this route needs the
explicit guard to match.

`degraded` is a **server-side signal and never reaches the wire** — the response body is `{ markers }`
either way.

Three filters apply independently, so a building lands on two layers, one, or none:

| Condition | Effect |
| --- | --- |
| coordinates not finite | dropped entirely — `building.sync` parses with `parseFloat` and writes `NaN` unguarded, and `NaN` serialises to `null` on a field this schema declares `number` |
| no `displayNo` | absent from `building_numbers`, still named on `building_labels` |
| no `name.ko` | absent from `building_labels` — a nameless marker is invisible but still occupies a tap target and a collision slot |

Response:

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "markers": [
      {
        "id": "2",
        "layerId": "building_numbers",
        "campus": "hssc",
        "lat": 37.587361,
        "lng": 126.994479,
        "text": { "ko": "1", "en": "1" },
        "startAt": null,
        "endAt": null,
        "tap": { "kind": "skku_building", "placeId": "2" }
      },
      {
        "id": "2",
        "layerId": "building_labels",
        "campus": "hssc",
        "lat": 37.587361,
        "lng": 126.994479,
        "text": { "ko": "수선관", "en": "Suseon Hall" },
        "startAt": null,
        "endAt": null,
        "tap": { "kind": "skku_building", "placeId": "2" }
      }
    ]
  }
}
```

The repeated `id` across the two entries is the documented case from §2, not a collision. Note also
that the fallback path emits `tap: null` on purpose: those markers exist precisely because the
buildings collection is empty, so there is no document for `/building/:id` to return and a tap could
only open a sheet that fails.

### 5.3 `GET /map/markers/event`

`Cache-Control: public, max-age=60`.

Every place of the currently active layer set. An empty list rather than an error when no festival is live — the app asks for this endpoint whenever
the layer is configured, and "no festival today" is an ordinary answer. When nothing is active it does
not touch Mongo at all. The same answer, with one warning per process, when an activation names a
layer set this build has no usable config for (§8.6): a category table the server cannot trust is not
one it draws from.

Named for the **mechanism**, not the festival. Whichever layer set is live is served here, and the
app never sees the URL except as `layers[].endpoint` in `/map/config` — so next year's festival
changes no route and no client.

Each marker's `layerId` is the place's `category` resolved through the layer set's `itemDefaults` by
`presentationFor` — **one table, one resolver** — which is what keeps a 주점 pin on the layer the
주점 chip shows.

A minute, because this URL is **stable rather than version-stamped** and so can never be immutable. A
minute is long enough for the edge to absorb a festival-day burst, and short enough that an ops
correction — a booth moved, a set cancelled — is live before anyone walks there. The **window
arithmetic does not need a short TTL**: opening and closing times ride in the payload, so a booth
changes state on the device's clock with no refetch.

**One document, one marker, one cursor.** There is no join and no lifecycle filter. This used to read
`places` and `sessions` and emit a marker per session — one occupancy interval each — so a booth open
on both festival days produced two markers with identical everything. The days are `hours` on a
single document now, so the join, the orphan counter and the whole notion of a plot separate from its
occupant are gone. Two booths genuinely sharing a coordinate are two documents with two taps, and the
client picks a pin between them (§3.4).

Response:

```json
{
  "meta": { "lang": "ko" },
  "data": {
    "markers": [
      {
        "id": "eskara-2026-d1-cse-booth",
        "layerId": "eskara26_booth",
        "campus": "nsc",
        "lat": 37.294452,
        "lng": 126.971747,
        "text": { "ko": "우끼끼친", "en": "Ukkikki", "zh": "乌key" },
        "startAt": "2026-09-16T07:00:00.000Z",
        "endAt": "2026-09-16T11:00:00.000Z",
        "tap": { "kind": "event", "placeId": "nsc-plaza-a3" }
      },
      {
        "id": "eskara-2026-toilet-a",
        "layerId": "eskara26_facility",
        "campus": "nsc",
        "lat": 37.294118,
        "lng": 126.972004,
        "text": { "ko": "화장실", "en": "Toilets" },
        "startAt": null,
        "endAt": null,
        "tap": { "kind": "event", "placeId": "nsc-plaza-b1" }
      }
    ]
  }
}
```

The second marker is the always-on case §3 exists to protect: both bounds null, drawn whenever the
layer is on, with no `status` beside it to make that ambiguous.

> [!NOTE]
> Both marker responses still carry `Vary: Accept-Language`, because `sendSuccess` puts `meta.lang`
> in the envelope. The marker **data** is language-independent — `text` carries every language we
> hold — so only the envelope varies. Stripping the header to win edge caching would be a lie about
> what the response depends on.

## 6. Why layers share endpoints

Both building layers point at `/map/markers/campus`. Every festival layer points at
`/map/markers/event`.

The app keys its marker cache on the **endpoint string** (`['map', 'layer', 'markers', endpoint]`),
so layers sharing one URL share a single fetch and a single cache entry, and each renders its own
subset:

```ts
markers.filter((m) => m.layerId === layer.id)
```

That is two toggles for one fetch where 건물번호 and 건물이름 used to cost two requests for the same
documents, and one small payload where six `?category=` endpoints would be six round trips. Turning a
second layer on over the same source is then free at the network layer, which is what makes the
filter grid feel instant on a festival network.

The trade is that a layer cannot be fetched in isolation. That is acceptable precisely because the
layers sharing an endpoint share a data source: filtering them apart server-side would send the same
documents twice.

## 7. The festival layer set

A festival's layers are **authored in its config** — `src/map/config/<layerSetId>.json`,
`layers[]` — and present in `GET /map/config` only while that layer set's activation window is open.
The window is the on/off lever (`npm run eventmap open|close`), so a festival starts and ends with no
deploy and the layers simply stop existing afterwards rather than lingering as dead toggles.

Each entry is `{ id, label: {ko, en?, zh?}, color, defaultVisible }` and nothing else: `color` is
content (a category colour is a fact about the event), and everything about how a festival pin is
*drawn* — `markerStyle: "placeDot"`, the pin geometry — is the map's business, applied to every
festival alike by `eventLayerSpecs` in `src/map/map-layers.data.ts`. Every festival layer is
`userConfigurable: true`; one that ships `defaultVisible: false` is the opt-in tier (편의시설), not a
locked background layer. Its `chipGroupId` is the **layer set id**, so two festivals could never share
a chip group.

Which category lands on which layer is `itemDefaults.byCategory[<category>].layerId` in the same
file, with `itemDefaults.fallback.layerId` for anything unmapped. That table is the **only** place
the mapping exists; the materializer and this route both resolve through it
([event-places.md](event-places.md)). A layer id that collides with a base layer, a
`layerId` that names no layer, or a set with nothing `defaultVisible` is a rejected config (§8.6).

The values as served for ESKARA 2026 are the file itself — read it rather than a copy here.

Next year's festival is therefore a new JSON file (registered in `CONFIG_FILES` and
`scripts/copy-build-assets.js`) plus Mongo content. No route, no TypeScript, no client branch: the
ids inside the file are the festival's to choose, and `eskara26_*` is a choice, not a requirement.

### 7.1 The fallback layer — the one that is not a bug

`SessionDoc.category` is an **open string on purpose**: "전시" next year must be a Mongo edit, not a
deploy. The layer table is a config file. Those two facts collide, and an unmapped category has no
entry to belong to.

It resolves to `itemDefaults.fallback.layerId` rather than vanishing, because **a booth missing from
the festival map is not a failure anyone can see or report**. A booth in the wrong bucket is visible
and fixable; a booth nobody drew is silent. The importer prints the distinct categories it is about
to write for exactly this comparison.

## 8. Chips

A layer answers *what is drawn*. A chip answers *where should I be looking, and what should be on
while I look there*. Chips ship inside `GET /map/config`, beside `layers`, and are entirely
server-decided: the app renders a pill and dispatches on `action.kind` without interpreting it.

They exist because the reorg in this document **orphaned the map's only server-driven chip row**. The
event map's chips used to filter snapshot *items*; once booths became ordinary marker layers there
were no snapshot items on the map screen left to filter, so `<EventMapChipRow />` was removed from
`CampusScreen` as a control that would visibly do nothing. What remained in that spot was
`CampusChipRow.tsx`, a hardcoded mock whose own header says the list "is what gets deleted" when an
endpoint lands. This is that endpoint.

> [!NOTE]
> `MapChip` is the **wire**. The **authored** form of a festival chip is `EventChipDef` in the layer
> set's config — `{ id, emoji, layerIds, label? }` — and `src/map/map-chips.data.ts` projects it into
> this shape, adding the camera and the synthesised reset chip (§8.5). This is the only chip
> vocabulary there is — the predicate chips the deleted snapshot used to ship went with the pins they
> filtered.

### 8.1 The schema

```ts
interface CameraMotion { zoom: number; tilt: number; bearing: number; durationMs: number }
interface MapCamera extends CameraMotion { lat: number; lng: number }

type MapChipAction =
  | { kind: "webview"; url: string }
  | { kind: "focus"; camera: MapCamera; layerIds: string[] };

interface MapChip {
  id: string;
  label: string;                                  // pick(label, lang), resolved server-side
  icon: { kind: "emoji"; emoji: string } | null;
  action: MapChipAction;
}
```

Discriminated on `kind`, matching `MarkerTap` in this same domain rather than the flat
`actionType` + `actionValue: string` pair the home screen's SDUI uses. That pair cannot carry a
camera, and encoding one as JSON inside a string would put a second parser on the wire.

`webview` reuses the name **and the validator** of the SDUI action type it corresponds to
(`src/infra/webview-url.ts`), so there is one rule for what counts as a usable web view URL rather
than two. Authored values are root-relative and are resolved against `WEBVIEW_ORIGIN` before they
ship, so a client never receives a relative string to hand to an opener. There is deliberately **no
`title`**: the client already holds the chip's `label`, and a page a chip opened is titled by that
chip. No chip uses this variant today (§8.5) — it is documented as part of the schema, and its rules
are enforced whenever one returns.

### 8.2 What a chip tap may change — two rules

1. **Only layers sharing the `chipGroupId` of the layers it names.** The chip's `layerIds` resolve to
   one group; every layer in that group is set (named → on, unnamed sibling → off); every layer
   outside it is untouched. An **empty** `layerIds` resolves no group, so the chip moves the camera
   and changes nothing — that is the camera-only chip, and it is why the field is not nullable.
2. **Never a `userConfigurable: false` layer** — §4.1 rule 3. A chip tap is a user-initiated change,
   and that flag already answers who may make one. Inert today, since nothing is `false`; stated so
   it holds when that quadrant gets its first occupant.

Together these are what let a festival chip swap the six festival layers while 건물번호 and 건물이름
stay visible **and** stay user-toggleable. Neither "exclusive over everything" nor "purely additive"
does that: the first turns the baseline off, the second cannot give a clean single-purpose view.

### 8.3 Why `chipGroupId` is declared, never inferred

The tempting shortcut is to read the group off `endpoint` — layers sharing a data source already
share a URL, so today the two agree exactly. It is the wrong key. `endpoint` is a **cache** key: the
app keys its marker query on that string so two building layers cost one fetch (§6). Merging or
splitting a route for network reasons would then silently redraw the chip boundaries, and the
symptom — "tapping 무대 hid 건물번호" — would have no line of code to blame.

Declaring it follows what the GIS tools settled on. Leaflet's grouped layer control takes an explicit
`exclusiveGroups` option naming which groups behave like radio buttons; ArcGIS service metadata
carries an `EXCLUSIVE=TRUE` flag on a group description. In both, group membership and exclusivity
are properties of the layer, kept separate from where the layer's data comes from.

| Layer | `chipGroupId` |
| --- | --- |
| `building_numbers`, `building_labels` | `null` — no chip may ever change them |
| every festival layer | the layer set id, e.g. `"eskara-2026"` |

`null` is a meaningful value here, not an omission.

### 8.4 Why chips ride inside `/map/config`

A chip's `layerIds` reference layer ids. Serving both in one document means the reference **cannot
disagree with the layer list on the wire** — there is no window in which the app holds a fresh chip
list and a stale layer list. The same reasoning drives the single activation read: layers and chips
ask "is a festival live" once between them, so the window cannot close midway and leave chips
pointing at layers that are no longer in the response.

It also costs nothing. The app already fetches this document.

### 8.5 The chips served

While a layer set is live, the row is: **the reset chip, then every chip authored in the layer set's
config**, in file order — followed by nothing else, because `BASE_CHIPS` is empty. 분실물 lived there
and was removed, and that action is still reachable from the campus SDUI (`src/ui/ui/ui.campus.ts`).
So outside an activation window `chips` is `[]`, and a client must render nothing rather than an
empty row. It stays a list because a permanent chip is an ordinary thing to want back.

**The reset chip is synthesised, not authored.** Its id is `<layerSetId>_all` (`eskara-2026_all`), its
label is the festival's `name`, its icon the festival's `emoji`, and its `layerIds` are exactly the
layers marked `defaultVisible` — the festival's **default** set, not literally every layer. That
distinction is load-bearing: a layer that ships `defaultVisible: false` (편의시설) must stay out of it,
or the way back would turn on something the user never opted into and leave no chip that returns to
the ordinary festival view. Deriving the list from the layer definitions is what makes drift
impossible; a hand-written copy of the same ids is the parallel structure that quietly stops turning
one category back on. The id form is a wire rule the app may key on (it logs `map_chip` taps by
chip id), which is why it is written down here and in `resetChip()` rather than left to a template
string.

An authored chip is `{ id, emoji, layerIds, label? }`. It names one or more of the layer set's own
layers and shares the config's `camera`. `label` may be omitted for a single-layer chip, in which
case the chip reads as its layer does; a chip spanning several layers has no such default and must
say what it means. ESKARA 2026 authors every label, because its pills read singular (`Bar`) where its
layer toggles read plural (`Bars`) — copy that a deploy must not quietly change.

Festival chips are gated by the **same activation window** as the festival layers, so a festival
starts and ends with no deploy and its chips stop existing rather than lingering as dead buttons.

### 8.6 Validation is fail-loud where a PR fixes it, fail-soft where the base map can keep serving

One validator, `validateChipSpecs(specs, catalogue)`, checks a chip row against the catalogue it will
be served beside and **returns** every problem it finds, accumulated. Two callers, two consequences:

| Row | When | On failure |
| --- | --- | --- |
| `BASE_CHIPS` against `BASE_LAYERS` | module import, `src/map/map-chips.data.ts` | throws `FATAL [map chips]` — repo TypeScript, a PR fixes it, the boot must not proceed |
| the festival row (reset chip + authored chips) against **the full served catalogue** (base + festival layers) | config load, `assertValidConfig` in `src/map/map-layerset.config.ts` | the layer set is **rejected**: logged once with the path, and `/map/config` serves the base layers only — the festival is off the campus map until the file is fixed |

The second row is a deliberate posture with a cost worth naming: a config typo takes the whole
festival off the map rather than degrading part of it. That is preferred to drawing from a category
table the server could not validate, and 건물번호 keeps serving throughout.

The rules:

| Rule | Where |
| --- | --- |
| a festival layer id does not reuse a base layer id | `assertValidConfig` |
| every `itemDefaults.*.layerId` and every chip `layerIds[]` entry names a layer of the set | `assertValidConfig` (`layerId`), `validateChipSpecs` (chips) |
| every named layer has a non-null `chipGroupId` | `validateChipSpecs` |
| a chip's `layerIds` do not straddle two groups | `validateChipSpecs` |
| chip ids are unique — including against the synthesised reset chip's | `validateChipSpecs`, the only place that collision is visible at all |
| a `webview` URL passes `toWebviewUrl` | `validateChipSpecs` |
| at least one layer is `defaultVisible`, so the reset chip restores something | `assertValidConfig` |
| a multi-layer chip carries a label; `layerIds` is non-empty; `color` is bare six-digit hex | `assertValidConfig` |

There is no translation-miss case any more. Labels are inline `{ko, en?, zh?}` on the layer and the
chip, resolved with the one `pick()` in `src/infra/i18n.ts`, so a label with no `ko` is a rejected
config and a base layer with no label does not compile.

`src/map/map-layers.data.ts` and `src/map/map-chips.data.ts` are **leaf modules** of this seam:
`eventmap.config.ts` imports them to validate at load, so they may never import it — or anything that
does — back. `eslint.config.js` refuses such an import for those two files; the rule is executable,
not prose.

### 8.7 Reserved: the "nearby" chip

The third chip kind — markers within N metres of a position — is written down and **not** built, so
that adding it stays additive:

```ts
| { kind: "nearby"; origin: "device" | "camera"; radiusM: number;
    endpoint: string; layerIds: string[] }
```

`origin` is on the wire rather than fixed in the client because one chip can reasonably mean "near
me" and another "near what I am looking at", and only the server knows which. See §9.6 for the client
constraint it will run into.

## 9. Known gaps

Stated plainly, because each one is a real constraint on the next deploy rather than a nicety.

### 9.1 Deploy order — the app half is prerequisite, not follow-up

This server change is **not compatible with the shipped app**, and no deploy order makes it so.
Chosen knowingly: the wire that named a festival had to go, and the two halves land inside one
release. What an app built before its half sees against this server:

| Surface | Shipped app + this server |
| --- | --- |
| Festival pins | drawn — the app reads `layers[].endpoint` from `/map/config`, so `/map/markers/event` is found. It reads absent `startAt`/`endAt` as `null`, which its own rule calls "always visible", so every pin draws unconditionally — which is the new intent anyway |
| Chips | work — server-driven, dispatched on `action.kind` |
| Tapping a pin | **inert** — `tap.kind: "event"` is not in the app's `TAP_KINDS` allowlist, and an unknown kind leaves the marker drawn but untappable |
| List / peek sheet | **gone** — `/eventmap/manifest` 404s, the app catches it and reports "inactive" |
| `skkuverse://map?place=event:…` | dropped — `PLACE_KINDS` does not carry `event` |

Every intermediate state degrades correctly rather than blanking the campus map, which is what let
the server land in five commits without the app blocking any of them. The app-side change is:
`TAP_KINDS` / `PLACE_KINDS` / the `CampusScreen` switch learn `event`; the whole snapshot client is
deleted; the list, card and peek sheet render from markers; and one pure function resolves a
coordinate collision (§3.4). Until it ships, the festival map is a picture with no taps.

### 9.2 The `<kind>:<placeId>` deep link

The link is literally the two fields of `tap`, so it can never disagree with the marker it came from:

```text
skkuverse://map?place=event:nsc-truck-05
skkuverse://map?place=skku_building:2
```

The app's `PLACE_ID_RE` (`apps/mobile/app/+native-intent.tsx` in skkuverse-app) accepts both this and
the bare `?place=<placeId>` form already; what it lacks is `event` in its `PLACE_KINDS` allowlist,
which is part of the app half above. An earlier revision of this section said the colon was rejected
— it is not, and has not been for some time.

**Umbrella ADR 0004 invariant 1 still specifies the bare form and needs amending** to match. The same
amendment retires invariant 2's "unrecognised predicate node evaluates `false`" — there is no
predicate on the wire — in favour of the marker-level rule: a marker whose `layerId` the app cannot
resolve is dropped and counted.

### 9.3 `userConfigurable` is served but nothing consumes it

Every layer entry carries the flag; no client reads it yet. `MapLayerDef` in
`packages/shared/src/types/map.ts` has no such member, so it is parsed away. The contract in §4 is
therefore a **promise about the wire**, not a description of shipped behaviour, and rule 1 (absent
means `true`) is what makes that safe in the meantime: today's clients behave exactly as if every
layer were configurable, which is what every layer currently is.

### 9.4 Next year's festival is a config file

Nothing that is not data names the festival any more: the route is `/map/markers/event`, the tap
kind is `event`, the chip group is the layer set id, and the layers, chips, labels, colours, camera,
name and emoji are all in `src/map/config/<layerSetId>.json`. `eskara27` is a new file, a
`CONFIG_FILES` entry, a `copy-build-assets.js` line, and Mongo content. That is ADR 0004 invariant 1
— "next year's event arrives as data" — honoured, after an earlier revision of this section chose to
violate it for unambiguity.

What stays festival-named is chosen, not required: the **layer and chip ids inside the file**
(`eskara26_bar`, `eskara26_view_bar`). A generic `event_bar` would let a user's 주점 toggle survive
into next year's festival; a festival-named one does not, and does not need to — it is a different
festival — while a log line, a deep link or a bug report can still say which one. The base-map layer
store in the app is ephemeral (`packages/shared/src/store/map.ts`, no `persist`), so neither choice
accumulates dead keys.

### 9.5 A chip camera cannot be honoured in one call

The client's map SDK splits the camera across two mechanisms.
`NaverMapViewRef.animateCameraTo` takes `{latitude, longitude, zoom, duration, easing, pivot}` and
**not** `tilt` or `bearing`; the declarative `camera` prop carries `tilt` and `bearing` and has **no
duration**. So a chip whose `tilt` and `bearing` are both `0` goes through `animateCameraTo` and gets
its `durationMs`, and any other chip goes through the prop and animates at the SDK's own pace.

Every chip served today is `tilt: 0, bearing: 0`, so nothing is currently lost. The server sends the
whole `CameraMotion` regardless: this is a client mechanism limit, and trimming the payload to match
it would bake the limitation into the wire.

### 9.6 A nearby chip will thrash the client's marker cache

`useLayerMarkers` keys its query on the **endpoint string** (`['map','layer','markers',endpoint]`) —
that is precisely why this reorg stripped `?overlay=` (§6). A nearby URL carrying
`?lat=&lng=&radiusM=` would mint a fresh cache entry per camera position.

So §8.7's chip kind needs its own client hook with a quantised key, not `useLayerMarkers`. Recorded
now because the constraint belongs to the design, not to the day it is discovered.

### 9.7 Chips, camera defaults and marker geometry are served but not consumed

The same shape as §9.3, and worth listing separately because §8 says "this is that endpoint" and a
reader could stop there. As of this deploy the client reads **none** of it:

| Served | Client state |
| --- | --- |
| `chips` | `parseMapConfig` builds `{naver, campuses, layers}` only; `MapConfig` has no `chips` member. `CampusChipRow.tsx` still renders its hardcoded `CAMPUS_CHIPS` mock |
| `cameraDefaults` | not parsed; `CampusScreen` still uses literal `zoom: 17.5` / `duration: 500` at three call sites |
| `layers[].chipGroupId` | not parsed |
| `style.height`, `style.zIndex` | not parsed at all by `parseLayerStyle` |
| `style.size`, `style.width` | parsed, then ignored — `MapMarkerLayer.tsx` uses `DOT_SIZE`, `PIN_WIDTH`, `PIN_HEIGHT` and `globalZIndex={100000}` regardless |
| `campuses[].defaultTilt` / `defaultBearing` | parsed, then dropped by `focusCampus` |

Only `style.color` and `style.captionTextSize` are honoured today.

That is safe rather than broken — **this is why server-first is the right order here**, unlike §9.1.
Every field is additive and the client's parsers ignore unknown keys, so nothing regresses while the
client catches up. But it does mean the wire is a **promise** until it does: changing `size` here
today changes the response and nothing on screen, with no error on either side.

## 10. Source of truth (file map)

| Concern | File |
| --- | --- |
| Wire schema, both producers | `src/map/map-marker.types.ts` |
| Base layer catalogue, festival layer projection, `chipGroupId`, marker geometry | `src/map/map-layers.data.ts` |
| Base chips, festival chip projection, the reset chip, the one chip validator | `src/map/map-chips.data.ts` |
| Chip wire schema | `src/map/map-chip.types.ts` |
| Response builder, campuses, activation lookup | `src/map/map-config.data.ts` |
| Buildings → markers, empty-DB fallback | `src/map/map-markers.data.ts` |
| Event places → markers | `src/map/map-event-markers.data.ts` |
| "Which layer set is live, and is its config usable" | `src/map/map-active-layerset.ts` |
| Festival layers, chips, labels, colours, camera, category → layer table | `src/map/config/<layerSetId>.json` |
| Category → presentation resolver (both producers) | `presentationFor` in `src/map/map-layerset.types.ts` |
| HTTP + `Cache-Control` | `src/map/controllers/map-config.controller.ts`, `src/map/controllers/map-markers.controller.ts` |
| Module wiring, rate limit, endpoint inventory | `src/map/map.module.ts` |
| Campus labels | `src/infra/i18n.ts` (`map.campus.*`) — layer and chip labels are inline `{ko, en?, zh?}` on their specs, resolved with `pick()` from the same module |
| Building documents | `src/building/building.data.ts` |
| Event documents + activation window | `src/map/map-places.data.ts`, `src/map/map-places.types.ts` |
| Sheet → documents, and the importer | `scripts/lib/map-places-file.js`, `scripts/import-eventmap-places.js` |
| Tests | `__tests__/nest/map/` |

## 11. Related

- [event-places.md](event-places.md) — the festival's storage, authoring and ops tiers
- [ADR 0004 — event map layer ownership](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md)
- [skkuverse-app `docs/eventmap-rendering.md`](https://github.com/spencer0124/skkuverse-app/blob/main/docs/eventmap-rendering.md) — the client side
- [docs/README.md](../README.md) — writing rules
