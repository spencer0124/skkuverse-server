# Flutter Building Migration — Server-Side Perspective

> **Date**: 2026-03-15
> **Scope**: What the Flutter app needs to change based on server API changes.
> **Related docs**: `flutter-building-api-guide.md` (API reference), `flutter-map-overlay-guide.md` (overlay migration details)

---

## Summary of Server Changes

1. **Building data now lives in MongoDB** — synced weekly from SKKU's campusMap API (78 buildings, ~7,500 spaces)
2. **3 new endpoints**: `/building/list`, `/building/search?q=`, `/building/:skkuId`
3. **Map overlay change**: `/map/config` → `campus_buildings` layer now points to `/map/markers/campus` (was `/map/overlays?category=hssc`)
4. **Overlay endpoint removed**: `GET /map/overlays?category=hssc` returns 404

---

## Breaking Changes (must fix)

### 1. Map layer pipeline — response shape changed

`/map/config` still drives the layer system, but the `campus_buildings` layer endpoint changed from `/map/overlays?category=hssc` to `/map/markers/campus`. The response shape is completely different:

```
Old: { category, overlays: [{ type, id, position: { lat, lng }, marker: { label, subLabel } }] }
New: { markers: [{ skkuId, buildNo, displayNo, type, name: { ko, en }, campus, lat, lng, image }] }
```

**Flutter action**: Update the layer data loader to parse the new shape. When the layer endpoint is `/map/markers/campus`, parse `markers[]` instead of `overlays[]`.

### 2. Building marker name is now bilingual

Old: `marker.label` was a pre-resolved string (e.g., "법학관")
New: `name` is `{ ko: "법학관", en: "Law School" }` — select by current locale.

### 3. Building identifier changed

Old overlay: `id` was a string like `"bldg_hssc_law"`
New markers: `skkuId` is an integer (e.g., `2`). Use this for `GET /building/{skkuId}` detail calls.

### 4. Old overlay endpoint is gone

`GET /map/overlays?category=hssc` now returns 404. Any code that calls this directly must be removed. The `/map/config` no longer references it.

---

## New Capabilities (can implement)

### 1. Building list — `/building/list?campus=hssc`

Returns all 78 buildings with metadata (name, coordinates, image, type, accessibility). Can replace the map marker source or populate a building directory view.

**Response fields per building:**
| Field | Type | Description |
|-------|------|-------------|
| `_id` | int | `skkuId` — use for detail API |
| `buildNo` | string \| null | SKKU raw building code (includes campus prefix). `null` for facilities. |
| `displayNo` | string \| null | Human-readable number (prefix stripped, e.g., "248"→"48"). **Use this for display.** |
| `type` | `"building"` \| `"facility"` | Facilities = gates, parking, fields |
| `name` | `{ ko, en }` | Bilingual name |
| `campus` | `"hssc"` \| `"nsc"` | Campus code |
| `location.coordinates` | `[lng, lat]` | GeoJSON order (longitude first!) |
| `image.url` | string \| null | Building photo |
| `accessibility` | `{ elevator, toilet }` | Disability access booleans |

### 2. Building search — `/building/search?q={query}&campus=hssc`

Searches building names/descriptions and space/room names. Returns two sections:

- `buildings[]` — matched buildings (max 5)
- `spaces[]` — matched spaces grouped by building (max 20 spaces)

Each space group has `skkuId` (for detail navigation), `buildNo`, `displayNo`, `buildingName`, and `items[]` with `spaceCd`, `name`, `floor`.

**Search behavior:**
- Case-insensitive substring match on names/descriptions
- Numeric queries match `displayNo` (user-facing number, e.g., `q=48` → 삼성학술정보관). Raw `buildNo` (e.g., "248") is NOT searchable.
- Alphanumeric queries also match `spaceCd` exactly (e.g., `q=23217` → 첨단e+강의실 in 제1공학관23동)
- `meta` includes `keyword`, `buildingCount`, `spaceCount`

**Flutter navigation from space result:**
- Use `skkuId` from the space group to call `GET /building/:skkuId`
- Pass `floor` and `spaceCd` from the tapped item as navigation params for future floor/space highlighting

### 3. Building detail — `/building/:skkuId`

Returns full building info with floor-grouped spaces:

```json
{
  "building": { "_id": 27, "buildNo": "248", "displayNo": "48", "name": {...}, "attachments": [...], "extensions": {}, ... },
  "floors": [
    {
      "floor": { "ko": "1층", "en": "1F" },
      "spaces": [
        { "spaceCd": "480102", "name": { "ko": "컴넷", "en": "Computer Zone" }, "conspaceCd": null }
      ]
    }
  ]
}
```

- Facilities (`type: "facility"`) return `floors: []`
- `extensions` is `{}` now — reserved for future custom data (indoor maps, tags, etc.)

---

## Coordinate Handling

All building coordinates use **GeoJSON format**: `coordinates: [longitude, latitude]`

```
Server stores:  location.coordinates = [126.974906, 37.293885]  // [lng, lat]
Flutter needs:  NLatLng(37.293885, 126.974906)                  // (lat, lng)
```

The `/map/markers/campus` endpoint pre-converts to flat `lat/lng` fields for convenience. The `/building/list` and `/building/:skkuId` endpoints return raw GeoJSON — Flutter must swap the order.

---

## Data Counts

| What | Count | Notes |
|------|-------|-------|
| Buildings total | 78 | 25 HSSC + 53 NSC |
| Buildings (type=building) | 59 | Have buildNo + floors |
| Facilities (type=facility) | 19 | Gates, parking, fields — no floors |
| Spaces | ~7,500 | Rooms/labs/offices across all buildings |
| Sync frequency | Weekly | + immediate on first boot if DB empty |

---

## Endpoint Summary

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/building/list` | GET | All buildings (map markers, directory) | **New** |
| `/building/search` | GET | Building + space text search | **New** |
| `/building/:skkuId` | GET | Building detail with floors | **New** |
| `/map/markers/campus` | GET | Lean marker data (pre-formatted lat/lng) | Existing (now DB-backed) |
| `/map/config` | GET | Layer definitions (endpoint changed) | **Updated** |
| `/map/overlays?category=` | GET | ~~Building overlays~~ | **Removed (404)** |
| `/map/overlays/:overlayId` | GET | Bus route polylines | Unchanged |
