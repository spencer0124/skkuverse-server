# Flutter Map Overlay Migration Guide

> **Date**: 2026-03-15 (updated)
> **Status**: Server migration complete. Flutter update pending.

---

## What Changed (2026-03-15)

Building marker overlays were **removed from the overlay system** and consolidated into the building module.

### Before

```
/map/config → layers[campus_buildings].endpoint = "/map/overlays?category=hssc"
                                                     ↓
                                          map-overlays.data.js (13 hardcoded markers)
                                          Response: { category, overlays: [{ type, position, marker }] }
```

### After

```
/map/config → layers[campus_buildings].endpoint = "/map/markers/campus"
                                                     ↓
                                          building.data.js → MongoDB (78 DB-backed markers)
                                          Response: { markers: [{ skkuId, buildNo, name, lat, lng, ... }] }
```

### Removed

- `GET /map/overlays?category=hssc` — **returns 404 now**
- `features/map/map-overlays.data.js` — deleted (hardcoded building data)
- ETag/Cache-Control for building overlays — no longer needed (DB-backed with 5min cache)

### Still Active

- `GET /map/overlays/:overlayId` — bus route polylines (`jongro07`, `jongro02`) unchanged
- `GET /map/config` — same structure, only `campus_buildings` endpoint URL changed
- `GET /map/markers/campus` — now the sole source for building markers (78 buildings, both campuses)

---

## Response Shape Change

**Old overlay shape** (removed):
```json
{
  "category": "hssc",
  "overlays": [
    {
      "type": "marker",
      "id": "bldg_hssc_law",
      "position": { "lat": 37.5874, "lng": 126.9905 },
      "marker": { "icon": null, "label": "법학관", "subLabel": "2" }
    }
  ]
}
```

**New markers shape** (`/map/markers/campus`):
```json
{
  "markers": [
    {
      "skkuId": 2,
      "buildNo": "1",
      "type": "building",
      "name": { "ko": "수선관", "en": "Suseon Hall" },
      "campus": "hssc",
      "lat": 37.587,
      "lng": 126.994,
      "image": "https://www.skku.edu/..."
    }
  ]
}
```

### Field Mapping

| Old (overlay) | New (markers) | Notes |
|---------------|---------------|-------|
| `id` (`bldg_hssc_law`) | `skkuId` (int) | Use for detail API: `GET /building/{skkuId}` |
| `position.lat/lng` | `lat/lng` | Flat fields, no nesting |
| `marker.label` | `name.ko` / `name.en` | Bilingual object, select by locale |
| `marker.subLabel` | `buildNo` | Can be `null` for facilities |
| `marker.icon` | *(removed)* | Was always `null` |
| *(none)* | `type` | `"building"` or `"facility"` |
| *(none)* | `campus` | Filter client-side (`"hssc"` or `"nsc"`) |
| *(none)* | `image` | Building photo URL |

---

## Flutter Impact

See `flutter-building-api-guide.md` for the full building API reference.

The Flutter map layer controller needs to handle the new response shape when loading the `campus_buildings` layer. The `/map/config` still drives the layer pipeline — only the endpoint URL and response parser need to change.

Bus route polyline layers (`jongro07`, `jongro02`) are unaffected.
