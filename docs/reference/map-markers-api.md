---
title: Map Markers API Reference
type: reference
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-08-28
audience: internal
---

# Map Markers API

> The one marker schema every layer of the campus map draws, the two layer flags that say what is
> visible and who may change it, and the three endpoints that carry them. Cross-repo ownership is
> [umbrella ADR 0004](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md);
> the festival's authoring, materialization and snapshot tiers are [eventmap-api.md](eventmap-api.md).

## 1. Summary

| | |
| --- | --- |
| Routes | `GET /map/config`, `GET /map/markers/campus`, `GET /map/markers/eskara26` |
| Auth | none on all three |
| Rate limit | `BusRateLimitMiddleware`, applied to the `/map` prefixes in `MapModule.configure` |
| Wire schema | `src/map/map-marker.types.ts` — the SSOT both producers import |
| Producers | `src/map/map-markers.data.ts` (buildings), `src/map/map-eskara26-markers.data.ts` (festival sessions) |
| Layer list | `src/map/map-config.data.ts` |
| Envelope | `{ meta: { lang }, data: { markers: [ … ] } }`, `Vary: Accept-Language`, `X-Response-Time` |
| Tests | `__tests__/nest/map/` |

A building and a booth are **the same kind of thing, addressed the same way** (umbrella ADR 0004
invariant 1). Before this contract they were not: the festival shipped its own manifest, snapshot,
cache and marker component beside the base map's, which is a second rendering system for the same
picture. Both producers now import the types in `map-marker.types.ts`, so a field can no longer be
added to one and forgotten in the other.

> [!NOTE]
> The event map's own tiers — `places`, `sessions`, `activations`, the CSV and JSON importers,
> `npm run eventmap` — are untouched and still documented in [eventmap-api.md](eventmap-api.md).
> What changed is only how a booth reaches the **map**: as a layer in `/map/config` with an
> endpoint, rather than as a snapshot the app renders separately.

## 2. The marker schema

Every marker on every layer, from either producer, is exactly this object. Nothing is optional
except `text.zh`.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Unique **within its layer** — a building id, or a session id. NOT unique across layers: one building is drawn once per building layer and both markers carry the same value, so the client's key has to be layer id plus this |
| `layerId` | `string` | Which layer draws this marker. The server decides membership; the client filters on it. Always one of the ids `GET /map/config` advertises |
| `campus` | `"hssc" \| "nsc"` | The `Campus` literal from `src/building/types.ts`. For a booth this is the **plot's** campus, never the session's denormalized copy, so a marker's campus and its position cannot disagree |
| `lat` | `number` | Latitude. Un-swapped from Mongo's GeoJSON `[lng, lat]` by the server, which is the only converter (ADR 0004 invariant 3) |
| `lng` | `number` | Longitude |
| `text` | `{ ko: string; en: string; zh?: string }` | The string this marker **displays** — a building number, a building name, a booth title. The layer's `markerStyle` decides how it is drawn |
| `startAt` | `string \| null` | ISO instant, or `null` for unbounded on that side |
| `endAt` | `string \| null` | ISO instant, or `null` for unbounded on that side |
| `tap` | `MarkerTap \| null` | What a tap resolves to, or `null` for a marker that is not interactive |

```ts
type MarkerTap =
  | { kind: "skku_building"; placeId: string }
  | { kind: "eskara26"; placeId: string };
```

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

## 3. Why there is no `status`

Visibility is a pure function of the device clock and the two bounds:

```text
(startAt == null || now >= startAt) && (endAt == null || now < endAt)
```

Both `null` therefore means **always visible**, and it means only that.

`status` was only ever a cache of that arithmetic, and caching it forced both-bounds-null to mean two
opposite things depending on a sibling field: an always-on 화장실, and a rain-cancelled truck. That
ambiguity is what made the field load-bearing rather than redundant.

A **cancellation is now expressed by not serving the marker at all**. That is what frees null/null to
mean one thing, and it turns "a closed booth draws no pin" into the definition rather than a rule
somebody has to remember. `/map/markers/eskara26` therefore queries `lifecycle: "published"` alone:
`draft` and `hidden` were never materialized either, and `cancelled` is absent.

> [!IMPORTANT]
> This is a deliberate divergence from the materializer, and it costs something. `SessionDoc`'s own
> comment says a cancelled booth must be **visibly** cancelled — "people walk there otherwise" — and
> the snapshot tier still ships one, closed and badged. On the **map** surface a cancelled booth is
> now silently absent instead. The trade was made knowingly: with no status field to disambiguate
> it, a served marker means "this is real", which is the property the whole schema rests on. Ops
> wanting a visibly-cancelled pin has to say so through the snapshot's card, not the map pin.

Because the bounds are absolute instants rather than wall-clock strings, a device in the wrong
timezone still derives correctly. A device whose clock is genuinely wrong does not, and that is
accepted rather than corrected — the same position [eventmap-api.md §9](eventmap-api.md) takes.
The side benefit is the one that matters on the day: the map keeps telling the truth on a dead
network.

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

### 4.1 Three contract rules

1. **An absent `userConfigurable` means `true`. Never fail closed.** This follows GeoServer ("a
   layer is advertised by default") and Esri's `listMode` default of "show". An old client that has
   never heard of the field keeps every control it had, and a new client reading an old server's
   response does not silently lock the map. The server's own list is explicit on every entry anyway,
   so a new layer cannot forget to decide.
2. **It governs the affordance, not the capability.** A non-configurable layer still renders, is
   still deep-linkable, and is still returned by its marker endpoint. Only the control disappears.
   QGIS says it outright about `LayerFlag::Private`: flags are "used for the UI but are not
   preventing any API call." Nothing here is an authorization boundary.
3. **The client must shadow a stored toggle, not overwrite it.** A user's persisted visibility choice
   survives a layer becoming non-configurable and comes back when it becomes configurable again. The
   resolution is a fallback chain, not an assignment — the same shape the event map's
   `basemapOverride` already uses (`override[id] ?? userToggle[id] ?? defaultVisible`). Writing the
   forced value into storage would destroy a preference the user cannot re-express while the control
   is hidden.

## 5. Endpoints

One route per **data source**, not per layer: buildings come from the buildings collection, festival
booths from the event map's `places` and `sessions`. See §6 for why layers within a source share one.

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
        "radiusM": 1000
      },
      {
        "id": "nsc",
        "label": "자과캠",
        "centerLat": 37.29358,
        "centerLng": 126.974942,
        "defaultZoom": 15.8,
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
        "endpoint": "/map/markers/campus"
      },
      {
        "id": "building_labels",
        "type": "marker",
        "markerStyle": "textLabel",
        "label": "건물이름",
        "defaultVisible": true,
        "userConfigurable": true,
        "endpoint": "/map/markers/campus"
      },
      {
        "id": "eskara26_stage",
        "type": "marker",
        "markerStyle": "placeDot",
        "label": "공연",
        "defaultVisible": true,
        "userConfigurable": true,
        "endpoint": "/map/markers/eskara26",
        "style": { "color": "F76CA0" }
      }
    ]
  }
}
```

`style.color` is **bare hex with no `#`**, the convention the app's `toCssColor` expects and the one
the commented-out bus polyline layers already use. `label` is resolved against `meta.lang` through
`src/infra/i18n.ts` — the labels are the one part of the map that is language-dependent, which is why
the envelope varies on `Accept-Language` while the marker data does not.

`campuses[].radiusM` is how far from the centre still counts as being on a campus; it belongs to the
campus reconciliation feature rather than to markers, and its derivation is in `map-config.data.ts`.

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
eskara26 sibling self-heals from the same failure inside its 60-second TTL; this route needs the
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

### 5.3 `GET /map/markers/eskara26`

`Cache-Control: public, max-age=60`.

Every **published** session of the currently active layer set, projected onto its plot's coordinates.
An empty list rather than an error when no festival is live — the app asks for this endpoint whenever
the layer is configured, and "no festival today" is an ordinary answer. When nothing is active it does
not touch Mongo at all.

A minute rather than the snapshot tier's `immutable`: this URL is **stable rather than
version-stamped**, so it can never be immutable. A minute is long enough for the edge to absorb a
festival-day burst, and short enough that an ops correction — a booth moved, a set cancelled — is live
before anyone walks there. The **window arithmetic does not need a short TTL**: opening and closing
times ride in the payload, so a booth changes state on the device's clock with no refetch.

One marker per **session**, not per plot. Two occupants of one plot — a daytime booth and a night
stall — are two markers whose windows do not overlap, so the density problem the snapshot answered
with `stackKey` collapsing is answered here by the clock. Where windows genuinely do overlap the
markers sit on the same coordinate, and both carry the same `tap`, so either opens the plot.

A session pointing at a missing or retired plot is **skipped and counted**, not thrown: one dangling
`placeId` is a typo in the session sheet, and dropping the festival over it would be worse. The count
is logged.

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
        "tap": { "kind": "eskara26", "placeId": "nsc-plaza-a3" }
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
        "tap": { "kind": "eskara26", "placeId": "nsc-plaza-b1" }
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

Both building layers point at `/map/markers/campus`. All six event layers point at
`/map/markers/eskara26`.

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

## 7. The eskara26 layer set

Six layers, present in `GET /map/config` only while an activation window is open. The window is the
on/off lever (`npm run eventmap open|close`), so a festival starts and ends with no deploy and the
layers simply stop existing afterwards rather than lingering as dead toggles.

The list below is the shape, not the SSOT: `ESKARA26_LAYERS` in
`src/map/map-eskara26-markers.data.ts` holds the ids, colours and default visibility, and each label
is that id resolved through `src/infra/i18n.ts` (`map.layer.<id>`). Values are as served at the time
of writing:

| Layer id | `ko` label | Colour | `defaultVisible` | Fed by `category` |
| --- | --- | --- | --- | --- |
| `eskara26_stage` | 공연 | `F76CA0` | `true` | `stage` |
| `eskara26_bar` | 주점 | `F04452` | `true` | `bar` |
| `eskara26_food` | 먹거리 | `FFB800` | `true` | `food` |
| `eskara26_booth` | 부스 | `3182F6` | `true` | `booth` |
| `eskara26_facility` | 편의시설 | `4CC9F0` | `false` | `facility` |
| `eskara26_etc` | 기타 | `8B95A1` | `true` | everything else |

Every one is `userConfigurable: true`, 편의시설 included — that one merely starts hidden. Nothing in
the festival set is a locked background layer.

They are declared as **one list** rather than an id array beside a colour map beside a hidden set:
parallel structures keyed by the same strings drift, and the drift shows up as a layer with no colour
rather than as a compile error. The layer id union is read off that list, so a category mapped to a
layer that does not exist is a compile error instead of a booth belonging to nothing.

### 7.1 `eskara26_etc` — the fallback that is not a bug

`SessionDoc.category` is an **open string on purpose**: "전시" next year must be a Mongo edit, not a
deploy. The `/map/config` layer list is a TypeScript literal. Those two facts collide, and an unmapped
category has no layer to belong to.

It resolves to `eskara26_etc` rather than vanishing, because **a booth missing from the festival map
is not a failure anyone can see or report**. A booth in the wrong bucket is visible and fixable; a
booth nobody drew is silent.

## 8. Known gaps

Stated plainly, because each one is a real constraint on the next deploy rather than a nicety.

### 8.1 Deploy order is load-bearing — ship the app first

The app has **no `layerId` filter, no `tap` handling, and no `placeDot` marker style**. Its
`RawMarkerData` still reads `skkuId` and `displayNo`, and its `markerStyle` union is
`numberCircle | numberDot | textLabel` (`packages/shared/src/types/map.ts` and
`packages/shared/src/map/parser.ts` in skkuverse-app).

Deploying this server before that app ships means every building is drawn **twice** — once per layer,
with no filter to separate them — with a **blank label**, because the app looks for `displayNo` and a
bare-string `text`, and **untappable**, because it looks for `skkuId`. The festival layers fare no
better: an unknown `markerStyle` falls through to the default branch, and the event markers have no
tap path at all.

Nothing in the payload lets the server detect an old client. Order is the whole mechanism:

```text
app release (or OTA) → verify → deploy server
```

### 8.2 The `<kind>:<placeId>` deep link is agreed but not reachable

The agreed format makes the link literally the two fields of `tap`, so it can never disagree with the
marker it came from:

```text
skkuverse://map?place=eskara26:nsc-truck-05
skkuverse://map?place=skku_building:2
```

It does **not work today**. The app's `PLACE_ID_RE` is `/^[a-z0-9-]+$/`
(`apps/mobile/app/+native-intent.tsx` in skkuverse-app), which rejects the colon, so such a link fails
the shape test and is dropped silently. Widening the pattern is app-side work in the next pass.

**Umbrella ADR 0004 invariant 1 still specifies the bare `?place=<placeId>` form and needs amending**
to match — as does [eventmap-api.md §8.1](eventmap-api.md), which documents the bare form as the
universal scheme.

### 8.3 `userConfigurable` is served but nothing consumes it

Every layer entry carries the flag; no client reads it yet. `MapLayerDef` in
`packages/shared/src/types/map.ts` has no such member, so it is parsed away. The contract in §4 is
therefore a **promise about the wire**, not a description of shipped behaviour, and rule 1 (absent
means `true`) is what makes that safe in the meantime: today's clients behave exactly as if every
layer were configurable, which is what every layer currently is.

### 8.4 Next year's festival costs a route, a config entry and a client branch

`eskara26` appears in three places that are not data: the layer ids, the route path
(`/map/markers/eskara26`), and the `tap.kind` literal. `eskara27` therefore needs a new route, a new
layer set in the config, and a client branch that knows the new tap kind.

That was chosen deliberately, against ADR 0004 invariant 1 — "It must never learn the name of a
consumer" — and its consequence that "next year's event arrives as data". The price is worth naming:

- A user who turned 주점 off does not carry that choice into next year's festival, because
  `eskara27_*` are different ids. Arguably correct anyway — it is a different festival.
- Generic `event_*` ids would preserve it, at the price of a name that says nothing about which
  festival is live.

> [!NOTE]
> An earlier revision of this section claimed the ids would also accumulate **dead keys**, because
> "the app persists base-map layer visibility permanently". That is wrong, and worth recording so
> the argument is not rebuilt on it: `packages/shared/src/store/map.ts` is explicitly *"ephemeral
> (not persisted)"* and has no `persist` middleware, so nothing accumulates. The **event** store
> (`store/eventmap.ts`) is the persisted one, and it already resets when `activeLayerSetId` changes.
> If the base-map store ever gains persistence, this cost becomes real — and the shadow rule in §4.1
> has to land in the same change.

Unambiguity won. A generic id in a log line, a deep link or a bug report cannot tell you which
festival it belonged to, and the festival map is a thing that is debugged in a crowd at 22:00.

## 9. Source of truth (file map)

| Concern | File |
| --- | --- |
| Wire schema, both producers | `src/map/map-marker.types.ts` |
| Layer list, campuses, event layer lookup | `src/map/map-config.data.ts` |
| Buildings → markers, empty-DB fallback | `src/map/map-markers.data.ts` |
| Event sessions → markers, layer set, category mapping | `src/map/map-eskara26-markers.data.ts` |
| HTTP + `Cache-Control` | `src/map/controllers/map-config.controller.ts`, `src/map/controllers/map-markers.controller.ts` |
| Module wiring, rate limit, endpoint inventory | `src/map/map.module.ts` |
| Layer and campus labels | `src/infra/i18n.ts` (`map.layer.*`, `map.campus.*`) |
| Building documents | `src/building/building.data.ts` |
| Event documents + activation window | `src/eventmap/eventmap.data.ts`, `src/eventmap/types.ts` |
| Tests | `__tests__/nest/map/` |

## 10. Related

- [eventmap-api.md](eventmap-api.md) — the festival's storage, materialization, snapshot and ops tiers
- [ADR 0004 — event map layer ownership](https://github.com/spencer0124/skkuverse/blob/main/docs/decisions/0004-event-map-layer-ownership.md)
- [skkuverse-app `docs/eventmap-rendering.md`](https://github.com/spencer0124/skkuverse-app/blob/main/docs/eventmap-rendering.md) — the client side
- [docs/README.md](../README.md) — writing rules
